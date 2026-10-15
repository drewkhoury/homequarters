// Proves: the package npm would publish installs into a scratch prefix and runs from a folder outside this repo: hq
// --version, hq check and hq backlog, which reach a root script the bin imports, and hq serve answers its Home page.
// Why: Nell found the tarball shipped bin and lib but not server.mjs, problem.mjs, backlog.mjs or dora.mjs, so a
// stranger's first `hq` died with module-not-found; every run until then had gone through a shim at the checkout.
// A medium test: npm pack and npm install, a few seconds. It needs the npm registry for marked and highlight.js, so
// HQ_OFFLINE=1 skips it with that reason (Hollis); it is the test to run before a publish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });

test('the packed tarball installs and hq runs from elsewhere: version, check, backlog and serve', { timeout: 120000, skip: process.env.HQ_OFFLINE === '1' && 'needs the npm registry for marked and highlight.js' }, async t => {
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
  // serve from the install, not the checkout: static/ and theme/ have to be in the tarball too
  const srv = spawn(hq, ['serve', '--port', '0'], { cwd: repo, env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir } });
  t.after(() => srv.kill());
  const url = await new Promise((res, rej) => {
    let out = ''; srv.stdout.on('data', d => { out += d; const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(out); if (m) res(m[1]); });
    srv.stderr.on('data', d => { out += d; }); srv.on('close', () => rej(new Error(`hq serve ended: ${out}`)));
  });
  const home = await fetch(url);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>/);
  const css = await fetch(`${url}/theme/nocturne.css`);
  assert.equal(css.status, 200, 'the theme ships and serves');
  function mkdirSyncRepo(r) {
    execFileSync('mkdir', ['-p', join(r, 'docs', 'backlog', 'next')]);
    writeFileSync(join(r, 'README.md'), '# r\n');
    writeFileSync(join(r, 'docs', 'backlog', 'next', 'fix-it.md'), '---\ntype: bug\nasked: Jane, 27 Sep\n---\n# Fix it\n\nA sentence.\n\nDone when: done.\n');
    writeFileSync(join(r, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'r', cache: join(dir, 'cache'), backlog: { dir: 'docs/backlog' } }));
    git(r, 'init', '-q', '-b', 'main'); git(r, 'add', '.'); git(r, 'commit', '-q', '-m', 'm');
  }
});
