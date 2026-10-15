// Proves: what the problem register works out by joining entries to observations (lib/problem-derive.mjs): ownership
// by signature, kind and window, after the fix by the fix commit, a fix held by the rule of three, came back, merged
// duplicates, kinds no store sees, and the observation groups no entry explains.
// Why: which entry owns which observation decides every cost on the Problems page (the plan's "What the reader works
// out", and Juno's review of the counts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { derive, testResults } from '../lib/problem-derive.mjs';
import { useQuestKeepStages } from './fixtures/stages.mjs';

useQuestKeepStages();

const DAY = 86400000, T0 = Date.parse('2026-10-01T12:00:00Z');
const day = n => new Date(T0 + n * DAY).toISOString();
const entry = (id, over = {}) => ({ id, title: id, kind: 'flaky-test', signature: 'smoke-wake', openedAt: day(10), status: 'open', events: [], ...over });
const closed = (id, closedDay, over = {}) => entry(id, { status: 'closed', disposition: 'fixed', closedAt: day(closedDay), ...over });
let n = 0;
const red = (d, over = {}) => ({ type: 'red', sig: 'smoke-wake', class: 'flaky', run: `r${++n}`, when: day(d), commit: `c${d}`, kind: 'docker-gate', minutes: 3, partial: false, starved: false, ...over });
const wait = (d, over = {}) => ({ type: 'wait', at: day(d), session: 's1', behind: 'other', outcome: 'took', minutes: 12, ...over });
// commits are named by day: a commit contains a fix when its day is on or after the fix's day and it is not on a branch cut
// before it, which the tests name with a trailing "old"
const contains = (fix, commit) => !String(commit).endsWith('old') && Number(String(commit).slice(1)) >= Number(String(fix).slice(1));
const run = (entries, { reds = [], slot = [], results = {}, now = day(40) } = {}) => derive(entries, { reds, slot, results, contains, now: Date.parse(now) });
const one = (r, id) => r.entries.find(p => p.id === id);

test('a flaky test entry owns the flaky reds of its signature from a week before it opened to its fix', () => {
  const r = run([closed('P-wake', 20)], { reds: [red(2), red(4), red(12), red(19), red(18, { sig: 'smoke-sync' })] });
  assert.deepEqual(one(r, 'P-wake').observations.map(o => o.when), [day(4), day(12), day(19)], 'day 2 is more than a week before its open');
  assert.equal(one(r, 'P-wake').machineMinutes, 9);
});

// The plan: a flake entry owns only confirmed reds; a real break of the same test belongs to a test failure.
test("a flake entry owns only flaky reds, and a test failure entry the test's other reds", () => {
  const reds = [red(11), red(12, { class: 'never-rerun' }), red(13, { class: 'red-twice' }), red(14, { class: 'passed-alone' }), red(15, { class: 'dirty' })];
  const r = run([entry('P-flake'), entry('P-break', { kind: 'test-failure' })], { reds });
  assert.deepEqual(one(r, 'P-flake').observations.map(o => o.class), ['flaky']);
  assert.deepEqual(one(r, 'P-break').observations.map(o => o.class), ['never-rerun', 'red-twice']);
});

// Juno's finding 4: one run's minutes were counted under two entries.
test('each observation belongs to one entry, and machine minutes count each run once', () => {
  const both = red(12, { run: 'same' });
  const r = run([entry('P-a', { openedAt: day(10) }), entry('P-b', { openedAt: day(11) })], { reds: [both, red(12, { run: 'same', sig: 'smoke-wake' })] });
  const owned = r.entries.flatMap(p => p.observations);
  assert.equal(owned.length, 2);
  assert.equal(r.entries.reduce((s, p) => s + p.machineMinutes, 0), 3, 'one run, 3 minutes, however the reds fall');
});

