// Proves: a run as it happens (lib/live.mjs, pages/live.mjs): what a log says about each test while it runs and once
// it has finished, which run folder belongs to the run holding the slot, and the stream of what the log gains, all
// from temp folders made here.
// Why: the live view is watched instead of the terminal, and it must never touch the real cache, the slot or a real
// run to be tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { ansiToHtml, expectedTests, parseProgress, matchRunFolder, folderTime, liveNow, isLive } from '../lib/live.mjs';
import { livePage, liveCard, liveStream } from '../pages/live.mjs';

// The container gate's log, cut to its shape: the run line, unit and rules, the script line naming the browser tests,
// then each browser test's marker and tail. A pass prints three lines (often ALL PASS); a failure up to 25 and a FAIL.
const RUN = '=== run {"kind":"docker-gate","where":"container","who":"agent","branch":"fix/x","commit":"570a903","dirty":false,"lanes":1}';
const SCRIPT = 'i  Running script: node tests/project.mjs sweep ... ; status=0; for t in smoke-prep smoke-sync smoke-tabs; do st=$(cat /tmp/qk-$t.status); ... done';
const START = [RUN, '=== unit pass', 'i  emulators: Starting emulators: auth, firestore, storage', SCRIPT, '=== rules (6s) pass'].join('\n') + '\n';
const RESULTS = ['=== smoke-prep (25s)', 'errors: []', 'ALL PASS',
  '=== smoke-sync (28s)', '  1: signs in', '  2: B sees the task', 'errors: ["sync push failed"]', 'FAIL',
  '=== smoke-tabs (41s) hit its time limit', '  3: the second tab opens',
  '=== leak check pass: nothing new in questkeep', '⚠  Script exited unsuccessfully (code 1)'].join('\n') + '\n';
// node's own output, as make test-unit writes it: coloured ✔ and ✖ lines, then the failures again and the totals
const UNIT = ['=== run {"kind":"unit","where":"laptop","who":"agent","branch":"main","commit":"abc1234","dirty":false,"lanes":2}',
  '\x1b[32m✔ a round counts for its day \x1b[90m(0.6ms)\x1b[39m\x1b[39m', '\x1b[31m✖ a 1 am round counts for the day before \x1b[90m(1.2ms)\x1b[39m\x1b[39m',
  '  AssertionError: expected Tuesday', '\x1b[32m✔ each day across a clock change is its own \x1b[90m(0.4ms)\x1b[39m\x1b[39m',
  '✖ failing tests:', '✖ a 1 am round counts for the day before (1.2ms)', 'ℹ tests 3', 'ℹ pass 2', 'ℹ fail 1'].join('\n') + '\n';
const SETS = { gate: ['load-check', 'smoke-prep'], after: ['walk-world'] };

test('terminal colours become spans, and the text around them is escaped', () => {
  assert.equal(ansiToHtml('\x1b[32m✔ ok\x1b[39m <b>'), '<span class="lv-c32">✔ ok</span> &lt;b&gt;');
  assert.equal(ansiToHtml('\x1b[1m\x1b[31mbold red\x1b[0m plain'), '<span class="lv-b"><span class="lv-c31">bold red</span></span> plain');
  assert.equal(ansiToHtml('\x1b[2Kcleared'), 'cleared', 'codes it does not know are dropped');
});

test('the tests a run will report come from its own script, with unit and rules first in a container', () => {
  assert.deepEqual(expectedTests(START, 'docker-gate', SETS), ['unit', 'rules', 'smoke-prep', 'smoke-sync', 'smoke-tabs']);
  assert.deepEqual(expectedTests('', 'gate', SETS), ['load-check', 'smoke-prep'], 'no script line: the Makefile\'s set');
  assert.deepEqual(expectedTests('', 'docker-after', SETS), ['walk-world']);
});

test('while the browser lanes run, every browser test without a result is running, together', () => {
  const p = parseProgress(START, { expected: expectedTests(START, 'docker-gate', SETS), live: true });
  assert.deepEqual(p.tests.map(t => [t.name, t.state]), [['unit', 'passed'], ['rules', 'passed'], ['smoke-prep', 'running'], ['smoke-sync', 'running'], ['smoke-tabs', 'running']]);
  assert.equal(p.phase, 'browser');
  assert.deepEqual([p.totals.passed, p.totals.running], [2, 3]);
});

