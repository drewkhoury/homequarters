// Plugins: pages a project adds to HQ, named in the manifest's plugins list. A plugin is an ES module whose default export
// is a function taking { ui, m } and answering { id, label, path, page(ctx, params, rest), actions?, demo? }:
//   id       a short word, used as the nav key
//   label    what the nav shows
//   path     the first part of its URL, letters and dashes, which must not be one of HQ's own
//   page     async (ctx, params, rest) => HTML for GET /<path> and /<path>/<rest>, or null for a 404
//   actions  { name: async (body, ctx) => result } for POST /plugin/<id>/<name>, JSON in and JSON out; optional
//   demo     false hides the page in the demo setting; default true
// The ui object is the only API HQ promises a plugin (lib/ui-api.mjs). A plugin that fails to load is reported on the
// Machine page and left out; it never stops HQ.
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { ui } from './ui-api.mjs';

export const RESERVED = new Set(['', 'code', 'repo', 'machine', 'backlog', 'decisions', 'conversations', 'ci', 'export', 'testing', 'runs', 'search', 'delivery', 'problems', 'github', 'docs', 'tests', 'pipeline', 'hq', 'theme', 'raw', 'cache', 'plugin', 'reveal', 'git', 'claude', 'setup']);
const PATH = /^[a-z][a-z0-9-]{0,40}$/;

// What a loaded plugin must look like; answers the problem in words, or null when it is fine.
export function checkPlugin(p, taken = new Set()) {
  if (!p || typeof p !== 'object') return 'the module\'s default export did not answer an object';
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(String(p.id || ''))) return `id ${JSON.stringify(p.id)} should be a short lower-case word`;
  if (typeof p.label !== 'string' || !p.label.trim()) return 'it has no label';
  if (!PATH.test(String(p.path || ''))) return `path ${JSON.stringify(p.path)} should be a short lower-case word`;
  if (RESERVED.has(p.path)) return `path "${p.path}" is one of HQ's own`;
  if (taken.has(p.path)) return `path "${p.path}" is already another plugin's`;
  if (typeof p.page !== 'function') return 'it has no page function';
  if (p.actions && (typeof p.actions !== 'object' || Object.values(p.actions).some(a => typeof a !== 'function'))) return 'actions should be an object of functions';
  return null;
}

// Every plugin the manifest names, loaded in order: { plugins: [...], failed: [{ file, why }] }.
export async function loadPlugins(m, { load = f => import(pathToFileURL(f).href) } = {}) {
  const plugins = [], failed = [], taken = new Set();
  for (const file of m.plugins || []) {
    if (!existsSync(file)) { failed.push({ file, why: 'the file is not there' }); continue; }
    try {
      const mod = await load(file);
      const make = mod.default;
      if (typeof make !== 'function') { failed.push({ file, why: 'the module has no default export function' }); continue; }
      const p = await make({ ui, m });
      const why = checkPlugin(p, taken);
      if (why) { failed.push({ file, why }); continue; }
      taken.add(p.path);
      plugins.push({ ...p, file, demo: p.demo !== false });
    } catch (e) { failed.push({ file, why: e.message }); }
  }
  return { plugins, failed };
}
