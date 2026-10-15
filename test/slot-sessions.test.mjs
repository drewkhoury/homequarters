// Proves: `hq slot` run for real against a throwaway lock folder: two sessions asking at once get one slot, a release is
// logged with its result and the machine's load, a dead holder is taken over, claims are kept to the newest ten, hosted
// CI and containers stand aside, and the agents of one Claude session keep claims and status lines apart. Why: the slot
// exists for several sessions on one laptop; each of these was once a clash between two of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideTake, whoText, waitLimit, sameOwner, SLOT_V } from '../lib/slot.mjs';
import { HQ, NOW, MIN, at, me, them, living, take, lockCli, scratch, shell, waiter, eventCount, until, holderTarget, logOf, sibling, dockerStub, rawCli } from './slot-helpers.mjs';

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
