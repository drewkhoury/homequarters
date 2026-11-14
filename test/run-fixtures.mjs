// A recorded-runs store and a repo to read it against, built in a temp folder: the awkward shapes the real stores hold,
// so a test of the run store, or of what is worked out from it, reads what devpipe, the Makefile and CI really write.
//
// The store (cache/):
//   runs/runs/<id>/   laptop runs as devpipe writes them: run.json, each task's log opening with the run line, and
//                     sometimes report.html, the Makefile's rerun.xml and a failed test's logs/<test>.log
//   ci/<folder>/      CI's artifact folders, junit-<run>-<attempt>-<part>: run.json and one JUnit file per task
// The repo (repo/): a Makefile naming the gate and after sets, and test files whose names and titles the runs' results
// belong to.
//
// buildStore() answers { root, cache, repo, laptop(id, spec), ci(name, meta, xml), done() }; laptop() and ci() add one
// more run, as a run that ends while HQ is running does.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const COMMIT = 'c0ffee1', OTHER = 'feed2b3';
const line = info => `=== run ${JSON.stringify({ kind: 'gate', who: 'drew', where: 'laptop', branch: 'main', commit: COMMIT, dirty: false, lanes: 2, ...info })}\n`;
const passed = (name, time = 0.01) => ({ name, status: 'passed', time });
const failed = (name, message = '', time = 1) => ({ name, status: 'failed', time, message });
const suite = cases => `<testsuite name="s">${cases.map(([name, ok, time = 1, body = '']) =>
  `<testcase name="${name}" classname="x" time="${time}">${ok === 'skip' ? '<skipped/>' : ok ? '' : '<failure message="see its log"/>'}${body}</testcase>`).join('')}</testsuite>`;

