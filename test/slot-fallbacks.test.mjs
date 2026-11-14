// Proves: from 0.3.0 the slot reads none of the QK_ names QuestKeep set, the lock store defaults to the manifest's cache, unclaim
// force takes another session's claim, and the claimer's own take renews its claim. Why: the adversary's survivors of
// 15 October, the fallbacks nothing exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideTake, whoText, waitLimit, sameOwner, SLOT_V } from '../lib/slot.mjs';
import { HQ, NOW, MIN, at, me, them, living, take, lockCli, scratch, shell, waiter, eventCount, until, holderTarget, logOf, sibling, dockerStub, rawCli } from './slot-helpers.mjs';

test('from 0.3.0 the slot reads none of the QK_ names: the agent, the process and who come from HQ_ names alone', async t => {
  const dir = scratch(t);
  const r = await rawCli(t, ['take', 'docker-test'], { HQ_SLOT_DIR: dir, HQ_NO_DOCKER: '1', HQ_SLOT_PID: String(process.pid), QK_LOCK_PID: '1', QK_AGENT: 'gate-runner', CLAUDE_CODE_SESSION_ID: 's1' });
  assert.equal(r.code, 0, r.text);
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  assert.equal(run.pid, process.pid, 'HQ_SLOT_PID, not QK_LOCK_PID'); assert.equal(run.agent, null, 'QK_AGENT is not read');
  const who = await rawCli(t, ['status', 'posting'], { HQ_SLOT_DIR: dir, HQ_NO_DOCKER: '1', QK_WHO: 'the laptop runner' });
  assert.equal(who.code, 0, who.text);
  assert.ok(!readdirSync(join(dir, 'board')).some(b => JSON.parse(readFileSync(join(dir, 'board', b), 'utf8')).person === 'the laptop runner'), 'QK_WHO is not read');
  assert.equal((await rawCli(t, ['release', 'docker-test', '0'], { HQ_SLOT_DIR: dir, HQ_NO_DOCKER: '1', HQ_SLOT_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: 's1' })).code, 0);
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
  const r2 = await rawCli(t, ['take', 'docker-test', '--repo', repo], { HQ_NO_DOCKER: '1', HQ_SLOT_PID: String(process.pid), HQ_SLOT_WAIT: '0' });
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
