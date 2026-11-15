// Proves: the package npm would publish installs into a scratch prefix and, run from a folder outside this repo, answers
// every command QuestKeep's Makefile, workflows and scripts call, in the form they call it: serve (plain, and with
// HQ_DEMO=1 and HQ_PORT), check and check --demo, backlog, dora, space host|figures|vm, ci-fetch, slot
// take|who|status|claim|unclaim|release, run-info with --json and HQ_LANES, and ci-keep; and the rest of the command
// line (setup, machine, problem) loads. hq serve writes the link file from the install too.
// Why: Nell found the tarball shipped bin and lib but not server.mjs, problem.mjs, backlog.mjs or dora.mjs, so a
// stranger's first `hq` died with module-not-found; every run until then had gone through a shim at the checkout. A
// command QuestKeep calls that only works from the checkout fails the day QuestKeep swaps its pin to the registry.
// The list comes from grepping QuestKeep's switch branch for `hq ` and `$(HQ)` (Makefile, .github/workflows,
// scripts); a new call there needs a line here. The commands run harmlessly: scratch cache, slot and ci folders, a
// space threshold of 0 so a full disk cannot fail it, dora with no fetch, and a repo with no remote, so ci-fetch stops
// before asking GitHub. PATH is this machine's with the install's bin first, so git is found wherever it lives; hq is
// still run by its full path in the install, never a global one.
// A medium test: npm pack and npm install, a few seconds. It needs the npm registry for marked and highlight.js, so
// HQ_OFFLINE=1 skips it with that reason (Hollis); it is the test to run before a publish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });

