// The recorded test runs, read into one shape whatever recorded them. Laptop runs come from devpipe's folder, the one
// every checkout's .devpipe links to (tests/history.mjs reads the same files). CI runs come from ~/.cache/questkeep/ci,
// where make ci-history downloads them.
//
// A run: { id, source: 'laptop' | 'ci', when, info: { kind, who, where, branch, commit, dirty, lanes }, ok,
//          tasks: [{ id, name, status, seconds, log, cases: [{ name, status, seconds, log? }] }], report }
// A failed case's log is the path of its own log in the run's folder (caseLog), when the run names one.
// CI runs also carry event, run and attempt in info, and parts: the artifact folders they were read from.
import { readdirSync, readFileSync, existsSync, copyFileSync, cpSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const json = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const dirs = p => { try { return readdirSync(p).filter(d => statSync(join(p, d)).isDirectory()).sort(); } catch { return []; } };

// The first part of a log, which is where tests/run-info.mjs prints its line.
function head(path, bytes = 65536) {
  try {
    const fd = openSync(path, 'r'), buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0); closeSync(fd);
    return buf.subarray(0, n).toString('utf8');
  } catch { return ''; }
}

// The '=== run {json}' line from tests/run-info.mjs, or null for older runs and logs without one.
import { runInfoLine } from './run-line.mjs'; // the line tests/run-info.mjs prints, read back
export { runInfoLine };

// devpipe's run.json keeps the JUnit results under metrics.data in 0.2.0 and straight under metrics before that
const casesOf = t => (((t.metrics && (t.metrics.data || t.metrics)) || {}).testcases || []);

// A failed browser test's log: its JUnit message names it as logs/<test>.log, relative to the run's folder, which the run
// line names as out. Answers the path, or null for an older message (see /tmp/qk-<test>.log), a run without out, or a
// name that is not a plain file name. HQ still opens it only from inside the cache (safePath).
export function caseLog(message, out) {
  const m = /(?:^|[\s;])logs\/([\w.-]+\.log)$/.exec(String(message || '').trim());
  if (!m || !out || typeof out !== 'string' || m[1].startsWith('.')) return null;
  return join(out, 'logs', m[1]);
}

// The rerun of a red container gate's failing tests (the Makefile's _rerun) writes rerun.xml in the run's folder and its
// tests' logs in rerun/logs there. devpipe reads only gate.xml, so the laptop's run gains it here as a task named rerun,
// as CI's run does from its artifact folder. It never makes the run pass: the gate's own task stays red.
const readText = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
function rerunTask(out, text) {
  const xml = typeof out === 'string' ? text(join(out, 'rerun.xml')) : null;
  if (!xml) return null;
  const cases = parseJunit(xml).map(c => (c.status === 'fail' && /^[\w-][\w.-]*$/.test(c.name) ? { ...c, log: join(out, 'rerun', 'logs', `${c.name}.log`) } : c));
  return { id: 'rerun', name: 'Rerun of the failing tests', status: cases.some(c => c.status === 'fail') ? 'fail' : 'pass',
    seconds: Math.round(cases.reduce((n, c) => n + c.seconds, 0) * 10) / 10, log: null, cases };
}

// One devpipe run.json into the shared shape. logText reads a task's log and text any other file; passed in so tests
// need no files.
export function fromDevpipe(run, logText = p => head(p), text = readText) {
  let info = null;
  const tasks = (run.tasks || []).filter(t => !t.skipped).map(t => {
    const line = t.logPath ? runInfoLine(logText(t.logPath)) : null;
    if (line) info = line; // the last task's line names the run, so make test (unit, rules, then the gate) reads as the gate
    const out = line && line.out;
    return {
      id: t.id, name: t.name || t.id, status: t.status === 'PASS' ? 'pass' : 'fail',
      seconds: Math.round((t.durationMs || 0) / 100) / 10, log: t.logPath || null,
      cases: casesOf(t).map(c => {
        const status = c.status === 'passed' ? 'pass' : c.status === 'skipped' ? 'skip' : 'fail';
        const log = status === 'fail' ? caseLog(c.message, out) : null;
        return { name: c.name, status, seconds: +c.time || 0, ...(log ? { log } : {}) };
      }),
    };
  });
  const ok = tasks.length > 0 && tasks.every(t => t.status === 'pass');
  const rerun = info && rerunTask(info.out, text);
  return { id: run.runId, source: 'laptop', when: run.timestamp, info: info || {}, ok, tasks: rerun ? [...tasks, rerun] : tasks, command: run.command || '' };
}

