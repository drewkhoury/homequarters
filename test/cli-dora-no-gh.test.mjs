// Proves: hq dora on a machine with no gh fails on CI (exit 1, saying gh is missing) and ends cleanly on a laptop, saying
// the same, so the figures are worked out from what the cache holds.
// Why: in CI (QuestKeep's nightly dora job) a missing gh that ended 0 would keep the job green every night while the
// dated copies were worked out from a cache that stopped growing. Ported from QuestKeep's tests/unit/dora-fetch.test.mjs,
// which proves it for the old script, before QuestKeep deletes that test. gh is kept off the PATH, so nothing reaches
// GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HQ = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs');
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };

// A repo with a manifest and a cache of its own, and a PATH that holds git and nothing else.
function machineWithoutGh(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-dora-no-gh-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo'), bin = join(dir, 'bin');
  mkdirSync(repo); mkdirSync(bin);
  writeFileSync(join(repo, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'doors', cache: join(dir, 'cache'), stores: ['dora', 'ci'] }));
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { env: gitEnv });
  execFileSync('git', ['-C', repo, 'add', '.'], { env: gitEnv });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'm'], { env: gitEnv });
  const git = (process.env.PATH || '').split(delimiter).map(p => join(p, 'git')).find(existsSync);
  symlinkSync(git, join(bin, 'git'));
  return { repo, env: { PATH: bin, HOME: dir } };
}
const dora = (m, env) => spawnSync(process.execPath, [HQ, 'dora', '--no-fetch-git', '--repo', m.repo], { encoding: 'utf8', env: { ...m.env, ...env } });

test('on CI with no gh, hq dora fails and says gh is missing', t => {
  const r = dora(machineWithoutGh(t), { CI: 'true' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /gh CLI is not installed/);
});

test('on a laptop with no gh, hq dora says so and ends cleanly', t => {
  const r = dora(machineWithoutGh(t), {});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /gh CLI is not installed/);
});
