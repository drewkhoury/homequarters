// HQ's reading of the run history: devpipe's run.json with the run-info line from each task's log, CI's JUnit files
// (the seam for backlog 30), flakes, and which test file each result belongs to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInfoLine, fromDevpipe, parseJunit, readCiRuns, keepFirstAttempt, flakes, fileForCase, resultsByFile, kindLabel, ago } from '../lib/runs.mjs';

// A make test run as devpipe 0.2.0 writes it: three tasks, each log opening with tests/run-info.mjs's line.
const MAKE_TEST = {
  runId: '2026-09-26T16-23-53Z_024359', timestamp: '2026-09-26T16:24:40Z', command: 'devpipe --only unit,rules,gate',
  tasks: [
    { id: 'unit', status: 'PASS', durationMs: 1200, logPath: 'unit.log', metrics: { data: { testcases: [
      { name: 'no frames, no summary', status: 'passed', time: 0.0002 },
      { name: 'the walker clamps to the disc', status: 'passed', time: 0.001 }] } } },
    { id: 'rules', status: 'PASS', durationMs: 3400, logPath: 'rules.log', metrics: { data: { testcases: [
      { name: 'owner can write and read their own profile', status: 'passed', time: 0.1 }] } } },
    { id: 'gate', status: 'FAIL', durationMs: 95000, logPath: 'gate.log', metrics: { data: { testcases: [
      { name: 'smoke-sync', status: 'passed', time: 26 },
      { name: 'smoke-reject', status: 'failed', time: 12, message: 'see /tmp/qk-smoke-reject.log' }] } } },
    { id: 'after', skipped: true },
  ],
};
const LOGS = {
  'unit.log': '=== run {"kind":"unit","where":"laptop","who":"person","branch":"main","commit":"a6cc739","dirty":false,"lanes":2}\n',
  'rules.log': '=== run {"kind":"rules","where":"laptop","who":"person","branch":"main","commit":"a6cc739","dirty":false,"lanes":2}\n',
  'gate.log': 'noise first\n=== run {"kind":"gate","where":"laptop","who":"agent","branch":"main","commit":"a6cc739","dirty":false,"lanes":2}\n=== unit pass\n',
};
const logText = p => LOGS[p] || '';

// The catalogue's shape for the files these results belong to.
const FILES = [
  { path: 'tests/smoke-sync.js', name: 'smoke-sync', set: 'gate', titles: [] },
  { path: 'tests/smoke-reject.js', name: 'smoke-reject', set: 'gate', titles: [] },
  { path: 'tests/unit/frame-stats.test.mjs', name: 'frame-stats', set: 'unit', titles: ['no frames, no summary'] },
  { path: 'tests/unit/world-walker.test.mjs', name: 'world-walker', set: 'unit', titles: ['the walker clamps to the disc'] },
  { path: 'tests/rules.test.js', name: 'rules', set: 'rules', titles: [] },
  { path: 'tests/storage-rules.test.js', name: 'storage-rules', set: 'rules', titles: ['another account cannot read a photo'] },
];

test("the run-info line is found anywhere in a log's opening, and a log without one answers null", () => {
  assert.equal(runInfoLine(LOGS['gate.log']).who, 'agent');
  assert.equal(runInfoLine('=== unit pass\n'), null);
  assert.equal(runInfoLine('=== run {not json}\n'), null);
});

test("a devpipe run takes the last task's run-info line, skips skipped tasks, and fails when any task failed", () => {
  const r = fromDevpipe(MAKE_TEST, logText);
  assert.equal(r.info.kind, 'gate');
  assert.deepEqual(r.tasks.map(t => [t.id, t.status, t.seconds]), [['unit', 'pass', 1.2], ['rules', 'pass', 3.4], ['gate', 'fail', 95]]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.tasks[2].cases[1], { name: 'smoke-reject', status: 'fail', seconds: 12 });
});

