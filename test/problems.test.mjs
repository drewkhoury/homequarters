// The problem register's ledger (hq/lib/problems.mjs, docs/plans/problem-register.md). Each line of the events file is
// one event about one entry, appended whole and never rewritten, so an entry's state is its events read in order. These
// tests pin how events become entries: the order they are read in, which events are refused and shown as not placed
// rather than allowed to rewrite history, which fields are kept, and how a redaction hides a field everywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, KINDS, MODES, STAGES, STAGE, BEFORE_MERGE, FIELDS } from '../lib/problems.mjs';
import { useQuestKeepStages } from './fixtures/stages.mjs';

useQuestKeepStages();

const ID = 'P-2026-10-11-smoke-wake-a1b2', OTHER = 'P-2026-10-11-smoke-sync-c3d4';
const at = (day, rest = 'T09:00:00.000Z') => `2026-10-${String(day).padStart(2, '0')}${rest}`;
const opened = (day, fields = {}, id = ID) => ({ at: at(day), ev: 'opened', id, by: 'builder', fields: { title: 'smoke-wake times out waiting for the wake banner', kind: 'flaky-test', signature: 'smoke-wake', ...fields } });
const ev = (day, e, id = ID) => ({ at: at(day), id, by: 'builder', ...e });
const one = events => { const r = fold(events); return { entry: r.entries.find(p => p.id === ID), notPlaced: r.notPlaced }; };

test('an opened entry takes its fields, a set changes them, and a close records how and when', () => {
  const { entry, notPlaced } = one([opened(1), ev(2, { ev: 'set', fields: { mode: 'async-wait', status: 'fixing' } }),
    ev(3, { ev: 'closed', fields: { disposition: 'fixed', fix: '1e79f371' } })]);
  assert.deepEqual(notPlaced, []);
  assert.equal(entry.title, 'smoke-wake times out waiting for the wake banner');
  assert.equal(entry.mode, 'async-wait');
  assert.deepEqual([entry.status, entry.disposition, entry.fix, entry.closedAt], ['closed', 'fixed', '1e79f371', at(3)]);
  assert.equal(entry.openedAt, at(1));
});

test("a won't-fix close drops the entry rather than closing it", () => {
  assert.equal(one([opened(1), ev(2, { ev: 'closed', fields: { disposition: 'wont-fix' } })]).entry.status, 'dropped');
});

// Times sorted as text put 12.500Z before 12Z and read +11:00 hours off (Juno's review, finding 8).
test('events are read in time order, with equal times in the order the file holds them', () => {
  // by time: network (08:00:05 UTC), clock (09:00:12), timeout (09:00:12.5); as text the order is the reverse
  const { entry } = one([
    { ...opened(1), at: '2026-10-01T08:00:00Z' },
    ev(0, { at: '2026-10-01T09:00:12.500Z', ev: 'set', fields: { mode: 'timeout' } }),
    ev(0, { at: '2026-10-01T09:00:12Z', ev: 'set', fields: { mode: 'clock' } }),
    ev(0, { at: '2026-10-01T19:00:05+11:00', ev: 'set', fields: { mode: 'network' } }),
  ]);
  assert.equal(entry.mode, 'timeout');
  const tie = one([opened(1), ev(2, { ev: 'set', fields: { mode: 'clock' } }), ev(2, { ev: 'set', fields: { mode: 'timeout' } })]).entry;
  assert.equal(tie.mode, 'timeout', 'the later line in the file wins a tie');
});

test('a second open of one id is refused, and the first entry stands', () => {
  const { entry, notPlaced } = one([opened(1), ev(2, { ev: 'closed', fields: { disposition: 'fixed' } }), opened(3, { title: 'again' })]);
  assert.deepEqual([entry.title, entry.status], ['smoke-wake times out waiting for the wake banner', 'closed']);
  assert.equal(notPlaced.length, 1);
  assert.match(notPlaced[0].why, /opened already/);
});

test('a close of an entry already closed is refused, so a second close cannot move the first', () => {
  const { entry, notPlaced } = one([opened(1), ev(10, { ev: 'closed', fields: { disposition: 'fixed' } }), ev(14, { ev: 'closed', fields: { disposition: 'fixed' } })]);
  assert.equal(entry.closedAt, at(10));
  assert.match(notPlaced[0].why, /closed already/);
});

test('a close without a known disposition is refused', () => {
  for (const fields of [{}, { disposition: 'done' }]) assert.match(one([opened(1), ev(2, { ev: 'closed', fields })]).notPlaced[0].why, /disposition/);
});

