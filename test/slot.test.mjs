// Proves: hq slot hands the test slot to one run at a time, lets a session claim it across several runs, takes it back
// from a holder that died, queues waiters in the order they came, and says who has it and why; and every line it logs
// carries v. Why: several sessions (Claude's or a person's) want one machine's browser and CPU at once, and two gates
// together starve each other. These tests pin the decisions with fake processes and clocks, then run the command for
// real against a throwaway lock folder. The ones that read a project's Makefile stayed with QuestKeep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideTake, whoText, waitLimit, sameOwner, SLOT_V } from '../lib/slot.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HQ = [join(root, 'bin/hq.mjs'), 'slot'];
const NOW = Date.parse('2026-09-27T06:00:00Z'), MIN = 60000;
const at = mins => new Date(NOW - mins * MIN).toISOString();
const me = { session: 'aaaa1111', pid: 100, claudePid: 10, worktree: 'questkeep-deploy', branch: 'ci/pr-reuse', target: 'docker-test' };
const them = { session: 'bbbb2222', pid: 200, claudePid: 20, worktree: 'questkeep-core', branch: 'feat/quest-core', target: 'docker-test', since: at(3) };
const living = (...pids) => pid => pids.includes(pid);
const take = over => decideTake({ run: null, claim: null, me, now: NOW, alive: living(10, 20, 200), containers: [], ...over });

test('a free slot is taken', () => {
  assert.equal(take({}).action, 'take');
});

test('a run in progress makes everyone wait, and says whose run and what it is', () => {
  const d = take({ run: them });
  assert.equal(d.action, 'wait'); assert.match(d.why, /questkeep-core/); assert.match(d.why, /docker-test/);
  // the holder's own session too: one session must not run two gates at once
  assert.equal(take({ run: { ...them, session: me.session } }).action, 'wait');
});

test('a run whose process has gone is taken over, and the log will say so', () => {
  const d = take({ run: them, alive: living(10, 20) });
  assert.equal(d.action, 'take'); assert.equal(d.clearRun, true); assert.match(d.why, /ended without releasing/);
});

test('a process number that came back as another process is taken over (its start time differs)', () => {
  const d = take({ run: them, runAlive: () => false });
  assert.equal(d.action, 'take'); assert.equal(d.clearRun, true);
});

test('a live holder is never taken over however long it has run, as on a laptop that slept through its gate', () => {
  assert.equal(take({ run: { ...them, since: at(600) }, runAlive: () => true }).action, 'wait');
});

test('an unreadable record (a write cut short) is taken over rather than spun on', () => {
  const d = take({ run: { unreadable: true, raw: '' } });
  assert.equal(d.action, 'take'); assert.equal(d.clearRun, true); assert.match(d.why, /unreadable/);
});

test('a test container still running from an ended run makes the next one wait, with how to stop it', () => {
  const d = take({ containers: [{ name: 'qk-core-docker-test', worktree: 'questkeep-core', target: '_docker-test', runningFor: '6 minutes' }] });
  assert.equal(d.action, 'wait'); assert.match(d.why, /qk-core-docker-test/); assert.match(d.why, /docker stop qk-core-docker-test/);
});

test('a claim holds the slot between its session\'s runs, and lets that session straight through', () => {
  const claim = { session: them.session, claudePid: 20, worktree: 'questkeep-core', branch: 'feat/quest-core', msg: '3 gate runs, then land', since: at(10), renewed: at(2) };
  const d = take({ claim });
  assert.equal(d.action, 'wait'); assert.match(d.why, /3 gate runs, then land/);
  assert.equal(take({ claim: { ...claim, session: me.session, claudePid: 10 } }).action, 'take', 'my own claim');
});

test('a claim by another agent of my own Claude session makes me wait like anyone else\'s', () => {
  const claim = { session: me.session, agent: 'gate-runner', claudePid: 10, worktree: 'questkeep-core', msg: '3 gate runs', since: at(10), renewed: at(2) };
  assert.equal(take({ claim, me: { ...me, agent: 'lock-builder' } }).action, 'wait');
  assert.equal(take({ claim, me }).action, 'wait', 'the session\'s lead, which names no agent');
  assert.equal(take({ claim, me: { ...me, agent: 'gate-runner' } }).action, 'take', 'the agent that claimed');
});