test('before unit has reported, unit runs and the rest wait', () => {
  const p = parseProgress(RUN + '\n', { expected: ['unit', 'rules', 'smoke-prep'], live: true, kind: 'docker-gate' });
  assert.deepEqual(p.tests.map(t => t.state), ['running', 'waiting', 'waiting']);
  assert.equal(p.phase, 'unit');
});

test('a finished log: passes, a FAIL with the end of its output, a time limit, and the run failed', () => {
  const text = START + RESULTS;
  const p = parseProgress(text, { expected: expectedTests(text, 'docker-gate', SETS), live: false });
  const by = Object.fromEntries(p.tests.map(t => [t.name, t]));
  assert.deepEqual([by['smoke-prep'].state, by['smoke-prep'].seconds], ['passed', 25]);
  assert.equal(by['smoke-sync'].state, 'failed');
  assert.match(by['smoke-sync'].excerpt, /sync push failed[\s\S]*FAIL$/);
  assert.deepEqual([by['smoke-tabs'].state, by['smoke-tabs'].timeLimit], ['failed', true]);
  assert.equal(p.finished, 'failed');
  assert.equal(text.split('\n')[by['smoke-sync'].line], '=== smoke-sync (28s)', 'each test knows its line in the log');
});

test('a test with no result in a finished run did not run', () => {
  const p = parseProgress(START + '⚠  Script exited unsuccessfully (code 1)\n', { expected: ['unit', 'rules', 'smoke-prep'], live: false });
  assert.equal(p.tests[2].state, 'notrun');
});

test('node\'s own output is counted: passes, failures with their message, and the totals it prints', () => {
  const p = parseProgress(UNIT, { live: false });
  assert.equal(p.mode, 'counts');
  assert.deepEqual([p.totals.passed, p.totals.failed], [2, 1], 'the failure listed again at the end is not counted twice');
  assert.match(p.tests.find(t => t.state === 'failed').excerpt, /AssertionError: expected Tuesday/);
  assert.deepEqual(p.summary, { tests: 3, pass: 2, fail: 1 });
  assert.equal(p.finished, 'failed');
});

// ---- which run is live ----

const SINCE = '2026-09-29T06:53:13.883Z';
test('the run folder for the lock\'s holder is the newest started after the lock was taken, on its branch', () => {
  const folders = [{ id: '2026-09-29T06-51-41Z_025425', info: { branch: 'HEAD' } }, { id: '2026-09-29T06-53-14Z_028792', info: { branch: 'HEAD' } },
    { id: '2026-09-29T06-53-20Z_028999', info: { branch: 'other' } }];
  assert.equal(matchRunFolder({ since: SINCE, branch: 'HEAD' }, folders), '2026-09-29T06-53-14Z_028792');
  assert.equal(matchRunFolder({ since: SINCE, branch: 'HEAD' }, folders.slice(0, 1)), null, 'a folder from before the lock is someone else\'s');
  assert.equal(folderTime('2026-09-29T06-53-14Z_028792'), Date.parse('2026-09-29T06:53:14Z'));
});

