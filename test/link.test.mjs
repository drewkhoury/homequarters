// Proves: hq serve writes {"url","pid"} to the file the manifest's link key names as it starts, takes it away again
// when it stops (unless a newer HQ has written its own since), and writes nothing when the manifest names no link.
// Why: a project's app links to HQ from that file. QuestKeep's own server wrote web/.hq.json at start; once HQ is a
// package, a bare `hq serve` has to keep writing it, or the app's link to HQ goes dead (decision 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HQ = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs');
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });

// A scratch repo whose app lives in web/, with the manifest given.
function repo(t, manifest) {
  const top = mkdtempSync(join(tmpdir(), 'hq-link-')), dir = join(top, 'repo');
  t.after(() => rmSync(top, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# r\n');
  writeFileSync(join(dir, 'web', 'index.html'), '<!doctype html>\n');
  writeFileSync(join(dir, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'r', cache: join(top, 'cache'), ...manifest }));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'm');
  return dir;
}

// hq serve on any free port; answers the process and its URL once it prints it.
function serve(t, dir) {
  const p = spawn(process.execPath, [HQ, 'serve', '--port', '0'], { cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  t.after(() => p.kill('SIGKILL'));
  return new Promise((res, rej) => {
    let out = '';
    p.stdout.on('data', d => { out += d; const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(out); if (m) res({ p, url: m[1] }); });
    p.stderr.on('data', d => { out += d; });
    p.on('close', () => rej(new Error(`hq serve ended: ${out}`)));
  });
}
const stopped = p => new Promise(r => { p.once('close', r); p.kill('SIGTERM'); });

test('with link named, hq serve writes its url and pid there at start and removes the file when it stops', async t => {
  const dir = repo(t, { link: 'web/.hq.json' });
  const file = join(dir, 'web', '.hq.json');
  const { p, url } = await serve(t, dir);
  assert.ok(existsSync(file), 'the link file is written before the start line');
  assert.equal(readFileSync(file, 'utf8'), JSON.stringify({ url, pid: p.pid }) + '\n', 'the shape QuestKeep\'s server wrote: one line, url then pid');
  await stopped(p);
  assert.equal(existsSync(file), false, 'gone once HQ stops');
});

test('a link file a newer HQ wrote over is left alone when the older one stops', async t => {
  const dir = repo(t, { link: 'web/.hq.json' });
  const file = join(dir, 'web', '.hq.json');
  const { p } = await serve(t, dir);
  const newer = JSON.stringify({ url: 'http://127.0.0.1:1', pid: p.pid + 100000 }) + '\n';
  writeFileSync(file, newer);
  await stopped(p);
  assert.equal(readFileSync(file, 'utf8'), newer);
});

test('with no link key hq serve writes no link file anywhere in the repo', async t => {
  const dir = repo(t, {});
  const { p } = await serve(t, dir);
  assert.equal(existsSync(join(dir, 'web', '.hq.json')), false);
  assert.equal(git(dir, 'status', '--porcelain', '--ignored', '--untracked-files=all'), '', 'nothing new in the repo');
  await stopped(p);
});

test('the manifest resolves link from the repo root, and a link that is not a path is warned and ignored', async () => {
  const { resolveManifest } = await import('../lib/manifest.mjs');
  const at = raw => resolveManifest({ schemaVersion: 1, name: 'r', ...raw }, { repo: '/r', home: '/h', env: {} });
  assert.equal(at({ link: 'web/.hq.json' }).m.link, '/r/web/.hq.json');
  assert.deepEqual(at({ link: 'web/.hq.json' }).warnings, []);
  assert.equal(at({}).m.link, null);
  const bad = at({ link: true });
  assert.equal(bad.m.link, null);
  assert.deepEqual(bad.warnings, ['hq.json: "link" should be a path, as a string; ignored']);
});