// Proves: a claim left by another agent of my own session says at once whose it is and the command that lets it go.
// Why: an agent shares its session's Claude process, so its claim never ends with it. An agent that stopped without
// hq slot unclaim would hold the slot until the whole session ended, and the waiter was told how only after 45 minutes.
test('a claim left by another agent of my own session says at once which agent and how to let it go', () => {
  const claim = { session: me.session, agent: 'gate-runner', claudePid: 10, worktree: 'questkeep-core', msg: '3 gate runs', since: at(10), renewed: at(2) };
  assert.match(take({ claim }).why, /gate-runner/);
  assert.match(take({ claim }).why, /HQ_AGENT=gate-runner hq slot unclaim/);
  const leads = take({ claim: { ...claim, agent: null }, me: { ...me, agent: 'lock-builder' } }).why;
  assert.match(leads, /your session's lead/i); assert.match(leads, /hq slot unclaim/); assert.doesNotMatch(leads, /HQ_AGENT=/);
});

test('a record is the caller\'s own for the same session and agent, or the same person outside any session', () => {
  const cases = [
    [{ session: 's', agent: 'a' }, { session: 's', agent: 'a' }, true],
    [{ session: 's', agent: 'a' }, { session: 's', agent: 'b' }, false],
    [{ session: 's', agent: 'a' }, { session: 's', agent: null }, false],
    [{ session: 's' }, { session: 's', agent: null }, true], // written before agents were named: no agent key at all
    [{ session: 's', agent: null }, { session: 's' }, true],
    [{ session: 's', agent: 'a' }, { session: 't', agent: 'a' }, false],
    [{ session: null, person: 'drew' }, { session: null, person: 'drew' }, true],
    [{ session: null, person: 'drew' }, { session: 's', person: 'drew' }, false],
    [{ session: null, person: 'drew' }, { session: null, person: 'runner' }, false],
  ];
  for (const [record, caller, own] of cases) assert.equal(sameOwner(record, caller), own, JSON.stringify([record, caller]));
});

test('a claim whose session has ended is dropped', () => {
  const claim = { session: them.session, claudePid: 20, msg: 'x', since: at(10), renewed: at(10) };
  const d = take({ claim, alive: living(10) });
  assert.equal(d.action, 'take'); assert.equal(d.clearClaim, true); assert.match(d.why, /ended/);
});

test('a claim left idle is never dropped silently: waiters are told how long, and past 45 minutes what to run', () => {
  const claim = { session: them.session, claudePid: 20, worktree: 'questkeep-core', msg: 'x', since: at(60), renewed: at(50) };
  const d = take({ claim });
  assert.equal(d.action, 'wait'); assert.match(d.why, /idle 50 min/); assert.match(d.why, /hq slot unclaim force/);
  const fresh = take({ claim: { ...claim, renewed: at(2) } });
  assert.match(fresh.why, /idle 2 min/); assert.doesNotMatch(fresh.why, /unclaim force/, 'a session waiting is not told to break a fresh claim');
  // a person at a terminal can see at once whether it is needed
  assert.match(take({ claim: { ...claim, renewed: at(2) }, me: { ...me, session: null, person: 'drew' } }).why, /hq slot unclaim force/);
});

test('a person\'s claim is named as theirs and waits for hq slot unclaim, since no session ends it', () => {
  const claim = { session: null, claudePid: null, person: 'drew', worktree: 'questkeep', branch: 'main', msg: 'landing quest-core', since: at(200), renewed: at(1) };
  const d = take({ claim });
  assert.equal(d.action, 'wait'); assert.match(d.why, /drew, in questkeep \(main\)/);
});

test('who names the holder, how to reach its session, every session\'s line, and the last runs', () => {
  const text = whoText({
    run: them, claim: { ...them, msg: '3 gate runs, then land', since: at(5), renewed: at(3) },
    board: [
      { session: them.session, claudePid: 20, worktree: 'questkeep-core', branch: 'feat/quest-core', at: at(1), msg: 'gate run 2 of 3', last: 'docker-test passed (3m05s)' },
      { session: 'cccc3333', claudePid: 30, worktree: 'questkeep-sync', branch: 'fix/sync-hardening', at: at(40), msg: 'waiting on the Reset decision' },
    ],
    log: [{ at: at(8), worktree: 'questkeep-core', target: 'docker-test', event: 'release', status: 0, secs: 185 }],
    now: NOW, alive: living(20),
  });
  assert.match(text, /questkeep-core \(feat\/quest-core\)/);
  assert.match(text, /claude --resume bbbb2222/);
  assert.match(text, /3 gate runs, then land/);
  assert.match(text, /gate run 2 of 3/);
  assert.match(text, /questkeep-sync.*\(ended\)/, 'a session whose process is gone is marked');
  assert.match(text, /docker-test\s+passed\s+3m05s/);
  assert.match(whoText({ run: null, claim: null, board: [], log: [], now: NOW, alive: living() }), /free/);
});

// The script itself, against a throwaway lock folder: the part that must be right when two sessions race.
function lockCli(t, dir, args, env = {}) {
  const p = spawn(process.execPath, [...HQ, ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, HQ_SLOT_DIR: dir, HQ_SLOT_POLL_MS: '20', HQ_NO_DOCKER: '1', ...env },
  });
  let text = ''; p.stdout.on('data', d => { text += d; }); p.stderr.on('data', d => { text += d; });
  return new Promise(done => p.on('close', code => done({ code, text })));
}
const scratch = t => { const d = mkdtempSync(join(tmpdir(), 'hq-slot-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('two sessions asking at once: exactly one gets the slot, the other waits', async t => {
  const dir = scratch(t);
  const a = await Promise.all([1, 2].map(i => lockCli(t, dir, ['take', 'docker-test'], { LOCK_WAIT: '0', CLAUDE_CODE_SESSION_ID: `s${i}`, HQ_SLOT_PID: String(process.pid) })));
  assert.deepEqual(a.map(r => r.code).sort(), [0, 3], a.map(r => r.text).join('\n'));
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  assert.equal(run.target, 'docker-test'); assert.equal(run.pid, process.pid);
});

test('the slot is released with the result, and the release is logged', async t => {
  const dir = scratch(t);
  assert.equal((await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(process.pid) })).code, 0);
  const r = await lockCli(t, dir, ['release', 'docker-test', '0'], { HQ_SLOT_PID: String(process.pid) });
  assert.equal(r.code, 0); assert.match(r.text, /released \(docker-test passed/);
  assert.equal(existsSync(join(dir, 'run.json')), false);
  const log = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(log.map(e => e.event), ['take', 'release']);
  assert.deepEqual(log.map(e => e.v), [SLOT_V, SLOT_V], 'every line says which shape it has');
});

// Delivery matches a self-hosted runner's slot wait and load to a gate job. Matched by time it is right only because the
// runner runs one job at a time; with the run's id on each line it is exact. Actions sets GITHUB_RUN_ID and
// GITHUB_RUN_ATTEMPT in every job, and a run outside Actions has neither, so its lines carry neither.
test('a run inside a GitHub Actions job logs that run and attempt on its take and release; one outside logs neither', async t => {
  const dir = scratch(t), env = { HQ_SLOT_PID: String(process.pid), HQ_WHO: 'the laptop runner (test.yml)', GITHUB_RUN_ID: '37391190949', GITHUB_RUN_ATTEMPT: '2' };
  await lockCli(t, dir, ['take', 'docker-test'], env);
  await lockCli(t, dir, ['release', 'docker-test', '0'], env);
  await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(process.pid) });
  const log = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(log.map(e => [e.event, e.ciRun, e.ciAttempt]), [['take', 37391190949, 2], ['release', 37391190949, 2], ['take', undefined, undefined]]);
});

