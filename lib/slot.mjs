// The test slot: one browser or container test run at a time on this machine, taken with `hq slot take <name>` and given
// back with `hq slot release <name> <exit status>`. Browser tests and test containers share one headless browser's worth
// of CPU and one home volume, and several sessions (Claude's, in their own worktrees, or a person's) can want them at
// once; two gates together starve each other and fail for no reason. A session can also claim the slot across several
// runs (`hq slot claim <why>`) and let it go (`hq slot unclaim`); `hq slot who` shows it all, and `hq slot status <msg>`
// posts a session's line. The slot is a guard, not a record: a Makefile that cannot find hq must stop the run, not skip
// this (the make lines hq setup proposes do).
// Everything lives in the repo's lock store (hq.json names it; <cache>/lock when it does not), beside the test history:
// what is shared is the machine, not a checkout. HQ_SLOT_DIR points elsewhere.
//   run.json          the run holding the slot: session, process, worktree, branch, target, since
//   claim.json        a session's claim across runs, with its reason
//   board/<id>.json   each session's latest status line, and its last run's result
//   queue/<n>.json    each run waiting for the slot; the slot goes to the one that has waited longest
//   log.jsonl         every take, wait, release and take-over, give-up, refusal (LOCK_WAIT=0) and waiter that left
//                     before its turn, each line with v; a take and a release also hold the machine's load, swap and
//                     busiest programs (lib/machine.mjs); a line written inside a GitHub Actions job also holds its run
//                     and attempt (ciRun, ciAttempt)
//   *.stale-*.json    records moved aside when judged stale or released, the newest ten of each kept for looking back
// Waiters take turns in the order they came, so a run that asks often, or takes again the moment it releases, cannot keep
// the others out; a session holding a claim goes first, since the rest are waiting for its claim anyway. A waiter that is
// stopped gives up its place, and one whose process has gone is dropped from the queue.
// A holder whose process has gone is taken over; so is a claim whose Claude session has ended. A test container left
// running by an ended run makes the next run wait, with the command to stop it; nothing here stops anyone's container.
// The slot stands aside on hosted CI, inside a test container (HQ_IN_CONTAINER=1) and with HQ_SLOT=0. A self-hosted
// runner is CI on this machine, so it takes its turn like anyone else, under the name HQ_WHO gives it.
// A Claude session is known by CLAUDE_CODE_SESSION_ID, which every agent it starts shares; nothing else Claude Code hands a
// command tells those agents apart. So an agent started by another agent names itself with HQ_AGENT, and a claim or a
// status line is that agent's alone. Without it, every agent of the session counts as one, and claim says so.
// LOCK_WAIT=0 makes take fail at once (exit 3) instead of waiting its turn, and LOCK_WAIT=<minutes> waits that long at
// most, then fails the same way. Every HQ_ name here is also read under the QK_ name QuestKeep used, for one release:
// HQ_SLOT_DIR/QK_LOCK_DIR, HQ_SLOT_PID/QK_LOCK_PID, HQ_SLOT_POLL_MS/QK_LOCK_POLL_MS, HQ_AGENT/QK_AGENT, HQ_WHO/QK_WHO,
// HQ_NO_DOCKER/QK_NO_DOCKER, HQ_TEST_IMAGE/QK_TEST_IMAGE, HQ_SLOT/QK_LOCK, HQ_IN_CONTAINER/QK_IN_CONTAINER.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, appendFileSync, existsSync, readdirSync, linkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { hostInfo, pagingRate } from './machine.mjs';
import { loadManifest } from './manifest.mjs';

export const SLOT_V = 1; // the shape of a log line; a reader takes a line without v as v 0

const MIN = 60000;
const CLAIM_IDLE_MIN = 45; // past this a waiting session is told to ask; a person at a terminal is told from the first minute

