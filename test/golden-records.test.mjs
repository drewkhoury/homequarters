// Proves: hq slot and hq run-info, given the inputs QuestKeep's own writers were given, write the records those writers
// wrote: the same keys and the same values, except the fields named volatile below and the few the package adds on purpose.
// Why: QuestKeep's pages and scripts read these records (the slot's run.json and log, the CI run line); when hq replaces
// scripts/lock.mjs and tests/run-info.mjs, every field must survive. test/fixtures/golden/README.md says how the records
// were made from QuestKeep's main and how to make them again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, lockCli, scratch, shell, logOf } from './slot-helpers.mjs';

const GOLDEN = join(root, 'test/fixtures/golden');
const golden = name => JSON.parse(readFileSync(join(GOLDEN, name), 'utf8'));
const goldenLog = () => readFileSync(join(GOLDEN, 'slot-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

// Fields that differ between any two runs, and are compared only for being there:
//   pid, pidStart  the process standing in for the make recipe's shell, and when it started
//   path           where the checkout is on disk (the fixture keeps a placeholder, since the real one names a home folder)
//   since, at      when the slot was taken, and when each line or the run line was written
//   secs           how long the run held the slot
//   paged, machine what the machine was doing (lib/machine.mjs): load, swap, the busiest programs
const VOLATILE = new Set(['pid', 'pidStart', 'path', 'since', 'at', 'secs', 'paged', 'machine']);
// Fields the package writes that QuestKeep's writers do not, and QuestKeep's readers ignore:
//   v     the record's shape (a reader takes a line without v as v 0), on the slot's log lines and the run line
//   tree  git's tree of the commit tested, on a CI run line
const SLOT_ADDS = new Set(['v']), RUN_ADDS = new Set(['v', 'tree']);

// paged and machine are blocks whose values change from run to run but whose keys do not (lib/machine.mjs writes every
// key, null where a reading failed), so their keys are compared one level down. The golden records were taken on a Mac,
// which always reads paged; elsewhere (Linux CI) the package writes paged as null, and only there is null allowed.
const BLOCKS = new Set(['paged', 'machine']);
const keysOf = o => Object.keys(o).sort();

function sameRecord(got, want, adds, what) {
  assert.deepEqual(Object.keys(got).filter(k => !adds.has(k)).sort(), Object.keys(want).sort(), `${what}: the same keys`);
  for (const k of Object.keys(want)) {
    if (VOLATILE.has(k)) assert.equal(typeof got[k], typeof want[k], `${what}: ${k} is there, as a ${typeof want[k]}`);
    else assert.deepEqual(got[k], want[k], `${what}: ${k}`);
    if (BLOCKS.has(k) && want[k] !== null && !(got[k] === null && k === 'paged' && process.platform !== 'darwin')) {
      assert.ok(got[k] !== null, `${what}: ${k} is a block, not null`);
      assert.deepEqual(keysOf(got[k]), keysOf(want[k]), `${what}: ${k} has the same keys`);
    }
  }
}

// A checkout named and branched as the golden one was (QuestKeep's main), with one commit so git can name its branch.
function checkout(t, branch) {
  const dir = join(scratch(t), 'questkeep');
  mkdirSync(dir);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'golden', GIT_AUTHOR_EMAIL: 'golden@example.invalid', GIT_COMMITTER_NAME: 'golden', GIT_COMMITTER_EMAIL: 'golden@example.invalid' };
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', branch], { env });
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'golden'], { env });
  return dir;
}

test('hq slot writes the run.json, take line and release line QuestKeep\'s scripts/lock.mjs wrote', async t => {
  const want = golden('slot-run.json'), [wantTake, wantRelease] = goldenLog();
  const repo = checkout(t, want.branch), dir = scratch(t), sh = shell(t);
  // the environment regenerate.sh gave scripts/lock.mjs, under the names QuestKeep's Makefile and runner set today
  const env = { HQ_SLOT_PID: String(sh.pid), USER: 'golden', QK_WHO: 'golden-runner', GITHUB_RUN_ID: '19000000001', GITHUB_RUN_ATTEMPT: '2', QK_RUN_TESTS: 'sync-offline island-stamps', JUNIT: '1', QK_KIND: 'deploy', QK_PLACE: 'home' };
  const took = await lockCli(t, dir, ['take', want.target, '--repo', repo], env);
  assert.equal(took.code, 0, took.text);
  sameRecord(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')), want, new Set(), 'run.json');
  assert.equal((await lockCli(t, dir, ['release', want.target, '0', '--repo', repo], env)).code, 0);
  const [take, release] = logOf(dir);
  sameRecord(take, wantTake, SLOT_ADDS, 'the take line');
  sameRecord(release, wantRelease, SLOT_ADDS, 'the release line');
  // the release line's machine block says how hard the machine paged during the run; the Delivery page and lib/dora.mjs read it
  assert.ok('pagingMBps' in wantRelease.machine, 'the golden release line has pagingMBps');
  assert.ok('pagingMBps' in release.machine, 'the release line: machine has pagingMBps');
});

test('hq run-info, with QuestKeep\'s CI fields in --extra, writes the run line QuestKeep\'s tests/run-info.mjs wrote', t => {
  const want = golden('run-info-ci.json'), repo = checkout(t, 'main'), out = join(scratch(t), 'run.json');
  // the workflow's environment regenerate.sh gave tests/run-info.mjs (QK_TARGET and QK_HALF are QuestKeep's, and come in extra)
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted', GITHUB_RUN_ID: '19000000001', GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main', QK_COMMIT: '0123456789abcdef0123456789abcdef01234567' };
  // what QuestKeep passes through --extra (decision 11): its runner's name, its make target and gate half, and the three
  // it works out itself (its tree hash, its lanes default, its SDK state), here as its own writer worked them out
  const extra = { runner: 'laptop', target: 'test-gate', half: '1', hash: want.hash, lanes: want.lanes, sdk: want.sdk };
  execFileSync(process.execPath, [join(root, 'bin/hq.mjs'), 'run-info', 'gate', '--json', out, '--extra', JSON.stringify(extra), '--repo', repo], { env });
  sameRecord(JSON.parse(readFileSync(out, 'utf8')), want, RUN_ADDS, 'the run line');
});