// The slot gives one test run, not a quiet laptop, so the log says what the laptop was doing when each run took and gave
// back the slot: its load, swap and the busiest programs outside the run (lib/machine.mjs).
test('a take and a release log the load of the machine they ran on', async t => {
  const dir = scratch(t);
  await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(process.pid) });
  await lockCli(t, dir, ['release', 'docker-test', '0'], { HQ_SLOT_PID: String(process.pid) });
  const log = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  for (const e of log) {
    assert.equal(typeof e.machine?.load1, 'number', `${e.event} logs the load`);
    assert.ok(e.machine.cores >= 1, `${e.event} logs the cores`);
    assert.ok(Array.isArray(e.machine.top), `${e.event} logs the busiest programs`);
  }
  // how fast the Mac paged while the run held the slot; Linux has no vm_stat, so it says null there
  const release = log.find(e => e.event === 'release');
  if (process.platform === 'darwin') assert.equal(typeof release.machine.pagingMBps?.swapIn, 'number', 'a release on a Mac logs the paging during the run');
  else assert.equal(release.machine.pagingMBps, null, 'a release without vm_stat logs no paging');
});

test('a release from anyone but the holder leaves the slot alone', async t => {
  const dir = scratch(t);
  await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(process.pid) });
  await lockCli(t, dir, ['release', 'docker-test', '0'], { HQ_SLOT_PID: '1' });
  assert.equal(existsSync(join(dir, 'run.json')), true);
});

test('a slot held by a process that has gone is taken over, and the take-over is logged', async t => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...them, pid: 999999, since: new Date().toISOString() }));
  const r = await lockCli(t, dir, ['take', 'docker-test'], { LOCK_WAIT: '0', HQ_SLOT_PID: String(process.pid) });
  assert.equal(r.code, 0, r.text); assert.match(r.text, /ended without releasing/);
  const events = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l).event);
  assert.deepEqual(events, ['takeover', 'take']);
});

// A record judged stale is moved aside rather than deleted, so it can be looked at later; nothing cleared those files, and
// 35 set-aside claims sat in the lock folder by 29 September. The newest ten are kept and the rest go.
test('set-aside claims are kept to the newest ten', async t => {
  const dir = scratch(t), started = Date.now();
  // thirty claims set aside over the last thirty minutes, the oldest first
  const seeded = Array.from({ length: 30 }, (_, i) => `claim.json.stale-4242-${started - (30 - i) * MIN}.json`);
  for (const f of seeded) writeFileSync(join(dir, f), JSON.stringify({ ...them, msg: f }) + '\n');
  // and a claim whose Claude session has ended, which the take moves aside as the thirty-first
  writeFileSync(join(dir, 'claim.json'), JSON.stringify({ ...them, claudePid: 999999, msg: 'a forgotten claim' }) + '\n');
  const r = await lockCli(t, dir, ['take', 'docker-test'], { LOCK_WAIT: '0', HQ_SLOT_PID: String(process.pid) });
  assert.equal(r.code, 0, r.text); assert.match(r.text, /ended with its session/);
  const aside = readdirSync(dir).filter(n => n.startsWith('claim.json.stale-')).sort();
  assert.ok(aside.length <= 10, `the lock folder holds ${aside.length} set-aside claims, more than ten`);
  const kept = aside.map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')).msg);
  assert.ok(kept.includes('a forgotten claim'), `the claim just set aside was kept; kept: ${kept.join(', ')}`);
  for (const f of seeded.slice(-9)) assert.ok(aside.includes(f), `${f}, one of the newest, was kept`);
});

test('a waiting run takes the slot as soon as it is released', async t => {
  const dir = scratch(t);
  await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(process.pid) });
  const waiting = lockCli(t, dir, ['take', 'docker-test-after'], { CLAUDE_CODE_SESSION_ID: 'waiter', HQ_SLOT_PID: String(process.pid) });
  // release only once the waiter has logged that it is waiting, so the order does not depend on how busy the laptop is
  const waitingSeen = () => existsSync(join(dir, 'log.jsonl')) && readFileSync(join(dir, 'log.jsonl'), 'utf8').includes('"event":"wait"');
  for (let i = 0; i < 500 && !waitingSeen(); i++) await new Promise(r => setTimeout(r, 20)); // cap: 10 s, polling the log
  assert.ok(waitingSeen(), 'the waiter logged its wait');
  await lockCli(t, dir, ['release', 'docker-test', '0'], { HQ_SLOT_PID: String(process.pid) });
  const r = await waiting;
  assert.equal(r.code, 0, r.text); assert.match(r.text, /busy/); assert.match(r.text, /taken \(docker-test-after/);
});

// The slot goes to whoever has waited longest. Without a queue, a waiter that asks often, or a run that takes again the
// moment it releases, wins every time: on 27 September one run waited 20 minutes without a turn.
// A stand-in for a run's shell: alive until the test ends, so its process number can stand for a holder or a waiter.
function shell(t) { const p = spawn('sleep', ['300'], { stdio: 'ignore' }); t.after(() => p.kill()); return p; }
// A take that waits, as its own process the test can stop; resolves with its exit code and output.
function waiter(t, dir, target, env) {
  const p = spawn(process.execPath, [...HQ, 'take', target], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, HQ_SLOT_DIR: dir, HQ_SLOT_POLL_MS: '20', HQ_NO_DOCKER: '1', ...env },
  });
  t.after(() => p.kill('SIGKILL'));
  let text = ''; p.stdout.on('data', d => { text += d; }); p.stderr.on('data', d => { text += d; });
  return { p, done: new Promise(r => p.on('close', code => r({ code, text }))) };
}
const eventCount = (dir, event) => (existsSync(join(dir, 'log.jsonl')) ? (readFileSync(join(dir, 'log.jsonl'), 'utf8').match(new RegExp(`"event":"${event}"`, 'g')) || []).length : 0);
async function until(cond, what) {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise(r => setTimeout(r, 20)); // cap: 10 s, polling the lock's files
  assert.ok(cond(), what);
}
const holderTarget = dir => { try { return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).target; } catch { return null; } };