const ago = (iso, now) => Math.max(0, Math.round((now - Date.parse(iso)) / MIN));
const clock = iso => new Date(iso).toTimeString().slice(0, 5);
const dur = secs => `${Math.floor(secs / 60)}m${String(Math.round(secs % 60)).padStart(2, '0')}s`;
const who = x => `${x.person ? `${x.person}, in ` : x.agent ? `${x.agent}, in ` : ''}${x.worktree || 'a session'}${x.branch ? ` (${x.branch})` : ''}`;
// Whether a record (a run, a claim) is the caller's own. A Claude session's record is its own only for the same agent of
// that session: every agent a session starts shares its CLAUDE_CODE_SESSION_ID, and QK_AGENT is what tells them apart.
// A person's record (no session) is only that person's.
const siblingOf = c => c.agent ? `Agent ${c.agent} of your own Claude session, in ${c.worktree || '?'},` : `Your session's lead, in ${c.worktree || '?'},`;
const releaseFor = c => c.agent ? `HQ_AGENT=${c.agent} hq slot unclaim` : 'hq slot unclaim with no HQ_AGENT';
export const sameOwner = (r, me) => r.session ? r.session === me.session && (r.agent || null) === (me.agent || null) : !me.session && r.person === me.person;

// May `me` take the slot now? run, claim: what the files hold (or null; {unreadable} for a file that will not parse);
// runAlive(run): whether the run's own process is still the one that took the slot (its number and its start time);
// alive(pid): whether a process exists; containers: test containers running now. Answers take (possibly clearing a stale
// run or claim) or wait, with why. There is no age limit on a run: a laptop can sleep through a gate and wake up in it.
export function decideTake({ run, claim, me, now, alive, runAlive = r => alive(r.pid), containers = [] }) {
  let clearRun = false, clearClaim = false;
  const why = [];
  if (run && run.unreadable) {
    clearRun = true;
    why.push('The slot\'s record was unreadable (a write cut short); taking it over.');
  } else if (run) {
    if (runAlive(run)) return { action: 'wait', why: `${who(run)} is running ${run.target} (since ${clock(run.since)}, ${ago(run.since, now)} min).` };
    clearRun = true;
    why.push(`${who(run)}'s ${run.target} ended without releasing the slot; taking it over.`);
  }
  if (containers.length) {
    const c = containers[0];
    return { action: 'wait', clearRun, why: `${c.worktree || 'An ended run'}'s test container ${c.name} is still running (${c.runningFor}). If it is stuck: docker stop ${c.name}` };
  }
  const mine = claim && !claim.unreadable && sameOwner(claim, me);
  if (claim && !claim.unreadable && !mine) {
    if (claim.claudePid && !alive(claim.claudePid)) {
      clearClaim = true;
      why.push(`${who(claim)}'s claim ("${claim.msg}") ended with its session.`);
    } else if (claim.session && claim.session === me.session) {
      // another agent of this session: it shares the session's Claude process, so its claim outlives it if it stopped
      // without make release; say whose it is and how to let it go, at once
      return { action: 'wait', clearRun, why: `${siblingOf(claim)} holds the slot: "${claim.msg}" (since ${clock(claim.since)}, idle ${ago(claim.renewed || claim.since, now)} min). If it has finished: ${releaseFor(claim)}.` };
    } else {
      const idle = ago(claim.renewed || claim.since, now);
      const hint = me.person || idle >= CLAIM_IDLE_MIN ? ' If it is not needed: hq slot unclaim force.' : '';
      return { action: 'wait', clearRun, why: `${who(claim)} has claimed the slot: "${claim.msg}" (since ${clock(claim.since)}, idle ${idle} min).${hint}` };
    }
  }
  if (claim && claim.unreadable) { clearClaim = true; why.push('The claim\'s record was unreadable; dropping it.'); }
  return { action: 'take', clearRun, clearClaim, why: why.join(' ') };
}

// The waiters ahead of `mine` (a ticket name, or null for a take that will not wait): every live ticket named before it.
// Ticket names start with the time they were taken, so their order is the order the waiters came in.
// LOCK_WAIT as a limit in ms: null to wait for good (unset, or not a number of minutes), 0 not to wait at all.
export function waitLimit(v) {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n * 60000 : null;
}

