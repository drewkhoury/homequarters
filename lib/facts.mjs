// The facts line at the end of a red gate (scripts/error-line.mjs says what it is and why). It reads the run's own logs and
// every other run's on this machine: the laptop's container runs in ~/.cache/questkeep/results and the laptop runner's
// CI runs in ~/.cache/questkeep/ci, which scripts/ci-keep.mjs fills as each job ends. It changes no status and never
// fails the caller: a red gate stays red, and a green one is left alone.
// Usage:
//   node scripts/facts.mjs line <run folder>           prints a line per failing test and writes facts.json there
//   node scripts/facts.mjs summary <run folder> <attempt> <ci run id>   Markdown for a CI job's step summary: this
//        run's facts when it is red, and when it is green on a later attempt, the facts of the red attempts before it
// HQ_CACHE names the cache (the manifest's by default), so the unit tests bring their own; HQ_NOW and HQ_BRANCH replay
// an old red as it would have read then.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { causeOf, candidates, sharedLines, factsFor, factLines } from './error-line.mjs';
import { codeKey } from './code-key.mjs';

const LOOKBACK_DAYS = 14;
const read = p => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const json = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const ls = p => { try { return readdirSync(p); } catch { return []; } };

// A run folder's tests by their .status files: [{ test, status }], status null when the file holds no number.
function statuses(folder) {
  const logs = join(folder, 'logs');
  return ls(logs).filter(f => f.endsWith('.status')).map(f => {
    const v = read(join(logs, f)).trim();
    return { test: f.slice(0, -'.status'.length), status: /^\d+$/.test(v) ? +v : null };
  });
}
// a test's log: logs/<test>.log, or logs/qk-<test>.log in CI runs from before 3 October
const logOf = (folder, test) => { const a = join(folder, 'logs', `${test}.log`), b = join(folder, 'logs', `qk-${test}.log`); return existsSync(a) ? a : existsSync(b) ? b : null; };

// The unit tests that failed, from Node's spec output in unit.log: each "✖ <title>" under "✖ failing tests:", with the
// lines below it up to the next, as its own log. Named "unit: <title>", so one failing unit test is not every unit red.
export function unitFailures(text) {
  const lines = String(text).split('\n'), at = lines.findIndex(l => /^✖ failing tests:/.test(l.trim()));
  if (at < 0) return [];
  const out = [];
  for (const l of lines.slice(at + 1)) {
    const m = /^✖ (.+?) \([\d.]+ms\)$/.exec(l.trim());
    if (m) out.push({ test: `unit: ${m[1]}`, text: '' });
    else if (out.length) out.at(-1).text += `${l.trim()}\n`;
  }
  return out;
}

// One run folder's failing tests with their lines, the lines its passing tests also printed left out, and whether a
// rerun passed each: [{ test, line, generic, rerun }]. also: lines passing tests printed in other recent runs
// (recentPassingLines), for a run with few passing tests of its own, such as a docker-smoke of one.
export function redsOf(folder, also = new Set()) {
  const all = statuses(folder), failed = all.filter(t => t.status !== 0 && t.status !== null), passed = all.filter(t => t.status === 0);
  if (!failed.length) return [];
  const shared = new Set([...also, ...sharedLines(passed.map(t => read(logOf(folder, t.test) || '')))]);
  const again = new Map(statuses(join(folder, 'rerun')).map(t => [t.test, t.status === 0 ? 'passed alone' : 'failed again']));
  return failed.flatMap(t => {
    const text = read(logOf(folder, t.test) || '');
    if (t.test === 'unit') { const u = unitFailures(text); if (u.length) return u.map(x => ({ test: x.test, ...(causeOf(x.text, shared) || { line: null, generic: false }), rerun: null })); }
    return [{ test: t.test, ...(causeOf(text, shared) || { line: null, generic: false }), rerun: again.get(t.test) || null }];
  });
}

