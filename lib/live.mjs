// A test run happening now on this laptop or in its container, read from the files it writes as it goes. The lock's
// run.json (~/.cache/questkeep/lock) says who holds the slot and since when; devpipe's run folder
// (~/.cache/questkeep/runs/runs/<id>/logs/<task>.log) holds the log from its first line, `=== run {json}`, and gets
// its own run.json only when the run ends. HQ only reads these; nothing here starts, stops or waits on a run.
//
// What a log says about each test, as the Makefile writes it:
//   === unit pass                 the unit tests, in a container gate
//   === rules (6s) pass           the rules tests ("=== rules" alone, then its tail, when they failed)
//   === smoke-prep (25s)          a browser test finished; the next few lines are its tail: three when it passed (often
//                                 ending ALL PASS), up to twenty-five and a FAIL when it failed; "hit its time limit"
//                                 after the seconds when it ran out of time
// The browser lanes print their results together when every lane has finished, so while they run the log says only
// that they are running. unit and rules runs on the laptop are node's own test output: a ✔ or ✖ line per test.
import { readdirSync, readFileSync, existsSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';
import { runInfoLine } from './runs.mjs';
import { readNew } from './conversations.mjs';

export const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g; // eslint-disable-line no-control-regex
export const stripAnsi = s => String(s).replace(ANSI, '');
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Terminal colours as spans with a class per colour (lv-c31, lv-c90…, lv-b for bold), everything else escaped. Codes it
// does not know are dropped; a reset (0, 39, 22) closes what is open.
export function ansiToHtml(text) {
  let out = '', open = 0;
  const close = () => { out += '</span>'.repeat(open); open = 0; };
  let at = 0;
  for (const m of String(text).matchAll(/\x1b\[([0-9;]*)m/g)) { // eslint-disable-line no-control-regex
    out += escHtml(String(text).slice(at, m.index).replace(ANSI, ''));
    at = m.index + m[0].length;
    for (const code of (m[1] || '0').split(';').map(Number)) {
      if (code === 0 || code === 39 || code === 22) close();
      else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) { out += `<span class="lv-c${code}">`; open++; }
      else if (code === 1) { out += '<span class="lv-b">'; open++; }
    }
  }
  out += escHtml(String(text).slice(at).replace(ANSI, ''));
  close();
  return out;
}

// The kinds of run whose logs have the === markers, and the kinds that are node's own test output.
const MARKED = ['docker-gate', 'soak', 'deploy', 'gate', 'docker-after', 'after', 'deploy-after'];
const NODE = ['unit', 'rules'];
export const modeOf = kind => (MARKED.includes(kind) ? 'tests' : NODE.includes(kind) ? 'counts' : 'plain');
const isAfter = kind => /after/.test(kind || '');
const inContainer = kind => ['docker-gate', 'soak', 'deploy'].includes(kind);

// The tests a run will report, in order: the browser tests named in the script the container runs (its
// `for t in …; do st=` loop, which is exactly what it will print), else the Makefile's set for that kind of run; with
// unit and rules first for a container gate, which runs them before the browser lanes.
export function expectedTests(text, kind, sets = {}) {
  const m = /for t in ([^;]+); do st=/.exec(text);
  const browser = m ? m[1].trim().split(/\s+/) : (isAfter(kind) ? sets.after : sets.gate) || [];
  return [...(inContainer(kind) ? ['unit', 'rules'] : []), ...browser];
}

// A log's lines, each marker found: { name, seconds, rest, index } for "=== name (Ns) rest" and "=== name pass".
const MARKER = /^=== ([\w.-]+)(?: \((\d+)s\))?(.*)$/;
const ENDS_SECTION = /^(===|✔ {2}Script exited|⚠ {2}Script exited|i {2}emulators: Shutting|Error: Script|make(\[\d+\])?: \*\*\*)/;

// Where a run has got to, from its log so far. expected: the tests it will report (expectedTests). live: whether it is
// still going, which decides what a test with no result yet is: running (or waiting its turn) while live, and not run
// once finished.
//   { mode, info, tests: [{ name, state: waiting|running|passed|failed|notrun, seconds, line, excerpt, timeLimit }],
//     totals: { passed, failed, running, waiting }, phase, finished: null|'passed'|'failed' }
// A red container gate's rerun (the Makefile's _rerun) goes on in the same log after a line of its own, with markers and
// a "Script exited" of its own; the gate's tests and result are read from the text before that line.
const RERUN_LINE = /^=== (rerun once|no rerun):/m;
export function parseProgress(raw, { expected = [], live = true, kind } = {}) {
  const all = stripAnsi(raw), cut = all.search(RERUN_LINE), text = cut < 0 ? all : all.slice(0, cut);
  const lines = text.split('\n');
  const info = runInfoLine(text) || {};
  kind = kind || info.kind;
  const mode = modeOf(kind);
  const finished = /Script exited successfully/.test(text) ? 'passed'
    : /Script exited unsuccessfully|exited with code [1-9]|make(\[\d+\])?: \*\*\*/.test(text) ? 'failed' : null;
  if (mode === 'counts') return nodeProgress(lines, { info, live, finished });
  if (mode === 'plain') return { mode, info, tests: [], totals: { passed: 0, failed: 0, running: 0, waiting: 0 }, phase: live ? 'running' : 'finished', finished };

  const found = new Map();
  lines.forEach((line, index) => {
    const m = MARKER.exec(line);
    // the run's own line, the leak check, a container set's machine line (tests/cgroup.mjs) and the lanes line are not tests
    if (!m || ['run', 'leak', 'machine', 'lanes'].includes(m[1])) return;
    const [, name, secs, rest] = m;
    const section = [];
    for (let j = index + 1; j < lines.length && !ENDS_SECTION.test(lines[j]); j++) if (lines[j].trim()) section.push(lines[j]);
    const timeLimit = /hit its time limit/.test(rest);
    // unit and rules say pass on their own line; a browser test failed when it hit its limit, printed FAIL, or printed
    // its long tail (a pass prints three lines) without ALL PASS
    const failed = name === 'unit' || name === 'rules' ? !/\bpass\b/.test(rest)
      : timeLimit || section.some(l => /^FAIL\b/.test(l.trim())) || (section.length > 3 && !section.some(l => /ALL PASS/.test(l)));
    found.set(name, { name, state: failed ? 'failed' : 'passed', seconds: secs ? +secs : null, line: index, timeLimit,
      excerpt: failed ? section.slice(-14).join('\n') : '' });
  });

  const names = [...expected, ...[...found.keys()].filter(n => !expected.includes(n))];
  const tests = names.map(name => found.get(name) || { name, state: 'waiting', seconds: null, line: null, excerpt: '', timeLimit: false });
  const open = tests.filter(t => t.state === 'waiting');
  let phase = 'finished';
  if (live && !finished) {
    // what is running now: unit, then rules, one at a time; then every browser test left, in their lanes together
    const first = open[0];
    if (first && (first.name === 'unit' || first.name === 'rules')) { first.state = 'running'; phase = first.name; }
    else { for (const t of open) t.state = 'running'; phase = open.length ? 'browser' : 'finishing'; }
  } else for (const t of open) t.state = 'notrun';
  return { mode, info, tests, totals: totals(tests), phase, finished };
}

const totals = tests => ({ passed: tests.filter(t => t.state === 'passed').length, failed: tests.filter(t => t.state === 'failed').length,
  running: tests.filter(t => t.state === 'running').length, waiting: tests.filter(t => t.state === 'waiting').length });

// node's own test output (make test-unit, the rules tests): a ✔ or ✖ line per test, then ℹ lines with the totals.
// The failures are listed again after "✖ failing tests:", so counting stops there.
function nodeProgress(lines, { info, live, finished }) {
  const tests = [];
  let summary = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^✖ failing tests:/.test(l.trim())) break;
    const ok = /^\s*✔ (.+?) \(([\d.]+)ms\)\s*$/.exec(l), bad = /^\s*✖ (.+?) \(([\d.]+)ms\)\s*$/.exec(l);
    if (ok) tests.push({ name: ok[1], state: 'passed', seconds: +ok[2] / 1000, line: i, excerpt: '' });
    else if (bad) {
      const tail = [];
      for (let j = i + 1; j < lines.length && tail.length < 14 && !/^\s*[✔✖ℹ]/.test(lines[j]); j++) if (lines[j].trim()) tail.push(lines[j]);
      tests.push({ name: bad[1], state: 'failed', seconds: +bad[2] / 1000, line: i, excerpt: tail.join('\n') });
    }
  }
  const n = k => { const m = new RegExp(`^ℹ ${k} (\\d+)`, 'm').exec(lines.join('\n')); return m ? +m[1] : null; };
  if (n('tests') != null) summary = { tests: n('tests'), pass: n('pass'), fail: n('fail') };
  const done = finished || (summary ? (summary.fail ? 'failed' : 'passed') : null);
  return { mode: 'counts', info, tests, totals: { ...totals(tests), running: live && !done ? 1 : 0 }, summary, phase: live && !done ? 'running' : 'finished', finished: done };
}