export function queueAhead({ tickets, mine, live }) {
  return (tickets || []).filter(t => live(t) && t.ticket !== mine && (mine === null || t.ticket < mine)).sort((a, b) => a.ticket.localeCompare(b.ticket));
}

// What make who prints.
export function whoText({ run, claim, board, log, now, alive, queue = [], exists = () => true }) {
  const out = [];
  if (run && run.unreadable) out.push('Test slot: its record is unreadable; the next run will take it over');
  else if (run) {
    out.push(`Test slot: ${who(run)} is running ${run.target} since ${clock(run.since)} (${ago(run.since, now)} min)${alive(run.pid) ? '' : ', but its process has gone'}`);
    if (run.session) out.push(`  session ${run.session}${run.claudePid && alive(run.claudePid) ? ', alive' : ''}; look in with: claude --resume ${run.session}`);
  } else out.push('Test slot: free');
  if (claim && !claim.unreadable) {
    const idle = ago(claim.renewed || claim.since, now);
    out.push(`  claimed by ${who(claim)} since ${clock(claim.since)}, idle ${idle} min: "${claim.msg}"${claim.claudePid && !alive(claim.claudePid) ? ' (its session has ended)' : ''}${idle >= CLAIM_IDLE_MIN ? '; if it is forgotten, hq slot unclaim force' : ''}`);
    if (claim.session && !run) out.push(`  look in with: claude --resume ${claim.session}`);
  }
  queue.forEach((q, i) => out.push(`${i ? '         ' : 'Waiting: '}${i + 1}. ${who(q)} for ${q.target}, since ${clock(q.since)} (${ago(q.since, now)} min)`));
  const recent = (board || []).filter(b => ago(b.at, now) < 12 * 60).sort((a, b) => b.at.localeCompare(a.at));
  if (recent.length) {
    out.push('', 'Sessions:');
    for (const b of recent) {
      const ended = b.claudePid && !alive(b.claudePid) ? ' (ended)' : '';
      // a person's line (the laptop runner's) names them; a message says when it was posted if that was before the line's
      // last change, so an old message does not borrow a newer run's time; a checkout that is gone says so
      const name = b.person || b.agent ? `${b.person || b.agent}, in ${b.worktree || '?'}` : (b.worktree || '?');
      const msg = b.msg ? `${b.msg}${b.msgAt && b.msgAt !== b.at ? ` (posted ${clock(b.msgAt)})` : ''}` : '';
      const gone = b.path && !exists(b.path) ? ' (checkout removed)' : '';
      out.push(`  ${name.padEnd(18)} ${(b.branch || '').padEnd(20)} ${clock(b.at)}  ${msg}${b.last ? `  [last run: ${b.last}]` : ''}${ended}${gone}`);
    }
  }
  const runs = (log || []).filter(e => e.event === 'release' || e.event === 'takeover').slice(-5).reverse();
  if (runs.length) {
    out.push('', 'Last runs:');
    for (const e of runs) out.push(`  ${clock(e.at)}  ${(e.worktree || '?').padEnd(18)} ${String(e.target || '?').padEnd(18)} ${e.event === 'takeover' ? 'ended without releasing' : `${e.status === 0 ? 'passed' : `failed (${e.status})`}  ${dur(e.secs)}`}`);
  }
  return out.join('\n');
}

