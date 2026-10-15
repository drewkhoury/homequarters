// Proves: the package npm would publish installs into a scratch prefix and runs from a folder outside this repo: hq
// --version, hq check and hq backlog, which reach a root script the bin imports. Why: Nell found the tarball shipped
// bin and lib but not server.mjs, problem.mjs, backlog.mjs or dora.mjs, so a stranger's first `hq` died with
// module-not-found; every run until then had gone through a shim at the checkout. A medium test: npm pack and npm
// install, about ten seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });

test('the packed tarball installs and hq runs from elsewhere: version, check and backlog', { timeout: 120000 }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-pack-')), prefix = join(dir, 'prefix'), repo = join(dir, 'repo');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('npm', ['pack', '--silent', '--pack-destination', dir, PKG], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const tarball = readdirSync(dir).find(f => f.endsWith('.tgz'));
  assert.ok(tarball, 'npm pack made a tarball');
  execFileSync('npm', ['install', '-g', '--silent', '--no-audit', '--no-fund', '--prefix', prefix, join(dir, tarball)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const hq = join(prefix, 'bin', 'hq');
  mkdirSyncRepo(repo);
  const run = (...args) => spawnSync(hq, args, { cwd: repo, encoding: 'utf8', env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir } });
  const v = run('--version');
  assert.equal(v.status, 0, v.stderr); assert.match(v.stdout, /^\d+\.\d+\.\d+/);
  const c = run('check');
  assert.equal(c.status, 0, c.stderr); assert.match(c.stdout, /keeps its contract/);
  const b = run('backlog');
  assert.equal(b.status, 0, b.stderr); assert.match(b.stdout, /Ready \(1\)/);
  function mkdirSyncRepo(r) {
    execFileSync('mkdir', ['-p', join(r, 'docs', 'backlog', 'next')]);
    writeFileSync(join(r, 'README.md'), '# r\n');
    writeFileSync(join(r, 'docs', 'backlog', 'next', 'fix-it.md'), '---\ntype: bug\nasked: Jane, 27 Sep\n---\n# Fix it\n\nA sentence.\n\nDone when: done.\n');
    writeFileSync(join(r, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'r', cache: join(dir, 'cache'), backlog: { dir: 'docs/backlog' } }));
    git(r, 'init', '-q', '-b', 'main'); git(r, 'add', '.'); git(r, 'commit', '-q', '-m', 'm');
  }
});
