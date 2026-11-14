// Proves: a project adds its own fields to the slot's run record and log lines with `hq slot take ... --extra '<json>'`
// or HQ_SLOT_EXTRA (HQ_SLOT_EXTRA), never over the slot's own fields, and a value that is not a JSON object is left out
// with a warning while the take still goes ahead.
// Why: QuestKeep's next slot field should need no HQ release (the plan's Rule 2), and a project's typo in its extra must
// not stop its test runs or break the slot's own bookkeeping (the process, the session, the time taken).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lockCli, scratch, shell, logOf } from './slot-helpers.mjs';

const runJson = dir => JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
// A field QuestKeep might add next: which cloud pool a split run's other half went to.
const POOL = { pool: 'vm-pool-2', lanesAsked: 4 };

test('--extra on a take puts the project\'s fields in run.json and the take line, and the target stays the target', async t => {
  const dir = scratch(t), sh = shell(t);
  const r = await lockCli(t, dir, ['take', 'gate', '--extra', JSON.stringify(POOL)], { HQ_SLOT_PID: String(sh.pid) });
  assert.equal(r.code, 0, r.text);
  const run = runJson(dir), take = logOf(dir).find(e => e.event === 'take');
  assert.equal(run.target, 'gate');
  for (const rec of [run, take]) assert.deepEqual({ pool: rec.pool, lanesAsked: rec.lanesAsked }, POOL);
});

test('HQ_SLOT_EXTRA reaches the take and the release, and --extra wins a key over it', async t => {
  for (const name of ['HQ_SLOT_EXTRA']) {
    const dir = scratch(t), sh = shell(t), env = { HQ_SLOT_PID: String(sh.pid), [name]: JSON.stringify(POOL) };
    assert.equal((await lockCli(t, dir, ['take', 'gate', '--extra', '{"pool":"vm-pool-9"}'], env)).code, 0);
    assert.equal(runJson(dir).pool, 'vm-pool-9', `${name}: the flag wins`);
    assert.equal(runJson(dir).lanesAsked, 4, `${name}: the environment's other key stays`);
    assert.equal((await lockCli(t, dir, ['release', 'gate', '0'], env)).code, 0);
    assert.equal(logOf(dir).find(e => e.event === 'release').pool, 'vm-pool-2', `${name}: on the release line`);
  }
});

test('an extra never replaces the slot\'s own fields', async t => {
  const dir = scratch(t), sh = shell(t);
  assert.equal((await lockCli(t, dir, ['take', 'gate', '--extra', '{"pid":1,"target":"other","since":"never","event":"x"}'], { HQ_SLOT_PID: String(sh.pid) })).code, 0);
  const run = runJson(dir), take = logOf(dir).find(e => e.event === 'take');
  assert.equal(run.pid, sh.pid); assert.equal(run.target, 'gate'); assert.notEqual(run.since, 'never');
  assert.equal(take.target, 'gate');
  // the release finds the run as its own, so the pid really was kept
  assert.equal((await lockCli(t, dir, ['release', 'gate', '0'], { HQ_SLOT_PID: String(sh.pid) })).code, 0);
  assert.equal(logOf(dir).filter(e => e.event === 'release').length, 1);
});

test('an extra that is not a JSON object is left out with a warning, and the take goes ahead', async t => {
  for (const [how, env, args] of [
    ['a list in --extra', {}, ['--extra', '[1,2]']],
    ['bad JSON in --extra', {}, ['--extra', '{pool']],
    ['a string in HQ_SLOT_EXTRA', { HQ_SLOT_EXTRA: '"vm-pool-2"' }, []],
  ]) {
    const dir = scratch(t), sh = shell(t);
    const r = await lockCli(t, dir, ['take', 'gate', ...args], { HQ_SLOT_PID: String(sh.pid), ...env });
    assert.equal(r.code, 0, how);
    assert.match(r.text, /extra.*(JSON object|not JSON).*left out/i, how);
    assert.equal(runJson(dir).target, 'gate', how);
    assert.equal('pool' in runJson(dir), false, how);
  }
});