export function readLaptopRuns(runsRoot) {
  const dir = join(runsRoot, 'runs');
  return dirs(dir).map(id => {
    const run = json(join(dir, id, 'run.json'));
    if (!run) return null;
    const r = fromDevpipe(run);
    if (existsSync(join(dir, id, 'report.html'))) r.report = `runs/runs/${id}/report.html`;
    return r;
  }).filter(Boolean);
}

// JUnit XML as written by node's reporter or by the Makefile's browser lanes: each <testcase> with its name, time and
// whether it holds a <failure> or <error>. Attributes are matched whole, since node leaves '>' unescaped inside them
// (a test named "a round > 25 minutes"); the same reading as testcases() in tests/junit-summary.mjs on ci/reliability.
export function parseJunit(xml) {
  const out = [];
  for (const m of xml.matchAll(/<testcase((?:\s+[\w:.-]+="[^"]*")*)\s*(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attr = k => { const a = new RegExp(`\\b${k}="([^"]*)"`).exec(m[1]); return a ? a[1] : ''; };
    const body = m[3] || '';
    const status = /<(failure|error)\b/.test(body) ? 'fail' : /<skipped\b/.test(body) ? 'skip' : 'pass';
    out.push({ name: unescapeXml(attr('name')), status, seconds: +attr('time') || 0 });
  }
  return out;
}
const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// CI runs as make ci-history keeps them: one folder per uploaded artifact, junit-<run>-<attempt>-<part>, where the part
// is gate (the gate in one job, before 1 October), gate_a and gate_b (its halves since), after, or load (the nightly
// two-core gate, kept by scripts/ci-keep.mjs). Each holds the
// run.json that tests/run-info.mjs --json writes on CI ({ kind, where: 'ci', who: 'ci', branch, commit, dirty: false,
// lanes, event, run, attempt, at, half }) and a JUnit file per task: unit.xml, rules.xml and gate.xml, or after.xml for
// the walkthroughs. Other folders are skipped.
// The nightly runs the long set again in the same job after a red; tests/ci-fetch.mjs keeps the first attempt under this part.
export const FIRST_ATTEMPT = 'after_first';
const CI_FOLDER = /^junit-(\d+)-(\d+)-((gate|after|load)(?:_[a-z0-9]+)?)$/;

// Of a run's artifact folders, the newest attempt of each part, the attempt compared as a number (10 is after 9). A
// re-run of one half uploads that half alone under the next attempt, so the other half's newest is still the earlier
// one. CI's filed job is getting the same rule in scripts/gate-halves.mjs; import it from there once that file exports it.
export function newestAttempts(names) {
  const best = new Map();
  for (const name of names) {
    const m = CI_FOLDER.exec(name);
    if (!m) continue;
    const key = `${m[1]} ${m[3]}`, was = best.get(key);
    if (!was || +m[2] > was.attempt) best.set(key, { attempt: +m[2], name });
  }
  return [...best.values()].map(b => b.name).sort();
}

// Whether a failed test's log says its page was killed from outside, as a container that ran out of memory does: a crash
// the test did not cause, so it is neither a flake nor a break. The one marker seen in a real log (nightly 38298159812's
// smoke-wake) is the text Playwright prints; looser words such as Killed match ordinary output.
const CRASH = /Target crashed/;
function crashedIn(logs, name) {
  if (!/^[\w-]+$/.test(name)) return false; // a log is named for a browser test; a title with a path in it names none
  try { return CRASH.test(readFileSync(join(logs, `${name}.log`), 'utf8')); } catch { return false; }
}

// One artifact folder: its part, attempt, run.json and tasks, or null without a run.json.
function ciFolder(ciRoot, id) {
  const meta = json(join(ciRoot, id, 'run.json'));
  if (!meta) return null;
  const [, run, attempt, part, base] = CI_FOLDER.exec(id);
  const set = part === FIRST_ATTEMPT ? part : base; // the nightly's first attempt is a run of its own, not a part of the last one's
  let files = [];
  try { files = readdirSync(join(ciRoot, id)).filter(f => f.endsWith('.xml')).sort(); } catch { /* none */ }
  const tasks = files.map(f => {
    const cases = parseJunit(readFileSync(join(ciRoot, id, f), 'utf8')).map(c => (c.status === 'fail' && crashedIn(join(ciRoot, id, 'logs'), c.name) ? { ...c, crashed: true } : c));
    return { id: basename(f, '.xml'), name: basename(f, '.xml'), status: cases.some(c => c.status === 'fail') ? 'fail' : 'pass',
      seconds: Math.round(cases.reduce((s, c) => s + c.seconds, 0) * 10) / 10, log: null, cases };
  });
  return { id, run, attempt: +attempt, part, set, meta, tasks };
}

// A run as it stood after one attempt: every part at its newest attempt up to that one, read as a single run whose
// tasks join the parts' results (gate.xml from both halves is one gate task). parts keeps each part's own tasks, which
// is what the estimate for one half's job plans from.
function ciSnapshot(set, attempt, folders) {
  const chosen = newestAttempts(folders.filter(f => f.attempt <= attempt).map(f => f.id)).map(id => folders.find(f => f.id === id))
    .sort((a, b) => a.part.localeCompare(b.part));
  const tasks = new Map();
  for (const f of chosen) for (const t of f.tasks) {
    const into = tasks.get(t.id) || { id: t.id, name: t.name, status: 'pass', seconds: 0, log: null, cases: [] };
    into.cases = into.cases.concat(t.cases);
    into.seconds = Math.round((into.seconds + t.seconds) * 10) / 10;
    if (t.status === 'fail') into.status = 'fail';
    tasks.set(t.id, into);
  }
  const all = [...tasks.values()].sort((a, b) => a.id.localeCompare(b.id));
  const meta = chosen.find(f => f.attempt === attempt).meta;
  const info = { kind: meta.kind, who: meta.who || 'ci', where: 'ci', branch: meta.branch, commit: String(meta.commit || '').slice(0, 7),
    dirty: false, lanes: meta.lanes, event: meta.event, run: meta.run, attempt };
  const when = chosen.map(f => f.meta.at).filter(Boolean).sort().pop() || null;
  return { id: `junit-${folders[0].run}-${attempt}-${set}`, source: 'ci', when, info, ok: all.length > 0 && all.every(t => t.status === 'pass') && all.some(t => t.cases.length), tasks: all,
    parts: chosen.map(f => ({ id: f.id, part: f.part, attempt: f.attempt, half: f.meta.half || null, tasks: f.tasks })) };
}

// Keeps the first attempt of a nightly that ran the long set twice: the long-set artifact's test-results-first folder
// (after.xml and logs) copied to the after_first folder, with the run.json of the last attempt's folder beside it. It
// keeps nothing when the night passed first time, and never overwrites a folder already kept.
// Answers { kept: folder } or { skipped: why }.
export function keepFirstAttempt(longSetDir, lastDir, into) {
  const from = join(longSetDir, 'test-results-first');
  if (!existsSync(join(from, 'after.xml'))) return { skipped: `no first attempt in ${longSetDir}` };
  if (!existsSync(join(lastDir, 'run.json'))) return { skipped: `no run.json in ${lastDir} to read the run by` };
  if (existsSync(into)) return { skipped: `${into} is already kept` };
  cpSync(from, into, { recursive: true });
  copyFileSync(join(lastDir, 'run.json'), join(into, 'run.json'));
  return { kept: into };
}

// Every CI run, once for each attempt that uploaded anything. A re-run of a job is the same commit under the next
// attempt, so a test that fails and then passes across attempts shows as a flake.
export function readCiRuns(ciRoot) {
  const groups = new Map();
  for (const f of dirs(ciRoot).filter(id => CI_FOLDER.test(id)).map(id => ciFolder(ciRoot, id)).filter(Boolean)) {
    const key = `${f.run} ${f.set}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const runs = [];
  for (const folders of groups.values()) {
    for (const attempt of [...new Set(folders.map(f => f.attempt))].sort((a, b) => a - b)) runs.push(ciSnapshot(folders[0].set, attempt, folders));
  }
  return runs.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

// Newest first.
export function allRuns(cacheRoot) {
  const runs = [...readLaptopRuns(join(cacheRoot, 'runs')), ...readCiRuns(join(cacheRoot, 'ci'))];
  return runs.sort((a, b) => String(b.when).localeCompare(String(a.when)));
}

// Tests that both passed and failed on one clean commit in one kind of run: the code was the same, so the test is
// flaky. Keyed as tests/history.mjs keys it, by commit and kind, with CI's kinds kept apart from the laptop's (ci-gate
// against gate), so HQ and make history name the same flakes. Answers [{ commit, kind, task, test }], each once; task
// is the task the test ran in, which says which file it belongs to. byRerun: true marks one whose only pass came from a
// red container gate's rerun (the task named rerun), which finds flakes that went unseen before it.
// A run on a probe/ or exp/ branch is made on purpose, to watch a red, so its results are never real flakes or problems.
export const planted = r => /^(probe|exp)\//.test((r && r.info && r.info.branch) || '');

export function flakes(runs) {
  const seen = new Map();
  for (const r of runs) {
    if (!r.info.commit || r.info.dirty || planted(r)) continue;
    const ci = r.source === 'ci' ? 'ci-' : '', kind = `${ci}${r.info.kind || '?'}`;
    for (const t of r.tasks) for (const c of t.cases) {
      const k = `${r.info.commit}\t${kind}\t${c.name}`;
      if (!seen.has(k)) seen.set(k, { commit: r.info.commit, kind, task: `${ci}${t.id}`, test: c.name, statuses: new Set(), passedOutsideRerun: false });
      const x = seen.get(k);
      if (c.crashed) continue; // killed from outside (memory), so it says nothing about the test
      x.statuses.add(c.status);
      if (c.status === 'pass' && t.id !== 'rerun') x.passedOutsideRerun = true;
    }
  }
  return [...seen.values()].filter(x => x.statuses.has('pass') && x.statuses.has('fail'))
    .map(({ statuses, passedOutsideRerun, ...x }) => (passedOutsideRerun ? x : { ...x, byRerun: true }));
}

// Which test file a result belongs to. Browser results are named for their file; node results are named by their test
// titles, which the catalogue read from each file; a rules result goes to the rules file with its title, and one no file
// names (a title built at run time) to rules.test.js.
export function fileForCase(taskId, caseName, files) {
  const kind = taskId.replace(/^(docker|ci)-/, '');
  if (kind === 'rules') return files.find(f => f.set === 'rules' && f.titles.includes(caseName)) || files.find(f => f.path === 'tests/rules.test.js') || files.find(f => f.set === 'rules') || null;
  if (kind === 'unit') return files.find(f => f.set === 'unit' && f.titles.includes(caseName)) || null;
  return files.find(f => f.name === caseName && (f.set === 'gate' || f.set === 'after' || f.set === 'helper')) || null;
}

// For each test file, what happened to it in each run, newest first: { run, where, source, when, commit, dirty, status,
// seconds, cases }. A node test file's status is failed when any of its tests failed, and its seconds are theirs added up.
export function resultsByFile(runs, files) {
  const by = new Map(files.map(f => [f.path, []]));
  for (const r of runs) for (const t of r.tasks) {
    if (t.id === 'rerun') continue; // the Testing page keys a file's results by run: a rerun would replace the gate's
    const seen = new Map();
    for (const c of t.cases) {
      const f = fileForCase(t.id, c.name, files);
      if (!f) continue;
      if (!seen.has(f.path)) seen.set(f.path, { run: r.id, task: t.id, source: r.source, where: r.info.where || r.source, when: r.when, commit: r.info.commit, dirty: !!r.info.dirty, status: 'pass', seconds: 0, cases: [] });
      const o = seen.get(f.path);
      o.cases.push(c);
      o.seconds += c.seconds;
      if (c.status === 'fail') o.status = 'fail';
    }
    for (const [p, o] of seen) by.get(p).push(o);
  }
  return by;
}

// What a run's kind means, in plain words, for the Runs tab (tests/run-info.mjs writes the kind). A kind added later is
// shown as it is, and a run from before kinds were written says Unknown.
// gate and after are run on the laptop and on CI alike, so their names leave the place to the Where column.
const KINDS = { unit: 'Unit tests', rules: 'Rules tests', gate: 'Gate', 'docker-gate': 'Gate (container)', deploy: 'Deploy gate',
  after: 'Long set', 'docker-after': 'Long set (container)', 'deploy-after': 'Deploy long set', soak: 'Soak' };
export const kindLabel = kind => (!kind || kind === '?' ? 'Unknown' : KINDS[kind] || kind);

// When something happened, as a person says it: just now, minutes, hours, yesterday, days, then the date.
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (isNaN(t)) return '?';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86400) return 'yesterday';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(t).toISOString().slice(0, 10);
}
