// Proves: a slot take and release record what the run was asked to do (its test list, whether its results feed a check
// or a deploy, its kind and a placement override), under HQ_ names and QuestKeep's QK_ names, and nothing when unset.
// Why: QuestKeep's cloud placement replay rebuilds each run from the slot log, and it reads these four fields; main's
// scripts/lock.mjs gained them after the package forked (3c09989d2, 8cc491671).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lockCli, scratch, shell, logOf } from './slot-helpers.mjs';

// What QuestKeep's Makefile sets for a long set run on the laptop that feeds a deploy: the list, HQ_JUNIT, the kind, a placement.
const ASKED = { tests: ['sync-offline', 'island-stamps'], junit: true, kind: 'deploy', place: 'home' };
const runJson = dir => JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));

async function takeAndRelease(t, env) {
  const dir = scratch(t), sh = shell(t), pid = { HQ_SLOT_PID: String(sh.pid) };
  assert.equal((await lockCli(t, dir, ['take', 'gate'], { ...pid, ...env })).code, 0);
  const run = runJson(dir);
  assert.equal((await lockCli(t, dir, ['release', 'gate', '0'], { ...pid, ...env })).code, 0);
  const log = logOf(dir);
  return { run, take: log.find(e => e.event === 'take'), release: log.find(e => e.event === 'release') };
}

test('a take and a release carry the run\'s tests, junit, kind and place from HQ_ names', async t => {
  const r = await takeAndRelease(t, { HQ_RUN_TESTS: ' sync-offline  island-stamps ', HQ_JUNIT: '1', HQ_KIND: 'deploy', HQ_PLACE: 'home' });
  for (const rec of [r.run, r.take, r.release]) for (const [k, v] of Object.entries(ASKED)) assert.deepEqual(rec[k], v, `${k} in ${rec.event || 'run.json'}`);
});

test('QuestKeep\'s old names (QK_RUN_TESTS, JUNIT, QK_KIND, QK_PLACE) are not read from 0.3.0', async t => {
  const r = await takeAndRelease(t, { QK_RUN_TESTS: 'sync-offline island-stamps', JUNIT: '1', QK_KIND: 'deploy', QK_PLACE: 'home' });
  for (const rec of [r.run, r.take, r.release]) for (const k of Object.keys(ASKED)) assert.equal(k in rec, false, `${k} in ${rec.event || 'run.json'}`);
});

test('a run that sets none of them records none of them, and a blank test list counts as unset', async t => {
  const r = await takeAndRelease(t, { HQ_RUN_TESTS: '   ' });
  for (const rec of [r.run, r.take, r.release]) for (const k of Object.keys(ASKED)) assert.equal(k in rec, false, `${k} in ${rec.event || 'run.json'}`);
});