// A failed browser test's JUnit message names its log relative to the run's folder (logs/<test>.log), and the run line
// names that folder as out (tests/run-info.mjs), so HQ can open the log of the test that failed. A message from before
// (see /tmp/qk-<test>.log), a run line without out, or a name that climbs out of the folder gives no log.
test("a failed test's log is its JUnit message's logs/<test>.log, read against the run's out", () => {
  const out = '/cache/results/2026-10-04T10-00-00Z-abc123';
  const run = (message, line = `{"kind":"docker-gate","commit":"a6cc739","out":"${out}"}`) => fromDevpipe({ runId: 'r', timestamp: 't', tasks: [
    { id: 'docker-gate', status: 'FAIL', durationMs: 1, logPath: 'g.log', metrics: { data: { testcases: [
      { name: 'smoke-sync', status: 'passed', time: 26 }, { name: 'smoke-reject', status: 'failed', time: 12, message }] } } }] },
  () => `=== run ${line}\n`);
  const cases = r => r.tasks[0].cases;
  assert.equal(run('see logs/smoke-reject.log').info.out, out);
  assert.equal(cases(run('see logs/smoke-reject.log'))[1].log, join(out, 'logs', 'smoke-reject.log'));
  assert.equal(cases(run('stopped at its time limit; see logs/smoke-reject.log'))[1].log, join(out, 'logs', 'smoke-reject.log'));
  assert.equal(cases(run('see logs/smoke-reject.log'))[0].log, undefined, 'a test that passed links no log');
  assert.equal(cases(run('see /tmp/qk-smoke-reject.log'))[1].log, undefined, 'an old message gives no log');
  assert.equal(cases(run('see logs/smoke-reject.log', '{"kind":"docker-gate"}'))[1].log, undefined, 'a run without out gives no log');
  assert.equal(cases(run('see logs/../../etc/passwd.log'))[1].log, undefined, 'a name that climbs out gives no log');
});

test('a run recorded before devpipe 0.2.0 keeps its results straight under metrics', () => {
  const old = { runId: 'x', timestamp: 't', tasks: [{ id: 'unit', status: 'PASS', durationMs: 0, metrics: { testcases: [{ name: 'a', status: 'passed', time: 1 }] } }] };
  assert.equal(fromDevpipe(old, logText).tasks[0].cases.length, 1);
});

test('JUnit from node and from the browser lanes reads as name, result and seconds', () => {
  const xml = `<testsuites><testsuite name="unit">
    <testcase name="a &amp; b" time="0.5" classname="test"/>
    <testcase name="smoke-reject" classname="browser" time="12"><failure message="see log"/></testcase>
    <testcase name="later" time="0"><skipped/></testcase>
    <testcase name="a round > 25 minutes" time="1" classname="test"/>
  </testsuite></testsuites>`;
  assert.deepEqual(parseJunit(xml), [
    { name: 'a & b', status: 'pass', seconds: 0.5 },
    { name: 'smoke-reject', status: 'fail', seconds: 12 },
    { name: 'later', status: 'skip', seconds: 0 },
    { name: 'a round > 25 minutes', status: 'pass', seconds: 1 },
  ]);
});

// CI's results as backlog 30 keeps them after make ci-history: junit-<run>-<attempt>-<gate|after>/ with run.json from
// tests/run-info.mjs --json and one JUnit file per task. Run 41 failed smoke-sync on attempt 1 and passed on attempt 2.
function ciFolder() {
  const ci = mkdtempSync(join(tmpdir(), 'hq-ci-'));
  const artifact = (name, meta, xml) => {
    mkdirSync(join(ci, name));
    writeFileSync(join(ci, name, 'run.json'), JSON.stringify({ kind: 'gate', where: 'ci', who: 'ci', branch: 'main', commit: 'a6cc739', dirty: false, lanes: 1, event: 'push', run: '41', ...meta }, null, 2));
    for (const [f, body] of Object.entries(xml)) writeFileSync(join(ci, name, f), body);
  };
  const unit = '<testsuites><testsuite name="unit a6cc739"><testcase name="a round > 25 minutes is refused" time="0.01" classname="test"/></testsuite></testsuites>';
  const rules = '<testsuites><testsuite name="rules"><testcase name="owner can write and read their own profile" time="0.1" classname="test"/></testsuite></testsuites>';
  artifact('junit-41-1-gate', { attempt: 1, at: '2026-09-26T18:00:00Z' }, { 'unit.xml': unit, 'rules.xml': rules,
    'gate.xml': '<testsuite name="browser lanes=1"><testcase name="smoke-sync" classname="browser" time="30"><failure message="see /tmp/qk-smoke-sync.log"/></testcase></testsuite>' });
  artifact('junit-41-2-gate', { attempt: 2, at: '2026-09-26T18:10:00Z' }, { 'unit.xml': unit, 'rules.xml': rules,
    'gate.xml': '<testsuite name="browser lanes=1"><testcase name="smoke-sync" classname="browser" time="28"/></testsuite>' });
  artifact('junit-41-1-after', { kind: 'after', attempt: 1, at: '2026-09-26T18:05:00Z' }, {
    'after.xml': '<testsuite name="browser lanes=1"><testcase name="walk-world" classname="browser" time="50"/></testsuite>' });
  mkdirSync(join(ci, 'stray')); writeFileSync(join(ci, 'stray', 'run.json'), '{}');
  return ci;
}

