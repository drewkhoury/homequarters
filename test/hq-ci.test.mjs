// Proves: CI as it happens (lib/ci-live.mjs, pages/ci.mjs): a job's steps drawn from GitHub's answer, the estimate of
// which test the test step is on, and the part and page built from a gh that answers from fixtures, in temp folders
// only.
// Why: the live CI view is what a person watches instead of GitHub, and it must say the same thing GitHub does
// without reaching GitHub in a test.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { testStepName, timeOf, span, stepTimeline, testPlan, estimateAt, historyFrom, setOf, describeRun, forgetKept } from '../lib/ci-live.mjs';
import { ciNowPart, ciRunPage } from '../pages/ci.mjs';

const NOW = Date.parse('2026-09-29T06:45:00Z');
const ZERO = '0001-01-01T00:00:00Z'; // how GitHub writes a time it does not have yet

// The step of test.yml that runs the tests, as the workflow has it.
const WORKFLOW = `jobs:
  test:
    steps:
      - run: make install
      - name: Run the tests
        run: |
          case "$TARGET" in test|test-after) ;; esac
          make "$TARGET" LANES=1 HQ_JUNIT=test-results
      - name: Keep the results
        run: node tests/run-info.mjs
`;

// A job halfway through, as gh run view --json jobs answers while it runs.
const RUNNING_JOB = { name: 'test', status: 'in_progress', conclusion: '', url: 'https://github.com/o/r/actions/runs/1/job/2', steps: [
  { name: 'Set up job', number: 1, status: 'completed', conclusion: 'success', startedAt: '2026-09-29T06:38:40Z', completedAt: '2026-09-29T06:38:41Z' },
  { name: 'Run make install', number: 6, status: 'completed', conclusion: 'success', startedAt: '2026-09-29T06:38:48Z', completedAt: '2026-09-29T06:38:57Z' },
  { name: 'Run the tests', number: 8, status: 'in_progress', conclusion: '', startedAt: '2026-09-29T06:43:00Z', completedAt: ZERO },
  { name: 'Keep the results', number: 11, status: 'queued', conclusion: '', startedAt: ZERO, completedAt: ZERO },
  { name: 'Post Run actions/checkout@v5', number: 24, status: 'queued', conclusion: '', startedAt: ZERO, completedAt: ZERO },
] };
const RUN = { databaseId: 36532132847, displayTitle: 'fix(sync): both devices keep their changes', workflowName: 'Tests', status: 'in_progress', conclusion: '',
  headBranch: 'fix/sync-merge', headSha: 'c6fa3879e0675e75', event: 'pull_request', createdAt: '2026-09-29T06:38:35Z', startedAt: '2026-09-29T06:38:35Z',
  updatedAt: '2026-09-29T06:44:00Z', url: 'https://github.com/o/r/actions/runs/36532132847', attempt: 1, jobs: [RUNNING_JOB] };

// Two past gate runs' results: the unit and rules tests, then the browser tests in the order they ran.
const PAST = [
  { cases: { unit: [{ name: 'u', seconds: 30 }], rules: [{ name: 'r', seconds: 10 }], gate: [{ name: 'load-check', seconds: 20 }, { name: 'smoke-sync', seconds: 30 }, { name: 'smoke-tour', seconds: 10 }] }, stepSeconds: 110 },
  { cases: { unit: [{ name: 'u', seconds: 30 }], rules: [{ name: 'r', seconds: 10 }], gate: [{ name: 'load-check', seconds: 20 }, { name: 'smoke-sync', seconds: 30 }, { name: 'smoke-tour', seconds: 10 }] }, stepSeconds: 110 },
];

beforeEach(() => forgetKept());

test('the test step is found by what it runs, whatever it is called', () => {
  assert.equal(testStepName(WORKFLOW), 'Run the tests');
  assert.equal(testStepName(WORKFLOW.replace('Run the tests', 'Gate')), 'Gate');
  assert.equal(testStepName('jobs: {}'), 'Run the tests', 'the usual name when the workflow cannot be read');
});

test('times GitHub does not have yet read as none, and spans read in words', () => {
  assert.equal(timeOf(ZERO), null);
  assert.equal(timeOf('2026-09-29T06:38:40Z'), Date.parse('2026-09-29T06:38:40Z'));
  assert.deepEqual([45, 190, 3840].map(span), ['45 s', '3 min 10 s', '1 h 4 min']);
});

test('a running job shows its finished steps with their times, the running one with how long so far, the rest waiting', () => {
  const steps = stepTimeline(RUNNING_JOB, NOW);
  assert.deepEqual(steps.map(s => [s.name, s.state, s.seconds]), [
    ['Set up job', 'done', 1], ['Run make install', 'done', 9], ['Run the tests', 'running', 120], ['Keep the results', 'queued', null]]);
  assert.ok(!steps.some(s => /^Post /.test(s.name)), 'GitHub\'s clean-up steps are left out while the job runs');
});