// A set to closed left an entry closed with no close time (Juno's review, finding 8): status moves only by its events.
test('a set may move an entry to fixing and to nothing else', () => {
  const r = one([opened(1), ev(2, { ev: 'set', fields: { status: 'closed' } })]);
  assert.equal(r.entry.status, 'open');
  assert.match(r.notPlaced[0].why, /status/);
  assert.equal(one([opened(1), ev(2, { ev: 'set', fields: { status: 'fixing' } })]).entry.status, 'fixing');
});

test('a reopen clears the close and its disposition, and a reopen of an open entry is refused', () => {
  const { entry } = one([opened(1), ev(2, { ev: 'closed', fields: { disposition: 'fixed' } }), ev(5, { ev: 'reopened' })]);
  assert.deepEqual([entry.status, entry.disposition, entry.closedAt, entry.reopenedAt], ['open', undefined, undefined, at(5)]);
  assert.match(one([opened(1), ev(2, { ev: 'reopened' })]).notPlaced[0].why, /not closed/);
});

test('a merge marks the entry merged into another that exists, and a merge into nothing is refused', () => {
  const r = fold([opened(1), opened(1, { title: 'the same wake banner wait' }, OTHER), ev(3, { ev: 'merged-into', into: ID }, OTHER)]);
  const dup = r.entries.find(p => p.id === OTHER);
  assert.deepEqual([dup.status, dup.mergedInto, dup.closedAt], ['merged', ID, at(3)]);
  assert.match(fold([opened(1), ev(3, { ev: 'merged-into', into: 'P-2026-10-08-flaky-test-0a0b0c' })]).notPlaced[0].why, /no entry P-2026-10-08-flaky-test-0a0b0c/);
  assert.match(fold([opened(1), ev(3, { ev: 'merged-into', into: ID })]).notPlaced[0].why, /itself/);
});

test('an event for an entry never opened is not placed, and says so', () => {
  const r = fold([ev(2, { ev: 'set', fields: { mode: 'clock' } })]);
  assert.deepEqual(r.entries, []);
  assert.match(r.notPlaced[0].why, /never opened/);
});

// The reader keeps only the fields the register defines, with values from its vocabulary (Theo's review, finding 3), so
// a line written by hand cannot put anything on HQ or into an export that the register does not know.
test('only defined fields with known values are kept', () => {
  // as a line of the file reads, so __proto__ is a key of its own
  const line = JSON.parse('{"kind":"flaky-test","mode":"not-a-mode","factors":["clock","made-up","machine-load"],"email":"x@example.com","__proto__":{"polluted":true}}');
  const { entry } = one([opened(1, line)]);
  assert.equal(entry.email, undefined);
  assert.equal(entry.mode, undefined, 'a mode its kind does not have');
  assert.deepEqual(entry.factors, ['clock', 'machine-load']);
  assert.equal({}.polluted, undefined);
  assert.equal(one([opened(1, { kind: 'bogus' })]).entry.kind, undefined);
  assert.ok(Object.keys(FIELDS).includes('evidence'));
});

// Theo's review, finding 3: one line that slipped past the writer's checks must be removable from every page and export,
// while the file itself is never rewritten.
test('a redaction hides its fields from the entry and from every one of its events, whenever it came', () => {
  const { entry } = one([opened(1, { evidence: 'a line that should not be here' }), ev(2, { ev: 'set', fields: { evidence: 'still not', mode: 'clock' } }),
    ev(3, { ev: 'redacted', fields: ['evidence'] })]);
  assert.equal(entry.evidence, undefined);
  assert.equal(entry.mode, 'clock');
  assert.deepEqual(entry.redacted, ['evidence']);
  assert.ok(entry.events.every(e => !JSON.stringify(e).includes('should not') && !JSON.stringify(e).includes('still not')));
});

test('a line without v is read as the first shape, and a line from a newer writer is read and counted', () => {
  const base = { at: at(11), ev: 'opened', id: ID, by: 'x', fields: { title: 't', kind: 'flaky-test' } };
  const r = fold([base, { ...base, v: 2, id: OTHER, fields: { title: 'u', kind: 'flaky-test', brandNew: 1 } }]);
  assert.deepEqual(r.entries.map(p => p.id).sort(), [ID, OTHER].sort(), 'both are placed');
  assert.equal(r.newer, 1);
  assert.deepEqual(r.notPlaced, []);
  assert.equal(r.entries.find(p => p.id === OTHER).brandNew, undefined, 'what this reader does not know is left out');
});

