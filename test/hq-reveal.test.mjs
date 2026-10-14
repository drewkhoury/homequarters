// Show in Finder and Fetch are the two things HQ does rather than reads. These check who may ask for them and what
// they run, with a stand-in for the program so no Finder window opens and nothing is fetched. Also the GitHub link
// built from the checkout's remote.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { start, REPO } from '../server.mjs';
import * as outside from '../lib/outside.mjs';

const { parseRemote, githubFileUrl, chooseGithubRef, revealCommand, reveal } = outside;

test("the GitHub repo is read from the remote's ssh or https form", () => {
  for (const url of ['git@github.com:example-org/questkeep.git', 'https://github.com/example-org/questkeep.git',
    'https://github.com/example-org/questkeep', 'ssh://git@github.com/example-org/questkeep.git', 'https://token@github.com/example-org/questkeep.git\n'])
    assert.equal(parseRemote(url), 'example-org/questkeep', url);
  assert.equal(parseRemote('git@gitlab.com:a/b.git'), null);
  assert.equal(parseRemote(''), null);
});

test('the GitHub link names the ref and the line, with a branch that has a slash', () => {
  assert.equal(githubFileUrl({ slug: 'example-org/questkeep', ref: 'feat/hq', path: 'web/app.js', line: 12 }),
    'https://github.com/example-org/questkeep/blob/feat/hq/web/app.js#L12');
  assert.equal(githubFileUrl({ slug: 'o/r', ref: 'main', path: 'docs/a b.md' }), 'https://github.com/o/r/blob/main/docs/a%20b.md');
});

// feat/hq was never pushed, so a link to it was a 404 on GitHub (checked 26 September: "No commit found for the ref")
const SHA = 'a'.repeat(40);
test('a branch that was never pushed links to the default branch, and its lines too while its commit is not on GitHub', () => {
  assert.deepEqual(chooseGithubRef({ branch: 'feat/hq', head: SHA, remoteBranches: ['main', 'ci/reliability'], defaultBranch: 'main', headOnRemote: false }),
    { pushed: false, fileRef: 'main', lineRef: 'main' });
});

test('a pushed branch links to itself, and its lines to the commit when GitHub has it', () => {
  assert.deepEqual(chooseGithubRef({ branch: 'ci/reliability', head: SHA, remoteBranches: ['main', 'ci/reliability'], defaultBranch: 'main', headOnRemote: true }),
    { pushed: true, fileRef: 'ci/reliability', lineRef: SHA });
  assert.deepEqual(chooseGithubRef({ branch: 'ci/reliability', head: SHA, remoteBranches: ['main', 'ci/reliability'], defaultBranch: 'main', headOnRemote: false }),
    { pushed: true, fileRef: 'ci/reliability', lineRef: 'ci/reliability' }, 'local commits not pushed yet: the branch, not a commit GitHub lacks');
});

test('an unpushed branch whose commit is already on GitHub (made from main, nothing new) links its lines to that commit', () => {
  assert.deepEqual(chooseGithubRef({ branch: 'fix/x', head: SHA, remoteBranches: ['main'], defaultBranch: 'main', headOnRemote: true }),
    { pushed: false, fileRef: 'main', lineRef: SHA });
});

test('a detached checkout links to the default branch', () => {
  assert.equal(chooseGithubRef({ branch: '', head: SHA, remoteBranches: ['main'], headOnRemote: false }).fileRef, 'main');
});

test('each system gets its own file manager command, with the path as one argument', () => {
  assert.deepEqual(revealCommand('darwin', '/Users/me/q/web/app.js', false), { cmd: 'open', args: ['-R', '/Users/me/q/web/app.js'], opts: {} });
  assert.deepEqual(revealCommand('win32', 'C:\\Users\\me\\q b\\app.js', false),
    { cmd: 'explorer.exe', args: ['/select,"C:\\Users\\me\\q b\\app.js"'], opts: { windowsVerbatimArguments: true, windowsHide: false } });
  assert.deepEqual(revealCommand('linux', '/home/me/q/web/app.js', false), { cmd: 'xdg-open', args: ['/home/me/q/web'], opts: {} });
  assert.deepEqual(revealCommand('linux', '/home/me/q/web', true), { cmd: 'xdg-open', args: ['/home/me/q/web'], opts: {} });
});

// From a review of #8, filed 2 October: every program HQ starts was hidden, Explorer too, which
// can stop it opening its window. A stand-in for execFile shows what each call is given.
test('Explorer is started with its window allowed, while the other programs stay hidden', async () => {
  const given = [];
  const exec = (cmd, args, opts, done) => { given.push([cmd, opts]); done(null); };
  for (const platform of ['win32', 'darwin', 'linux']) {
    const { cmd, args, opts } = revealCommand(platform, platform === 'win32' ? 'C:\\q\\app.js' : '/q/app.js', false);
    assert.equal(await outside.runFile(cmd, args, opts, exec), null);
  }
  assert.deepEqual(given.map(([cmd, o]) => [cmd, o.windowsHide, o.timeout]), [['explorer.exe', false, 10000], ['open', true, 10000], ['xdg-open', true, 10000]]);
});