// Juno's finding 2: a red on a branch cut before the fix, run after the close, is not the problem coming back.
test('a red after the close came back only when its commit holds the fix', () => {
  const fix = { fix: 'c20' };
  assert.equal(one(run([closed('P-wake', 20, fix)], { reds: [red(22, { commit: 'c22old' })] }), 'P-wake').cameBack, null);
  assert.equal(one(run([closed('P-wake', 20, fix)], { reds: [red(22, { commit: 'c22old' })] }), 'P-wake').observations.length, 1, 'still its red, from code without the fix');
  assert.equal(one(run([closed('P-wake', 20, fix)], { reds: [red(23, { commit: 'c23' })] }), 'P-wake').cameBack, day(23));
  assert.equal(one(run([closed('P-wake', 20)], { reds: [red(23, { commit: 'c23old' })] }), 'P-wake').cameBack, day(23), 'with no fix commit, after the close');
});

// The plan: the rule of three on full gate runs, over at least two days the test ran; until then, checking the fix.
test('a flake fix holds after clean full runs numbering three times its runs per red, over two days or more', () => {
  const before = [...Array(8)].map((_, i) => ({ run: `b${i}`, when: day(12 + i * 0.5), commit: `c${12 + i}`, status: i % 4 ? 'pass' : 'fail', full: true, kind: 'docker-gate' })); // 8 runs, 2 reds
  const after = k => [...Array(k)].map((_, i) => ({ run: `a${i}`, when: day(21 + i * 0.25), commit: `c${21 + i}`, status: 'pass', full: true, kind: 'docker-gate' }));
  const reds = [red(12), red(14)];
  const held = k => one(run([closed('P-wake', 20, { fix: 'c20' })], { reds, results: { 'smoke-wake': [...before, ...after(k)] } }), 'P-wake');
  assert.equal(held(11).fixHeld, 'checking', '11 clean runs, 12 needed');
  assert.deepEqual([held(12).fixHeld, held(12).cleanRuns, held(12).cleanNeeded], ['held', 12, 12]);
  const sameDay = [...Array(12)].map((_, i) => ({ run: `s${i}`, when: day(21), commit: 'c21', status: 'pass', full: true, kind: 'docker-gate' }));
  assert.equal(one(run([closed('P-wake', 20, { fix: 'c20' })], { reds, results: { 'smoke-wake': [...before, ...sameDay] } }), 'P-wake').fixHeld, 'checking', 'one day is not two');
  const partial = after(12).map(x => ({ ...x, full: false }));
  assert.equal(one(run([closed('P-wake', 20, { fix: 'c20' })], { reds, results: { 'smoke-wake': [...before, ...partial] } }), 'P-wake').fixHeld, 'checking', 'partial runs do not count');
});

test('a fix that came back has not held', () => {
  const p = one(run([closed('P-wake', 20, { fix: 'c20' })], { reds: [red(12), red(25, { commit: 'c25' })] }), 'P-wake');
  assert.deepEqual([p.cameBack, p.fixHeld], [day(25), 'came-back']);
});

// Juno's finding 1: kinds no store can see would show no cost and always hold.
test('a later entry with the same signature, or one naming it as repeated, means it came back', () => {
  const mistake = closed('P-addall', 15, { kind: 'agent-mistake', signature: 'git add -A' });
  assert.equal(one(run([mistake, entry('P-again', { kind: 'agent-mistake', signature: 'git add -A', openedAt: day(18) })]), 'P-addall').cameBack, day(18));
  assert.equal(one(run([mistake, entry('P-again', { kind: 'agent-mistake', signature: 'other words', repeatOf: 'P-addall', openedAt: day(19) })]), 'P-addall').cameBack, day(19));
});

test('kinds no store sees show their cost as not measured, never as zero', () => {
  const p = one(run([closed('P-addall', 15, { kind: 'agent-mistake', signature: 'git add -A' })]), 'P-addall');
  assert.deepEqual([p.notMeasured, p.machineMinutes, p.waitMinutes, p.fixHeld], [true, null, null, null]);
});

// Juno's finding 3: a merged duplicate showed as came back on the main entry's next red.
test("a merged duplicate's observations go to the entry it was merged into, and it never comes back", () => {
  const main = entry('P-main', { openedAt: day(10) });
  const dup = entry('P-dup', { signature: 'smoke-wake banner', openedAt: day(11), status: 'merged', mergedInto: 'P-main', closedAt: day(12) });
  const r = run([main, dup], { reds: [red(11, { sig: 'smoke-wake banner' }), red(20)] });
  assert.deepEqual(one(r, 'P-main').observations.map(o => o.sig), ['smoke-wake banner', 'smoke-wake']);
  assert.deepEqual([one(r, 'P-dup').observations, one(r, 'P-dup').cameBack, one(r, 'P-dup').missing], [[], null, []]);
});