// A run folder's causes for the register (hq/lib/problem-register.mjs): Map(test -> { line, generic }), read from its logs
// now, passing over its own passing tests' lines and also (recentPassingLines, once per register read): a facts.json
// kept from before a rule changed can hold a worse line (Juno: 6 of 19 differed on 13 October). Only a folder whose
// logs are gone falls back to its facts.json. Tests with no line are left out.
// What the logs say is worked out once per folder while its logs, its rerun's logs and facts.json stat the same (name,
// size, mtime): each failing test's candidate lines, best first, and the lines its passing tests printed. The lines in
// also are applied to that, so new ones need no log read. With index, the file it is saved to, a restarted HQ starts
// from what it worked out before (saveIndex(write) says when to write; 2 s after a change unless a test says now).
const PIECES = new Map(), INDEXES = new Map();
const statKey = p => { try { const s = statSync(p); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; } };
const folderStamp = folder => [join(folder, 'logs'), join(folder, 'rerun', 'logs')]
  .map(d => ls(d).sort().map(f => `${f}=${statKey(join(d, f))}`).join(',')).join('|') + `|${statKey(join(folder, 'facts.json'))}`;
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// the code that works out a folder's causes; an index written by other code is passed over (lib/code-key.mjs)
let readers = null;
const READERS = () => (readers ??= codeKey(new URL('./facts.mjs', import.meta.url)));
const later = write => { const t = setTimeout(write, 2000); if (t.unref) t.unref(); };
function useIndex(file) {
  if (!file || INDEXES.has(file)) return INDEXES.get(file) || null;
  const x = { saving: false };
  INDEXES.set(file, x);
  const saved = json(file);
  if (saved && saved.readers === READERS() && saved.format === 1 && saved.folders && typeof saved.folders === 'object') {
    for (const [folder, [stamp, pieces]] of Object.entries(saved.folders)) if (!PIECES.has(folder)) PIECES.set(folder, { stamp, pieces, answers: new Map() });
  }
  return x;
}
function saveSoon(file, when) {
  const x = useIndex(file);
  if (!x || x.saving) return;
  x.saving = true;
  when(() => {
    x.saving = false;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify({ hq: VERSION, readers: READERS(), format: 1, folders: Object.fromEntries([...PIECES].map(([f, e]) => [f, [e.stamp, e.pieces]])) }));
      renameSync(`${file}.tmp`, file);
    } catch { /* an index that cannot be written only means a slower next start */ }
  });
}
// What a folder's logs say: { facts, own, passed, reds: [{ test, cands }] }. facts is facts.json's list for a folder
// whose logs are gone, and null otherwise.
function readPieces(folder) {
  const all = statuses(folder), failed = all.filter(t => t.status !== 0 && t.status !== null), passed = all.filter(t => t.status === 0);
  const kept = json(join(folder, 'facts.json'));
  if (!all.length && kept && Array.isArray(kept.facts)) return { facts: kept.facts.filter(f => f && f.line).map(f => ({ test: f.test, line: f.line, generic: !!f.generic })), own: [], passed: 0, reds: [] };
  const own = passed.length ? [...sharedLines(passed.map(t => read(logOf(folder, t.test) || '')))] : [];
  const reds = failed.flatMap(t => {
    const text = read(logOf(folder, t.test) || '');
    const cands = c => candidates(c).map(({ line, generic }) => ({ line, generic }));
    if (t.test === 'unit') { const u = unitFailures(text); if (u.length) return u.map(x => ({ test: x.test, cands: cands(x.text) })); }
    return [{ test: t.test, cands: cands(text) }];
  });
  return { facts: null, own, passed: passed.length, reds };
}
function piecesOf(folder, { index = null, saveIndex = later } = {}) {
  useIndex(index);
  const stamp = folderStamp(folder), had = PIECES.get(folder);
  if (had && had.stamp === stamp) return had;
  const e = { stamp, pieces: readPieces(folder), answers: new Map() };
  PIECES.set(folder, e);
  if (index) saveSoon(index, saveIndex);
  return e;
}
const ALSO = new WeakMap();
const alsoKey = also => { if (!ALSO.has(also)) ALSO.set(also, [...also].sort().join('\n')); return ALSO.get(also); };
export function causesOfFolder(folder, also = new Set(), opts = {}) {
  const e = piecesOf(folder, opts), k = alsoKey(also);
  if (e.answers.has(k)) return e.answers.get(k);
  const { facts, own, reds } = e.pieces;
  let list;
  if (facts) list = facts;
  else {
    const shared = new Set([...also, ...own]);
    list = reds.map(r => { const c = r.cands.find(x => !shared.has(x.line)) || r.cands[0]; return c ? { test: r.test, line: c.line, generic: c.generic } : null; }).filter(Boolean);
  }
  const value = new Map(list.map(f => [f.test, { line: f.line, generic: !!f.generic }]));
  e.answers.clear();
  e.answers.set(k, value);
  return value;
}

// The lines passing tests printed in the newest runs on this machine, up to RECENT_RUNS of them from the last day: what
// a green test prints on this bench, such as the avatar request the seal refuses on every signed-in page, is no red's
// cause, even in a run that has no passing test of its own (Mags).
const RECENT_RUNS = 20;
// index and saveIndex as causesOfFolder takes them: the lines are the ones it works out per folder.
export function recentPassingLines(cache, { now = Date.now(), skip, index = null, saveIndex } = {}) {
  const day = now - 86400e3, out = new Set();
  const folders = [...folderTimes(cache)].filter(f => f.t >= day && f.t <= now && !(skip && resolve(f.dir) === resolve(skip))).sort((a, b) => b.t - a.t);
  let used = 0;
  for (const f of folders) {
    const { pieces } = piecesOf(f.dir, { index, saveIndex });
    if (!pieces.passed) continue;
    for (const l of pieces.own) out.add(l);
    if (++used >= RECENT_RUNS) break;
  }
  return out;
}