test('the plan is the unit tests, the rules tests, then each browser test, stretched to how long the step usually takes', () => {
  const p = testPlan(PAST);
  assert.deepEqual(p.items.map(i => [i.name, i.seconds]), [['unit tests', 30], ['rules tests', 10], ['load-check', 20], ['smoke-sync', 30], ['smoke-tour', 10]]);
  assert.equal(p.scale, 110 / 100);
  assert.equal(Math.round(p.expected), 110);
  assert.equal(testPlan([]), null, 'no history, no plan');
});

test('the estimate walks the plan to the time the step has run, and says when it runs long', () => {
  const p = testPlan(PAST);
  assert.deepEqual(['unit tests', 'rules tests', 'load-check', 'smoke-sync', 'smoke-tour'].map((n, i) => estimateAt(p, [0, 34, 45, 70, 105][i]).name), ['unit tests', 'rules tests', 'load-check', 'smoke-sync', 'smoke-tour']);
  const late = estimateAt(p, 150);
  assert.deepEqual([late.over, late.name, Math.round(late.into)], [true, 'smoke-tour', 40]);
  assert.equal(estimateAt(null, 10), null);
});

test('history is the newest gate runs make ci-history kept, with each set\'s cases by name', () => {
  const ci = [
    { when: '2026-09-28T10:00:00Z', info: { kind: 'gate', run: '11', attempt: 1 }, tasks: [{ id: 'gate', cases: [{ name: 'a' }] }] },
    { when: '2026-09-29T10:00:00Z', info: { kind: 'gate', run: '12', attempt: 1 }, tasks: [{ id: 'gate', cases: [{ name: 'b' }] }, { id: 'unit', cases: [] }] },
    { when: '2026-09-29T11:00:00Z', info: { kind: 'after', run: '13', attempt: 1 }, tasks: [{ id: 'after', cases: [] }] },
  ];
  const h = historyFrom(ci);
  assert.deepEqual(h.map(x => x.run), ['12', '11']);
  assert.deepEqual(Object.keys(h[0].cases), ['gate', 'unit']);
  assert.deepEqual([setOf('Tests'), setOf('Long set (after)')], ['gate', 'after']);
});

// Review 14, 2 October: each half of the gate runs its own test step, so the estimate for a half is planned from that
// half's past results, and a run re-run in part counts once, at its newest attempt.
test("a half's plan comes from that half's results, and a run counts once at its newest attempt", () => {
  const part = (id, half, gate, more = {}) => ({ id, part: `gate_${half}`, half, tasks: [{ id: 'gate', cases: gate.map(name => ({ name, seconds: 10 })) }, ...Object.entries(more).map(([k, n]) => ({ id: k, cases: [{ name: n, seconds: 5 }] }))] });
  const run = (run, attempt, when, parts) => ({ when, info: { kind: 'gate', run, attempt }, parts,
    tasks: [{ id: 'gate', cases: parts.flatMap(p => p.tasks[0].cases) }, ...parts.flatMap(p => p.tasks.slice(1))] });
  const ci = [
    run('20', 1, '2026-10-01T10:00:00Z', [part('junit-20-1-gate_a', 'a', ['smoke-sync'], { rules: 'r' }), part('junit-20-1-gate_b', 'b', ['load-check'], { unit: 'u' })]),
    run('20', 2, '2026-10-01T10:20:00Z', [part('junit-20-2-gate_a', 'a', ['smoke-sync', 'smoke-tour'], { rules: 'r' }), part('junit-20-1-gate_b', 'b', ['load-check'], { unit: 'u' })]),
  ];
  assert.deepEqual(historyFrom(ci).map(h => [h.run, h.attempt]), [['20', 2]]);
  const b = historyFrom(ci, { part: 'gate_b' });
  assert.deepEqual([Object.keys(b[0].cases), b[0].cases.gate.map(c => c.name)], [['gate', 'unit'], ['load-check']]);
  assert.deepEqual(testPlan(historyFrom(ci, { part: 'gate_a' })).items.map(i => i.name), ['rules tests', 'smoke-sync', 'smoke-tour']);
  assert.deepEqual(historyFrom(ci, { part: 'gate_c' }), [], 'no history for a part no run has');
});

test("each half's running test step asks for its own half's plan", async () => {
  const asked = [];
  const two = { ...RUN, jobs: [{ ...RUNNING_JOB, name: 'test (a)' }, { ...RUNNING_JOB, name: 'test (b)' }] };
  await describeRun(two, { now: NOW, step: 'Run the tests', plan: async (set, part) => { asked.push([set, part]); return testPlan(PAST); } });
  assert.deepEqual(asked, [['gate', 'gate_a'], ['gate', 'gate_b']]);
});

