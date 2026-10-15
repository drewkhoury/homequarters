// Proves: hq dora reads and writes the dora store of the manifest's cache, never a baked folder, and with nothing fetched
// yet says where it looked and ends 0. Why: the script had ~/.cache/questkeep and the package's parent folder baked in,
// so run from the package it would have read the wrong repo and written another project's cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HQ = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs');
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });

test('with no runs fetched, hq dora names the manifest\'s cache and ends 0, and HQ_CACHE moves it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-dora-cli-')), cache = join(dir, 'cache'), other = join(dir, 'other');
  writeFileSync(join(dir, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'doors', cache, stores: ['dora', 'ci'] }));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'm');
  const r = spawnSync(process.execPath, [HQ, 'dora', '--no-fetch', '--no-fetch-git', '--repo', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`No runs in ${cache.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/ci/actions yet`));
  const moved = spawnSync(process.execPath, [HQ, 'dora', '--no-fetch', '--no-fetch-git', '--repo', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, HQ_CACHE: other } });
  assert.match(moved.stdout, /\/other\/ci\/actions yet/);
  assert.ok(!existsSync(join(cache, 'dora')), 'nothing was written with nothing to work out');
  rmSync(dir, { recursive: true, force: true });
});

// The stranger's install: --no-fetch still fetched origin/main and then blamed gh's login for a repo with no remote.
test('--no-fetch fetches nothing, GitHub or git, and a repo with no remote is told so instead of blamed for gh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-dora-cli-')), cache = join(dir, 'cache');
  writeFileSync(join(dir, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'doors', cache, stores: ['dora', 'ci'] }));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'm');
  const r = spawnSync(process.execPath, [HQ, 'dora', '--no-fetch', '--repo', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /Could not fetch origin\/main/);
  assert.doesNotMatch(r.stdout, /gh logged in/);
  assert.match(r.stdout, /No runs in .*ci\/actions yet/);
  rmSync(dir, { recursive: true, force: true });
});
