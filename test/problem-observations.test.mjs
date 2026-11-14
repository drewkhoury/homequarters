// Proves: the register's observations (lib/problem-observations.mjs) are worked out from the stores each time HQ
// asks, never typed in and never closed: each red test sorted by what else the stores saw of it, each slot wait
// matched to how it ended and whose run it waited behind, on runs and lock lines shaped as the writers write them.
// Why: observations are the register's view of what happened without anyone writing it down, so the matching rules
// are the whole value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { observeReds, observeSlot, observePulls, machineMinutes, testKeyer } from '../lib/problem-observations.mjs';

const run = (id, { commit = 'a6cc739', kind = 'docker-gate', dirty = false, partial, cases = [], rerun, tasks, pressure = 'normal', when = '2026-10-10T05:00:00Z', source = 'laptop' } = {}) => ({
  id, source, when, info: { commit, kind, dirty, ...(partial ? { partial: true } : {}), where: 'container', machine: { pressure } },
  tasks: tasks || [{ id: 'docker-gate', status: cases.some(c => c[1] === 'fail') ? 'fail' : 'pass', seconds: 180, cases: cases.map(([name, status]) => ({ name, status, seconds: 20 })) },
    ...(rerun ? [{ id: 'rerun', status: rerun.some(c => c[1] === 'fail') ? 'fail' : 'pass', seconds: 12, cases: rerun.map(([name, status]) => ({ name, status, seconds: 11 })) }] : [])],
});
const red = (obs, test) => obs.find(o => o.sig === test);

test('a red with a pass of the same test on the same clean commit and kind is a confirmed flaky red', () => {
  const obs = observeReds([run('r1', { cases: [['smoke-wake', 'fail']] }), run('r2', { cases: [['smoke-wake', 'pass']] })]);
  assert.deepEqual(obs.map(o => [o.sig, o.class, o.run]), [['smoke-wake', 'flaky', 'r1']]);
});

// Hollis's review of the rerun: alone, on fresh emulators, a pass shows only that the test passes when run alone.
test("a red whose rerun passed is 'passed when rerun alone', and one whose rerun failed is red twice", () => {
  assert.equal(red(observeReds([run('r1', { cases: [['smoke-wake', 'fail']], rerun: [['smoke-wake', 'pass']] })]), 'smoke-wake').class, 'passed-alone');
  assert.equal(red(observeReds([run('r1', { cases: [['smoke-wake', 'fail']], rerun: [['smoke-wake', 'fail']] })]), 'smoke-wake').class, 'red-twice');
  // a pass in a full run as well confirms it
  assert.equal(red(observeReds([run('r1', { cases: [['smoke-wake', 'fail']], rerun: [['smoke-wake', 'pass']] }), run('r2', { cases: [['smoke-wake', 'pass']] })]), 'smoke-wake').class, 'flaky');
});

test('a red seen once, with no pass on its commit and no rerun, is red and never rerun', () => {
  assert.equal(red(observeReds([run('r1', { cases: [['smoke-wake', 'fail']] }), run('r2', { commit: 'b7dd840', cases: [['smoke-wake', 'pass']] })]), 'smoke-wake').class, 'never-rerun');
});

test('a task that failed with no test result is an infra red, named by its task', () => {
  const obs = observeReds([run('r1', { tasks: [{ id: 'docker-gate', status: 'fail', seconds: 30, cases: [] }] })]);
  assert.deepEqual(obs.map(o => [o.sig, o.class]), [['task:docker-gate', 'infra']]);
});

test("a rerun's own results are never reds of their own", () => {
  const obs = observeReds([run('r1', { cases: [['smoke-wake', 'fail']], rerun: [['smoke-wake', 'fail']] })]);
  assert.equal(obs.length, 1);
});

test('a red on a dirty tree is marked dirty, and a red in a run of some tests is marked partial', () => {
  assert.equal(red(observeReds([run('r1', { dirty: true, cases: [['smoke-wake', 'fail']] })]), 'smoke-wake').class, 'dirty');
  assert.equal(red(observeReds([run('r1', { partial: true, cases: [['smoke-wake', 'fail']] })]), 'smoke-wake').partial, true);
});