// a repo and a cache made here, with a file beside them that must never be shown
let base, repo, cache, server, url;
const ran = [];
let lastOpts = null;
before(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'hq-reveal-')));
  repo = join(base, 'repo'); cache = join(base, 'cache');
  mkdirSync(join(repo, 'web'), { recursive: true }); mkdirSync(join(cache, 'runs'), { recursive: true });
  writeFileSync(join(repo, 'web', 'app.js'), '');
  writeFileSync(join(base, 'secret.txt'), '');
  ({ server, url } = await start({ port: 0, repo: REPO, cache, platform: 'darwin', run: async (cmd, args, opts) => { ran.push([cmd, ...args]); lastOpts = opts; return null; } }));
});
after(() => { server.close(); rmSync(base, { recursive: true, force: true }); });

test('a path outside the repo and the cache is refused and nothing runs', async () => {
  const run = async () => assert.fail('nothing should run');
  for (const path of ['../secret.txt', join(base, 'secret.txt'), 'web/../../secret.txt'])
    assert.equal((await reveal({ roots: { repo, cache }, root: 'repo', path, run })).status, 403, path);
  assert.equal((await reveal({ roots: { repo, cache }, root: 'home', path: 'x', run })).status, 400);
});

test('a path inside runs the command for it', async () => {
  const calls = [];
  const out = await reveal({ roots: { repo, cache }, root: 'repo', path: 'web/app.js', platform: 'darwin', run: async (...a) => { calls.push(a); return null; } });
  assert.equal(out.status, 200);
  assert.deepEqual(calls, [['open', ['-R', join(repo, 'web', 'app.js')], {}]]);
});

// a request to the running server, with the headers a browser would send from the page given
const post = (path, { method = 'POST', origin = url, type = 'application/json', body = '{}' } = {}) => new Promise((resolve, reject) => {
  const u = new URL(url), headers = { 'content-type': type };
  if (origin) headers.origin = origin;
  const req = request({ host: u.hostname, port: u.port, path, method, headers }, res => {
    let text = ''; res.on('data', d => (text += d)); res.on('end', () => resolve({ status: res.statusCode, text }));
  });
  req.on('error', reject); req.end(method === 'GET' ? undefined : body);
});

test('the server shows a repo file when HQ itself asks', async () => {
  ran.length = 0;
  const r = await post('/reveal', { body: JSON.stringify({ root: 'repo', path: 'Makefile' }) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(ran, [['open', '-R', join(realpathSync(REPO), 'Makefile')]]);
});

test('GET is refused, so no link or prefetch can set it off', async () => {
  ran.length = 0;
  assert.equal((await post('/reveal?root=repo&path=Makefile', { method: 'GET' })).status, 405);
  assert.deepEqual(ran, []);
});

test('another origin, or none, is refused', async () => {
  ran.length = 0;
  const body = JSON.stringify({ root: 'repo', path: 'Makefile' });
  assert.equal((await post('/reveal', { origin: 'https://evil.example', body })).status, 403);
  assert.equal((await post('/reveal', { origin: 'http://localhost:1', body })).status, 403);
  assert.equal((await post('/reveal', { origin: null, body })).status, 403);
  assert.deepEqual(ran, []);
});

test('a form post, which a page elsewhere could send without asking, is refused', async () => {
  assert.equal((await post('/reveal', { type: 'application/x-www-form-urlencoded', body: 'root=repo&path=Makefile' })).status, 415);
});

test('the server refuses a path out of the repo', async () => {
  ran.length = 0;
  assert.equal((await post('/reveal', { body: JSON.stringify({ root: 'repo', path: '../../../etc/passwd' }) })).status, 403);
  assert.equal((await post('/reveal', { body: JSON.stringify({ root: 'repo', path: '.git/config' }) })).status, 403);
  assert.deepEqual(ran, []);
});

test('POST anywhere else is still refused', async () => {
  assert.equal((await post('/tests')).status, 405);
});

test('Fetch runs git fetch --prune in the repo when HQ itself asks', async () => {
  ran.length = 0;
  const r = await post('/git/fetch', { body: '{}' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(ran, [['git', 'fetch', '--prune']]);
  assert.equal(lastOpts.cwd, REPO, 'in this repo, not wherever HQ was started');
});

test('Fetch refuses GET, another origin, none, and a form post, and runs nothing', async () => {
  ran.length = 0;
  assert.equal((await post('/git/fetch', { method: 'GET' })).status, 405);
  assert.equal((await post('/git/fetch', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/git/fetch', { origin: null })).status, 403);
  assert.equal((await post('/git/fetch', { type: 'text/plain' })).status, 415);
  assert.deepEqual(ran, []);
});
