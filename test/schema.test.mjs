// Proves: every convention file the manifest names may carry a schema number, a missing one reads as 1, and a newer one
// or a malformed one warns once at start while the file is still read. Why: HQ cannot know which version of a convention
// a project's files follow, so the reader is forgiving in exactly the manifest's way and says so where a person looks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { schemaWarning, conventionWarnings, SCHEMAS } from '../lib/schema.mjs';

test('no schema reads as the first; the current one is quiet; a newer one or a bad one warns and names the file key', () => {
  assert.equal(schemaWarning('tests.layers', { layers: [] }), null);
  assert.equal(schemaWarning('tests.layers', { schema: 1, layers: [] }), null);
  assert.match(schemaWarning('tests.layers', { schema: 2, layers: [] }), /tests\.layers: schema 2 is newer than this HQ reads \(1\)/);
  assert.match(schemaWarning('docs.groups', { schema: '1', groups: [] }), /docs\.groups: schema should be a whole number/);
  assert.equal(schemaWarning('demo', ['not', 'an', 'object']), null, 'a shape that is not an object is another check\'s problem');
  assert.deepEqual(Object.keys(SCHEMAS), ['tests.layers', 'tests.pipeline', 'tests.sets', 'docs.groups', 'demo']);
});

test('the warnings for a manifest are read once from its files; a missing or unparsable file earns none here', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-schema-'));
  const f = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
  const m = {
    tests: { layers: f('layers.json', '{"schema":1,"layers":[]}'), pipeline: f('pipeline.json', '{"schema":3,"stages":[],"paths":[]}'), sets: f('sets.json', 'not json') },
    docs: { groups: join(dir, 'missing.json') },
    demo: f('demo.json', '{"schema":0}'),
  };
  const w = conventionWarnings(m);
  assert.equal(w.length, 2, w.join('\n'));
  assert.ok(w.some(x => x.startsWith('tests.pipeline: schema 3 is newer')));
  assert.ok(w.some(x => x.startsWith('demo: schema should be a whole number')));
  assert.deepEqual(conventionWarnings({}), []);
  rmSync(dir, { recursive: true, force: true });
});

test('every convention key is checked, and a file holding null is nobody\'s crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-schema-all-'));
  const f = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
  const m = { tests: { layers: f('l.json', '{"schema":2}'), pipeline: f('p.json', '{"schema":2}'), sets: f('s.json', '{"schema":2}') }, docs: { groups: f('g.json', '{"schema":2}') }, demo: f('d.json', 'null') };
  const w = conventionWarnings(m);
  assert.deepEqual(w.map(x => x.split(':')[0]).sort(), ['docs.groups', 'tests.layers', 'tests.pipeline', 'tests.sets'], w.join('\n'));
  rmSync(dir, { recursive: true, force: true });
});