// The plan's words: a starved run is a factor on the red's own entry, never an entry of its own.
test('a red in a run that started under memory pressure warn is marked starved', () => {
  assert.equal(red(observeReds([run('r1', { pressure: 'warn', cases: [['smoke-wake', 'fail']] })]), 'smoke-wake').starved, true);
  assert.equal(red(observeReds([run('r1', { cases: [['smoke-wake', 'fail']] })]), 'smoke-wake').starved, false);
});

// Juno's review, finding 4: one run turned red by two tests was counted under both.
test("each red is priced from its own run, and a run's minutes count once however many reds it holds", () => {
  const obs = observeReds([run('r1', { cases: [['smoke-wake', 'fail'], ['smoke-sync', 'fail']] }), run('r2', { cases: [['smoke-sync', 'fail']], tasks: undefined })]);
  assert.ok(obs.every(o => o.minutes === 3), '180 s of tasks is 3 minutes');
  assert.equal(machineMinutes(obs), 6, 'two runs, not three reds');
});

// ---- the test slot ----

const line = (at, event, who, extra = {}) => ({ at: `2026-10-10T${at}:00.000Z`, event, pid: who.pid, session: who.session ?? null, agent: who.agent ?? null, person: who.person ?? null, worktree: who.worktree ?? null, target: 'docker-test', ...extra });
// a lead (A) and its builder (A2) share one Claude session, in worktrees of their own; A again is the lead's next run
const A = { session: 'sess-a', worktree: 'questkeep', pid: 1 }, A2 = { session: 'sess-a', agent: 'builder', worktree: 'questkeep-core', pid: 2 }, AGAIN = { ...A, pid: 5 };
const B = { session: 'sess-b', worktree: 'questkeep-days', pid: 3 }, RUNNER = { person: 'the laptop runner', worktree: 'questkeep', pid: 4 };

test("a wait behind another session's run counts its minutes until it took the slot", () => {
  const obs = observeSlot([line('05:00', 'take', A), line('05:02', 'wait', B), line('05:09', 'release', A), line('05:09', 'take', B)]);
  assert.deepEqual(obs.map(o => [o.type, o.behind, o.outcome, o.minutes, o.session]), [['wait', 'other', 'took', 7, 'sess-b']]);
});

// The plan: waits behind one's own run are the queue working, so they are not lost time. Juno's review of the build: a
// lead's builders all share its Claude session, so "own" is the same agent in the same worktree, not the same session.
test("a wait behind the same agent's own run is its own, and one behind another agent of the session is not", () => {
  assert.equal(observeSlot([line('05:00', 'take', A), line('05:01', 'wait', AGAIN), line('05:05', 'release', A), line('05:05', 'take', AGAIN)])[0].behind, 'own');
  assert.equal(observeSlot([line('05:00', 'take', A), line('05:01', 'wait', A2), line('05:05', 'release', A), line('05:05', 'take', A2)])[0].behind, 'other', 'its builder waits behind the lead');
  assert.equal(observeSlot([line('05:00', 'take', RUNNER), line('05:01', 'wait', A), line('05:05', 'release', RUNNER), line('05:05', 'take', A)])[0].behind, 'other');
});

// Juno's review of the build: a wait that found the slot free for a moment then sat behind another session's take.
test('a wait that found the slot free goes by whoever took it while it waited', () => {
  const obs = observeSlot([line('05:00', 'take', A), line('05:01', 'release', A), line('05:01', 'wait', A2), line('05:02', 'take', B), line('05:09', 'release', B), line('05:09', 'take', A2)]);
  assert.deepEqual([obs[0].behind, obs[0].minutes], ['other', 8]);
});

test('a wait behind a claim is behind its claimant', () => {
  assert.equal(observeSlot([line('05:00', 'claim', B), line('05:01', 'wait', A), line('05:30', 'unclaim', B), line('05:30', 'take', A)])[0].behind, 'other');
});

test('a wait that gave up, left or was never heard of again says so', () => {
  const ends = observeSlot([line('05:00', 'take', A), line('05:01', 'wait', B), line('05:21', 'gave-up', B),
    line('05:02', 'wait', RUNNER), line('05:12', 'left', RUNNER, { secs: 600 }), line('05:03', 'wait', A2)]);
  assert.deepEqual(ends.filter(o => o.type === 'wait').map(o => [o.outcome, o.minutes]), [['gave-up', 20], ['left', 10], ['unknown', null]]);
});