test('a run\'s running test step carries the estimate; with no history it says so rather than guess', async () => {
  const withPlan = await describeRun(RUN, { now: NOW, step: 'Run the tests', plan: async () => testPlan(PAST) });
  const e = withPlan.jobs[0].estimate;
  assert.deepEqual([e.known, e.name, e.set, e.elapsed], [true, 'smoke-tour', 'gate', 120]);
  const bare = await describeRun(RUN, { now: NOW, step: 'Run the tests' });
  assert.equal(bare.jobs[0].estimate.known, false);
});

// A gh that answers from the fixtures, and counts what it was asked.
function fakeGh(runs, byId) {
  const asked = [];
  const gh = async args => {
    asked.push(args.join(' '));
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify(runs);
    if (args[0] === 'run' && args[1] === 'view') return JSON.stringify(byId[args[2]] || null);
    throw new Error(`not expected: ${args.join(' ')}`);
  };
  return { gh, asked };
}
function tempRepoAndCache() {
  const dir = mkdtempSync(join(tmpdir(), 'hq-ci-'));
  mkdirSync(join(dir, 'repo', '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, 'repo', '.github', 'workflows', 'test.yml'), WORKFLOW);
  mkdirSync(join(dir, 'cache', 'ci'), { recursive: true });
  return { repo: join(dir, 'repo'), cache: join(dir, 'cache'), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('the part shows a running run\'s steps and says plainly that the test is not readable live', async () => {
  const t = tempRepoAndCache();
  const { gh, asked } = fakeGh([RUN], { [RUN.databaseId]: RUN });
  const p = await ciNowPart({ repo: t.repo, cache: t.cache, gh });
  assert.match(p.html, /data-ci-live="running"/);
  assert.match(p.html, /Run the tests<\/span>\s*<span class="ci-time">running /);
  assert.match(p.html, /No CI history here to estimate/);
  assert.match(p.mini, /<a href="\/ci\/36532132847">Tests<\/a> <code>fix\/sync-merge<\/code>/);
  // a second look within ten seconds asks GitHub nothing
  await ciNowPart({ repo: t.repo, cache: t.cache, gh });
  assert.equal(asked.length, 2);
  t.done();
});

test('with nothing running the part says so, with the last run and how it ended', async () => {
  const t = tempRepoAndCache();
  const finished = { ...RUN, status: 'completed', conclusion: 'failure', updatedAt: new Date(Date.now() - 60000).toISOString(), jobs: undefined };
  const { gh } = fakeGh([finished], {});
  const p = await ciNowPart({ repo: t.repo, cache: t.cache, gh });
  assert.match(p.mini, /Nothing running on CI\. Last: Tests failed/);
  assert.match(p.html, /Just finished/);
  t.done();
});

test('a finished run\'s page says how it ended and links to GitHub and to its results in HQ; a bad id is no page', async () => {
  const t = tempRepoAndCache();
  // the gate's two halves, as make ci-history keeps them
  for (const half of ['a', 'b']) {
    const dir = join(t.cache, 'ci', `junit-${RUN.databaseId}-1-gate_${half}`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ kind: 'gate', where: 'ci', who: 'ci', commit: 'c6fa387', run: String(RUN.databaseId), attempt: 1, half }));
    writeFileSync(join(dir, 'gate.xml'), `<testsuite name="browser"><testcase name="smoke-${half}" time="1"/></testsuite>`);
  }
  const finished = { ...RUN, status: 'completed', conclusion: 'success', jobs: [{ ...RUNNING_JOB, status: 'completed', conclusion: 'success', steps: RUNNING_JOB.steps.slice(0, 2) }] };
  const { gh } = fakeGh([], { [RUN.databaseId]: finished });
  const card = await ciRunPage({ repo: t.repo, cache: t.cache, gh }, String(RUN.databaseId), new URLSearchParams('part=1'));
  assert.match(card, /^<div class="ci-live" data-status="completed">/);
  assert.match(card, /Finished .* ago: <span class="ci-res" data-result="success">passed<\/span>/);
  assert.match(card, /href="\/runs\/junit-36532132847-1-gate">its test results in HQ/);
  assert.equal(card.match(/its test results in HQ/g).length, 1, 'one link for the run, not one per half');
  assert.match(card, /href="https:\/\/github\.com\/o\/r\/actions\/runs\/36532132847"/);
  assert.equal(await ciRunPage({ repo: t.repo, cache: t.cache, gh }, '../../etc'), null);
  t.done();
});

test('names and titles from GitHub cannot break out of the page', async () => {
  const t = tempRepoAndCache();
  const evil = { ...RUN, displayTitle: '<img src=x onerror=alert(1)>', headBranch: '"><script>', jobs: [RUNNING_JOB] };
  const { gh } = fakeGh([evil], { [RUN.databaseId]: evil });
  const p = await ciNowPart({ repo: t.repo, cache: t.cache, gh });
  assert.ok(!p.html.includes('<img src=x') && !p.html.includes('"><script>'));
  t.done();
});