test('waiters get the slot in the order they came, however often the later one asks', { timeout: 30000 }, async t => {
  const dir = scratch(t), h = shell(t), a = shell(t), b = shell(t);
  assert.equal((await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(h.pid) })).code, 0);
  // the first waiter asks once a second, the second fifty times a second
  const first = waiter(t, dir, 'first', { HQ_SLOT_PID: String(a.pid), CLAUDE_CODE_SESSION_ID: 'one', HQ_SLOT_POLL_MS: '1000' });
  await until(() => eventCount(dir, 'wait') >= 1, 'the first waiter is waiting');
  const second = waiter(t, dir, 'second', { HQ_SLOT_PID: String(b.pid), CLAUDE_CODE_SESSION_ID: 'two' });
  await until(() => eventCount(dir, 'wait') >= 2, 'the second waiter is waiting');
  await lockCli(t, dir, ['release', 'docker-test', '0'], { HQ_SLOT_PID: String(h.pid) });
  await until(() => holderTarget(dir) !== null, 'someone took the slot');
  assert.equal(holderTarget(dir), 'first', 'the waiter that came first');
  assert.equal((await first.done).code, 0);
  await lockCli(t, dir, ['release', 'first', '0'], { HQ_SLOT_PID: String(a.pid) });
  const r = await second.done;
  assert.equal(r.code, 0, r.text); assert.match(r.text, /taken \(second/);
});

test('a take that will not wait does not jump the queue', { timeout: 30000 }, async t => {
  const dir = scratch(t), h = shell(t), a = shell(t), c = shell(t);
  await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(h.pid) });
  const first = waiter(t, dir, 'first', { HQ_SLOT_PID: String(a.pid), CLAUDE_CODE_SESSION_ID: 'one', HQ_SLOT_POLL_MS: '1000' });
  await until(() => eventCount(dir, 'wait') >= 1, 'the first waiter is waiting');
  // Pause the first waiter so its once-a-second poll cannot take the freed slot before the jumper asks, however loaded the machine.
  // A paused waiter keeps its place: the queue drops only waiters whose process has ended.
  first.p.kill('SIGSTOP');
  await lockCli(t, dir, ['release', 'docker-test', '0'], { HQ_SLOT_PID: String(h.pid) });
  const jumper = await lockCli(t, dir, ['take', 'jumper'], { HQ_SLOT_PID: String(c.pid), CLAUDE_CODE_SESSION_ID: 'three', LOCK_WAIT: '0' });
  first.p.kill('SIGCONT');
  assert.equal(jumper.code, 3, jumper.text); assert.match(jumper.text, /waiting ahead/);
  assert.equal((await first.done).code, 0);
});

test('a waiter stopped with Ctrl-C, or killed outright, gives up its place', { timeout: 30000 }, async t => {
  const dir = scratch(t), h = shell(t), a = shell(t), b = shell(t), c = shell(t);
  await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(h.pid) });
  const stopped = waiter(t, dir, 'stopped', { HQ_SLOT_PID: String(a.pid), CLAUDE_CODE_SESSION_ID: 'one' });
  await until(() => eventCount(dir, 'wait') >= 1, 'the waiter is waiting');
  stopped.p.kill('SIGINT'); await stopped.done;
  // killed with no chance to tidy up, and its shell gone too
  const killed = waiter(t, dir, 'killed', { HQ_SLOT_PID: String(b.pid), CLAUDE_CODE_SESSION_ID: 'two' });
  await until(() => eventCount(dir, 'wait') >= 2, 'the second waiter is waiting');
  killed.p.kill('SIGKILL'); b.kill(); await killed.done;
  await lockCli(t, dir, ['release', 'docker-test', '0'], { HQ_SLOT_PID: String(h.pid) });
  const r = await lockCli(t, dir, ['take', 'next'], { HQ_SLOT_PID: String(c.pid), CLAUDE_CODE_SESSION_ID: 'three', LOCK_WAIT: '0' });
  assert.equal(r.code, 0, r.text);
});

const logOf = dir => readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

// Proves: a waiter that stops before its turn leaves a line in the log saying who it was, how long it waited and what for.
// Why: the problem register counts the time sessions lose to the slot. A waiter that stopped left no line, so by 10 October
// QuestKeep's log held six give-ups against 18 waiters that had left without a trace. A waiter killed outright still leaves none.
test('a waiter stopped before its turn logs that it left, how long it waited and what for', { timeout: 30000 }, async t => {
  const dir = scratch(t), h = shell(t), a = shell(t);
  await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(h.pid) });
  const stopped = waiter(t, dir, 'stopped', { HQ_SLOT_PID: String(a.pid), CLAUDE_CODE_SESSION_ID: 'one', HQ_AGENT: 'builder' });
  await until(() => eventCount(dir, 'wait') >= 1, 'the waiter is waiting');
  stopped.p.kill('SIGINT'); await stopped.done;
  const left = logOf(dir).filter(e => e.event === 'left');
  assert.equal(left.length, 1, 'one line for the waiter that left');
  assert.equal(left[0].session, 'one'); assert.equal(left[0].agent, 'builder'); assert.equal(left[0].target, 'stopped');
  assert.equal(typeof left[0].secs, 'number');
  assert.match(left[0].for, /docker-test/, 'what it was waiting behind');
});

// Proves: a waiter that gets its turn, or gives up after LOCK_WAIT minutes, logs no left line as well.
// Why: one wait must count once; a give-up already has a line of its own.
test('a waiter that takes the slot or gives up logs no left line', { timeout: 30000 }, async t => {
  const dir = scratch(t), h = shell(t), a = shell(t);
  await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(h.pid) });
  const gaveUp = await lockCli(t, dir, ['take', 'after'], { HQ_SLOT_PID: String(a.pid), LOCK_WAIT: '0.005' });
  assert.equal(gaveUp.code, 3, gaveUp.text);
  const next = waiter(t, dir, 'next', { HQ_SLOT_PID: String(a.pid), CLAUDE_CODE_SESSION_ID: 'one' });
  await until(() => logOf(dir).some(e => e.event === 'wait' && e.target === 'next'), 'the next waiter is waiting');
  await lockCli(t, dir, ['release', 'docker-test', '0'], { HQ_SLOT_PID: String(h.pid) });
  assert.equal((await next.done).code, 0);
  // counts, not order: a release and the next take can be written within milliseconds of each other
  const count = event => logOf(dir).filter(e => e.event === event).length;
  assert.equal(count('left'), 0, 'no left line beside a give-up or a take');
  assert.equal(count('gave-up'), 1);
  assert.equal(count('take'), 2);
});