test("CI runs are read from backlog 30's artifact folders, and any other folder is skipped", () => {
  const ci = ciFolder();
  try {
    const runs = readCiRuns(ci);
    assert.deepEqual(runs.map(r => r.id), ['junit-41-1-after', 'junit-41-1-gate', 'junit-41-2-gate']);
    const [after, first] = runs;
    assert.deepEqual(first.info, { kind: 'gate', who: 'ci', where: 'ci', branch: 'main', commit: 'a6cc739', dirty: false, lanes: 1, event: 'push', run: '41', attempt: 1 });
    assert.deepEqual([first.source, first.when, first.ok], ['ci', '2026-09-26T18:00:00Z', false]);
    assert.deepEqual(first.tasks.map(t => [t.id, t.status]), [['gate', 'fail'], ['rules', 'pass'], ['unit', 'pass']]);
    assert.deepEqual(first.tasks[2].cases, [{ name: 'a round > 25 minutes is refused', status: 'pass', seconds: 0.01 }]);
    assert.deepEqual([after.info.kind, after.ok, after.tasks.map(t => t.id)], ['after', true, ['after']]);
  } finally { rmSync(ci, { recursive: true, force: true }); }
  assert.deepEqual(readCiRuns(join(tmpdir(), 'hq-no-such-folder')), []);
});

// Since 1 October the gate runs as two halves, each uploading its own folder, junit-<run>-<attempt>-gate_<half>, and a
// re-run of one half adds a folder for that half alone under the next attempt. The halves' run.json as run-info writes it.
const SPEC = {
  a: { 'rules.xml': '<testsuite name="rules"><testcase name="r" time="0.1"/></testsuite>' },
  b: { 'unit.xml': '<testsuite name="unit"><testcase name="u" time="0.01"/></testsuite>' },
};
const browser = (name, ok, time = 20) => `<testsuite name="browser lanes=1"><testcase name="${name}" classname="browser" time="${time}">${ok ? '' : '<failure message="see its log"/>'}</testcase></testsuite>`;
function halvesFolder(folders) {
  const ci = mkdtempSync(join(tmpdir(), 'hq-ci-'));
  for (const [name, gate] of Object.entries(folders)) {
    const [, run, attempt, part] = /^junit-(\d+)-(\d+)-gate_(\w+)$/.exec(name);
    mkdirSync(join(ci, name));
    writeFileSync(join(ci, name, 'run.json'), JSON.stringify({ kind: 'gate', where: 'ci', who: 'ci', branch: 'main', commit: 'b7c1d2e', dirty: false, lanes: 1, event: 'push',
      run, attempt: +attempt, half: part, at: `2026-10-01T18:${String(attempt).padStart(2, '0')}:00Z` }));
    for (const [f, body] of Object.entries({ ...(SPEC[part] || {}), 'gate.xml': gate })) writeFileSync(join(ci, name, f), body);
  }
  return ci;
}

// Review 14, 2 October: each half read as a run of its own, so the pipeline's CI result showed whichever half was newest.
test("a CI run's gate halves read as one run, each half at its newest attempt", () => {
  const ci = halvesFolder({ 'junit-42-1-gate_a': browser('smoke-sync', false), 'junit-42-1-gate_b': browser('load-check', true), 'junit-42-2-gate_a': browser('smoke-sync', true) });
  try {
    const runs = readCiRuns(ci);
    assert.deepEqual(runs.map(r => [r.id, r.ok]), [['junit-42-1-gate', false], ['junit-42-2-gate', true]]);
    const rerun = runs[1];
    assert.deepEqual(rerun.tasks.map(t => [t.id, t.cases.map(c => `${c.name} ${c.status}`).join(', ')]),
      [['gate', 'smoke-sync pass, load-check pass'], ['rules', 'r pass'], ['unit', 'u pass']]);
    assert.deepEqual([rerun.info.kind, rerun.info.run, rerun.info.attempt, rerun.when], ['gate', '42', 2, '2026-10-01T18:02:00Z']);
    assert.deepEqual(rerun.parts.map(p => [p.id, p.half]), [['junit-42-2-gate_a', 'a'], ['junit-42-1-gate_b', 'b']]);
  } finally { rmSync(ci, { recursive: true, force: true }); }
});