// Every run folder on this machine with its time: the laptop's, timed by their names, and CI's, by their run.json.
function* folderTimes(cache) {
  for (const id of ls(join(cache, 'results'))) yield { dir: join(cache, 'results', id), t: Date.parse(id.slice(0, 20).replace(/T(\d\d)-(\d\d)-(\d\d)Z/, 'T$1:$2:$3Z')) };
  for (const id of ls(join(cache, 'ci')).filter(x => /^junit-\d+-\d+-[a-z]/.test(x))) { const m = json(join(cache, 'ci', id, 'run.json')) || {}; yield { dir: join(cache, 'ci', id), t: Date.parse(m.at), branch: m.branch || null }; }
}

// Every other run on this machine in the last LOOKBACK_DAYS, as its failing tests: [{ run, when, branch, test, line }].
// A laptop folder's time is in its name and its branch in its devpipe run, where one recorded it; a CI folder's are in
// its run.json. A folder with no branch (docker-smoke records none) still counts its tests and runs.
export function history(cache, { now = Date.now(), skip, also = new Set() } = {}) {
  const from = now - LOOKBACK_DAYS * 86400e3, out = [];
  const branchOf = new Map();
  for (const id of ls(join(cache, 'runs', 'runs'))) {
    const r = json(join(cache, 'runs', 'runs', id, 'run.json'));
    for (const t of (r && r.tasks) || []) { const m = /"out":"([^"]+)"[^\n]*"branch":"([^"]+)"|"branch":"([^"]+)"[^\n]*"out":"([^"]+)"/.exec(read(t.logPath || '').slice(0, 65536)); if (m) branchOf.set(m[1] || m[4], m[2] || m[3]); }
  }
  for (const f of folderTimes(cache)) {
    const t = f.t;
    if (!Number.isFinite(t) || t < from || t > now || (skip && resolve(f.dir) === resolve(skip))) continue;
    for (const r of redsOf(f.dir, also)) if (r.line) out.push({ run: basename(f.dir), when: new Date(t).toISOString(), branch: f.branch || branchOf.get(f.dir) || null, test: r.test, line: r.line });
  }
  return out;
}

// the branch the Makefile names (HQ_BRANCH), unless the checkout is detached, as CI's is: then the pull request's own
const branchNow = () => [process.env.HQ_BRANCH, process.env.GITHUB_HEAD_REF].find(b => b && b !== 'HEAD') || null;

function lineCmd(folder, cache) {
  const now = process.env.HQ_NOW ? Date.parse(process.env.HQ_NOW) : Date.now(); // HQ_NOW replays an old red, for checking
  const also = recentPassingLines(cache, { now, skip: folder }), tests = redsOf(folder, also);
  if (!tests.length) return;
  const facts = factsFor({ run: basename(folder), branch: branchNow(), tests }, history(cache, { now, skip: folder, also }), { now });
  console.log('=== facts: where else each failing test\'s error line turned up on this machine. It changes nothing about this gate.');
  for (const l of factLines(facts)) console.log(l);
  try { writeFileSync(join(folder, 'facts.json'), `${JSON.stringify({ at: new Date().toISOString(), facts }, null, 1)}\n`); } catch { /* a read-only folder: the lines above still said it */ }
}

// For the step summary: this run's facts, from its facts.json, and on a green later attempt, the red attempts' before it,
// which the laptop runner kept in ci/ (scripts/ci-keep.mjs) so a green rerun cannot hide them.
export function summary(folder, attempt, runId, cache) {
  const mine = json(join(folder, 'facts.json'));
  const lines = [];
  if (mine && mine.facts.length) lines.push('### Facts on this red', '', ...factLines(mine.facts).map(l => `- ${l.replace(/^=== facts /, '')}`));
  else if (+attempt > 1) {
    for (let a = +attempt - 1; a >= 1; a--) {
      const prev = json(join(cache, 'ci', `junit-${runId}-${a}-gate`, 'facts.json'));
      if (prev && prev.facts.length) lines.push(`### Attempt ${a} of this run was red`, '', ...factLines(prev.facts).map(l => `- ${l.replace(/^=== facts /, '')}`), '');
    }
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // the cache is the repo's manifest's unless HQ_CACHE says otherwise
  const { loadManifest } = await import('./manifest.mjs');
  const [cmd, folder, attempt, runId] = process.argv.slice(2), cache = process.env.HQ_CACHE || loadManifest(process.cwd()).m.cache;
  try {
    if (cmd === 'line' && folder) lineCmd(resolve(folder), cache);
    else if (cmd === 'summary' && folder) process.stdout.write(summary(resolve(folder), attempt || '1', runId || '', cache));
    else { console.error('Usage: node lib/facts.mjs line <run folder> | summary <run folder> <attempt> <ci run id>'); process.exitCode = 2; }
  } catch (e) { console.error(`facts: could not say (${e.message}); the gate's own result stands.`); }
}