// Proves: a take that will not wait (LOCK_WAIT=0) and finds the slot busy logs that it was refused, with whose run it met.
// Why: a refusal is a run that did not happen because of the slot, and nothing recorded it, so the register could not count it.
test('a take that will not wait logs its refusal and what it met', async t => {
  const dir = scratch(t), h = shell(t);
  await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(h.pid) });
  const r = await lockCli(t, dir, ['take', 'smoke'], { HQ_SLOT_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: 'two', LOCK_WAIT: '0' });
  assert.equal(r.code, 3, r.text);
  const refused = logOf(dir).filter(e => e.event === 'refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].session, 'two'); assert.equal(refused[0].target, 'smoke');
  assert.match(refused[0].for, /docker-test/);
});

test('a session holding a claim goes ahead of the queue, since the others are waiting for its claim anyway', { timeout: 30000 }, async t => {
  const dir = scratch(t), a = shell(t), s = shell(t);
  const mine = { CLAUDE_CODE_SESSION_ID: 'claimer', CLAUDE_PID: String(process.pid) };
  assert.equal((await lockCli(t, dir, ['claim', 'three runs'], mine)).code, 0);
  const other = waiter(t, dir, 'other', { HQ_SLOT_PID: String(a.pid), CLAUDE_CODE_SESSION_ID: 'one' });
  await until(() => eventCount(dir, 'wait') >= 1, 'the other session waits for the claim');
  const r = await lockCli(t, dir, ['take', 'docker-test'], { ...mine, HQ_SLOT_PID: String(s.pid), LOCK_WAIT: '0' });
  assert.equal(r.code, 0, r.text);
  const who = (await lockCli(t, dir, ['who'])).text;
  assert.match(who, /Waiting: 1\. .*for other, since \d\d:\d\d/);
  other.p.kill('SIGKILL');
});

// Proves: claim does not make a session believe it holds the slot while another session's run is live in it.
// Why: a claim says "the slot is mine across several runs". The claim command only checked for another claim, so a session
// could claim in the middle of someone else's gate, and both then believed the slot was theirs. A live run that is the
// caller's own, or whose process has gone, does not stop a claim: take treats those two the same way.
test('a claim is refused while another session\'s run is live in the slot, and makes no claim', async t => {
  const dir = scratch(t), holder = shell(t);
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...them, pid: holder.pid, since: new Date().toISOString() }));
  const r = await lockCli(t, dir, ['claim', 'three runs'], { CLAUDE_CODE_SESSION_ID: 'claimer', CLAUDE_PID: String(process.pid) });
  assert.equal(r.code, 3, r.text); assert.match(r.text, /questkeep-core/); assert.match(r.text, /docker-test/);
  assert.equal(existsSync(join(dir, 'claim.json')), false, 'no claim was made');
});

test('a claim is made while the claiming session\'s own run is live in the slot', async t => {
  const dir = scratch(t), holder = shell(t);
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...them, session: 'claimer', pid: holder.pid, since: new Date().toISOString() }));
  const r = await lockCli(t, dir, ['claim', 'three runs'], { CLAUDE_CODE_SESSION_ID: 'claimer', CLAUDE_PID: String(process.pid) });
  assert.equal(r.code, 0, r.text); assert.equal(existsSync(join(dir, 'claim.json')), true);
});

test('a claim is made when the slot\'s run has ended without releasing it', async t => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...them, pid: 999999, since: new Date().toISOString() }));
  const r = await lockCli(t, dir, ['claim', 'three runs'], { CLAUDE_CODE_SESSION_ID: 'claimer', CLAUDE_PID: String(process.pid) });
  assert.equal(r.code, 0, r.text); assert.equal(existsSync(join(dir, 'claim.json')), true);
});

test('on hosted CI, inside a container, or with HQ_SLOT=0 the slot stands aside and touches nothing; the QK_ names still work', async t => {
  const dir = scratch(t);
  for (const env of [{ CI: 'true' }, { CI: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }, { HQ_SLOT: '0' }, { HQ_IN_CONTAINER: '1' }, { QK_LOCK: '0' }, { QK_IN_CONTAINER: '1' }]) {
    const r = await lockCli(t, dir, ['take', 'docker-test'], env);
    assert.equal(r.code, 0); assert.equal(r.text, '');
  }
  assert.deepEqual(readdirSync(dir), []);
});