test('attempt 10 is newer than attempt 9, and a run may have any number of parts', () => {
  const ci = halvesFolder({ 'junit-43-9-gate_a': browser('smoke-sync', false), 'junit-43-10-gate_a': browser('smoke-sync', true),
    'junit-43-9-gate_b': browser('load-check', true), 'junit-43-9-gate_c': browser('smoke-tour', true) });
  try {
    const newest = readCiRuns(ci).find(r => r.info.attempt === 10);
    assert.deepEqual([newest.ok, newest.parts.map(p => p.id)], [true, ['junit-43-10-gate_a', 'junit-43-9-gate_b', 'junit-43-9-gate_c']]);
    assert.deepEqual(newest.tasks.find(t => t.id === 'gate').cases.map(c => c.name), ['smoke-sync', 'load-check', 'smoke-tour']);
  } finally { rmSync(ci, { recursive: true, force: true }); }
});

test("a half that fails and then passes on its re-run is a flake; the other half's one result is not", () => {
  const ci = halvesFolder({ 'junit-42-1-gate_a': browser('smoke-sync', false), 'junit-42-1-gate_b': browser('load-check', true), 'junit-42-2-gate_a': browser('smoke-sync', true) });
  try {
    assert.deepEqual(flakes(readCiRuns(ci)).map(f => f.test), ['smoke-sync']);
  } finally { rmSync(ci, { recursive: true, force: true }); }
});

test('a test that fails on one attempt and passes on the re-run is a flake, kept apart from the laptop', () => {
  const ci = ciFolder();
  try {
    const runs = readCiRuns(ci);
    assert.deepEqual(flakes(runs), [{ commit: 'a6cc739', kind: 'ci-gate', task: 'ci-gate', test: 'smoke-sync' }]);
    assert.equal(fileForCase('ci-gate', 'smoke-sync', FILES).path, 'tests/smoke-sync.js');
    assert.equal(fileForCase('ci-unit', 'no frames, no summary', FILES).path, 'tests/unit/frame-stats.test.mjs');
    // the laptop passing the same test on the same commit is not CI's flake, nor a new one
    const laptop = { id: 'l', source: 'laptop', when: 'x', info: { commit: 'a6cc739', dirty: false }, tasks: [{ id: 'gate', cases: [{ name: 'smoke-sync', status: 'pass', seconds: 1 }] }] };
    assert.deepEqual(flakes([runs[1], laptop]), []);
  } finally { rmSync(ci, { recursive: true, force: true }); }
});

// runs in the shared shape, built small: one task, one result, and the kind of run, which is the task's name unless given
const run = (commit, dirty, status, task = 'gate', name = 'smoke-sync', kind = task) =>
  ({ id: `${commit}-${status}`, source: 'laptop', when: '2026-09-26T00:00:00Z', info: { commit, dirty, kind, where: 'laptop' }, tasks: [{ id: task, cases: [{ name, status, seconds: 1 }] }] });

test('a test that passed and failed on one clean commit in one kind of run is a flake', () => {
  assert.deepEqual(flakes([run('abc', false, 'pass'), run('abc', false, 'fail')]), [{ commit: 'abc', kind: 'gate', task: 'gate', test: 'smoke-sync' }]);
});

test('different commits, a dirty tree or different kinds of run are not a flake', () => {
  assert.deepEqual(flakes([run('abc', false, 'pass'), run('def', false, 'fail')]), []);
  assert.deepEqual(flakes([run('abc', false, 'pass'), run('abc', true, 'fail')]), []);
  assert.deepEqual(flakes([run('abc', false, 'pass', 'gate'), run('abc', false, 'fail', 'docker-gate')]), []);
});

