// Proves: a test container still running makes a take wait, found through a stand-in docker by label or by image; two
// takers over a dead holder with a slow docker never both get the slot (HQ_RACE_ROUNDS rounds, one by default); an empty
// or immovable stale record neither hangs nor spins a waiter. Why: the slot's atomic step is read-then-move, and docker
// is the slow call between them; the race test samples that gap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideTake, whoText, waitLimit, sameOwner, SLOT_V } from '../lib/slot.mjs';
import { HQ, NOW, MIN, at, me, them, living, take, lockCli, scratch, shell, waiter, eventCount, until, holderTarget, logOf, sibling, dockerStub, rawCli } from './slot-helpers.mjs';

test('a labelled test container still running makes a take wait, through the real docker check', async t => {
  const dir = scratch(t);
  const r = await lockCli(t, dir, ['take', 'docker-test'], { LOCK_WAIT: '0', ...dockerStub(t, { labelled: 'qk_core_gate\t_docker-test\tquestkeep-core\t6 minutes ago\n' }) });
  assert.equal(r.code, 3, r.text); assert.match(r.text, /qk_core_gate/); assert.match(r.text, /docker stop qk_core_gate/);
});

test('a test container from a checkout without the labels is seen too, by its image and command', async t => {
  const dir = scratch(t);
  // docker lists the screenshots folder first, as it did for quest-core's gate on 27 September
  const row = `old_gate\t\tsh -c make --no-print-directory browser; make serve >/dev/null && make _test\t2 minutes ago\t/Users/dev/repos/questkeep-core/.shots,qk-node,/Users/dev/repos/questkeep-core\n`;
  const r = await lockCli(t, dir, ['take', 'docker-test'], { LOCK_WAIT: '0', ...dockerStub(t, { byImage: row }) });
  assert.equal(r.code, 3, r.text); assert.match(r.text, /old_gate/); assert.match(r.text, /questkeep-core's test container/);
  const shell = `a_shell\t\tbash\t2 minutes ago\t/Users/dev/repos/questkeep-core\n`;
  assert.equal((await lockCli(t, dir, ['take', 'docker-test'], { LOCK_WAIT: '0', ...dockerStub(t, { byImage: shell }) })).code, 0, 'a shell or docker-up is not a test run');
});

// One round in `npm test`: the race is the same each time, and more rounds only sample more interleavings of the stub's
// random pause. Before a publish, HQ_RACE_ROUNDS=5 buys those samples (Hollis, twice).
const ROUNDS = Math.max(1, +(process.env.HQ_RACE_ROUNDS || 1));
test(`two takers over a dead holder, with a slow docker: never both get the slot (${ROUNDS} round${ROUNDS === 1 ? '' : 's'})`, async t => {
  for (let i = 0; i < ROUNDS; i++) {
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