// A self-hosted runner is CI on this machine: its runs share the CPU with everyone else's, so they take their turn, and
// who names the runner rather than the account it runs as.
test('on a self-hosted runner the slot is taken like anywhere else, in the name HQ_WHO gives it', async t => {
  const dir = scratch(t);
  const runner = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted', HQ_WHO: 'the laptop runner (after.yml)', HQ_SLOT_PID: String(process.pid) };
  const r = await lockCli(t, dir, ['take', 'docker-test-after'], runner);
  assert.equal(r.code, 0, r.text); assert.match(r.text, /taken \(docker-test-after/);
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  assert.equal(run.person, 'the laptop runner (after.yml)');
  assert.match((await lockCli(t, dir, ['who'])).text, /the laptop runner \(after\.yml\), in /);
});

test('each session keeps its own status line, so two sessions posting at once never clash', async t => {
  const dir = scratch(t);
  await Promise.all([
    lockCli(t, dir, ['status', 'gate run 2 of 3'], { CLAUDE_CODE_SESSION_ID: 'one', CLAUDE_PID: String(process.pid) }),
    lockCli(t, dir, ['status', 'building S2'], { CLAUDE_CODE_SESSION_ID: 'two', CLAUDE_PID: String(process.pid) }),
  ]);
  const who = (await lockCli(t, dir, ['who'])).text;
  assert.match(who, /gate run 2 of 3/); assert.match(who, /building S2/);
});

// Every agent a Claude Code session starts runs its commands with the session's CLAUDE_CODE_SESSION_ID, and nothing else
// in their environment or process tree tells them apart. HQ_AGENT, which an agent puts on its commands, does.
const sibling = name => ({ CLAUDE_CODE_SESSION_ID: 'shared', CLAUDE_PID: String(process.pid), HQ_AGENT: name });

// Proves: two agents of one Claude session do not share a claim: the second's claim is refused, and its release leaves the
// first's claim in place.
// Why: one agent was told "Already claimed by you" while another agent held the claim, and could have released it.
test('two agents of one session: the second agent\'s claim is refused, and its release leaves the first\'s claim', async t => {
  const dir = scratch(t);
  assert.equal((await lockCli(t, dir, ['claim', 'three runs'], sibling('gate-runner'))).code, 0);
  const second = await lockCli(t, dir, ['claim', 'one smoke'], sibling('lock-builder'));
  assert.equal(second.code, 3, second.text); assert.match(second.text, /gate-runner/); assert.doesNotMatch(second.text, /by you/);
  const release = await lockCli(t, dir, ['unclaim'], sibling('lock-builder'));
  assert.equal(release.code, 3, release.text);
  assert.equal(JSON.parse(readFileSync(join(dir, 'claim.json'), 'utf8')).msg, 'three runs', 'the first agent\'s claim stands');
});

// Proves: another agent's claim in my own session holds my run, and my take leaves that claim as it was.
// Why: a claim renewed by a sibling's take would never look idle.
test('another agent of my session holding a claim makes my run wait, and leaves its claim as it was', async t => {
  const dir = scratch(t), s = shell(t);
  assert.equal((await lockCli(t, dir, ['claim', 'three runs'], sibling('gate-runner'))).code, 0);
  const before = readFileSync(join(dir, 'claim.json'), 'utf8');
  const r = await lockCli(t, dir, ['take', 'docker-test'], { ...sibling('lock-builder'), HQ_SLOT_PID: String(s.pid), LOCK_WAIT: '0' });
  assert.equal(r.code, 3, r.text); assert.match(r.text, /gate-runner/);
  assert.equal(readFileSync(join(dir, 'claim.json'), 'utf8'), before, 'the claim is not renewed by another agent\'s take');
  assert.equal(existsSync(join(dir, 'run.json')), false);
});

test('two agents of one session keep a status line each', async t => {
  const dir = scratch(t);
  await lockCli(t, dir, ['status', 'gate run 2 of 3'], sibling('gate-runner'));
  await lockCli(t, dir, ['status', 'writing the red test'], sibling('lock-builder'));
  const who = (await lockCli(t, dir, ['who'])).text;
  assert.match(who, /gate run 2 of 3/); assert.match(who, /writing the red test/);
});

test('a claim in a Claude session says so when it cannot tell the session\'s agents apart, and not when it can', async t => {
  const lead = await lockCli(t, scratch(t), ['claim', 'three runs'], { CLAUDE_CODE_SESSION_ID: 'shared', CLAUDE_PID: String(process.pid) });
  assert.equal(lead.code, 0, lead.text); assert.match(lead.text, /HQ_AGENT/);
  const agent = await lockCli(t, scratch(t), ['claim', 'three runs'], sibling('gate-runner'));
  assert.equal(agent.code, 0, agent.text); assert.doesNotMatch(agent.text, /HQ_AGENT/);
});

// A stand-in for docker on PATH: answers 'ps' with the rows given for the labelled query and for the image query, after a
// random pause of up to maxMs, which is what makes a race between two takers show up if there is one.
function dockerStub(t, { labelled = '', byImage = '', maxMs = 0 } = {}) {
  const dir = scratch(t);
  writeFileSync(join(dir, 'labelled'), labelled); writeFileSync(join(dir, 'byImage'), byImage);
  writeFileSync(join(dir, 'docker'), `#!/bin/sh
sleep $(awk 'BEGIN{srand(); printf "%.3f", rand()*${maxMs}/1000}')
case "$*" in *label=hq.test*) cat "${dir}/labelled";; *label=qk.test*) ;; *ancestor=*) cat "${dir}/byImage";; esac
`);
  chmodSync(join(dir, 'docker'), 0o755);
  return { PATH: `${dir}:${process.env.PATH}`, HQ_NO_DOCKER: '', HQ_TEST_IMAGE: 'questkeep-test:pw1.63.0' };
}

test('a labelled test container still running makes a take wait, through the real docker check', async t => {
  const dir = scratch(t);
  const r = await lockCli(t, dir, ['take', 'docker-test'], { LOCK_WAIT: '0', ...dockerStub(t, { labelled: 'qk_core_gate\t_docker-test\tquestkeep-core\t6 minutes ago\n' }) });
  assert.equal(r.code, 3, r.text); assert.match(r.text, /qk_core_gate/); assert.match(r.text, /docker stop qk_core_gate/);
});

test('a test container from a checkout without the labels is seen too, by its image and command', async t => {
  const dir = scratch(t);
  // docker lists the screenshots folder first, as it did for quest-core's gate on 27 September
  const row = `old_gate\t\tsh -c make --no-print-directory browser; make serve >/dev/null && make _test\t2 minutes ago\t/Users/drew/repos/questkeep-core/.shots,qk-node,/Users/drew/repos/questkeep-core\n`;
  const r = await lockCli(t, dir, ['take', 'docker-test'], { LOCK_WAIT: '0', ...dockerStub(t, { byImage: row }) });
  assert.equal(r.code, 3, r.text); assert.match(r.text, /old_gate/); assert.match(r.text, /questkeep-core's test container/);
  const shell = `a_shell\t\tbash\t2 minutes ago\t/Users/drew/repos/questkeep-core\n`;
  assert.equal((await lockCli(t, dir, ['take', 'docker-test'], { LOCK_WAIT: '0', ...dockerStub(t, { byImage: shell }) })).code, 0, 'a shell or docker-up is not a test run');
});

test('two takers over a dead holder, with a slow docker: never both get the slot', async t => {
  for (let i = 0; i < 8; i++) {
    const dir = scratch(t);
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...them, pid: 999999, since: new Date().toISOString() }));
    const env = { LOCK_WAIT: '0', ...dockerStub(t, { maxMs: 300 }), HQ_SLOT_PID: String(process.pid) };
    const codes = (await Promise.all(['a', 'b'].map(s => lockCli(t, dir, ['take', 'docker-test'], { ...env, CLAUDE_CODE_SESSION_ID: s })))).map(r => r.code).sort();
    assert.deepEqual(codes, [0, 3], `round ${i}`);
  }
});

