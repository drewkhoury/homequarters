// Proves: schema/hq.schema.json, the JSON Schema for hq.json schema 1, names exactly the keys docs/standards/manifest.md
// documents and lib/manifest.mjs reads, at the top and inside each object key; QuestKeep's real manifest passes it; and
// it refuses what the manifest's reader warns about (a bad name, an unknown key, a store HQ does not know).
// Why: the schema ships in the tarball for editors and other tools, and it is part of the contract (contract.md). A key
// added to the reader or the doc and not the schema, or the other way round, would make the three disagree silently.
// The fixture is QuestKeep's switch-branch hq.json with tests.sets removed, as decision 13 leaves tests/sets.json out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYS, SUBKEYS } from '../lib/manifest.mjs';
import { validate } from '../lib/schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const SCHEMA = JSON.parse(read('schema/hq.schema.json'));

// The table under "The keys of schema 1": each row's key and its description.
const rows = (() => {
  const doc = read('docs/standards/manifest.md');
  const table = doc.slice(doc.indexOf('## The keys of schema 1'), doc.indexOf('\n## ', doc.indexOf('## The keys of schema 1') + 5));
  return Object.fromEntries(table.split('\n').filter(l => /^\| `/.test(l)).map(l => { const [, key, , about] = l.split('|').map(c => c.trim()); return [key.replace(/`/g, ''), about]; }));
})();
const props = s => Object.keys(s.properties || {}).sort();
const objectKeys = Object.keys(SUBKEYS);
// a key's object form in the schema: the key itself when it is an object, or the object branch of an anyOf (info)
const objectOf = k => { const s = SCHEMA.properties[k]; return s.type === 'object' ? s : (s.anyOf || []).find(b => b.type === 'object'); };

test('the schema, the doc\'s table and the reader name the same top-level keys', () => {
  assert.deepEqual(props(SCHEMA), Object.keys(rows).sort(), 'schema and manifest.md');
  assert.deepEqual(props(SCHEMA), [...KEYS].sort(), 'schema and lib/manifest.mjs');
});

test('inside each object key, the schema and the reader name the same keys, and the doc\'s row names each of them', () => {
  for (const k of objectKeys) {
    const o = objectOf(k);
    assert.ok(o, `${k} has an object form in the schema`);
    assert.deepEqual(props(o), [...SUBKEYS[k]].sort(), `${k}: schema and lib/manifest.mjs`);
    assert.equal(o.additionalProperties, false, `${k}: an unknown key inside it is refused, as the reader warns`);
    // every word in backticks in the row that could be a key (no dot, slash or space) is one, and every key is in the row
    const named = [...rows[k].matchAll(/`([A-Za-z]+)`/g)].map(m => m[1]).filter(w => !['true', 'false'].includes(w));
    for (const w of named) assert.ok(SUBKEYS[k].includes(w), `${k}: manifest.md names \`${w}\`, which the schema does not have`);
    for (const sk of SUBKEYS[k]) assert.ok(named.includes(sk), `${k}: the schema has ${sk}, which manifest.md's row does not name`);
  }
});

test('QuestKeep\'s manifest, from its switch branch, passes the schema', () => {
  assert.deepEqual(validate(SCHEMA, JSON.parse(read('test/fixtures/questkeep-hq.json'))), []);
  assert.deepEqual(validate(SCHEMA, { ...JSON.parse(read('test/fixtures/questkeep-hq.json')), link: 'web/.hq.json' }), [], 'and with the link file named');
});

test('the schema refuses what the reader warns about, and says where', () => {
  const ok = { schemaVersion: 1, name: 'doors' };
  assert.deepEqual(validate(SCHEMA, ok), []);
  const errs = v => validate(SCHEMA, v);
  assert.match(errs({ ...ok, name: 'Doors!' }).join('\n'), /^name: /m);
  assert.match(errs({ ...ok, futureKey: 1 }).join('\n'), /futureKey/);
  assert.match(errs({ ...ok, docs: { home: 'README.md', hom: 'x' } }).join('\n'), /^docs: .*hom/m);
  assert.match(errs({ ...ok, stores: ['runs', 'weather'] }).join('\n'), /^stores\/1/m);
  assert.match(errs({ ...ok, schemaVersion: 0 }).join('\n'), /^schemaVersion: /m);
  assert.match(errs({ name: 'doors' }).join('\n'), /schemaVersion/);
  assert.match(errs({ ...ok, plugins: [{ with: {} }] }).join('\n'), /^plugins\/0/m);
  assert.match(errs({ ...ok, link: true }).join('\n'), /^link: /m);
  assert.deepEqual(errs({ ...ok, info: true, stores: [{ id: 'ci', path: 'ci-results' }], plugins: ['./p.mjs'], backlog: { dir: 'docs/backlog', stages: ['next', { id: 'later' }] } }), [], 'the string and object forms of a list element');
});
