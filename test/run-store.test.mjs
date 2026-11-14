// Proves: HQ's reading of the recorded runs answers what 0.3.0's did, on a store holding the shapes devpipe, the
// Makefile and CI write: the runs, the flakes, each test file's results and the Problems page's results, cold and warm.
// Why: the run store reads each run once and keeps it, so every page that says "the last run passed" must still say
// what the old reading said. test/fixtures/runs-store/expected.json is 0.3.0's answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStore, answersOf } from './run-fixtures.mjs';
import { allRuns, FILES } from '../lib/runs.mjs';

const EXPECTED = JSON.parse(readFileSync(new URL('./fixtures/runs-store/expected.json', import.meta.url), 'utf8'));

test("the runs, flakes and results read from the store are 0.3.0's, read cold and read again", () => {
  const s = buildStore();
  try {
    assert.deepEqual(answersOf(s), EXPECTED, 'cold');
    assert.deepEqual(answersOf(s), EXPECTED, 'warm');
  } finally { s.done(); }
});

// The files a read of the store opens, by path relative to the cache, each with how many times it was opened.
function counting(cache) {
  const opened = new Map(), note = p => opened.set(p.slice(cache.length + 1), (opened.get(p.slice(cache.length + 1)) || 0) + 1);
  const io = { read: p => (note(p), FILES.read(p)), head: p => (note(p), FILES.head(p)), exists: FILES.exists };
  return { io, opened, clear: () => opened.clear() };
}
// maxAge 0: look at the folders on every call, as a call a second after the last one does
const read = (s, io) => allRuns(s.cache, { io, maxAge: 0 });

test('a new run is read once, and the runs already read are not read again', () => {
  const s = buildStore(), c = counting(s.cache);
  try {
    read(s, c.io);
    c.clear();
    assert.equal(read(s, c.io).length, 22);
    assert.deepEqual([...c.opened.keys()], [], 'nothing changed, so nothing is opened');
    s.laptop('2026-11-06T09-00-00Z_000013', { at: '2026-11-06T09:01:00Z', tasks: [{ id: 'unit', cases: [{ name: 'the newer copy wins', status: 'passed', time: 0.01 }], info: { kind: 'test' } }] });
    s.ci('junit-64-1-gate', { run: '64', attempt: 1, at: '2026-11-06T18:00:00Z' }, { 'gate.xml': '<testsuite><testcase name="smoke-sync" time="20"/></testsuite>' });
    const runs = read(s, c.io);
    assert.deepEqual(runs.slice(0, 2).map(r => r.id), ['junit-64-1-gate', '2026-11-06T09-00-00Z_000013']);
    assert.deepEqual([...c.opened].filter(([p]) => p.endsWith('run.json')).sort(),
      [['ci/junit-64-1-gate/run.json', 1], ['runs/runs/2026-11-06T09-00-00Z_000013/run.json', 1]]);
    assert.deepEqual([...c.opened.keys()].filter(p => !p.includes('_000013') && !p.includes('junit-64-')), [], 'no run read before is opened again');
  } finally { s.done(); }
});

test('a run that finishes after HQ first looked is shown, with its results', () => {
  const s = buildStore();
  try {
    assert.equal(read(s).some(r => r.id === '2026-11-04T09-00-00Z_000011'), false, 'still running: no run.json yet');
    s.laptop('2026-11-04T09-00-00Z_000011', { at: '2026-11-04T09:01:00Z', tasks: [{ id: 'unit', cases: [{ name: 'the newer copy wins', status: 'passed', time: 0.01 }], info: { kind: 'test' } }] });
    const r = read(s).find(x => x.id === '2026-11-04T09-00-00Z_000011');
    assert.deepEqual([r?.ok, r?.tasks.map(t => t.id)], [true, ['unit']]);
  } finally { s.done(); }
});

test('a CI folder that gains a file after HQ first read it is read again', () => {
  const s = buildStore();
  try {
    const tasks = () => read(s).find(r => r.id === 'junit-62-1-load').tasks.map(t => t.id);
    assert.deepEqual(tasks(), ['gate']);
    writeFileSync(join(s.cache, 'ci', 'junit-62-1-load', 'unit.xml'), '<testsuite><testcase name="midnight rolls the day" time="0.01"/></testsuite>');
    assert.deepEqual(tasks(), ['gate', 'unit']);
  } finally { s.done(); }
});

// What is worked out from the runs is kept against the store's array, and the catalogue against its list of files:
// these hold that a new run, or a changed test file, is worked out afresh and never answered from the last one.
test('after a new run, the flakes and the test file results include it', async () => {
  const { flakes, resultsByFile } = await import('../lib/runs.mjs');
  const { catalogue } = await import('../lib/catalogue.mjs');
  const s = buildStore();
  try {
    const before = read(s), files = catalogue(s.repo);
    assert.equal(flakes(before).some(f => f.test === 'the newer copy wins'), false);
    const merges = () => resultsByFile(read(s), files).get('tests/unit/merge.test.mjs').length;
    const was = merges();
    // the same commit's unit run red on a test that passed before: a new flake
    s.laptop('2026-11-06T10-00-00Z_000014', { at: '2026-11-06T10:01:00Z', tasks: [{ id: 'unit', status: 'FAIL', cases: [{ name: 'the newer copy wins', status: 'failed', time: 0.01 }], info: { kind: 'test' } }] });
    const after = read(s);
    assert.notEqual(after, before, 'a new run is a new array');
    assert.equal(flakes(after).some(f => f.test === 'the newer copy wins' && f.kind === 'test'), true);
    assert.equal(merges(), was + 1);
  } finally { s.done(); }
});

test('a test file whose titles change is read again into the catalogue', async () => {
  const { catalogue } = await import('../lib/catalogue.mjs');
  const s = buildStore();
  try {
    const titles = () => catalogue(s.repo, { maxAge: 0 }).find(f => f.path === 'tests/unit/merge.test.mjs').titles;
    assert.deepEqual(titles(), ['the newer copy wins']);
    assert.equal(catalogue(s.repo, { maxAge: 0 }), catalogue(s.repo, { maxAge: 0 }), 'unchanged, the same list');
    writeFileSync(join(s.repo, 'tests', 'unit', 'merge.test.mjs'), "test('the newer copy wins', () => {});\ntest('a tombstone outlives the copy', () => {});\n");
    assert.deepEqual(titles(), ['the newer copy wins', 'a tombstone outlives the copy']);
    writeFileSync(join(s.repo, 'tests', 'unit', 'fresh.test.mjs'), "test('a new file is found', () => {});\n");
    assert.equal(catalogue(s.repo, { maxAge: 0 }).some(f => f.path === 'tests/unit/fresh.test.mjs'), true);
  } finally { s.done(); }
});