export function buildStore() {
  const root = mkdtempSync(join(tmpdir(), 'hq-store-'));
  const cache = join(root, 'cache'), repo = join(root, 'repo'), runsDir = join(cache, 'runs', 'runs'), ciDir = join(cache, 'ci');
  mkdirSync(runsDir, { recursive: true }); mkdirSync(ciDir, { recursive: true });

  // a laptop run: spec.tasks is [{ id, status, cases, info, skipped, flat }], flat for the run.json devpipe wrote
  // before 0.2.0 (testcases straight under metrics)
  const laptop = (id, { at, tasks = [], report = false, rerun = null, logs = {}, runJson = true, corrupt = false }) => {
    const dir = join(runsDir, id);
    mkdirSync(join(dir, 'logs'), { recursive: true });
    for (const [name, text] of Object.entries(logs)) writeFileSync(join(dir, 'logs', name), text);
    if (rerun) { writeFileSync(join(dir, 'rerun.xml'), suite(rerun)); mkdirSync(join(dir, 'rerun', 'logs'), { recursive: true }); }
    if (report) writeFileSync(join(dir, 'report.html'), '<html></html>');
    const run = { runId: id, timestamp: at, command: 'devpipe', tasks: tasks.map(t => {
      const log = join(dir, 'logs', `${t.id}.log`);
      writeFileSync(log, `${t.info === null ? '' : line({ out: dir, ...t.info })}output of ${t.id}\n`);
      const testcases = t.cases || [];
      return { id: t.id, name: t.id, status: t.status || 'PASS', durationMs: 1500, logPath: log, ...(t.skipped ? { skipped: true } : {}),
        metrics: t.flat ? { testcases } : { data: { testcases } } };
    }) };
    if (corrupt) writeFileSync(join(dir, 'run.json'), '{"runId": "half writ');
    else if (runJson) writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
    return dir;
  };
  const ci = (name, meta, xml = {}, { logs = {}, runJson = true } = {}) => {
    const dir = join(ciDir, name);
    mkdirSync(dir, { recursive: true });
    for (const [f, body] of Object.entries(xml)) writeFileSync(join(dir, f), body);
    if (Object.keys(logs).length) { mkdirSync(join(dir, 'logs'), { recursive: true }); for (const [f, t] of Object.entries(logs)) writeFileSync(join(dir, 'logs', f), t); }
    if (runJson) writeFileSync(join(dir, 'run.json'), JSON.stringify({ kind: 'gate', where: 'ci', who: 'ci', branch: 'main', commit: COMMIT, dirty: false, lanes: 1, event: 'push', ...meta }));
    return dir;
  };

  // ---- the repo ----
  mkdirSync(join(repo, 'tests', 'unit'), { recursive: true });
  writeFileSync(join(repo, 'Makefile'), 'GATE := smoke-sync smoke-wake load-check\nAFTER := walk-world\n');
  for (const n of ['smoke-sync', 'smoke-wake', 'load-check', 'walk-world', 'helper-page']) writeFileSync(join(repo, 'tests', `${n}.js`), `// Proves: ${n}\n`);
  writeFileSync(join(repo, 'tests', 'rules.test.js'), "test('owner can write their profile', () => {});\ntest('a stranger cannot read it', () => {});\n");
  writeFileSync(join(repo, 'tests', 'unit', 'clock.test.mjs'), "test('a round over 25 minutes is refused', () => {});\ntest('midnight rolls the day', () => {});\n");
  writeFileSync(join(repo, 'tests', 'unit', 'merge.test.mjs'), "test('the newer copy wins', () => {});\n");

  // ---- laptop runs ----
  const unit = (ok = true) => ({ id: 'unit', status: ok ? 'PASS' : 'FAIL', cases: [passed('a round over 25 minutes is refused'), ok ? passed('midnight rolls the day') : failed('midnight rolls the day'), passed('the newer copy wins')], info: { kind: 'test' } });
  const rules = { id: 'rules', cases: [passed('owner can write their profile', 0.2), passed('a stranger cannot read it', 0.1)], info: { kind: 'test' } };
  const gate = (ok = true, extra = {}) => ({ id: 'gate', status: ok ? 'PASS' : 'FAIL', cases: [ok ? passed('smoke-sync', 20) : failed('smoke-sync', 'Error: timed out. See logs/smoke-sync.log', 31), passed('smoke-wake', 12), passed('load-check', 5)], info: { kind: 'gate', ...extra } });
  // make test: unit, rules and the gate, all green
  laptop('2026-11-01T10-00-00Z_000001', { at: '2026-11-01T10:01:00Z', tasks: [unit(), rules, gate()], report: true });
  // the same commit's gate red on smoke-sync, which names its own log: smoke-sync is a flake on this commit
  laptop('2026-11-01T11-00-00Z_000002', { at: '2026-11-01T11:01:00Z', tasks: [gate(false)], logs: { 'smoke-sync.log': 'timed out' } });
  // a container gate red on smoke-wake, whose rerun alone passed it
  laptop('2026-11-01T12-00-00Z_000003', { at: '2026-11-01T12:01:00Z', tasks: [{ id: 'docker-gate', status: 'FAIL', cases: [passed('smoke-sync', 19), failed('smoke-wake'), passed('load-check')], info: { kind: 'gate', where: 'container' } }], rerun: [['smoke-wake', true, 11]] });
  // devpipe before 0.2.0: testcases straight under metrics, and a skipped task left out
  laptop('2026-10-20T09-00-00Z_000004', { at: '2026-10-20T09:01:00Z', tasks: [{ ...unit(), flat: true }, { id: 'rules', skipped: true, cases: [] }] });
  // uncommitted changes: never a flake, however it went
  laptop('2026-11-01T13-00-00Z_000005', { at: '2026-11-01T13:01:00Z', tasks: [unit(false)].map(t => ({ ...t, info: { kind: 'test', dirty: true } })) });
  // a probe/ branch red made on purpose
  laptop('2026-11-01T14-00-00Z_000006', { at: '2026-11-01T14:01:00Z', tasks: [gate(false, { branch: 'probe/red-once' })] });
  // another commit, unit red then green: a flake there
  laptop('2026-11-02T09-00-00Z_000007', { at: '2026-11-02T09:01:00Z', tasks: [{ ...unit(false), info: { kind: 'test', commit: OTHER } }] });
  laptop('2026-11-02T09-30-00Z_000008', { at: '2026-11-02T09:31:00Z', tasks: [{ ...unit(true), info: { kind: 'test', commit: OTHER } }] });
  // a log with no run line (an old run): no info at all
  laptop('2026-10-01T08-00-00Z_000009', { at: '2026-10-01T08:01:00Z', tasks: [{ ...unit(), info: null }] });
  // a soak on a feature branch
  laptop('2026-11-03T20-00-00Z_000010', { at: '2026-11-03T20:01:00Z', tasks: [{ ...gate(), info: { kind: 'soak', branch: 'feat/x', who: 'agent:Ivy' } }] });
  // still running: devpipe writes run.json when the run ends
  laptop('2026-11-04T09-00-00Z_000011', { at: '2026-11-04T09:01:00Z', tasks: [unit()], runJson: false });
  // a run.json cut off half-written
  laptop('2026-11-04T09-10-00Z_000012', { at: '2026-11-04T09:11:00Z', tasks: [unit()], corrupt: true });

  // ---- CI folders ----
  const unitXml = suite([['a round over 25 minutes is refused', true, 0.01], ['midnight rolls the day', true, 0.01]]);
  const rulesXml = suite([['owner can write their profile', true, 0.1]]);
  // run 41: the gate red on smoke-sync at attempt 1, green at attempt 2
  ci('junit-41-1-gate', { run: '41', attempt: 1, at: '2026-11-01T18:00:00Z' }, { 'unit.xml': unitXml, 'rules.xml': rulesXml, 'gate.xml': suite([['smoke-sync', false, 30], ['smoke-wake', true, 10]]) });
  ci('junit-41-2-gate', { run: '41', attempt: 2, at: '2026-11-01T18:10:00Z' }, { 'unit.xml': unitXml, 'rules.xml': rulesXml, 'gate.xml': suite([['smoke-sync', true, 28], ['smoke-wake', true, 10]]) });
  ci('junit-41-1-after', { run: '41', kind: 'after', attempt: 1, at: '2026-11-01T18:05:00Z' }, { 'after.xml': suite([['walk-world', true, 50]]) });
  // run 42: the gate in halves, half a re-run alone at attempt 2
  ci('junit-42-1-gate_a', { run: '42', attempt: 1, half: 'a', at: '2026-11-02T18:01:00Z' }, { 'rules.xml': rulesXml, 'gate.xml': suite([['smoke-sync', false, 30]]) });
  ci('junit-42-1-gate_b', { run: '42', attempt: 1, half: 'b', at: '2026-11-02T18:02:00Z' }, { 'unit.xml': unitXml, 'gate.xml': suite([['load-check', true, 5]]) });
  ci('junit-42-2-gate_a', { run: '42', attempt: 2, half: 'a', at: '2026-11-02T18:12:00Z' }, { 'rules.xml': rulesXml, 'gate.xml': suite([['smoke-sync', true, 29]]) });
  // run 50: a nightly whose long set failed first time and passed in the same job
  ci('junit-50-1-after_first', { run: '50', kind: 'after', attempt: 1, event: 'schedule', at: '2026-11-03T20:01:00Z' }, { 'after.xml': suite([['walk-world', false, 60]]) });
  ci('junit-50-1-after', { run: '50', kind: 'after', attempt: 1, event: 'schedule', at: '2026-11-03T20:31:00Z' }, { 'after.xml': suite([['walk-world', true, 55]]) });
  // run 60: attempt 10 after 9, compared as numbers
  ci('junit-60-9-gate', { run: '60', attempt: 9, at: '2026-11-04T18:09:00Z' }, { 'gate.xml': suite([['load-check', false, 5]]) });
  ci('junit-60-10-gate', { run: '60', attempt: 10, at: '2026-11-04T18:10:00Z' }, { 'gate.xml': suite([['load-check', true, 5]]) });
  // run 61: a page killed from outside (out of memory): neither a flake nor a break
  ci('junit-61-1-gate', { run: '61', attempt: 1, commit: OTHER, at: '2026-11-05T18:00:00Z' }, { 'gate.xml': suite([['smoke-wake', false, 9]]) }, { logs: { 'smoke-wake.log': 'Error: Target crashed' } });
  ci('junit-61-2-gate', { run: '61', attempt: 2, commit: OTHER, at: '2026-11-05T18:10:00Z' }, { 'gate.xml': suite([['smoke-wake', true, 9]]) });
  // a two-core load run, and a skipped case
  ci('junit-62-1-load', { run: '62', kind: 'load', attempt: 1, event: 'schedule', at: '2026-11-05T21:00:00Z' }, { 'gate.xml': suite([['smoke-sync', true, 40], ['load-check', 'skip', 0]]) });
  // a download that has not brought its run.json yet, and a folder that is no artifact
  ci('junit-63-1-gate', {}, { 'gate.xml': suite([['smoke-sync', true, 20]]) }, { runJson: false });
  mkdirSync(join(ciDir, 'stray')); writeFileSync(join(ciDir, 'stray', 'run.json'), '{}');

  return { root, cache, repo, laptop, ci, done: () => rmSync(root, { recursive: true, force: true }) };
}

// Everything the pages work out from the store, as plain JSON with the temp folder written <root>: the runs newest
// first, the flakes, each test file's results, and the Problems page's results by test. The equivalence test holds the
// run store's answers to the ones 0.3.0 gave (test/fixtures/runs-store/expected.json).
import { allRuns, flakes, resultsByFile } from '../lib/runs.mjs';
import { catalogue } from '../lib/catalogue.mjs';
import { testResults } from '../lib/problem-derive.mjs';
import { testKeyer } from '../lib/problem-observations.mjs';
export function answersOf({ root, cache, repo }) {
  const runs = allRuns(cache), files = catalogue(repo);
  const out = {
    runs,
    flakes: flakes(runs),
    byFile: Object.fromEntries(resultsByFile(runs, files)),
    results: testResults(runs, { keyOf: testKeyer(files) }),
  };
  return JSON.parse(JSON.stringify(out).split(root).join('<root>'));
}