// Juno's finding 7, and the plan's Late.
test('a closed entry found late without where it should have been caught says so, and one with it is late', () => {
  assert.deepEqual(one(run([closed('P-bug', 15, { kind: 'product-bug', foundAt: 'you' })]), 'P-bug').missing, ['shouldHaveCaughtAt']);
  const late = one(run([closed('P-bug', 15, { kind: 'product-bug', foundAt: 'users', shouldHaveCaughtAt: 'pr-gate' })]), 'P-bug');
  assert.deepEqual([late.missing, late.late], [[], true]);
  assert.equal(one(run([closed('P-bug', 15, { kind: 'product-bug', foundAt: 'pr-gate', shouldHaveCaughtAt: 'pr-gate' })]), 'P-bug').late, false);
});

// Waits for the slot are agents waiting, a clock apart from machine minutes (Juno's finding 5).
test("a test slot entry owns waits behind another session, on the waiting clock, never as machine minutes", () => {
  const r = run([entry('P-slot', { kind: 'slot-contention', signature: 'slot' })], { slot: [wait(11), wait(12, { behind: 'own' }), wait(13, { behind: 'other', minutes: 30 })] });
  const p = one(r, 'P-slot');
  assert.deepEqual([p.observations.length, p.waitMinutes, p.machineMinutes], [2, 42, 0]);
});

// The plan's Overview: an observation group still alive with no entry is unexplained. Groups are a signature and what
// the stores saw (a flaky red, a real red, a red that passed when rerun alone, an infra red, a wait, a refusal).
test('observations no entry owns are grouped as unexplained by signature and family, alive or quiet', () => {
  const reds = [red(38, { sig: 'smoke-sync' }), red(39, { sig: 'smoke-sync' }), red(5, { sig: 'smoke-tabs', class: 'never-rerun' }), red(39, { sig: 'smoke-reset', class: 'dirty' })];
  const groups = run([], { reds, slot: [wait(39), wait(39, { behind: 'own' }), { type: 'takeover', at: day(39), session: 's2' }] }).unexplained;
  assert.deepEqual(groups.map(g => [g.sig, g.family, g.count, g.state]), [['smoke-sync', 'flaky', 2, 'alive'], ['slot', 'wait', 1, 'alive'], ['slot', 'takeover', 1, 'alive'], ['smoke-tabs', 'real', 1, 'quiet']],
    'dirty reds and waits behind their own session are never a group');
});

// Juno's review of the build, finding 1: a red whose signature had an entry that did not own it was counted nowhere.
test('a red is explained only by the entry that owns it: a real break beside a flake entry is unexplained', () => {
  const reds = [red(11), red(12, { class: 'never-rerun' }), red(13, { class: 'passed-alone' })];
  const groups = run([entry('P-flake')], { reds }).unexplained;
  assert.deepEqual(groups.map(g => [g.sig, g.family, g.count]), [['smoke-wake', 'passed-alone', 1], ['smoke-wake', 'real', 1]], 'the newest first');
});

// Every observation is counted exactly once: owned by one entry, in one unexplained group, or left out on purpose.
test('every observation is owned, unexplained or left out on purpose, exactly once', () => {
  const reds = [red(2), red(11), red(12, { class: 'never-rerun' }), red(13, { class: 'dirty' }), red(14, { class: 'infra', sig: 'task:unit' }), red(25, { commit: 'c25' })];
  const slot = [wait(11), wait(12, { behind: 'own' }), wait(13, { behind: 'unknown' }), { type: 'refused', at: day(14), session: 's3' }];
  const r = run([closed('P-wake', 20, { fix: 'c20' }), entry('P-slot', { kind: 'slot-contention', signature: 'slot' })], { reds, slot });
  const owned = r.entries.flatMap(p => p.observations), grouped = r.unexplained.flatMap(g => g.observations);
  const all = [...owned, ...grouped, ...r.leftOut];
  assert.equal(all.length, reds.length + slot.length);
  assert.equal(new Set(all).size, all.length, 'none twice');
  assert.deepEqual(r.leftOut.map(o => o.class || o.behind), ['dirty', 'own']);
});