// Review 28, 2 October: HQ keyed a flake by commit and task, make history (tests/history.mjs) by commit and kind, so
// a unit test that passed in make test-unit and failed in make test's unit task was flaky on HQ and steady in make history.
test('the same task in two kinds of run is not a flake, as make history counts it', () => {
  const unit = 'a round > 25 minutes is refused';
  assert.deepEqual(flakes([run('abc', false, 'pass', 'unit', unit, 'unit'), run('abc', false, 'fail', 'unit', unit, 'gate')]), []);
  assert.deepEqual(flakes([run('abc', false, 'pass', 'unit', unit, 'gate'), run('abc', false, 'fail', 'unit', unit, 'gate')]).map(f => [f.kind, f.task]), [['gate', 'unit']]);
});

test('each result belongs to its file: browser by name, node and rules by title, an unknown rules title to rules.test.js', () => {
  assert.equal(fileForCase('gate', 'smoke-sync', FILES).path, 'tests/smoke-sync.js');
  assert.equal(fileForCase('docker-gate', 'smoke-reject', FILES).path, 'tests/smoke-reject.js');
  assert.equal(fileForCase('unit', 'no frames, no summary', FILES).path, 'tests/unit/frame-stats.test.mjs');
  assert.equal(fileForCase('rules', 'anything at all', FILES).path, 'tests/rules.test.js');
  assert.equal(fileForCase('docker-rules', 'another account cannot read a photo', FILES).path, 'tests/storage-rules.test.js');
  assert.equal(fileForCase('unit', 'a title no file has', FILES), null);
});

test("a file's result in a run fails when any of its tests failed and adds up their seconds", () => {
  const r = fromDevpipe(MAKE_TEST, logText);
  const by = resultsByFile([r], FILES);
  assert.deepEqual(by.get('tests/smoke-reject.js').map(o => [o.status, o.seconds, o.where]), [['fail', 12, 'laptop']]);
  assert.deepEqual(by.get('tests/unit/frame-stats.test.mjs').map(o => [o.status, o.seconds]), [['pass', 0.0002]]);
  assert.deepEqual(by.get('tests/rules.test.js').map(o => o.status), ['pass']);
});

// The Runs tab says what ran in plain words, and when as a person would say it (27 September: "docker-gate" and
// "deploy-after" needed a legend, and a date wrapped over three lines).
test('each kind of run has a name a person reads without a legend, and an unknown one says so', () => {
  assert.deepEqual(['unit', 'rules', 'gate', 'docker-gate', 'deploy', 'after', 'docker-after', 'deploy-after', 'soak'].map(kindLabel),
    ['Unit tests', 'Rules tests', 'Gate', 'Gate (container)', 'Deploy gate', 'Long set', 'Long set (container)', 'Deploy long set', 'Soak']);
  assert.equal(kindLabel(undefined), 'Unknown'); assert.equal(kindLabel('?'), 'Unknown');
  assert.equal(kindLabel('something-new'), 'something-new', 'a kind added later is shown as it is');
});

test('when a run happened reads as a person says it, from just now to the date', () => {
  const now = Date.parse('2026-09-28T12:00:00Z'), at = s => new Date(now - s * 1000).toISOString();
  assert.equal(ago(at(20), now), 'just now');
  assert.equal(ago(at(5 * 60), now), '5 min ago');
  assert.equal(ago(at(3 * 3600 + 100), now), '3 h ago');
  assert.equal(ago(at(30 * 3600), now), 'yesterday');
  assert.equal(ago(at(4 * 86400), now), '4 days ago');
  assert.equal(ago('2026-08-01T10:00:00Z', now), '2026-08-01');
  assert.equal(ago('not a date', now), '?');
});

// After a red container gate its failing browser tests run once more in the same container, and the rerun's JUnit file is
// rerun.xml in the run's folder (out in its run line), its tests' logs in rerun/logs there (the Makefile's _rerun). On CI
// the same file sits beside gate.xml and reads as a task of the run already; on the laptop devpipe reads only gate.xml,
// so fromDevpipe adds it. The rerun never makes the run pass, and a red-then-green pair on one clean commit is a flake.
const RERUN_OUT = '/cache/results/2026-10-11T05-00-00Z-a6cc739';
const RED_GATE = { runId: '2026-10-11T05-00-00Z_000001', timestamp: '2026-10-11T05:00:00Z', tasks: [
  { id: 'docker-gate', status: 'FAIL', durationMs: 300000, logPath: 'g.log', metrics: { data: { testcases: [
    { name: 'smoke-sync', status: 'passed', time: 26 }, { name: 'smoke-reject', status: 'failed', time: 12, message: 'see logs/smoke-reject.log' }] } } }] };