test('an empty run.json left by a cut-short write does not hang a take', async t => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'run.json'), '');
  const r = await lockCli(t, dir, ['take', 'docker-test'], { LOCK_WAIT: '0', HQ_SLOT_PID: String(process.pid) });
  assert.equal(r.code, 0, r.text); assert.match(r.text, /unreadable/);
});

test('a take-over marks the dead holder\'s board line, so its last result is not left looking current', async t => {
  const dir = scratch(t);
  await lockCli(t, dir, ['status', 'gate run 1 of 3'], { CLAUDE_CODE_SESSION_ID: them.session, CLAUDE_PID: '20' });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...them, pid: 999999, since: new Date().toISOString() }));
  await lockCli(t, dir, ['take', 'docker-test'], { HQ_SLOT_PID: String(process.pid) });
  assert.match((await lockCli(t, dir, ['who'])).text, /docker-test ended without releasing/);
});

// A stale record that cannot be moved aside (here, a lock folder the waiter may not write to) used to send the waiter
// straight round its loop with no pause, at full CPU for as long as it waited (backlog, 27 September). It now waits a
// poll between tries. Root may write anywhere, so the folder cannot refuse it, and the test has nothing to show there.
test('a stale record that cannot be moved aside is retried a poll apart, not in a tight loop', { timeout: 20000 }, async t => {
  if (process.getuid && process.getuid() === 0) { t.skip('root can move the record whatever the folder allows'); return; }
  const dir = scratch(t);
  mkdirSync(join(dir, 'queue'));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...them, pid: 999999, since: new Date().toISOString() }));
  chmodSync(dir, 0o555);
  const p = spawn(process.execPath, [...HQ, 'take', 'docker-test'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, HQ_SLOT_DIR: dir, HQ_SLOT_POLL_MS: '200', HQ_NO_DOCKER: '1', HQ_SLOT_PID: String(process.pid) },
    stdio: 'ignore',
  });
  // a waiter that spins never reaches its own signal handlers, so it is stopped with SIGKILL, here and not later
  const secs = s => { const [m, rest] = s.trim().split(':'); return +m * 60 + +rest; };
  let cpu;
  try {
    await new Promise(r => setTimeout(r, 2000)); // cap: two seconds of waiting, long enough to tell a spin from a poll
    cpu = secs(execFileSync('ps', ['-o', 'time=', '-p', String(p.pid)], { encoding: 'utf8' }));
  } finally { p.kill('SIGKILL'); chmodSync(dir, 0o755); }
  assert.ok(cpu < 1, `the waiter used ${cpu} s of CPU in 2 s of waiting`);
});

// who reads a session's line from the board. Each piece it shows has to be as fresh as it looks.
const boardLine = over => ({ session: 'cccc3333', claudePid: 30, worktree: 'questkeep-sync', branch: 'fix/sync', at: at(2), ...over });
const who1 = (row, extra = {}) => whoText({ run: null, claim: null, board: [row], log: [], now: NOW, alive: living(30), ...extra });

test('who names the person a line belongs to, so a runner does not read as someone\'s checkout', () => {
  const text = who1(boardLine({ session: null, claudePid: null, person: 'the laptop runner (after.yml)', worktree: 'questkeep', branch: 'HEAD' }));
  assert.match(text, /the laptop runner \(after\.yml\), in questkeep/);
});

test('who shows when a status message was posted, apart from the session\'s last run', () => {
  const text = who1(boardLine({ at: at(2), msg: 'AFK work done', msgAt: at(300) }));
  assert.match(text, /AFK work done \(posted \d\d:\d\d\)/);
});

test('who says when the checkout a line names no longer exists', () => {
  assert.match(who1(boardLine({ path: '/gone/questkeep-sync' }), { exists: p => p !== '/gone/questkeep-sync' }), /questkeep-sync.*\(checkout removed\)/);
  assert.doesNotMatch(who1(boardLine({ path: '/here/questkeep-sync' }), { exists: () => true }), /checkout removed/);
});

test('taking the slot moves a session\'s line to the checkout it is in now, and a status keeps its own time and person', async t => {
  const dir = scratch(t);
  mkdirSync(join(dir, 'board'));
  writeFileSync(join(dir, 'board', 'dddd4444.json'), JSON.stringify(boardLine({ session: 'dddd4444', worktree: 'questkeep-gone', branch: 'fix/old', path: '/gone' })));
  assert.equal((await lockCli(t, dir, ['take', 'docker-test'], { CLAUDE_CODE_SESSION_ID: 'dddd4444', HQ_SLOT_PID: String(process.pid) })).code, 0);
  const line = JSON.parse(readFileSync(join(dir, 'board', 'dddd4444.json'), 'utf8'));
  assert.notEqual(line.worktree, 'questkeep-gone'); assert.notEqual(line.path, '/gone');
  await lockCli(t, dir, ['status', 'nightly'], { HQ_WHO: 'the laptop runner (after.yml)', USER: 'runner' });
  const runner = JSON.parse(readFileSync(join(dir, 'board', 'person-the_laptop_runner__after.yml_.json'), 'utf8'));
  assert.equal(runner.person, 'the laptop runner (after.yml)'); assert.ok(runner.msgAt, 'the message keeps its own time');
});

test('LOCK_WAIT: unset waits for good, 0 not at all, and a number of minutes that long', () => {
  assert.equal(waitLimit(undefined), null);
  assert.equal(waitLimit(''), null);
  assert.equal(waitLimit('0'), 0);
  assert.equal(waitLimit('20'), 20 * 60000);
  assert.equal(waitLimit('0.5'), 30000);
  assert.equal(waitLimit('soon'), null, 'a value that is not a number waits as if unset');
  assert.equal(waitLimit('-1'), null);
});