test("a test's results come from every run's own tasks, the rerun's left out, marked full when the run was whole and clean", () => {
  const runs = [{ id: 'r1', when: day(1), info: { commit: 'c1', dirty: false, kind: 'docker-gate' }, tasks: [{ id: 'docker-gate', cases: [{ name: 'smoke-wake', status: 'fail' }] }, { id: 'rerun', cases: [{ name: 'smoke-wake', status: 'pass' }] }] },
    { id: 'r2', when: day(2), info: { commit: 'c2', dirty: false, partial: true, kind: 'docker-gate' }, tasks: [{ id: 'docker-gate', cases: [{ name: 'smoke-wake', status: 'pass' }] }] }];
  assert.deepEqual(testResults(runs)['smoke-wake'], [{ run: 'r1', when: day(1), commit: 'c1', status: 'fail', full: true, kind: 'docker-gate', seconds: 0 }, { run: 'r2', when: day(2), commit: 'c2', status: 'pass', full: false, kind: 'docker-gate', seconds: 0 }]);
});

// A backfilled entry is written today about reds from weeks ago, so it says when its problem was first seen (seenFrom),
// and owns observations from a week before that rather than before the day it was written.
test('a backfilled entry owns observations from a week before it was first seen, not before it was written', () => {
  const r = run([entry('P-old', { openedAt: day(30), seenFrom: day(12), record: 'backfill' })], { reds: [red(2), red(6), red(20)] });
  assert.deepEqual(one(r, 'P-old').observations.map(o => o.when), [day(6), day(20)], 'day 2 is more than a week before day 12');
});

// Juno's review of the build, findings 6 and 8.
test('a reopen counts as coming back, and only a later entry of the same kind does', () => {
  const reopened = closed('P-wake', 14, { fix: 'c20', reopenedAt: day(10) }); // closed day 8, reopened day 10, closed again day 14
  assert.equal(one(run([{ ...reopened }]), 'P-wake').cameBack, day(10));
  const flake = closed('P-wake', 15, { fix: 'c15' });
  assert.equal(one(run([flake, entry('P-break', { kind: 'test-failure', openedAt: day(18) })]), 'P-wake').cameBack, null, 'a test failure of the same test is another problem');
});

// Juno's review of the build, findings 3 and 9: a red the entry does not own (a real break) left "checking" stuck, and
// soak and deploy runs counted towards the rule of three, which the plan holds to full gate runs.
test("a fix's clean count stops only at a red the entry owns, and counts only gate runs", () => {
  const before = [...Array(4)].map((_, i) => ({ run: `b${i}`, when: day(12 + i), commit: `c${12 + i}`, status: i % 2 ? 'pass' : 'fail', full: true, kind: 'docker-gate' }));
  const after = (k, over = {}) => [...Array(k)].map((_, i) => ({ run: `a${i}`, when: day(21 + i * 0.5), commit: `c${21 + i}`, status: 'pass', full: true, kind: 'docker-gate', ...over }));
  const realRed = { run: 'x1', when: day(20.5), commit: 'c20', status: 'fail', full: true, kind: 'docker-gate' };
  const reds = [red(12, { run: 'b0' }), red(14, { run: 'b2' }), red(20.5, { run: 'x1', commit: 'c20', class: 'never-rerun' })];
  const p = one(run([closed('P-wake', 20, { fix: 'c20' })], { reds, results: { 'smoke-wake': [...before, realRed, ...after(6)] } }), 'P-wake');
  assert.deepEqual([p.fixHeld, p.cleanRuns], ['held', 6], 'the real break is not its red');
  const soak = one(run([closed('P-wake', 20, { fix: 'c20' })], { reds, results: { 'smoke-wake': [...before, ...after(6, { kind: 'soak' })] } }), 'P-wake');
  assert.deepEqual([soak.fixHeld, soak.cleanRuns], ['checking', 0], 'soak runs are not gate runs');
});

