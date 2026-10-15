// Proves: hq finds the repo from a subfolder of the checkout or from --repo, serves on 8780 or the next free port when
// none is given, and takes the port it is given. Why: these are a stranger's first three commands, and nothing ran the
// command itself (Hollis); the make lines and tests always passed --repo or a port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const HQ = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs');
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-startup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'docs', 'backlog', 'next'), { recursive: true }); mkdirSync(join(dir, 'deep', 'inside'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# r\n'); writeFileSync(join(dir, 'deep', 'inside', 'a.txt'), 'a');
  writeFileSync(join(dir, 'docs', 'backlog', 'next', 'fix-it.md'), '---\ntype: bug\nasked: Jane, 27 Sep\n---\n# Fix it\n\nA.\n\nDone when: done.\n');
  writeFileSync(join(dir, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'r', cache: join(dir, 'cache'), backlog: { dir: 'docs/backlog' } }));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'm');
  return dir;
}
const env = { PATH: process.env.PATH, HOME: process.env.HOME };
// starts hq serve and answers its URL once it prints it; stopped after the test
function serve(t, args, cwd) {
  const p = spawn(process.execPath, [HQ, 'serve', ...args], { cwd, env });
  t.after(() => p.kill('SIGTERM'));
  return new Promise((res, rej) => {
    let out = '';
    p.stdout.on('data', d => { out += d; const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(out); if (m) res(m[1]); });
    p.stderr.on('data', d => { out += d; });
    p.on('close', () => rej(new Error(`hq serve ended: ${out}`)));
  });
}

// the same, with the whole start-up text readable after the URL came
function serveOut(t, args, cwd) {
  const p = spawn(process.execPath, [HQ, 'serve', ...args], { cwd, env });
  t.after(() => p.kill('SIGTERM'));
  let out = '';
  return new Promise((res, rej) => {
    p.stdout.on('data', d => { out += d; const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(out); if (m) setTimeout(() => res({ url: m[1], text: () => out }), 50); });
    p.stderr.on('data', d => { out += d; });
    p.on('close', () => rej(new Error(`hq serve ended: ${out}`)));
  });
}

test('hq finds the checkout from a folder inside it, and --repo points it elsewhere', t => {
  const dir = repo(t);
  const inside = spawnSync(process.execPath, [HQ, 'backlog'], { cwd: join(dir, 'deep', 'inside'), encoding: 'utf8', env });
  assert.equal(inside.status, 0, inside.stderr); assert.match(inside.stdout, /fix-it/);
  const elsewhere = spawnSync(process.execPath, [HQ, 'backlog', '--repo', dir], { cwd: tmpdir(), encoding: 'utf8', env });
  assert.equal(elsewhere.status, 0, elsewhere.stderr); assert.match(elsewhere.stdout, /fix-it/);
});

test('with no port given hq serves on 8780 or the next free one; a given port is taken as it is', async t => {
  const dir = repo(t);
  const url = await serve(t, [], dir);
  assert.ok(+new URL(url).port >= 8780, url);
  assert.equal((await fetch(url)).status, 200);
  // a port in use: the next one is taken
  const blocker = createServer(); await new Promise(r => blocker.listen(0, '127.0.0.1', r)); t.after(() => blocker.close());
  const busy = blocker.address().port;
  const url2 = await serve(t, ['--port', String(busy)], dir);
  assert.equal(+new URL(url2).port, busy + 1, 'the next port after the one in use');
  const free = createServer(); await new Promise(r => free.listen(0, '127.0.0.1', r)); const want = free.address().port; await new Promise(r => free.close(r));
  const url3 = await serve(t, ['--port', String(want)], dir);
  assert.equal(+new URL(url3).port, want);
});

// The stranger's install (finding 4): --port 8790 served on 8791 because 8790 was on a list of ports QuestKeep's laptop
// uses. A port list is one machine's; a given port is taken when free, and a move is said out loud.
test('a given port on no list is taken when free, and when it is in use the start line says so', async t => {
  const dir = repo(t);
  const probe = async p => { const s = createServer(); try { await new Promise((r, j) => { s.once('error', j); s.listen(p, '127.0.0.1', r); }); await new Promise(r => s.close(r)); return true; } catch { return false; } };
  let want = null;
  for (const p of [8790, 9399, 9599, 4100, 8381, 8765]) if (await probe(p)) { want = p; break; }
  if (want === null) { t.skip('every port on the old list is in use on this machine'); return; }
  const a = await serveOut(t, ['--port', String(want)], dir);
  assert.equal(+new URL(a.url).port, want, a.text());
  const b = await serveOut(t, ['--port', String(want)], dir);
  assert.equal(+new URL(b.url).port, want + 1);
  assert.match(b.text(), new RegExp(`port ${want} was in use`));
  assert.doesNotMatch(a.text(), /was in use/);
});

// The stranger's install: hq setup --repo <a folder that is not there> printed a full proposal and exited 0.
test('--repo naming a folder that is not there is refused, by setup and by check alike', () => {
  const gone = join(tmpdir(), 'hq-not-here-' + process.pid);
  for (const cmd of ['setup', 'check']) {
    const r = spawnSync(process.execPath, [HQ, cmd, '--repo', gone], { encoding: 'utf8', env });
    assert.equal(r.status, 2, `${cmd}: ${r.stdout}`);
    assert.match(r.stderr, /is not a folder/);
  }
});

test('hq slot --help and hq problem --help print usage and exit 0, like hq --help', () => {
  for (const cmd of ['slot', 'problem']) {
    const r = spawnSync(process.execPath, [HQ, cmd, '--help'], { encoding: 'utf8', env, cwd: tmpdir() });
    assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
    assert.match(r.stdout, /Usage|hq /);
    assert.doesNotMatch(r.stdout, /ctx: the privacy check|The command line as \{ cmd, opts \}/, 'no source comments in the help');
  }
});