test('the packed tarball installs and runs every command QuestKeep calls, from outside the checkout', { timeout: 180000, skip: process.env.HQ_OFFLINE === '1' && 'needs the npm registry for marked and highlight.js' }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-pack-')), prefix = join(dir, 'prefix'), repo = join(dir, 'repo'), cache = join(dir, 'cache');
  // the servers stop first and are waited for: one still writing in dir (its warm-up reads pages) fails the rm, and a
  // hook that throws leaves the hooks after it unrun and the servers holding the runner open. Each server leads its
  // own process group, and the whole group is stopped: a git its warm-up started outlives a server killed alone, and
  // went on writing in dir (ENOTEMPTY on CI's node 22 Linux job, retries or not)
  const servers = [];
  const group = (s, sig) => { try { process.kill(-s.pid, sig); } catch { /* the group has gone */ } };
  t.after(async () => {
    await Promise.all(servers.map(s => (s.exitCode !== null || s.signalCode !== null ? null : new Promise(r => { s.once('exit', r); group(s, 'SIGTERM'); }))));
    for (const s of servers) group(s, 'SIGKILL');
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  execFileSync('npm', ['pack', '--silent', '--pack-destination', dir, PKG], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const tarball = readdirSync(dir).find(f => f.endsWith('.tgz'));
  assert.ok(tarball, 'npm pack made a tarball');
  execFileSync('npm', ['install', '-g', '--silent', '--no-audit', '--no-fund', '--prefix', prefix, join(dir, tarball)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // npm puts a global install's commands in <prefix>/bin on macOS and Linux
  const bin = join(prefix, 'bin'), hq = join(bin, 'hq');
  assert.ok(existsSync(hq), `npm installed hq at ${hq}`);
  makeRepo();

  const env = (extra = {}) => ({ PATH: [bin, dirname(process.execPath), process.env.PATH].join(delimiter), HOME: dir, ...GIT_ENV,
    HQ_SLOT_DIR: join(dir, 'slot'), HQ_NO_DOCKER: '1', HQ_SPACE_FAIL_GB: '0', HQ_SPACE_WARN_GB: '0', ...extra });
  const run = (args, extra) => spawnSync(hq, args, { cwd: repo, encoding: 'utf8', env: env(extra), timeout: 60000 });
  const ok = (args, extra, pattern) => {
    const r = run(args, extra);
    assert.equal(r.status, 0, `hq ${args.join(' ')} exited ${r.status}:\n${r.stdout}${r.stderr}`);
    if (pattern) assert.match(r.stdout + r.stderr, pattern, `hq ${args.join(' ')}`);
    return r;
  };

  assert.match(ok(['--version']).stdout, /^\d+\.\d+\.\d+/);
  ok(['check'], {}, /keeps its contract/);
  ok(['check', '--demo'], {}, /pages rendered with the demo setting/);
  ok(['backlog'], {}, /Ready \(1\)/);
  // make dora and after.yml: what the cache holds, with no fetch from GitHub or git; a scratch cache holds no runs yet
  ok(['dora', '--no-fetch', '--no-fetch-git', '--quiet'], {}, /No runs in .* yet/);
  // the free-space checks before a test run, and inside a test container
  ok(['space', 'host']);
  assert.doesNotThrow(() => JSON.parse(ok(['space', 'figures']).stdout), 'space figures prints JSON for the container');
  ok(['space', 'vm'], { HQ_SPACE_HOST: '{}' });
  ok(['ci-fetch', join(cache, 'ci')], {}, /no git remote/);
  // the slot, as the Makefile's LOCK and scripts/soak.mjs drive it
  ok(['slot', 'take', 'pack-test']);
  ok(['slot', 'who']);
  ok(['slot', 'status']);
  ok(['slot', 'status', 'packing'], {}, /Status: packing/);
  ok(['slot', 'release', 'pack-test', '0']);
  ok(['slot', 'claim', 'a few runs'], {}, /Claimed/);
  ok(['slot', 'unclaim']);
  // test.yml and after.yml: the run line, then the results kept on this machine
  ok(['run-info', 'gate', '--json', join(repo, 'test-results', 'run.json')], { HQ_LANES: '2' });
  assert.equal(JSON.parse(readFileSync(join(repo, 'test-results', 'run.json'), 'utf8')).kind, 'gate');
  writeFileSync(join(repo, 'test-results', 'junit.xml'), '<testsuites tests="0"></testsuites>\n');
  ok(['ci-keep', 'test-results', 'junit-1-1-gate'], { HQ_CI_DIR: join(cache, 'ci') }, /Kept/);
  // the rest of the command line loads from the install
  ok(['setup'], {}, /hq setup for/);
  assert.doesNotThrow(() => JSON.parse(ok(['machine']).stdout), 'machine prints JSON');
  ok(['problem', '--help']);

  // make hq, make hq-start: serve from the install, not the checkout; static/ and theme/ have to be in the tarball too
  const url = await serve(t, ['serve', '--port', '0'], {});
  const home = await fetch(url);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>/);
  assert.equal((await fetch(`${url}/theme/nocturne.css`)).status, 200, 'the theme ships and serves');
  assert.equal(JSON.parse(readFileSync(join(repo, 'web', '.hq.json'), 'utf8')).url, url, 'the link file is written from the install');
  // make hq-demo: HQ_DEMO=1, with the port from HQ_PORT
  const demoUrl = await serve(t, ['serve'], { HQ_DEMO: '1', HQ_PORT: '0' });
  assert.match(await (await fetch(demoUrl)).text(), /HomeQuarters/, 'the demo setting\'s wordmark');

  function serve(tt, args, extra) {
    const srv = spawn(hq, args, { cwd: repo, env: env(extra), detached: true });
    servers.push(srv);
    return new Promise((res, rej) => {
      let out = ''; srv.stdout.on('data', d => { out += d; const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(out); if (m) res(m[1]); });
      srv.stderr.on('data', d => { out += d; }); srv.on('close', () => rej(new Error(`hq ${args.join(' ')} ended: ${out}`)));
    });
  }
  function makeRepo() {
    mkdirSync(join(repo, 'docs', 'backlog', 'next'), { recursive: true });
    mkdirSync(join(repo, 'web'), { recursive: true });
    mkdirSync(join(repo, 'test-results'), { recursive: true });
    writeFileSync(join(repo, 'README.md'), '# r\n');
    writeFileSync(join(repo, '.gitignore'), 'test-results/\nweb/.hq.json\n');
    writeFileSync(join(repo, 'docs', 'backlog', 'next', 'fix-it.md'), '---\ntype: bug\nasked: Jane, 27 Sep\n---\n# Fix it\n\nA sentence.\n\nDone when: done.\n');
    writeFileSync(join(repo, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'r', cache, backlog: { dir: 'docs/backlog' }, stores: ['runs', 'lock', 'ci', 'dora'], link: 'web/.hq.json' }));
    git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'm');
  }
});
