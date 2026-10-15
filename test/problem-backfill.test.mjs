// Proves: the import of another session's sort of red gates (problem-backfill.mjs) groups the judged lines into
// entries by kind, mode, test and fix, writes them through the register's own writer as record backfill so they meet
// the same checks as a note, and opens nothing for lines that are not problems (dirty trees, red-first commits,
// planted reds).
// Why: a backfilled entry is read beside hand-written ones, so it must keep to the same vocabulary and own only the
// reds that were problems.
import test from 'node:test';
import assert from 'node:assert/strict';
import { entriesFromRedGates, reconcile } from '../problem-backfill.mjs';
import { useQuestKeepStages } from './fixtures/stages.mjs';

useQuestKeepStages();

const line = (over = {}) => ({ run: 'r1', source: 'laptop', when: '2026-10-08T07:00:00Z', commit: 'a6cc739', branch: 'main', runKind: 'docker-gate', partial: false, tests: ['smoke-sync'],
  verdict: 'flaky', kind: 'Flaky test', mode: 'network', factors: [], confidence: 'confirmed', evidence: 'run r1, smoke-sync passed on a6cc739 in run r2', fix: 'a1700cff', record: 'backfill', ...over });
const infraSig = run => ({ r9: 'task:unit' }[run] || null); // r9's infra red was its unit task's

test('reds of one test and kind are one entry, first seen at the earliest, listing its runs', () => {
  const es = entriesFromRedGates([line(), line({ run: 'r2', when: '2026-10-08T06:00:00Z' }), line({ tests: ['smoke-prep'] })], { infraSig });
  assert.equal(es.length, 2);
  const sync = es.find(e => e.note.signature === 'smoke-sync');
  assert.deepEqual(sync.note, { title: 'Flaky test in smoke-sync (network)', kind: 'flaky-test', mode: 'network', signature: 'smoke-sync', confidence: 'confirmed',
    evidence: '2 red gate runs, the first r2', seenFrom: '2026-10-08T06:00:00Z', record: 'backfill', fix: 'a1700cff', runs: ['r2', 'r1'] });
  assert.deepEqual(sync.close, { disposition: 'fixed', fix: 'a1700cff' });
});

test('lines that are not problems open nothing', () => {
  assert.deepEqual(entriesFromRedGates(['dirty', 'red-first', 'planted'].map(verdict => line({ verdict, kind: null, mode: null })), { infraSig }), []);
  assert.deepEqual(entriesFromRedGates([line({ verdict: 'dirty' })], { infraSig }), [], 'whatever kind the line carries');
});

test("a red that names no test takes the signature of its run's infra red", () => {
  const [e] = entriesFromRedGates([line({ run: 'r9', tests: [], verdict: 'infra', kind: 'Tooling', mode: 'runner', fix: null })], { infraSig });
  assert.equal(e.note.signature, 'task:unit');
  assert.equal(e.close, null, 'no fix, so it stays open');
  const [none] = entriesFromRedGates([line({ run: 'r0', tests: [], verdict: 'infra', kind: 'Tooling', mode: 'runner', fix: null })], { infraSig });
  assert.equal(none.note.signature, 'task:docker-gate', 'else the task named after its kind of run');
});

test('factors read by their labels, an unknown mode stays out of the title, and confidence is the surest of its reds', () => {
  const [e] = entriesFromRedGates([line({ factors: ['shared state', 'clock', 'made up'], mode: 'unknown', confidence: 'suspected' }), line({ mode: 'unknown', confidence: 'confirmed', run: 'r2' })], { infraSig });
  assert.deepEqual(e.note.factors, ['shared-state', 'clock']);
  assert.equal(e.note.mode, 'unknown');
  assert.equal(e.note.title, 'Flaky test in smoke-sync');
  assert.equal(e.note.confidence, 'confirmed', 'confirmed when any of its reds is');
});

test('a red is found at the stage the pipeline file gives its place and task, and at no stage when the file gives none', () => {
  assert.equal(entriesFromRedGates([line({ source: 'ci', runKind: 'gate' })], { infraSig })[0].note.foundAt, 'pr-gate');
  assert.equal(entriesFromRedGates([line({ source: 'container', runKind: 'docker-gate' })], { infraSig })[0].note.foundAt, 'pr-gate');
  assert.equal(entriesFromRedGates([line({ source: 'laptop', runKind: 'docker-gate' })], { infraSig })[0].note.foundAt, undefined);
});

test('each entry has a key of its own, the same on every import, so a second import opens nothing new', () => {
  const a = entriesFromRedGates([line(), line({ tests: ['smoke-prep'] })], { infraSig }), b = entriesFromRedGates([line(), line({ tests: ['smoke-prep'] })], { infraSig });
  assert.deepEqual(a.map(e => e.key), b.map(e => e.key));
  assert.equal(new Set(a.map(e => e.key)).size, 2);
  assert.match(a[0].key, /^[0-9a-f]{6}$/, 'six hex digits: about 50 flaky test entries a day would often share four');
});

test("a unit test named by its title in the sort takes its file's path, as fix commits name it", () => {
  const keyOf = (task, name) => (name === 'a waiter stopped before its turn logs that it left' ? 'tests/unit/lock.test.mjs' : name);
  const [e] = entriesFromRedGates([line({ tests: ['a waiter stopped before its turn logs that it left'], kind: 'Test failure', mode: 'unknown', verdict: 'code', fix: null })], { infraSig, keyOf });
  assert.equal(e.note.signature, 'tests/unit/lock.test.mjs');
});

