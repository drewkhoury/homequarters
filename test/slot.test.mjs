// Proves: hq slot decides who gets the test slot from fake processes and clocks (a free slot, a live holder, a dead one,
// a claim, a container), and who's text and the HQ_SLOT_WAIT reading say what a person needs. Why: these are the decisions
// behind every take; pinned here with no process spawned, they run in milliseconds. The slot's other files run the
// command for real against a throwaway lock folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideTake, whoText, waitLimit, sameOwner, SLOT_V } from '../lib/slot.mjs';
import { HQ, NOW, MIN, at, me, them, living, take, lockCli, scratch, shell, waiter, eventCount, until, holderTarget, logOf, sibling, dockerStub, rawCli } from './slot-helpers.mjs';

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

test('HQ_SLOT_WAIT: unset waits for good, 0 not at all, and a number of minutes that long', () => {
  assert.equal(waitLimit(undefined), null);
  assert.equal(waitLimit(''), null);
  assert.equal(waitLimit('0'), 0);
  assert.equal(waitLimit('20'), 20 * 60000);
  assert.equal(waitLimit('0.5'), 30000);
  assert.equal(waitLimit('soon'), null, 'a value that is not a number waits as if unset');
  assert.equal(waitLimit('-1'), null);
});

test('a run given HQ_SLOT_WAIT minutes gives up once they pass, says so, and leaves the queue', async t => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...them, pid: process.pid, since: new Date().toISOString() }));
  const r = await lockCli(t, dir, ['take', 'docker-test-after'], { HQ_SLOT_WAIT: '0.005', HQ_SLOT_PID: '1' });
  assert.equal(r.code, 3, r.text);
  assert.match(r.text, /Giving up \(HQ_SLOT_WAIT=0\.005 minutes\)/);
  assert.deepEqual(existsSync(join(dir, 'queue')) ? readdirSync(join(dir, 'queue')) : [], []);
});
