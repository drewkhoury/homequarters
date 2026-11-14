// Proves: a plugin loads only when it names the ui API it was written for and that API is not newer than HQ's, it gets its
// with block, a bad one is reported and left out, and HQ's own paths cannot be taken. Why: a plugin written for a later
// HQ would render blank pages or throw inside requests; refusing it at load is the only place that can say why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlugins, checkPlugin } from '../lib/plugins.mjs';

const dir = mkdtempSync(join(tmpdir(), 'hq-plugins-'));
const file = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
const good = file('good.mjs', `export const hqApi = 1;\nexport default ({ ui, with: w }) => ({ id: 'launch', label: 'Launch', path: 'launch', demo: false, page: async () => ui.esc('<' + (w.greeting || '')) });`);
// the same plugin written for this HQ's ui
const current = file('current.mjs', `export const hqApi = 2;\nexport default ({ ui, with: w }) => ({ id: 'launch', label: 'Launch', path: 'launch', demo: false, page: async () => ui.esc('<' + (w.greeting || '')) });`);
const noApi = file('noapi.mjs', `export default () => ({ id: 'x', label: 'X', path: 'x', page: async () => '' });`);
const newer = file('newer.mjs', `export const hqApi = 99;\nexport default () => ({ id: 'y', label: 'Y', path: 'y', page: async () => '' });`);
const reserved = file('reserved.mjs', `export const hqApi = 1;\nexport default () => ({ id: 'z', label: 'Z', path: 'testing', page: async () => '' });`);
const throws = file('throws.mjs', `export const hqApi = 1;\nexport default () => { throw new Error('boom'); };`);

test('a plugin written for this HQ\'s ui loads, keeps its with block, and draws with the ui API', async () => {
  const { plugins, failed, warnings } = await loadPlugins({ plugins: [{ path: current, with: { greeting: 'hi' } }] });
  assert.equal(failed.length, 0); assert.deepEqual(warnings, []);
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0].path, 'launch'); assert.equal(plugins[0].demo, false);
  assert.equal(await plugins[0].page({}, new URLSearchParams(), ''), '&lt;hi');
});

test('a plugin that names no hqApi, or a newer one, is refused with the reason; one for an older API loads with a warning', async () => {
  const r = await loadPlugins({ plugins: [noApi, newer] });
  assert.equal(r.plugins.length, 0);
  assert.ok(r.failed[0].why.includes('exports no hqApi'));
  assert.ok(r.failed[1].why.includes('written for ui API 99'));
  const old = await loadPlugins({ plugins: [good] });
  assert.equal(old.plugins.length, 1);
  assert.ok(old.warnings[0].includes('written for ui API 1'));
});

test('a plugin on one of HQ\'s own paths, one that throws, and one that is not there are reported and left out', async () => {
  const { plugins, failed } = await loadPlugins({ plugins: [reserved, throws, join(dir, 'missing.mjs')] });
  assert.equal(plugins.length, 0);
  assert.deepEqual(failed.map(f => f.why), ['path "testing" is one of HQ\'s own', 'boom', 'the file is not there']);
});

test('two plugins cannot share a path, and a plugin must have a page function', () => {
  assert.equal(checkPlugin({ id: 'a', label: 'A', path: 'a', page: () => '' }, new Set(['a'])), 'path "a" is already another plugin\'s');
  assert.equal(checkPlugin({ id: 'a', label: 'A', path: 'a' }), 'it has no page function');
  assert.equal(checkPlugin({ id: 'a', label: 'A', path: 'a', page: () => '', actions: { go: 1 } }), 'actions should be an object of functions');
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