// Juno's review of the build, finding 7: git could not place 92 of 464 fix and run commit pairs in this clone.
test("a red whose commit git cannot place against the fix falls back to the close time", () => {
  const unknown = (fix, commit) => (commit === 'lost' ? null : contains(fix, commit));
  const at = (d, c) => derive([closed('P-wake', 20, { fix: 'c20' })], { reds: [red(d, { commit: c })], contains: unknown, now: Date.parse(day(40)) }).entries[0].cameBack;
  assert.equal(at(25, 'lost'), day(25), 'after the close');
  assert.equal(at(18, 'lost'), null, 'before it');
});

// Juno's review of the build, finding 9: a note never closes, so a note found late was never asked for this.
test('an open entry found late without where it should have been caught says so too', () => {
  assert.deepEqual(one(run([entry('P-note', { kind: 'agent-mistake', foundAt: 'you' })]), 'P-note').missing, ['shouldHaveCaughtAt']);
});

// Juno's check of the import: a backfilled tooling entry named the tests that went red when the environment broke, and
// owned none of their reds, since a tooling entry owns only reds naming no test. An entry that lists the runs it was
// judged from owns its signature's reds in those runs, whatever the stores called them.
test('an entry that lists its runs owns its reds in them, whatever their class', () => {
  const reds = [red(12, { run: 'r1', class: 'never-rerun' }), red(13, { run: 'r2', class: 'flaky' }), red(14, { run: 'r3', class: 'never-rerun' }), red(15, { run: 'r1', class: 'dirty' })];
  const p = one(run([entry('P-vm', { kind: 'tooling-breakage', runs: ['r1', 'r2'], record: 'backfill' })], { reds }), 'P-vm');
  assert.deepEqual(p.observations.map(o => o.run), ['r1', 'r2'], 'r3 is not one of its runs, and a dirty red is never owned');
});

// Juno's check of the import, again: a tooling entry that owns infra reds by their class took the reds of runs another
// entry was judged from, since the newest entry wins. The entry judged from a run comes first for that run's reds.
test("an entry judged from a run comes first for that run's reds", () => {
  const reds = [red(12, { run: 'r1', sig: 'task:docker-gate', class: 'infra' }), red(13, { run: 'r2', sig: 'task:docker-gate', class: 'infra' })];
  const r = run([entry('P-judged', { kind: 'test-failure', signature: 'task:docker-gate', runs: ['r1'], openedAt: day(14) }), entry('P-tooling', { kind: 'tooling-breakage', signature: 'task:docker-gate', openedAt: day(15) })], { reds });
  assert.deepEqual([one(r, 'P-judged').observations.map(o => o.run), one(r, 'P-tooling').observations.map(o => o.run)], [['r1'], ['r2']]);
});

// A pile-up entry owns the waits it explains; waits no entry owns are one group, since each is the person's own time.
test('pull request waits are owned by a pile-up entry, or grouped together as waiting on you', () => {
  const prs = [{ type: 'pr-wait', sig: 'pr', pr: 276, at: day(12), greenAt: day(11.9), minutes: 90 }, { type: 'pr-wait', sig: 'pr', pr: 277, at: day(13), greenAt: day(12.9), minutes: 30 }];
  const alone = derive([], { prs, now: Date.parse(day(14)) });
  assert.deepEqual(alone.unexplained.map(g => [g.sig, g.family, g.count, g.waitMinutes]), [['pr', 'pr-wait', 2, 120]]);
  const owned = derive([entry('P-pile', { kind: 'pr-pileup', signature: 'pr', openedAt: day(12) })], { prs, now: Date.parse(day(14)) });
  assert.deepEqual([owned.entries[0].observations.length, owned.entries[0].waitMinutes, owned.unexplained.length], [2, 120, 0]);
});

test('a planted red is left out on purpose, never owned and never unexplained', () => {
  const r = run([entry('P-flake')], { reds: [red(12, { class: 'planted' })] });
  assert.deepEqual([one(r, 'P-flake').observations.length, r.unexplained.length, r.leftOut.length], [0, 0, 1]);
});

// Asking git cost most of the first read of HQ's Problems page: most runs are on branches, off main's line. A run that
// began before a fix commit was written cannot hold it, and an entry from git is opened at its fix commit's time, so
// those need no question at all.
test('a run older than a fix commit is before the fix, without asking git', () => {
  const fromGit = closed('F-fix', 20, { source: 'git', fix: 'c20', openedAt: day(20) });
  const asked = [];
  derive([fromGit], { reds: [red(15, { commit: 'branch15' }), red(25, { commit: 'branch25' })], contains: (fix, commit) => { asked.push(commit); return true; }, now: Date.parse(day(40)) });
  assert.deepEqual(asked, ['branch25']);
});