// Juno's check of the import: grouping by mode and fix gave 22 tests more than one entry, each opened as the one before it
// closed, which the reader read as coming back at the moment of the import.
test('one entry per kind and test, with its commonest mode and its latest fix', () => {
  const es = entriesFromRedGates([line({ mode: 'timeout', fix: 'b0b0b0b', when: '2026-10-01T07:00:00Z', run: 'r1' }), line({ mode: 'network', fix: 'a1700cff', when: '2026-10-08T07:00:00Z', run: 'r2' }),
    line({ mode: 'network', fix: null, when: '2026-10-05T07:00:00Z', run: 'r3' })], { infraSig });
  assert.equal(es.length, 1);
  assert.deepEqual([es[0].note.mode, es[0].note.fix, es[0].close.fix, es[0].note.runs], ['network', 'a1700cff', 'a1700cff', ['r1', 'r3', 'r2']]);
});

// A sort corrected after its first import (the Delivery session re-judged 8 lines on 11 October) is imported again: each
// entry it makes is matched to the backfilled entry of the same kind and test, and only what changed is written.
const was = (over = {}) => ({ id: 'P-2026-10-11-flaky-test-aaaaaa', record: 'backfill', status: 'open', kind: 'flaky-test', mode: 'network', signature: 'smoke-sync',
  confidence: 'confirmed', evidence: '1 red gate run, the first r1', seenFrom: '2026-10-08T07:00:00Z', title: 'Flaky test in smoke-sync (network)', runs: ['r1'], ...over });
const planOf = lines => entriesFromRedGates(lines, { infraSig });

test('an entry the corrected sort makes the same writes nothing again', () => {
  assert.deepEqual(reconcile(planOf([line({ fix: null })]), [was()]), []);
});

test('a backfilled entry whose mode, fix or runs changed gets one set of what changed, and a close when it is still open', () => {
  const acts = reconcile(planOf([line({ mode: 'timeout' }), line({ run: 'r2', mode: 'timeout', when: '2026-10-08T08:00:00Z' })]), [was()]);
  assert.deepEqual(acts, [
    { op: 'set', id: 'P-2026-10-11-flaky-test-aaaaaa', fields: { title: 'Flaky test in smoke-sync (timeout)', mode: 'timeout', evidence: '2 red gate runs, the first r1', fix: 'a1700cff', runs: ['r1', 'r2'] } },
    { op: 'close', id: 'P-2026-10-11-flaky-test-aaaaaa', fields: { disposition: 'fixed', fix: 'a1700cff' } },
  ]);
  assert.deepEqual(reconcile(planOf([line()]), [was({ status: 'closed', fix: 'a1700cff' })]), [], 'closed with that fix already');
});

test('a new kind and test opens an entry, and the entry that lost all its runs to it is merged into it', () => {
  const acts = reconcile(planOf([line({ verdict: 'infra', kind: 'Tooling', mode: 'makefile', fix: '936f8e10' })]), [was()]);
  const [note, merge] = acts;
  assert.equal(note.op, 'note');
  assert.equal(note.plan.note.kind, 'tooling-breakage');
  assert.deepEqual(merge, { op: 'merge', id: 'P-2026-10-11-flaky-test-aaaaaa', into: { key: note.plan.key } });
  assert.equal(acts.length, 2);
});

test('an entry merges into the one holding most of its runs, into an existing entry by its id', () => {
  const tooling = was({ id: 'P-2026-10-11-tooling-breakage-bbbbbb', kind: 'tooling-breakage', mode: 'makefile', signature: 'smoke-sync', title: 'Tooling in smoke-sync (makefile)', runs: ['r3'], evidence: '1 red gate run, the first r3' });
  const acts = reconcile(planOf([line({ run: 'r1', verdict: 'infra', kind: 'Tooling', mode: 'makefile', fix: null }), line({ run: 'r2', verdict: 'infra', kind: 'Tooling', mode: 'makefile', fix: null }), line({ run: 'r9', tests: ['smoke-prep'], fix: null })]),
    [was({ runs: ['r1', 'r2', 'r9'] }), tooling]);
  assert.deepEqual(acts.find(a => a.op === 'merge'), { op: 'merge', id: 'P-2026-10-11-flaky-test-aaaaaa', into: 'P-2026-10-11-tooling-breakage-bbbbbb' });
});

test('a backfilled entry none of whose runs the sort still calls a problem is left as it is and named', () => {
  assert.deepEqual(reconcile(planOf([line({ verdict: 'dirty' })]), [was()]), [{ op: 'left', id: 'P-2026-10-11-flaky-test-aaaaaa', why: 'no entry of the sort holds any of its runs' }]);
});

test('live entries, and backfilled ones already merged or dropped, are never touched', () => {
  assert.deepEqual(reconcile(planOf([line({ verdict: 'dirty' })]), [was({ record: 'live' }), was({ id: 'P-2026-10-11-flaky-test-cccccc', status: 'merged' }), was({ id: 'P-2026-10-11-flaky-test-dddddd', status: 'dropped' })]), []);
  const acts = reconcile(planOf([line({ fix: null })]), [was({ record: 'live' })]);
  assert.deepEqual(acts.map(a => a.op), ['note'], 'a live entry of the same kind and test is no match: the sort adds its own');
});