// A cache made here with a lock held by this test's own process and a run folder with its log.
function cache({ live = true, text = START } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-live-'));
  const id = new Date(Date.now() - 1000).toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z') + '_000001';
  mkdirSync(join(dir, 'runs', 'runs', id, 'logs'), { recursive: true });
  const log = join(dir, 'runs', 'runs', id, 'logs', 'docker-gate.log');
  writeFileSync(log, text);
  mkdirSync(join(dir, 'lock'));
  if (live) writeFileSync(join(dir, 'lock', 'run.json'), JSON.stringify({ session: 's1', pid: process.pid, worktree: 'questkeep-sync', branch: 'fix/x', target: 'docker-test', since: new Date(Date.now() - 5000).toISOString() }));
  return { dir, id, log, ctx: { cache: dir, repo: dir, liveEvery: { read: 15, check: 15 } }, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('the holder of the slot, its run folder, and whether that run is still going', () => {
  const c = cache();
  const now = liveNow(c.ctx);
  assert.deepEqual([now.run.target, now.run.who, now.folder], ['docker-test', 'questkeep-sync', c.id]);
  assert.equal(isLive(c.ctx, c.id), true);
  writeFileSync(join(c.dir, 'runs', 'runs', c.id, 'run.json'), '{"tasks":[]}');
  assert.equal(isLive(c.ctx, c.id), false, 'devpipe writes run.json when the run ends');
  c.done();
});

test('no lock, or a lock whose process has gone, is no run', () => {
  const c = cache({ live: false });
  assert.equal(liveNow(c.ctx).run, null);
  writeFileSync(join(c.dir, 'lock', 'run.json'), JSON.stringify({ pid: 2 ** 22 + 12345, since: new Date().toISOString() }));
  assert.equal(liveNow(c.ctx).run, null);
  c.done();
});

// A response as the server hands one over: what is written, and a close when the page goes.
function fakeRes() {
  const r = Object.assign(new EventEmitter(), { writableEnded: false, events: [], status: null, wake: () => {} });
  r.writeHead = s => { r.status = s; };
  r.write = chunk => { for (const l of String(chunk).split('\n').filter(Boolean)) r.events.push(JSON.parse(l)); r.wake(); };
  r.end = () => { r.writableEnded = true; r.wake(); };
  r.until = cond => new Promise(done => { r.wake = () => cond() && done(); r.wake(); });
  return r;
}

test('the stream sends what the log gains, the tests as they change, and done when the run ends', async () => {
  const c = cache();
  const res = fakeRes();
  liveStream(c.ctx, c.id, 'docker-gate', Buffer.byteLength(START))(res);
  await res.until(() => res.events.some(e => e.type === 'tests'));
  assert.equal(res.status, 200);
  assert.equal(res.events.find(e => e.type === 'tests').progress.phase, 'browser');
  appendFileSync(c.log, '=== smoke-prep (25s)\nerrors: []\nALL PASS\n');
  await res.until(() => res.events.some(e => e.type === 'lines'));
  const lines = res.events.filter(e => e.type === 'lines');
  assert.deepEqual(lines[0].html, ['=== smoke-prep (25s)', 'errors: []', 'ALL PASS'], 'only what was added, not what the page had');
  await res.until(() => res.events.some(e => e.type === 'tests' && e.progress.tests.find(t => t.name === 'smoke-prep')?.state === 'passed'));
  writeFileSync(join(c.dir, 'runs', 'runs', c.id, 'run.json'), JSON.stringify({ tasks: [{ id: 'docker-gate', status: 'PASS' }] }));
  await res.until(() => res.writableEnded);
  assert.deepEqual(res.events.at(-1), { type: 'done', ok: true });
  res.emit('close');
  c.done();
});

test('an unknown run or task is a 404, and a run id that is not a folder name is refused', async () => {
  const c = cache();
  for (const id of ['2026-01-01T00-00-00Z_000000', '../lock', 'x/y']) {
    const res = fakeRes();
    await liveStream(c.ctx, id, 'docker-gate', 0)(res);
    assert.equal(res.status, 404, id);
  }
  c.done();
});

test('the page shows every test, the coloured log and the stream\'s starting point; Home says what is running', () => {
  const c = cache({ text: START + '\x1b[31mred\x1b[39m <tag>\n' });
  const html = livePage(c.ctx, c.id, new URLSearchParams());
  assert.match(html, /<h1>Running now/);
  assert.equal((html.match(/class="lv-test" data-state="running"/g) || []).length, 3);
  assert.match(html, /<span class="lv-c31">red<\/span> &lt;tag&gt;/);
  const data = JSON.parse(/<script type="application\/json" id="lv-data">(.*?)<\/script>/.exec(html)[1]);
  assert.deepEqual([data.runId, data.task, data.live, data.offset], [c.id, 'docker-gate', true, Buffer.byteLength(START + '\x1b[31mred\x1b[39m <tag>\n')]);
  assert.match(liveCard(c.ctx), /<b>docker-test<\/b> on <code>fix\/x<\/code> for questkeep-sync[\s\S]*href="\/runs\/[^"]+\/live">watch/);
  assert.equal(livePage(c.ctx, 'nope', new URLSearchParams()), null);
  c.done();
});

test('a finished run shows how it ended and links to its results, with no stream', () => {
  const c = cache({ live: false, text: START + RESULTS });
  writeFileSync(join(c.dir, 'runs', 'runs', c.id, 'run.json'), JSON.stringify({ tasks: [{ id: 'docker-gate', status: 'FAIL' }] }));
  const html = livePage(c.ctx, c.id, new URLSearchParams());
  assert.match(html, /Finished: <b>failed<\/b>/);
  assert.match(html, /"live":false/);
  assert.equal(liveCard(c.ctx), '');
  c.done();
});

// A container run says how long each test waited for CPU after its seconds, and ends its set with the container's own
// machine line (tests/cgroup.mjs). Neither may change what HQ reads: the stall is not part of the seconds, and the
// machine line is not a test.
test("a test's stalled seconds keep its seconds, and the machine line is not taken for a test", () => {
  const text = START + ['=== smoke-prep (25s), 9s stalled', 'errors: []', 'ALL PASS',
    '=== smoke-sync (28s)', 'errors: []', 'ALL PASS',
    '=== smoke-tabs (41s), 30s stalled hit its time limit', '  3: the second tab opens',
    '=== machine {"where":"container","cpus":8,"cpuStalledS":39}'].join('\n') + '\n';
  const p = parseProgress(text, { expected: expectedTests(text, 'docker-gate', SETS), live: false });
  const by = Object.fromEntries(p.tests.map(t => [t.name, t]));
  assert.deepEqual([by['smoke-prep'].state, by['smoke-prep'].seconds], ['passed', 25]);
  assert.deepEqual([by['smoke-tabs'].timeLimit, by['smoke-tabs'].seconds], [true, 41]);
  assert.equal(by.machine, undefined, 'the machine line is not a test');
});

// With more than one lane the set ends with a line saying which lane ran each test and when it started, so a flake can
// be matched with what ran beside it. It is not a test.
test('the lanes line is not taken for a test', () => {
  const text = START + ['=== smoke-prep (25s)', 'ALL PASS', '=== smoke-sync (28s)', 'ALL PASS', '=== smoke-tabs (41s)', 'ALL PASS',
    '=== lanes {"smoke-prep":[1,0],"smoke-sync":[2,0],"smoke-tabs":[1,25]}'].join('\n') + '\n';
  const p = parseProgress(text, { expected: expectedTests(text, 'docker-gate', SETS), live: false });
  assert.equal(p.tests.find(t => t.name === 'lanes'), undefined);
  assert.equal(p.tests.find(t => t.name === 'smoke-tabs').state, 'passed');
});

// After a red container gate its failing tests run once more in the same container (the Makefile's _rerun), and the log
// goes on: "=== rerun once: <tests>" or "=== no rerun: <why>", then the rerun's own markers and its own "Script exited".
// The gate's tests and its result are read from before that line, so the rerun's pass never shows the gate's red test as
// passed, its line is never read as a test, and a red gate never reads as finished green (Mags's review, 11 October).
test("a red gate's rerun leaves the gate's own results as they were", () => {
  const rerun = ['make: *** [Makefile:398: _test] Error 1', '=== rerun once: smoke-sync', 'i  emulators: Starting emulators: auth, firestore, storage',
    'i  Running script: [ -n "smoke-sync" ] ... for t in smoke-sync; do st=$(cat x); done', '=== smoke-sync (2s)', 'ok   signs in', 'ALL PASS',
    '=== machine {"where":"container","cpus":8}', '✔  Script exited successfully (code 0)'].join('\n') + '\n';
  const text = START + RESULTS + rerun;
  const p = parseProgress(text, { expected: expectedTests(text, 'docker-gate', SETS), live: false });
  const by = Object.fromEntries(p.tests.map(t => [t.name, t]));
  assert.equal(by['smoke-sync'].state, 'failed', "the gate's red, not the rerun's pass");
  assert.equal(by.rerun, undefined, 'the rerun line is not a test');
  assert.equal(p.finished, 'failed');
  assert.deepEqual(p.tests.map(t => t.name), ['unit', 'rules', 'smoke-prep', 'smoke-sync', 'smoke-tabs']);
  const skipped = parseProgress(START + RESULTS + '=== no rerun: 6 browser tests failed, more than 5: something shared broke\n', { expected: expectedTests(text, 'docker-gate', SETS), live: false });
  assert.equal(skipped.tests.find(t => t.name === 'no'), undefined, 'a skipped rerun is not a test either');
});