test("a run older than its fix commit's time on main is before the fix, without asking git, for a backfilled entry too", () => {
  const backfilled = closed('P-bf', 30, { record: 'backfill', fix: 'c20', seenFrom: day(10) });
  const asked = [];
  derive([backfilled], { reds: [red(15, { commit: 'branch15' }), red(25, { commit: 'branch25' })], contains: (fix, commit) => { asked.push(commit); return true; },
    fixTime: fix => (fix === 'c20' ? Date.parse(day(20)) : null), now: Date.parse(day(40)) });
  assert.deepEqual(asked, ['branch25']);
});

// Noor's review of the page: an entry for a unit test file said "1277 of 5769 clean runs", more runs than the store
// held, since each of the file's tests in a run was counted as a run.
test("a fix's clean runs count each run once, however many of the signature's tests it ran", () => {
  const cases = (r, status) => ['a', 'b', 'c'].map(name => ({ ...r, name, status: name === 'b' ? status : 'pass' }));
  const before = [...Array(4)].flatMap((_, i) => cases({ run: `b${i}`, when: day(12 + i), commit: `c${12 + i}`, full: true, kind: 'docker-gate' }, i % 2 ? 'pass' : 'fail'));
  const after = [...Array(6)].flatMap((_, i) => cases({ run: `a${i}`, when: day(21 + i * 0.5), commit: `c${21 + i}`, full: true, kind: 'docker-gate' }, 'pass'));
  const reds = [red(12, { run: 'b0' }), red(14, { run: 'b2' })];
  const p = one(run([closed('P-wake', 20, { fix: 'c20' })], { reds, results: { 'smoke-wake': [...before, ...after] } }), 'P-wake');
  assert.deepEqual([p.fixHeld, p.cleanRuns, p.cleanNeeded], ['held', 6, 6], '4 runs before, 2 of them red: 3 times 2 needed');
});

test('a merged entry says nothing of whether its fix held: the entry it went into does', () => {
  const p = one(run([closed('P-wake', 20, { fix: 'c20', status: 'merged', mergedInto: 'P-other' }), entry('P-other', { openedAt: day(9) })], { reds: [red(12)] }), 'P-wake');
  assert.equal(p.fixHeld, null);
});

// Nightly 38298159812: a run that hit its memory cap is the machine's fault; a tooling entry owns it, a flake entry does not.
test('a resource red is a tooling entry\'s, never a flake entry\'s, and is a group of its own when unowned', () => {
  const reds = [red(12, { class: 'resource' })];
  assert.deepEqual([one(run([entry('P-flake')], { reds }), 'P-flake').observations.length, one(run([entry('P-tool', { kind: 'tooling-breakage', signature: 'smoke-wake' })], { reds }), 'P-tool').observations.length], [0, 1]);
  assert.deepEqual(run([entry('P-flake')], { reds }).unexplained.map(g => [g.sig, g.family, g.count]), [['smoke-wake', 'resource', 1]]);
});

// The burst proposal (Drew, 13 October): a cause shared across tests is one problem, not one per test. A red's cause is
// its error line, which the facts line printed (scripts/error-line.mjs, kept in the run's facts.json). Juno's review.
const NODE_MODULES = "Error: Cannot find module 'playwright'";
const caused = (d, sig, over = {}) => red(d, { sig, class: 'never-rerun', cause: NODE_MODULES, causeGeneric: false, ...over });

test('unexplained reds of several tests that share an error line are one group, naming its tests', () => {
  const reds = [caused(30, 'smoke-prep'), caused(30, 'smoke-sync'), caused(31, 'load-check'), red(31, { sig: 'smoke-tabs', class: 'never-rerun', cause: 'FAIL: tabs', causeGeneric: false })];
  const r = run([], { reds });
  const g = r.unexplained.find(x => x.family === 'shared-cause');
  assert.ok(g, `no shared-cause group: ${JSON.stringify(r.unexplained.map(x => [x.sig, x.family]))}`);
  assert.deepEqual([g.sig, g.count, g.tests], [`cause:${NODE_MODULES}`, 3, ['load-check', 'smoke-prep', 'smoke-sync']]);
  assert.ok(r.unexplained.some(x => x.sig === 'smoke-tabs' && x.family === 'real'), 'a line one test printed keeps its own group');
});