// ---- which run is live ----

// A run folder's name is when it started: 2026-09-29T06-53-14Z_028792.
export const folderTime = id => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/.exec(id); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : NaN; };
export const safeId = id => (typeof id === 'string' && /^[\w.:-]{1,80}$/.test(id) ? id : null);

// Which run folder belongs to the lock's holder: the newest one started no earlier than ten seconds before the lock was
// taken, whose own first line (when it has one yet) names the same branch. folders: [{ id, info }].
export function matchRunFolder(lockRun, folders) {
  if (!lockRun) return null;
  const since = Date.parse(lockRun.since);
  const fits = folders.filter(f => folderTime(f.id) >= since - 10000 && (!f.info?.branch || !lockRun.branch || f.info.branch === lockRun.branch));
  return fits.sort((a, b) => folderTime(b.id) - folderTime(a.id))[0]?.id || null;
}

const json = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const runsDir = cache => join(cache, 'runs', 'runs');

// A run folder's tasks: each log it has, the main one (the gate, or the last to change) first.
export function runTasks(cache, id) {
  const dir = join(runsDir(cache), id, 'logs');
  let logs = [];
  try { logs = readdirSync(dir).filter(f => f.endsWith('.log')); } catch { return []; }
  const rank = t => (/gate|after/.test(t) ? 0 : 1);
  return logs.map(f => ({ task: f.slice(0, -4), file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => rank(a.task) - rank(b.task) || b.mtime - a.mtime);
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// The run holding the slot now, and its folder when one can be matched: { run: { ...lock's run.json, who }, folder }.
// A holder whose process has gone is not a run.
export function liveNow({ cache }) {
  const lock = json(join(cache, 'lock', 'run.json'));
  if (!lock || (lock.pid && !alive(lock.pid))) return { run: null, folder: null };
  let folders = [];
  try {
    folders = readdirSync(runsDir(cache)).filter(id => folderTime(id) >= Date.parse(lock.since) - 10000).map(id => {
      const t = runTasks(cache, id)[0];
      let head = '';
      try { head = t ? readFileSync(t.file, 'utf8').slice(0, 4096) : ''; } catch { /* gone */ }
      return { id, info: runInfoLine(head) };
    });
  } catch { /* no runs folder yet */ }
  const who = lock.person || lock.worktree || (lock.session ? String(lock.session).slice(0, 8) : 'someone');
  return { run: { ...lock, who }, folder: matchRunFolder(lock, folders) };
}

// Whether a run folder's run is still going: devpipe has not written its run.json, and the lock still names it.
export const isLive = (ctx, id) => !existsSync(join(runsDir(ctx.cache), id, 'run.json')) && liveNow(ctx).folder === id;
export const finishedRun = (ctx, id) => json(join(runsDir(ctx.cache), id, 'run.json'));

// ---- the stream ----

// Streams what a run's log gains as NDJSON: { type:'at', offset }, { type:'lines', text, html } for new whole lines,
// { type:'tests', progress } when the reading of the tests changes, and { type:'done', ok } when the run has ended
// (its run.json appeared, or the lock no longer names it). from: the byte offset the page already has.
// ctx.liveEvery ({ read, check } in ms) lets the tests tick faster.
export function liveStream(ctx, runId, task, from, { sets = {} } = {}) {
  return async res => {
    const id = safeId(runId), tasks = id ? runTasks(ctx.cache, id) : [];
    const t = tasks.find(x => x.task === task) || tasks[0];
    const out = o => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    if (!t) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ message: 'No such run, or no log yet.' })); }
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const every = ctx.liveEvery || { read: 1000, check: 2000 };
    let offset = Number.isInteger(from) && from >= 0 ? from : 0, text = '', last = '', ended = false;
    try { text = offset ? readFileSync(t.file, 'utf8').slice(0, offset) : ''; } catch { /* read below */ }
    const progress = live => {
      const p = parseProgress(text, { expected: expectedTests(stripAnsi(text), runInfoLine(stripAnsi(text))?.kind, sets), live });
      const key = JSON.stringify(p.tests.map(x => [x.name, x.state])) + p.phase + p.finished;
      if (key !== last) { last = key; out({ type: 'tests', progress: p }); }
    };
    const pump = () => {
      let size;
      try { size = statSync(t.file).size; } catch { return; }
      if (size < offset) { offset = 0; text = ''; }
      const r = readNew(t.file, offset, size);
      if (r.offset === offset) return;
      offset = r.offset;
      const chunk = r.lines.join('\n') + '\n';
      text += chunk;
      out({ type: 'lines', text: chunk, html: chunk.split('\n').slice(0, -1).map(ansiToHtml) });
      out({ type: 'at', offset });
      progress(true);
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      pump();
      progress(false);
      const run = finishedRun(ctx, id);
      out({ type: 'done', ok: run ? (run.tasks || []).filter(x => !x.skipped).every(x => x.status === 'PASS') : null });
      stop();
      res.end();
    };
    out({ type: 'at', offset });
    pump();
    progress(true);
    let watcher = null;
    try { watcher = watch(t.file, pump); } catch { /* the timer below still reads */ }
    const reads = setInterval(pump, every.read); // cap: fs.watch can miss an append; this reads anyway
    const checks = setInterval(() => { if (!isLive(ctx, id)) finish(); }, every.check); // cap: the lock and run.json have no event to wait on
    const stop = () => { clearInterval(reads); clearInterval(checks); if (watcher) watcher.close(); };
    res.on('close', stop);
    if (!isLive(ctx, id)) finish();
  };
}