const redLine = () => `=== run {"kind":"docker-gate","where":"container","commit":"a6cc739","dirty":false,"out":"${RERUN_OUT}"}\n`;
const rerunXml = ok => `<testsuite name="rerun"><testcase name="smoke-reject" classname="browser" time="11">${ok ? '' : '<failure message="see logs/smoke-reject.log"/>'}</testcase></testsuite>`;
const withRerun = ok => fromDevpipe(RED_GATE, redLine, p => (p === join(RERUN_OUT, 'rerun.xml') ? rerunXml(ok) : null));

test("a laptop gate's rerun reads as its task named rerun, and never makes the run pass", () => {
  const r = withRerun(true);
  assert.deepEqual(r.tasks.map(t => [t.id, t.status]), [['docker-gate', 'fail'], ['rerun', 'pass']]);
  assert.deepEqual(r.tasks[1].cases, [{ name: 'smoke-reject', status: 'pass', seconds: 11 }]);
  assert.equal(r.ok, false);
  assert.deepEqual(fromDevpipe(RED_GATE, redLine, () => null).tasks.map(t => t.id), ['docker-gate'], 'a run with no rerun has no rerun task');
});

test("a red rerun's log is the rerun's own, in the run's rerun folder", () => {
  const c = withRerun(false).tasks[1].cases[0];
  assert.equal(c.status, 'fail');
  assert.equal(c.log, join(RERUN_OUT, 'rerun', 'logs', 'smoke-reject.log'));
});

// A flake whose only pass came from the rerun is marked byRerun, so make dora can say how many the rerun found: the
// rerun finds flakes that went unseen before, and without the mark the rate would look as if the tests got worse.
test("a gate red and its rerun's pass on one clean commit is a flake, named for the gate's task and marked as the rerun's find", () => {
  assert.deepEqual(flakes([withRerun(true)]), [{ commit: 'a6cc739', kind: 'docker-gate', task: 'docker-gate', test: 'smoke-reject', byRerun: true }]);
  assert.deepEqual(flakes([withRerun(false)]), [], 'red twice is not a flake');
});

// HQ's Testing page keys a file's results by run (hq/pages/testing.mjs), so a rerun counted there would replace the
// gate's red with the rerun's pass on that file's page.
test("a file's results leave the rerun out, so the gate's own result stands", () => {
  assert.deepEqual(resultsByFile([withRerun(true)], FILES).get('tests/smoke-reject.js').map(o => [o.task, o.status]), [['docker-gate', 'fail']]);
});


// A run on a probe/ or exp/ branch is made on purpose, as the rerun's probe on 11 October planted a red on smoke-nogl
// to watch the rerun pass it; its flakes are never real ones, so HQ and make dora leave them out. Drew agreed on 11 October.
test('a flake on a probe/ or exp/ branch is planted, and never counted', () => {
  const on = branch => ({ ...run('abc', false, 'fail'), info: { ...run('abc', false, 'fail').info, branch } });
  const pass = { ...run('abc', false, 'pass'), info: { ...run('abc', false, 'pass').info, branch: 'probe/rerun-once' } };
  assert.deepEqual(flakes([on('probe/rerun-once'), pass]), []);
  assert.deepEqual(flakes([{ ...on('exp/filing-red'), id: 'x1' }, { ...pass, id: 'x2', info: { ...pass.info, branch: 'exp/filing-red' } }]), []);
  assert.equal(flakes([on('feat/real-work'), { ...pass, info: { ...pass.info, branch: 'feat/real-work' } }]).length, 1);
});

// The nightly runs the long set again in the same job when it fails; tests/ci-fetch.mjs keeps the first attempt as
// junit-<run>-<attempt>-after_first beside the last attempt's junit-<run>-<attempt>-after.
function nightlyFolder(first, last) {
  const ci = mkdtempSync(join(tmpdir(), 'hq-ci-'));
  for (const [name, xml] of [['junit-50-1-after_first', first], ['junit-50-1-after', last]]) {
    mkdirSync(join(ci, name));
    writeFileSync(join(ci, name, 'run.json'), JSON.stringify({ kind: 'after', where: 'ci', who: 'ci', branch: 'main', commit: '1c8851f', dirty: false, lanes: 2, event: 'schedule', run: '50', attempt: 1, at: '2026-10-12T20:01:22Z' }));
    writeFileSync(join(ci, name, 'after.xml'), xml);
  }
  return ci;
}

