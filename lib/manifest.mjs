// The manifest, hq.json at the repo root: how a project declares itself to HQ. HQ reads no folder the manifest does not
// name. Every key but schemaVersion and name is optional, and a missing key turns its feature off, so a repo with no
// manifest gets the baseline (Home, Repo, Machine, GitHub, Conversations, Export) and nothing else.
//
// Versioning: schemaVersion is an integer. HQ at SCHEMA reads every manifest from 1 to SCHEMA. A manifest newer than HQ is
// read anyway, with a warning. Unknown keys are listed as warnings and never acted on. A key, once published, is never
// renamed or removed; a replaced key stays readable and the warning says what replaces it (RENAMED below).
// Paths are from the repo root, or start with ~ for the home folder. Nothing here reads a folder: it only resolves names.
import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute, basename, resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';

export const SCHEMA = 1;
export const FILE = 'hq.json';
// the keys schema 1 knows, with what each turns on
export const KEYS = ['schemaVersion', 'name', 'cache', 'docs', 'backlog', 'decisions', 'tests', 'stores', 'info', 'deploy', 'plugins', 'demo', 'delivery'];
// a key that was replaced keeps working and says what to use instead; none yet
export const RENAMED = {};
export const STORES = ['runs', 'lock', 'problems', 'dora', 'ci'];

// A path from the manifest as an absolute one: ~ is the home folder, anything relative is from the repo root.
export function expand(p, { repo, home = homedir() }) {
  if (p == null || p === '') return null;
  const s = String(p);
  if (s === '~') return home;
  if (s.startsWith('~/')) return join(home, s.slice(2));
  return isAbsolute(s) ? s : resolvePath(repo, s);
}

// The raw file, or null when there is none. A file that is not JSON is an error, never silently ignored.
export function readManifest(repo) {
  const file = join(repo, FILE);
  if (!existsSync(file)) return { file, raw: null, present: false, error: null };
  try { return { file, raw: JSON.parse(readFileSync(file, 'utf8')), present: true, error: null }; }
  catch (e) { return { file, raw: null, present: true, error: `${FILE} is not valid JSON: ${e.message}` }; }
}

// What a repo with no manifest gets: the name of its folder, a cache under ~/.cache/hq, and no conventions.
export function defaults(repo, home = homedir()) {
  const name = basename(repo);
  return { name, cache: join(home, '.cache', 'hq', name) };
}

// The manifest as the pages use it: every path absolute, every feature a boolean, every store a folder or null.
export function resolveManifest(raw, { repo, home = homedir() }) {
  const warnings = [];
  const d = defaults(repo, home);
  const r = raw || {};
  if (raw) {
    if (r.schemaVersion == null) warnings.push(`${FILE} has no schemaVersion; read as schema ${SCHEMA}`);
    else if (!Number.isInteger(r.schemaVersion) || r.schemaVersion < 1) warnings.push(`${FILE} has schemaVersion ${JSON.stringify(r.schemaVersion)}, which is not a whole number from 1; read as schema ${SCHEMA}`);
    else if (r.schemaVersion > SCHEMA) warnings.push(`${FILE} is schema ${r.schemaVersion}, newer than this HQ (schema ${SCHEMA}); keys it does not know are listed below and left alone`);
    for (const k of Object.keys(r)) {
      if (RENAMED[k]) warnings.push(`${FILE}: "${k}" is now "${RENAMED[k]}"; it still works`);
      else if (!KEYS.includes(k)) warnings.push(`${FILE}: "${k}" is not a key this HQ knows; left alone`);
    }
  }
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : d.name;
  const cache = expand(r.cache, { repo, home }) || join(home, '.cache', 'hq', name);
  const p = v => expand(v, { repo, home });
  const list = (v, what) => { if (v == null) return []; if (Array.isArray(v)) return v; warnings.push(`${FILE}: "${what}" should be a list; ignored`); return []; };
  const obj = (v, what) => { if (v == null || v === false) return null; if (typeof v === 'object' && !Array.isArray(v)) return v; warnings.push(`${FILE}: "${what}" should be an object; ignored`); return null; };

  const docs = { home: (r.docs && r.docs.home) || 'README.md', groups: p(r.docs && r.docs.groups) };
  const bl = obj(r.backlog, 'backlog');
  const backlog = bl && bl.dir ? { dir: p(bl.dir), rel: String(bl.dir).replace(/\/$/, ''), stages: list(bl.stages, 'backlog.stages').length ? bl.stages : ['inbox', 'next', 'parked'], map: p(bl.map), earlier: p(bl.earlier), earlierRel: bl.earlier || null } : null;
  const de = obj(r.decisions, 'decisions');
  const decisions = de && de.dir ? { dir: p(de.dir), rel: String(de.dir).replace(/\/$/, ''), earlier: p(de.earlier), earlierRel: de.earlier || null } : null;
  const te = obj(r.tests, 'tests');
  const tests = te ? { layers: p(te.layers), pipeline: p(te.pipeline), headers: list(te.headers, 'tests.headers') } : null;
  const stores = list(r.stores, 'stores').filter(s => { if (STORES.includes(s)) return true; warnings.push(`${FILE}: store "${s}" is not one this HQ knows (${STORES.join(', ')}); left alone`); return false; });
  const store = n => (stores.includes(n) ? join(cache, n) : null);
  const deploy = list(r.deploy, 'deploy').filter(x => x && typeof x === 'object' && x.provider);
  const plugins = list(r.plugins, 'plugins').map(x => p(x)).filter(Boolean);
  const dl = obj(r.delivery, 'delivery');
  const delivery = { userPaths: list(dl && dl.userPaths, 'delivery.userPaths') };
  const info = r.info === true || (r.info && typeof r.info === 'object') ? { file: join(repo, '.git', 'project-info.json') } : null;

  const features = {
    backlog: !!backlog, decisions: !!decisions,
    testing: !!(tests || store('runs') || store('ci')),
    delivery: !!store('dora'), problems: !!store('problems'),
    deploys: deploy.length > 0, info: !!info,
  };
  return {
    m: { schemaVersion: raw ? (Number.isInteger(r.schemaVersion) && r.schemaVersion >= 1 ? r.schemaVersion : SCHEMA) : null, present: !!raw, name, repo, cache,
      docs, backlog, decisions, tests, stores, store, info, deploy, plugins, demo: p(r.demo), delivery, features },
    warnings,
  };
}

// readManifest and resolveManifest in one: what the server wants when it starts.
export function loadManifest(repo, { home = homedir() } = {}) {
  const read = readManifest(repo);
  const { m, warnings } = resolveManifest(read.raw, { repo, home });
  if (read.error) warnings.unshift(read.error);
  return { m, warnings, file: read.file, present: read.present };
}

// The pages a manifest turns on, in nav order: the baseline first, then each convention the manifest names.
export function pagesFor(m, plugins = []) {
  const f = m.features;
  return [
    ['home', 'Home', '/'],
    ['repo', 'Repo', '/repo'],
    ['machine', 'Machine', '/machine'],
    f.testing && ['testing', 'Testing', '/testing'],
    f.backlog && ['backlog', 'Backlog', '/backlog'],
    f.decisions && ['decisions', 'Decisions', '/decisions'],
    ['conversations', 'Conversations', '/conversations'],
    ['github', f.deploys ? 'GitHub & Deploys' : 'GitHub', '/github'],
    f.delivery && ['delivery', 'Delivery', '/delivery'],
    f.problems && ['problems', 'Problems', '/problems'],
    ...plugins.map(pl => [pl.id, pl.label, `/${pl.path}`]),
    ['export', 'Export', '/export'],
  ].filter(Boolean);
}