test('the stages run earliest first, and the ones before the merge are the ones the gate and review can catch at', () => {
  assert.deepEqual(STAGES.map(([k]) => k), ['self', 'test-fast', 'pre-push', 'smoke', 'pr-gate', 'reviewer', 'you', 'merge', 'prod-smoke', 'nightly', 'you-after', 'users']);
  assert.deepEqual([...BEFORE_MERGE], ['self', 'test-fast', 'pre-push', 'smoke', 'pr-gate', 'reviewer', 'you']);
  assert.ok(STAGE.smoke.i < STAGE['pr-gate'].i, 'smoke before the PR gate (Mags and Hollis)');
});

test("each kind has the plan's modes, and a starved run is a factor, never a mode", () => {
  assert.deepEqual(KINDS.map(([k]) => k), ['product-bug', 'test-failure', 'flaky-test', 'slot-contention', 'pr-pileup', 'proof-churn', 'tooling-breakage', 'agent-mistake']);
  assert.ok(!Object.values(MODES).flat().includes('starved-run'));
  assert.deepEqual(MODES['slot-contention'], ['queue-wait', 'held-too-long', 'gave-up-or-takeover', 'stray-process']);
});

test('an entry may say when its problem was first seen, as a time', () => {
  assert.equal(one([opened(9, { seenFrom: '2026-09-28T10:00:00Z' })]).entry.seenFrom, '2026-09-28T10:00:00Z');
  assert.equal(one([opened(9, { seenFrom: 'last week' })]).entry.seenFrom, undefined);
});

// Juno's review of the build, finding 9: A into B, then B into A, left both entries merged and their reds lost.
test('a merge whose chain comes back to the entry itself is refused', () => {
  const r = fold([opened(1), opened(1, { title: 'the same wake banner wait' }, OTHER), ev(3, { ev: 'merged-into', into: OTHER }), ev(4, { ev: 'merged-into', into: ID }, OTHER)]);
  assert.equal(r.entries.find(p => p.id === OTHER).status, 'open');
  assert.match(r.notPlaced[0].why, /back to P-2026-10-11-smoke-sync-c3d4/);
});

test("a change of kind drops a mode the new kind does not have", () => {
  const { entry } = one([opened(1, { mode: 'clock' }), ev(2, { ev: 'set', fields: { kind: 'tooling-breakage' } })]);
  assert.deepEqual([entry.kind, entry.mode], ['tooling-breakage', undefined]);
});

// Theo's review of the build, finding 2: the entry dropped unknown fields, but its events and the refused events kept them,
// and an export sends both.
test('no text the ledger dropped or refused stays in what it returns', () => {
  const line = JSON.parse('{"mode":"clock","note":"call 555-0100 or write to a.player@gmail.com"}');
  const r = fold([opened(1, JSON.parse('{"reply":"call 555-0100"}')), ev(2, { ev: 'set', fields: line }), opened(3, { title: 'again, from a.player@gmail.com' })]);
  assert.equal(r.entries[0].mode, 'clock');
  assert.ok(!JSON.stringify(r).includes('gmail') && !JSON.stringify(r).includes('555-0100'), JSON.stringify(r).slice(0, 300));
  assert.deepEqual(Object.keys(r.notPlaced[0]).sort(), ['at', 'ev', 'id', 'why']);
});

// Theo's review of the fixes: three refusals quoted the raw value, and by was kept raw, for lines the writer did not make.
test('no refusal and no writer name carries text from a line the writer did not make', () => {
  const raw = 'mail a.player@gmail.com';
  const r = fold([{ ...opened(1), by: raw }, ev(2, { ev: 'set', fields: { status: raw } }), ev(3, { ev: 'merged-into', into: raw }), ev(4, { ev: raw }), { at: at(5), ev: 'set', id: raw, fields: {} }]);
  assert.equal(r.notPlaced.length, 4);
  assert.ok(!JSON.stringify(r).includes('gmail'), JSON.stringify(r).slice(0, 400));
  assert.equal(r.entries[0].openedBy, null);
});

test("an entry's runs are run ids, laptop or CI, and nothing else", () => {
  assert.deepEqual(one([opened(1, { runs: ['2026-10-08T06-00-00Z_000123', 'junit-18342-1-gate', 'see the log'] })]).entry.runs, ['2026-10-08T06-00-00Z_000123', 'junit-18342-1-gate']);
});