// ---- the command line: files, processes and docker ----
// set once by main: the environment, the lock folder and the repo the run is in
let env = process.env, DIR = '', repo = process.cwd();
const E = (hq, qk) => (env[hq] !== undefined ? env[hq] : env[qk]);
const git = (...args) => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// when a process started, so a process number that came back as another process is not taken for the holder
const started = pid => { try { return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const runAlive = r => alive(r.pid) && (!r.pidStart || started(r.pid) === r.pidStart);
// a file that exists but will not parse is reported as such, with its bytes, so it can be moved aside rather than spun on
const readRaw = f => { try { return readFileSync(join(DIR, f), 'utf8'); } catch { return null; } };
const read = f => { const raw = readRaw(f); if (raw === null) return null; try { return JSON.parse(raw); } catch { return { unreadable: true, raw }; } };
const logEvent = e => appendFileSync(join(DIR, 'log.jsonl'), JSON.stringify({ v: SLOT_V, at: new Date().toISOString(), ...e }) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Publishes a whole record under a name only if nothing is there: written to a file of its own first, then linked into
// place, which fails if the name exists. So the record can never be seen half written, and of two writers one wins.
function publish(name, obj) {
  const tmp = join(DIR, `${name}.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(obj) + '\n');
  try { linkSync(tmp, join(DIR, name)); return true; } catch (e) { if (e.code === 'EEXIST') return false; throw e; } finally { try { unlinkSync(tmp); } catch { /* gone */ } }
}
// Replaces a record in place, whole.
function replace(name, obj) { const tmp = join(DIR, `${name}.${process.pid}.tmp`); writeFileSync(tmp, JSON.stringify(obj) + '\n'); renameSync(tmp, join(DIR, name)); }
// Moves a record aside only if it is still the one that was judged stale; if another session has put a new one there
// meanwhile, that one is put back. Answers whether the stale one was moved. The set-aside files are kept for looking
// back; of the claims only the newest ASIDE_KEEP stay, so the folder does not grow for good. A run's copies need no
// cap, since releaseSlot clears its own.
function moveAside(name, seen) {
  const aside = join(DIR, `${name}.stale-${process.pid}-${Date.now()}.json`);
  try { renameSync(join(DIR, name), aside); } catch { return false; } // gone already: someone else moved it
  let moved = null; try { moved = readFileSync(aside, 'utf8'); } catch { /* vanished */ }
  if (moved === (seen.unreadable ? seen.raw : JSON.stringify(seen) + '\n') || (!seen.unreadable && sameRecord(moved, seen))) { if (name === 'claim.json') pruneAside(name); return true; }
  try { linkSync(aside, join(DIR, name)); } catch { /* a newer one is already there */ }
  try { unlinkSync(aside); } catch { /* fine */ }
  return false;
}
// Clears all but the newest ASIDE_KEEP set-aside copies of a record, newest by the time in their names. The one just
// moved aside is the newest, so it is never the one cleared.
const ASIDE_KEEP = 10;
function pruneAside(name) {
  const at = n => Number((/-(\d+)\.json$/.exec(n) || [])[1]) || 0;
  let names = []; try { names = readdirSync(DIR).filter(n => n.startsWith(`${name}.stale-`) && n.endsWith('.json')); } catch { return; }
  for (const f of names.sort((a, b) => at(b) - at(a)).slice(ASIDE_KEEP)) { try { unlinkSync(join(DIR, f)); } catch { /* another session cleared it */ } }
}
function sameRecord(text, seen) { try { const r = JSON.parse(text); return r.pid === seen.pid && r.since === seen.since && r.session === seen.session; } catch { return false; } }

function identity(target) {
  // the shell running the make recipe: alive exactly as long as the run is
  const pid = +E('HQ_SLOT_PID', 'QK_LOCK_PID') || process.ppid, path = git('rev-parse', '--show-toplevel') || repo;
  return {
    session: env.CLAUDE_CODE_SESSION_ID || null, agent: (env.CLAUDE_CODE_SESSION_ID && E('HQ_AGENT', 'QK_AGENT')) || null,
    claudePid: +env.CLAUDE_PID || null, pid, pidStart: started(pid),
    worktree: basename(path), path, branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    target, person: env.CLAUDE_CODE_SESSION_ID ? null : (E('HQ_WHO', 'QK_WHO') || env.USER || 'someone'),
    // inside a GitHub Actions job (a self-hosted runner), which run and attempt this is, so Delivery can match the slot's
    // wait and the machine's load to the job exactly rather than by time
    ...(/^\d+$/.test(env.GITHUB_RUN_ID || '') ? { ciRun: +env.GITHUB_RUN_ID, ciAttempt: +env.GITHUB_RUN_ATTEMPT || 1 } : {}),
  };
}

// Test containers running now: by the labels a project's docker run puts on them (hq.test=<target> and hq.worktree, or
// QuestKeep's qk.* for one release), and by the test image (HQ_TEST_IMAGE) for containers started by a checkout that
// predates the labels, counted only when their command is a test run (not a shell).
function testContainers() {
  if (E('HQ_NO_DOCKER', 'QK_NO_DOCKER')) return [];
  const ps = args => { try { return execFileSync('docker', ['ps', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).split('\n').filter(Boolean); } catch { return []; } };
  const labelled = ['hq', 'qk'].flatMap(ns => ps(['--filter', `label=${ns}.test`, '--format', `{{.Names}}\t{{.Label "${ns}.test"}}\t{{.Label "${ns}.worktree"}}\t{{.RunningFor}}`])
    .map(r => { const [name, target, worktree, runningFor] = r.split('\t'); return { name, target, worktree, runningFor }; }).filter(c => /test/.test(c.target)));
  const image = E('HQ_TEST_IMAGE', 'QK_TEST_IMAGE');
  const unlabelled = image ? ps(['--filter', `ancestor=${image}`, '--no-trunc', '--format', '{{.Names}}\t{{.Label "qk.test"}}\t{{.Command}}\t{{.RunningFor}}\t{{.Mounts}}'])
    .map(r => { const [name, label, command, runningFor, mounts] = r.split('\t'); return { name, label, command, runningFor, worktree: worktreeOf(mounts), target: 'unlabelled' }; })
    .filter(c => !c.label && /make (_?test|_docker-test)/.test(c.command || '')) : [];
  return [...labelled, ...unlabelled];
}

// The checkout a container mounts: the folder mounted as /repo, or the one holding the screenshots folder mounted beside it.
function worktreeOf(mounts) {
  const dirs = (mounts || '').split(',').filter(m => m.startsWith('/')).map(m => m.replace(/\/\.shots\/?$/, ''));
  return dirs.length ? basename(dirs[0]) : undefined;
}

function setBoard(who, fields) {
  const key = who.session ? `${who.session}${who.agent ? `-${who.agent}` : ''}` : `person-${who.person}`;
  mkdirSync(join(DIR, 'board'), { recursive: true });
  const f = join(DIR, 'board', `${String(key).replace(/[^\w.-]/g, '_')}.json`);
  let old = {}; try { old = JSON.parse(readFileSync(f, 'utf8')); } catch { /* first line */ }
  writeFileSync(f, JSON.stringify({ ...old, session: who.session, agent: who.agent || null, claudePid: who.claudePid, person: who.person || null, worktree: who.worktree, path: who.path || old.path || null, branch: who.branch, at: new Date().toISOString(), ...fields }) + '\n');
}

// The queue: one file per waiting run, named by the time it began to wait, so names sort in the order waiters came.
const QDIR = () => join(DIR, 'queue');
function readQueue() {
  if (!existsSync(QDIR())) return [];
  return readdirSync(QDIR()).filter(n => n.endsWith('.json')).map(n => { try { return { ...JSON.parse(readFileSync(join(QDIR(), n), 'utf8')), ticket: n }; } catch { return null; } }).filter(Boolean);
}
const leaveQueue = name => { if (name) { try { unlinkSync(join(QDIR(), name)); } catch { /* gone */ } } };
// the live waiters, dropping the tickets of runs whose process has gone
function liveQueue() {
  const all = readQueue();
  for (const q of all) if (!runAlive(q)) leaveQueue(q.ticket);
  return all.filter(q => runAlive(q)).sort((a, b) => a.ticket.localeCompare(b.ticket));
}

async function takeSlot(target) {
  const me = identity(target), begun = Date.now(), poll = +(E('HQ_SLOT_POLL_MS', 'QK_LOCK_POLL_MS') || 2000), limit = waitLimit(E('HQ_SLOT_WAIT', 'LOCK_WAIT'));
  let lastSaid = 0, ticket = null, waitingFor = null;
  if (limit !== 0) {
    mkdirSync(QDIR(), { recursive: true });
    ticket = `${String(Date.now()).padStart(14, '0')}-${me.pid}-${process.pid}.json`;
    writeFileSync(join(QDIR(), ticket), JSON.stringify({ ...me, since: new Date().toISOString() }) + '\n');
    // a stopped waiter gives up its place and says so in the log (a killed one is dropped by the next reader, its process
    // being gone, and leaves no line)
    process.on('exit', code => {
      if (!ticket) return;
      leaveQueue(ticket);
      if (waitingFor) { try { logEvent({ event: 'left', ...me, secs: Math.round((Date.now() - begun) / 1000), code, for: waitingFor }); } catch { /* the folder is gone */ } }
    });
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(sig, () => process.exit(code));
  }
  for (;;) {
    // docker first: nothing slow may sit between reading a stale record and moving it aside
    const containers = testContainers(), run = read('run.json'), claim = read('claim.json');
    let d = decideTake({ run, claim, me, now: Date.now(), alive, runAlive, containers });
    const claimMine = claim && !claim.unreadable && sameOwner(claim, me);
    if (d.action === 'take' && !d.clearRun && !d.clearClaim && !claimMine) {
      const ahead = queueAhead({ tickets: liveQueue(), mine: ticket, live: () => true });
      if (ahead.length) d = { action: 'wait', why: `${ahead.length} waiting ahead, first ${who(ahead[0])} for ${ahead[0].target} (since ${clock(ahead[0].since)}).` };
    }
    if (d.clearRun && run) {
      if (moveAside('run.json', run)) {
        logEvent({ event: 'takeover', ...(run.unreadable ? { target: 'unreadable record' } : run), by: me.worktree });
        if (!run.unreadable) setBoard(run, { last: `${run.target} ended without releasing (started ${clock(run.since)})` });
        console.log(`Lock: ${d.why}`);
      } else await sleep(poll); // it could not be moved (another session moved it first, or the folder refuses): try again a poll later, never in a tight loop
      continue;
    }
    if (d.clearClaim && claim) {
      if (moveAside('claim.json', claim)) { logEvent({ event: 'claim-ended', ...(claim.unreadable ? {} : claim) }); console.log(`Lock: ${d.why}`); }
      else await sleep(poll);
      continue;
    }
    if (d.action === 'take') {
      const machine = hostInfo();
      // the swap and compressor counters at the take, so the release can say how hard the Mac paged during the run
      if (!publish('run.json', { ...me, since: new Date().toISOString(), paged: machine.paged })) { await sleep(poll); continue; } // taken between the read and the write
      const own = read('claim.json');
      if (own && !own.unreadable && sameOwner(own, me)) replace('claim.json', { ...own, renewed: new Date().toISOString() });
      leaveQueue(ticket); ticket = null;
      logEvent({ event: 'take', ...me, machine }); // what else the laptop was doing as the run began (lib/machine.mjs)
      setBoard(me, {}); // the session's line names the checkout it is running in now, not the one of its last release
      const waited = Math.round((Date.now() - begun) / 1000);
      console.log(`Lock: ${waited > 5 ? `free after ${dur(waited)}; ` : ''}taken (${target}, ${me.worktree})`);
      return 0;
    }
    if (limit === 0) {
      console.log(`Lock: busy. ${d.why} Not waiting (LOCK_WAIT=0).`);
      logEvent({ event: 'refused', ...me, for: d.why });
      return 3;
    }
    waitingFor = d.why;
    if (limit && Date.now() - begun >= limit) {
      console.log(`Lock: still busy after ${dur((Date.now() - begun) / 1000)}. ${d.why} Giving up (LOCK_WAIT=${E('HQ_SLOT_WAIT', 'LOCK_WAIT')} minutes).`);
      logEvent({ event: 'gave-up', ...me, for: d.why });
      leaveQueue(ticket); ticket = null; // its give-up is its line: no left line as well
      return 3;
    }
    if (Date.now() - lastSaid >= 30000) {
      console.log(lastSaid ? `Lock: still waiting (${dur((Date.now() - begun) / 1000)}). ${d.why}` : `Lock: busy. ${d.why} Waiting. (hq slot who; LOCK_WAIT=0 stops instead)`);
      if (!lastSaid) logEvent({ event: 'wait', ...me, for: d.why });
      lastSaid = Date.now();
    }
    await sleep(poll); // poll: the holder's own process ending is what frees the slot
  }
}

function releaseSlot(target, status) {
  const me = identity(target), run = read('run.json');
  if (!run || run.unreadable || run.pid !== me.pid) return 0; // not ours: leave it
  if (!moveAside('run.json', run)) return 0;
  for (const f of readdirSync(DIR).filter(n => n.startsWith(`run.json.stale-${process.pid}-`))) { try { unlinkSync(join(DIR, f)); } catch { /* fine */ } }
  const secs = Math.round((Date.now() - Date.parse(run.since)) / 1000), code = +status || 0;
  const machine = hostInfo();
  logEvent({ event: 'release', ...me, target: run.target, status: code, secs, machine: { ...machine, pagingMBps: pagingRate(run.paged, machine.paged, (Date.now() - Date.parse(run.since)) / 1000) } });
  setBoard(me, { last: `${run.target} ${code === 0 ? 'passed' : `failed (${code})`} (${dur(secs)})` });
  console.log(`Lock: released (${run.target} ${code === 0 ? 'passed' : `failed, exit ${code}`}, ${dur(secs)})`);
  return 0;
}

function readBoard() {
  if (!existsSync(join(DIR, 'board'))) return [];
  return readdirSync(join(DIR, 'board')).map(f => { try { return JSON.parse(readFileSync(join(DIR, 'board', f), 'utf8')); } catch { return null; } }).filter(Boolean);
}
function readLog() {
  if (!existsSync(join(DIR, 'log.jsonl'))) return [];
  return readFileSync(join(DIR, 'log.jsonl'), 'utf8').trim().split('\n').slice(-200).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// The repo the run is in: --repo, else HQ_REPO, else the git checkout the current folder is in, else the folder.
function repoOf(argv) {
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (env.HQ_REPO) return env.HQ_REPO;
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.cwd(); }
}

// hq slot <command>: exits with the command's status (take: 0 taken, 3 busy and not waiting).
export async function main(argv, environment = process.env) {
  env = environment;
  repo = repoOf(argv);
  const i = argv.indexOf('--repo'), [cmd, ...rest] = i >= 0 ? [...argv.slice(0, i), ...argv.slice(i + 2)] : argv;
  const { m } = loadManifest(repo);
  DIR = E('HQ_SLOT_DIR', 'QK_LOCK_DIR') || m.store('lock') || join(m.cache, 'lock');
  // a project's docker run sets HQ_IN_CONTAINER: the host took the slot before it started the container. GitHub sets
  // RUNNER_ENVIRONMENT on every runner: github-hosted, or self-hosted for a runner that shares this machine.
  const hostedCI = !!env.CI && env.RUNNER_ENVIRONMENT !== 'self-hosted';
  const standAside = hostedCI || E('HQ_SLOT', 'QK_LOCK') === '0' || E('HQ_IN_CONTAINER', 'QK_IN_CONTAINER') === '1';
  if (standAside && ['take', 'release', 'claim', 'unclaim'].includes(cmd)) process.exit(0);
  mkdirSync(DIR, { recursive: true });
  const me = identity(null);
  if (cmd === 'take') process.exit(await takeSlot(rest[0]));
  else if (cmd === 'release') process.exit(releaseSlot(rest[0], rest[1]));
  else if (cmd === 'status') {
    if (!rest.join(' ').trim()) { console.log(whoText({ run: read('run.json'), claim: read('claim.json'), board: readBoard(), log: readLog(), now: Date.now(), alive, queue: liveQueue(), exists: existsSync })); console.log('\n(hq slot status "what you are doing" posts your own line)'); }
    else { setBoard(me, { msg: rest.join(' '), msgAt: new Date().toISOString() }); console.log(`Status: ${rest.join(' ')}`); }
  } else if (cmd === 'claim') {
    const msg = rest.join(' ').trim() || 'a few runs in a row', now = new Date().toISOString();
    // A live run that is someone else's means the slot is not free to keep: refuse, as a take that will not wait does. The
    // caller's own run, one whose process has gone, and an unreadable record do not stop a claim (take clears the last two).
    const run = read('run.json');
    if (run && !run.unreadable && !sameOwner(run, me) && runAlive(run)) {
      console.log(`Not claimed: ${who(run)} is running ${run.target} (since ${clock(run.since)}, ${ago(run.since, Date.now())} min). Try again when it ends (hq slot who).`);
      process.exit(3);
    }
    if (publish('claim.json', { ...me, msg, since: now, renewed: now })) {
      logEvent({ event: 'claim', ...me, msg });
      console.log(`Claimed: "${msg}". hq slot unclaim lets it go${me.claudePid ? '; it also ends with this session' : '; nothing else ends it'}.`);
      // nothing Claude Code gives a command tells the agents of one session apart, so without HQ_AGENT they all hold this claim
      if (me.session && !me.agent) console.log('Every agent of this Claude session counts as the claimer, since HQ_AGENT is not set. An agent started by another agent puts HQ_AGENT=<its name> before each command.');
    } else { const c = read('claim.json'); const ours = c && !c.unreadable && sameOwner(c, me); console.log(ours ? 'Already claimed by you.' : `Already claimed by ${c && !c.unreadable ? `${who(c)}: "${c.msg}"` : 'an unreadable record (hq slot unclaim force clears it)'}. hq slot who for more.`); process.exit(ours ? 0 : 3); }
  } else if (cmd === 'unclaim') {
    const c = read('claim.json'), ours = c && !c.unreadable && sameOwner(c, me);
    if (!c) console.log('No claim to release.');
    else if (ours || rest[0] === 'force') { if (moveAside('claim.json', c)) { logEvent({ event: 'unclaim', ...me, of: c.session || c.person || 'unreadable' }); console.log(`Released the claim${c.msg ? ` "${c.msg}"` : ''}.`); } }
    else { console.log(`The claim is ${who(c)}'s ("${c.msg}"). ${c.session && c.session === me.session ? `If it has finished: ${releaseFor(c)}` : 'hq slot unclaim force takes it away'}.`); process.exit(3); }
  } else if (cmd === 'who') {
    console.log(whoText({ run: read('run.json'), claim: read('claim.json'), board: readBoard(), log: readLog(), now: Date.now(), alive, queue: liveQueue(), exists: existsSync }));
    const containers = testContainers();
    if (containers.length) console.log(`\nTest containers running: ${containers.map(c => `${c.name} (${c.worktree || '?'}, ${c.runningFor})`).join(', ')}`);
  } else if (cmd === '--help' || cmd === 'help' || argv.includes('--help')) {
    console.log('Usage: hq slot take <name> | release <name> <exit status> | who | status [msg] | claim [why] | unclaim [force]\nOne test run at a time on this machine. LOCK_WAIT=0 fails at once instead of waiting; HQ_SLOT=0 stands aside.');
  } else { console.error('Usage: hq slot take <name> | release <name> <exit status> | who | status [msg] | claim [why] | unclaim [force]'); process.exit(2); }
}