// Nell: a sync bug and a slow network both end in a Playwright timeout, so a generic line never joins tests.
test('a generic line, a bare timeout, never groups tests', () => {
  const reds = [caused(30, 'smoke-prep', { cause: 'page.goto: timed out', causeGeneric: true }), caused(30, 'smoke-sync', { cause: 'page.goto: timed out', causeGeneric: true })];
  assert.ok(!run([], { reds }).unexplained.some(x => x.family === 'shared-cause'));
});

test('grouping by cause keeps every observation in exactly one place', () => {
  const reds = [caused(30, 'smoke-prep'), caused(30, 'smoke-sync'), caused(31, 'smoke-sync', { class: 'flaky' }), red(31, { class: 'dirty', cause: NODE_MODULES })];
  const r = run([entry('P-flake', { signature: 'smoke-sync', openedAt: day(30) })], { reds });
  const placed = [...r.entries.flatMap(p => p.observations), ...r.unexplained.flatMap(g => g.observations), ...r.leftOut];
  assert.equal(placed.length, reds.length); assert.equal(new Set(placed).size, reds.length);
});

// Juno: a tooling entry owns only infra reds by kind, but a burst's reds were never rerun, so a cause entry would own
// none of them. One keyed by its error line owns every counted red with that line, as an entry judged from a run does.
test('an entry whose signature is an error line owns every red with that line, whatever its class', () => {
  const reds = [caused(30, 'smoke-prep'), caused(30, 'smoke-sync', { class: 'flaky' }), caused(31, 'smoke-tabs', { class: 'dirty' })];
  const r = run([entry('P-npm', { kind: 'tooling-breakage', signature: `cause:${NODE_MODULES}`, openedAt: day(30) })], { reds });
  assert.deepEqual(one(r, 'P-npm').observations.map(o => o.sig), ['smoke-prep', 'smoke-sync'], 'a dirty red says nothing of a commit');
});

// Juno: the line's normalising rules changed five times on 13 October; an entry keyed by an old form owns nothing silently.
test('an entry keyed by an error line that matches no red says so', () => {
  const r = run([entry('P-old', { kind: 'tooling-breakage', signature: 'cause:Error: an older form of the line', openedAt: day(30) })], { reds: [caused(30, 'smoke-prep')] });
  assert.ok(one(r, 'P-old').missing.includes('signature'), JSON.stringify(one(r, 'P-old').missing));
});

// Juno: a note keyed by a line whose reds a backfilled entry already owns has a line that is fine; only a line no red has
// at all is missing.
test("an entry keyed by a line some red has is not missing its signature, even when another entry owns those reds", () => {
  const reds = [caused(30, 'smoke-prep', { run: 'judged-run' })];
  const r = run([entry('P-judged', { kind: 'flaky-test', signature: 'smoke-prep', runs: ['judged-run'], openedAt: day(31) }), entry('P-line', { kind: 'tooling-breakage', signature: `cause:${NODE_MODULES}`, openedAt: day(30) })], { reds });
  assert.deepEqual(one(r, 'P-judged').observations.length, 1);
  assert.ok(!one(r, 'P-line').missing.includes('signature'), JSON.stringify(one(r, 'P-line').missing));
});

// Juno: a newer entry for one test outranked the entry for the line, which split a burst between them.
test("for a red with its line, an entry keyed by the line comes before a newer one keyed by the test", () => {
  const reds = [caused(32, 'smoke-prep'), caused(32, 'smoke-sync')];
  const r = run([entry('P-line', { kind: 'tooling-breakage', signature: `cause:${NODE_MODULES}`, openedAt: day(30) }), entry('P-test', { kind: 'test-failure', signature: 'smoke-prep', openedAt: day(31) })], { reds });
  assert.deepEqual(one(r, 'P-line').observations.map(o => o.sig), ['smoke-prep', 'smoke-sync']);
});