test("a nightly's first attempt reads as a run of its own, so a test that failed then passed on the same commit is a flake", () => {
  const ci = nightlyFolder(browser('smoke-postcard', false), browser('smoke-postcard', true));
  try {
    const runs = readCiRuns(ci);
    assert.deepEqual(runs.map(r => [r.id, r.ok]), [['junit-50-1-after', true], ['junit-50-1-after_first', false]]);
    assert.deepEqual(flakes(runs).map(f => [f.commit, f.kind, f.test]), [['1c8851f', 'ci-after', 'smoke-postcard']]);
  } finally { rmSync(ci, { recursive: true, force: true }); }
});

test("a long-set artifact's first attempt is kept as the run's after_first folder, with the last attempt's run.json", () => {
  const root = mkdtempSync(join(tmpdir(), 'hq-first-'));
  try {
    const longSet = join(root, 'long-set-50-1'), last = join(root, 'junit-50-1-after');
    mkdirSync(join(longSet, 'test-results-first', 'logs'), { recursive: true });
    mkdirSync(last);
    writeFileSync(join(longSet, 'test-results-first', 'after.xml'), browser('smoke-postcard', false));
    writeFileSync(join(longSet, 'test-results-first', 'logs', 'smoke-postcard.log'), 'log');
    writeFileSync(join(last, 'run.json'), '{"kind":"after","run":"50","attempt":1}');
    assert.deepEqual(keepFirstAttempt(longSet, last, join(root, 'junit-50-1-after_first')), { kept: join(root, 'junit-50-1-after_first') });
    assert.deepEqual(readdirSync(join(root, 'junit-50-1-after_first')).sort(), ['after.xml', 'logs', 'run.json']);
    assert.match(keepFirstAttempt(longSet, last, join(root, 'junit-50-1-after_first')).skipped, /already/);
    const none = join(root, 'long-set-51-1');
    mkdirSync(none);
    assert.match(keepFirstAttempt(none, last, join(root, 'x')).skipped, /no first attempt/, 'a night that passed first time has nothing to keep');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Nightly 38298159812: smoke-wake died in the two-core job with "page.evaluate: Target crashed" when the container hit
// its memory cap, and the rerun alone passed. That is a resource failure, not a flake.
test("a failed test whose log says the page crashed is marked crashed, and is never a flake", () => {
  const ci = halvesFolder({ 'junit-60-1-gate_a': browser('smoke-wake', false) });
  try {
    mkdirSync(join(ci, 'junit-60-1-gate_a', 'logs'));
    writeFileSync(join(ci, 'junit-60-1-gate_a', 'logs', 'smoke-wake.log'), 'WAKE FAILED page.evaluate: Target crashed \n');
    const crashed = readCiRuns(ci)[0].tasks.find(t => t.id === 'gate').cases;
    assert.deepEqual(crashed.map(c => [c.name, c.status, c.crashed]), [['smoke-wake', 'fail', true]]);
    const passes = { id: 'p', source: 'ci', when: 'x', info: { commit: 'b7c1d2e', dirty: false, kind: 'gate' }, tasks: [{ id: 'gate', cases: [{ name: 'smoke-wake', status: 'pass', seconds: 1 }] }] };
    assert.deepEqual(flakes([...readCiRuns(ci), passes]), []);
  } finally { rmSync(ci, { recursive: true, force: true }); }
});

test("a failed test whose log only mentions being killed in another sense stays an ordinary red", () => {
  const ci = halvesFolder({ 'junit-61-1-gate_a': browser('smoke-wake', false) });
  try {
    mkdirSync(join(ci, 'junit-61-1-gate_a', 'logs'));
    writeFileSync(join(ci, 'junit-61-1-gate_a', 'logs', 'smoke-wake.log'), 'Moss Killed the weed and the bird Killed time\nexpected 3 to equal 4\n');
    assert.equal(readCiRuns(ci)[0].tasks.find(t => t.id === 'gate').cases[0].crashed, undefined);
  } finally { rmSync(ci, { recursive: true, force: true }); }
});
