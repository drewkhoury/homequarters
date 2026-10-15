// Proves: waiters get the slot in the order they came, a take that will not wait does not jump the queue, a waiter stopped
// before its turn gives up its place and logs that it left, and a session holding a claim goes ahead. Why: without a queue
// a waiter that asks often wins every time; on 27 September one run waited 20 minutes without a turn. These spawn waiting
// processes and are the slot's slower tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideTake, whoText, waitLimit, sameOwner, SLOT_V } from '../lib/slot.mjs';
import { HQ, NOW, MIN, at, me, them, living, take, lockCli, scratch, shell, waiter, eventCount, until, holderTarget, logOf, sibling, dockerStub, rawCli } from './slot-helpers.mjs';

// The slot goes to whoever has waited longest. Without a queue, a waiter that asks often, or a run that takes again the
// moment it releases, wins every time: on 27 September one run waited 20 minutes without a turn.

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