test('a run given LOCK_WAIT minutes gives up once they pass, says so, and leaves the queue', async t => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...them, pid: process.pid, since: new Date().toISOString() }));
  const r = await lockCli(t, dir, ['take', 'docker-test-after'], { LOCK_WAIT: '0.005', HQ_SLOT_PID: '1' });
  assert.equal(r.code, 3, r.text);
  assert.match(r.text, /Giving up \(LOCK_WAIT=0\.005 minutes\)/);
  assert.deepEqual(existsSync(join(dir, 'queue')) ? readdirSync(join(dir, 'queue')) : [], []);
});

// ---- the adversary's survivors, 15 October: the fallbacks nothing exercised ----
// A take by a process whose environment names the folder the QuestKeep way, and names its agent and process the same way.
const rawCli = (t, args, env) => {
  const p = spawn(process.execPath, [...HQ, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, HQ_SLOT_POLL_MS: '20', ...env } });
  let text = ''; p.stdout.on('data', d => { text += d; }); p.stderr.on('data', d => { text += d; });
  return new Promise(done => p.on('close', code => done({ code, text })));
};

test('the QK_ names QuestKeep set still work for one release: the folder, the agent, the process, who, no docker', async t => {
  const dir = scratch(t);
  const r = await rawCli(t, ['take', 'docker-test'], { QK_LOCK_DIR: dir, QK_NO_DOCKER: '1', QK_LOCK_PID: String(process.pid), QK_AGENT: 'gate-runner', CLAUDE_CODE_SESSION_ID: 's1' });
  assert.equal(r.code, 0, r.text);
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  assert.equal(run.pid, process.pid, 'QK_LOCK_PID'); assert.equal(run.agent, 'gate-runner', 'QK_AGENT');
  // a run outside any Claude session is a person's, named the QuestKeep way
  const who = await rawCli(t, ['status', 'posting'], { QK_LOCK_DIR: dir, QK_NO_DOCKER: '1', QK_WHO: 'the laptop runner' });
  assert.equal(who.code, 0, who.text);
  assert.ok(readdirSync(join(dir, 'board')).some(b => JSON.parse(readFileSync(join(dir, 'board', b), 'utf8')).person === 'the laptop runner'), 'QK_WHO');
  const hq = await rawCli(t, ['release', 'docker-test', '0'], { QK_LOCK_DIR: dir, HQ_SLOT_DIR: dir, QK_NO_DOCKER: '1', HQ_SLOT_PID: String(process.pid), QK_LOCK_PID: '1', HQ_AGENT: 'gate-runner', QK_AGENT: 'other', CLAUDE_CODE_SESSION_ID: 's1' });
  assert.equal(hq.code, 0, `the HQ_ name wins over the QK_ one: ${hq.text}`);
  assert.equal(existsSync(join(dir, 'run.json')), false);
});

test('with no folder named, the slot is the manifest\'s lock store, under the repo\'s cache', async t => {
  const repo = scratch(t), cache = join(repo, 'cache');
  writeFileSync(join(repo, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'doors', cache, stores: ['lock'] }));
  const r = await rawCli(t, ['take', 'docker-test', '--repo', repo], { HQ_NO_DOCKER: '1', HQ_SLOT_PID: String(process.pid) });
  assert.equal(r.code, 0, r.text);
  assert.equal(existsSync(join(cache, 'lock', 'run.json')), true, 'run.json under <cache>/lock');
  const moved = scratch(t);
  writeFileSync(join(repo, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'doors', cache, stores: [{ id: 'lock', path: moved }] }));
  const r2 = await rawCli(t, ['take', 'docker-test', '--repo', repo], { HQ_NO_DOCKER: '1', HQ_SLOT_PID: String(process.pid), LOCK_WAIT: '0' });
  assert.equal(r2.code, 0, `a store with its own path is the slot: ${r2.text}`);
  assert.equal(existsSync(join(moved, 'run.json')), true);
});

test('unclaim force takes away another session\'s claim; without force it is refused and says so', async t => {
  const dir = scratch(t);
  assert.equal((await lockCli(t, dir, ['claim', 'three runs'], { CLAUDE_CODE_SESSION_ID: 'a', CLAUDE_PID: String(process.pid) })).code, 0);
  const refused = await lockCli(t, dir, ['unclaim'], { CLAUDE_CODE_SESSION_ID: 'b', CLAUDE_PID: String(process.pid) });
  assert.equal(refused.code, 3, refused.text); assert.match(refused.text, /hq slot unclaim force/);
  assert.equal(existsSync(join(dir, 'claim.json')), true);
  const forced = await lockCli(t, dir, ['unclaim', 'force'], { CLAUDE_CODE_SESSION_ID: 'b', CLAUDE_PID: String(process.pid) });
  assert.equal(forced.code, 0, forced.text);
  assert.equal(existsSync(join(dir, 'claim.json')), false);
  const log = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(log.at(-1).event, 'unclaim'); assert.equal(log.at(-1).of, 'a');
});

test('the claimer\'s own take renews its claim, so a session running gate after gate never looks idle', async t => {
  const dir = scratch(t), me = { CLAUDE_CODE_SESSION_ID: 'a', CLAUDE_PID: String(process.pid), HQ_SLOT_PID: String(process.pid) };
  assert.equal((await lockCli(t, dir, ['claim', 'three runs'], me)).code, 0);
  const before = JSON.parse(readFileSync(join(dir, 'claim.json'), 'utf8'));
  await new Promise(r => setTimeout(r, 30)); // cap: so the take's stamp can differ from the claim's
  assert.equal((await lockCli(t, dir, ['take', 'docker-test'], me)).code, 0);
  const after = JSON.parse(readFileSync(join(dir, 'claim.json'), 'utf8'));
  assert.ok(after.renewed && Date.parse(after.renewed) > Date.parse(before.renewed || before.since), 'renewed at the take');
  assert.equal(after.msg, 'three runs');
});
