// HQ serves files from two places only, the repo and ~/.cache/questkeep. safePath is the one gate: these build a small
// repo, a cache and a folder beside them that holds a secret, then try every way out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safePath, refusedName } from '../lib/paths.mjs';

let base, repo, cache;
const canLink = (target, path) => { try { symlinkSync(target, path); return true; } catch { return false; } }; // Windows needs a privilege for links

before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'hq-paths-')));
  repo = join(base, 'repo'); cache = join(base, 'cache');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  mkdirSync(join(repo, '.git'));
  mkdirSync(join(repo, 'node_modules'));
  mkdirSync(join(base, 'outside'));
  mkdirSync(join(cache, 'runs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'PRODUCT.md'), '# Product');
  writeFileSync(join(repo, '.git', 'config'), '[core]');
  writeFileSync(join(repo, 'node_modules', 'x.js'), '');
  writeFileSync(join(repo, '.env'), 'SECRET=1');
  writeFileSync(join(base, 'outside', 'secret.txt'), 'secret');
  writeFileSync(join(cache, 'runs', 'report.html'), '<p>');
});
after(() => rmSync(base, { recursive: true, force: true }));

test('a file inside the repo or the cache is found', () => {
  assert.equal(safePath(repo, 'docs/PRODUCT.md'), join(repo, 'docs', 'PRODUCT.md'));
  assert.equal(safePath(cache, 'runs/report.html'), join(cache, 'runs', 'report.html'));
});

test('../ out of the root is refused, however it is written', () => {
  for (const p of ['../outside/secret.txt', 'docs/../../outside/secret.txt', '..\\outside\\secret.txt', 'docs/..//../outside/secret.txt'])
    assert.equal(safePath(repo, p), null, p);
});

test('an absolute path is refused', () => {
  assert.equal(safePath(repo, join(base, 'outside', 'secret.txt')), null);
  assert.equal(safePath(repo, 'C:/Windows/win.ini'), null);
});

test("git's store, installed packages and env files are refused inside the repo", () => {
  for (const p of ['.git/config', 'node_modules/x.js', '.env']) assert.equal(safePath(repo, p), null, p);
});

// macOS and Windows ignore letter case, APFS folds ſ (the long s) to s, and Windows drops dots and spaces from the end of
// a name, so each of these opens a refused folder or file on some laptop.
const ALIASES = ['.GIT', 'Node_Modules', 'EMULATOR-DATA', '.ENV', '.Env.local', 'node_moduleſ', '.git.', 'node_modules ', '.env. '];

test('a refused name is refused in every spelling the file system opens as the same folder or file', () => {
  for (const n of ALIASES) assert.equal(refusedName(n), true, JSON.stringify(n));
  for (const p of ['.GIT/config', 'NODE_MODULES/x.js', '.ENV']) assert.equal(safePath(repo, p), null, p);
});

test('names that only start like a refused one are still shown, since HQ lists .github and .gitignore', () => {
  for (const n of ['.github', '.gitignore', '.envrc', '.hq.json', 'environment', 'web']) assert.equal(refusedName(n), false, n);
});

test('a missing file or a NUL in the path answers null rather than throwing', () => {
  assert.equal(safePath(repo, 'docs/NOPE.md'), null);
  assert.equal(safePath(repo, 'docs/PRODUCT.md\0.png'), null);
});

test('a symlink inside the repo that points out of it is refused', t => {
  if (!canLink(join(base, 'outside', 'secret.txt'), join(repo, 'docs', 'link.txt'))) return t.skip('symlinks need a privilege here');
  assert.equal(safePath(repo, 'docs/link.txt'), null);
});

test('a symlink inside the repo that points at .git is refused', t => {
  if (!canLink(join(repo, '.git'), join(repo, 'gitlink'))) return t.skip('symlinks need a privilege here');
  assert.equal(safePath(repo, 'gitlink/config'), null);
});