test('a refused take and a take-over are observations of their own', () => {
  const obs = observeSlot([line('05:00', 'take', A), line('05:01', 'refused', B), line('06:00', 'takeover', A, { by: 'questkeep-core' })]);
  assert.deepEqual(obs.map(o => [o.type, o.session]), [['refused', 'sess-b'], ['takeover', 'sess-a']]);
});

// Two reds in the run store on 11 October were failed results with no name, which made a signature of "undefined".
test('a failed result with no name is its task\'s infra red', () => {
  const obs = observeReds([run('r1', { tasks: [{ id: 'unit', status: 'fail', seconds: 30, cases: [{ status: 'fail', seconds: 1 }] }] })]);
  assert.deepEqual(obs.map(o => [o.sig, o.class]), [['task:unit', 'infra']]);
});

// Juno's review of the build, finding 5: reds named a unit or rules test by its title, while a fix commit names it by its
// file, so the two never met. A browser test is named by its name, which is its file's; any other by its file's path.
const FILES = [
  { path: 'tests/smoke-wake.js', name: 'smoke-wake', set: 'gate', titles: [] },
  { path: 'tests/unit/lock.test.mjs', name: 'lock', set: 'unit', titles: ['a waiter stopped before its turn logs that it left'] },
  { path: 'tests/storage-rules.test.js', name: 'storage-rules', set: 'rules', titles: ['another account cannot read a photo'] },
];
test('a red is named by its test file: a browser test by its name, a unit or rules test by its path', () => {
  const keyOf = testKeyer(FILES);
  assert.equal(keyOf('docker-gate', 'smoke-wake'), 'smoke-wake');
  assert.equal(keyOf('unit', 'a waiter stopped before its turn logs that it left'), 'tests/unit/lock.test.mjs');
  assert.equal(keyOf('rules', 'another account cannot read a photo'), 'tests/storage-rules.test.js');
  assert.equal(keyOf('unit', 'a title no file has any more'), 'a title no file has any more', 'a title no file has keeps its title');
  assert.equal(keyOf(null, 'a waiter stopped before its turn logs that it left'), 'tests/unit/lock.test.mjs', 'with no task, by any file that has the title');
  const obs = observeReds([run('r1', { tasks: [{ id: 'unit', status: 'fail', seconds: 30, cases: [{ name: 'a waiter stopped before its turn logs that it left', status: 'fail', seconds: 1 }] }] })], { keyOf });
  assert.equal(obs[0].sig, 'tests/unit/lock.test.mjs');
});

// Pull requests waiting on the person, from make dora's own figures (dora/changes.json, written beside dora.json), never
// worked out a second time: each change that came by pull request, from its last green gate to its merge.
test('a pull request waits on the person from its green gate to its merge, as make dora works it out', () => {
  const changes = [
    { path: 'pr', pr: 276, mergedAt: '2026-10-10T12:00:00Z', split: { greenToMergeSec: 5400 } },
    { path: 'push', pr: null, mergedAt: '2026-10-10T13:00:00Z', split: null },
    { path: 'pr', pr: 277, mergedAt: '2026-10-10T14:00:00Z', split: null },
  ];
  assert.deepEqual(observePulls(changes), [{ type: 'pr-wait', sig: 'pr', pr: 276, at: '2026-10-10T12:00:00Z', greenAt: '2026-10-10T10:30:00.000Z', minutes: 90 }]);
});

// Every merged pull request counts, whether or not it changed what players get: make dora's merges, not its changes.
test('pull request waits come from every merge make dora found, docs and tooling pull requests included', () => {
  const merges = [{ pr: 276, mergedAt: '2026-10-10T12:00:00Z', greenToMergeSec: 5400 }, { pr: 277, mergedAt: '2026-10-10T14:00:00Z', greenToMergeSec: 600 }];
  assert.deepEqual(observePulls([], merges), [
    { type: 'pr-wait', sig: 'pr', pr: 276, at: '2026-10-10T12:00:00Z', greenAt: '2026-10-10T10:30:00.000Z', minutes: 90 },
    { type: 'pr-wait', sig: 'pr', pr: 277, at: '2026-10-10T14:00:00Z', greenAt: '2026-10-10T13:50:00.000Z', minutes: 10 }]);
});

