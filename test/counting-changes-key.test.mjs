// Proves: a project lists its own counting notes in hq.json (delivery.countingChanges): the manifest keeps the
// well-formed ones and warns on the rest; Delivery shows a note that names a decision file while the file is there and
// one that names none always; and hq check reports a note whose decision file is missing.
// Why: the notes were QuestKeep's history written into the package, shown to anyone whose repo happened to hold the same
// decision files. A project's own list belongs in its manifest, and a renamed decision file must not make a note
// vanish without anyone being told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadManifest } from '../lib/manifest.mjs';
import { countingChangesFor } from '../lib/dora.mjs';
import { checks } from '../lib/check.mjs';

// Two made-up notes: one tied to a decision file, one from before the project kept decisions.
const FILED = { date: '2026-03-02', what: 'Gate time leaves out reused gates.', decision: '2026-03-02-reuse.md' };
const EARLY = { date: '2026-01-10', what: 'Deploys skip a tree already live.' };

function repoWith(t, notes, files = []) {
  const repo = mkdtempSync(join(tmpdir(), 'hq-counting-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, 'docs', 'decisions'), { recursive: true });
  for (const f of files) writeFileSync(join(repo, 'docs', 'decisions', f), '# A decision\n\nWhy it was made.\n');
  writeFileSync(join(repo, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'app', decisions: { dir: 'docs/decisions' }, delivery: { countingChanges: notes } }));
  return repo;
}

test('the manifest keeps well-formed notes, names a missing decision null, and warns on the rest', t => {
  const repo = repoWith(t, [FILED, EARLY, { date: 'March', what: 'x' }, { date: '2026-01-01', what: 'y', decision: '../up.md' }]);
  const { m, warnings } = loadManifest(repo, { home: repo, env: {} });
  assert.deepEqual(m.delivery.countingChanges, [FILED, { ...EARLY, decision: null }]);
  assert.equal(warnings.filter(w => /countingChanges\[\d\]/.test(w)).length, 2, warnings.join('\n'));
});

test('a note shows while its decision file is there, and one with no file always shows', () => {
  const own = [FILED, { ...EARLY, decision: null }];
  assert.deepEqual(countingChangesFor('/r/docs/decisions', () => true, null, own), own);
  assert.deepEqual(countingChangesFor('/r/docs/decisions', () => false, null, own), [own[1]]);
});

test('hq check reports a note whose decision file is not in the folder, and nothing when it is', t => {
  const missing = repoWith(t, [FILED]);
  const found = checks(missing, loadManifest(missing, { home: missing, env: {} }), { files: [] }).filter(p => p.area === 'delivery');
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /2026-03-02-reuse\.md/);
  const present = repoWith(t, [FILED], [FILED.decision]);
  assert.deepEqual(checks(present, loadManifest(present, { home: present, env: {} }), { files: [] }).filter(p => p.area === 'delivery'), []);
});