// A red planted on purpose on a probe/ or exp/ branch says nothing about the work: the register sets it apart, as a dirty red is.
test('a red on a probe/ or exp/ branch is planted', () => {
  const planted = observeReds([{ ...run('r1', { cases: [['smoke-nogl', 'fail']] }), info: { ...run('r1').info, branch: 'probe/rerun-once' } }]);
  assert.deepEqual(planted.map(o => o.class), ['planted']);
  assert.deepEqual(observeReds([{ ...run('r1', { cases: [['smoke-nogl', 'fail']] }), info: { ...run('r1').info, branch: 'feat/x' } }]).map(o => o.class), ['never-rerun']);
});

// The rerun's own probe on 11 October failed its container naming no test, and the Problems page read it as a tooling
// entry coming back after its fix.
test('a red naming no test on a probe/ or exp/ branch is planted too', () => {
  const failedTask = [{ id: 'docker-gate', status: 'fail', seconds: 40, cases: [] }];
  assert.deepEqual(observeReds([{ ...run('r1', { tasks: failedTask }), info: { ...run('r1').info, branch: 'exp/vm-load' } }]).map(o => [o.sig, o.class]), [['task:docker-gate', 'planted']]);
  assert.deepEqual(observeReds([{ ...run('r1', { tasks: failedTask }), info: { ...run('r1').info, branch: 'feat/x' } }]).map(o => o.class), ['infra']);
});

// Nightly 38298159812: the container ran out of memory and the page crashed. The rerun passing alone says nothing about a race.
test("a red whose page crashed is a resource red, whatever the rerun or other runs did", () => {
  const crashed = (id, extra) => ({ ...run(id, extra), tasks: [{ id: 'docker-gate', status: 'fail', seconds: 60, cases: [{ name: 'smoke-wake', status: 'fail', seconds: 17, crashed: true }] },
    { id: 'rerun', status: 'pass', seconds: 12, cases: [{ name: 'smoke-wake', status: 'pass', seconds: 11 }] }] });
  assert.equal(red(observeReds([crashed('r1')]), 'smoke-wake').class, 'resource');
  assert.equal(red(observeReds([crashed('r1'), run('r2', { cases: [['smoke-wake', 'pass']] })]), 'smoke-wake').class, 'resource');
});

// The burst proposal: a red carries its cause, the error line the facts line printed for it (scripts/error-line.mjs), so
// the register can see one cause across many tests. causeOf reads it for a run's failing test; none says null.
test('a red carries the error line its run gave that test, and whether the line is generic', () => {
  const lines = { 'smoke-wake': { line: "Error: Cannot find module 'playwright'", generic: false }, 'smoke-sync': { line: 'page.goto: timed out', generic: true } };
  const obs = observeReds([run('r1', { cases: [['smoke-wake', 'fail'], ['smoke-sync', 'fail'], ['smoke-tabs', 'fail']] })], { causeOf: (r, task, name) => lines[name] || null });
  assert.deepEqual([red(obs, 'smoke-wake').cause, red(obs, 'smoke-wake').causeGeneric], ["Error: Cannot find module 'playwright'", false]);
  assert.deepEqual([red(obs, 'smoke-sync').cause, red(obs, 'smoke-sync').causeGeneric], ['page.goto: timed out', true]);
  assert.equal(red(obs, 'smoke-tabs').cause, null, 'a test its run gave no line has none');
});

test('the reds of one runs list are sorted once: a second read asks the keyer nothing, and each read asks causes afresh', () => {
  const runs = [run('r1', { cases: [['smoke-wake', 'fail'], ['smoke-sky', 'fail']] }), run('r2', { cases: [['smoke-wake', 'pass']] })];
  let keyed = 0;
  const keyOf = (task, name) => { keyed++; return name; };
  const first = observeReds(runs, { keyOf, causeOf: () => ({ line: 'Error: before', generic: false }) });
  const was = keyed;
  const second = observeReds(runs, { keyOf, causeOf: (r, task, name) => ({ line: `Error: ${name} now`, generic: true }) });
  assert.equal(keyed, was, 'the keyer was asked again');
  assert.deepEqual(second.map(o => [o.sig, o.class, o.cause, o.causeGeneric]), [['smoke-wake', 'flaky', 'Error: smoke-wake now', true], ['smoke-sky', 'never-rerun', 'Error: smoke-sky now', true]]);
  assert.equal(first[0].cause, 'Error: before');
  second[0].owner = 'P-1';
  assert.equal(observeReds(runs, { keyOf }).find(o => o.sig === 'smoke-wake').owner, undefined, 'one read changing an observation changes no other read');
});
