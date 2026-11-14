// Proves: the Machine page asks the runner the server was started with for every machine figure and tool version, so
// a test or the demo check can give HQ a stub and no real sysctl, pmset, ps, docker or gh runs.
// Why: homequarters/testing promises a server that does not depend on the machine it runs on; with the page calling
// the real tools, a test's page carried this laptop's load, programs and gh login, and took seconds where the tools
// were slow.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { start } from '../server.mjs';
import { resolveManifest } from '../lib/manifest.mjs';

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
let home, srv;
// every command the page asked for, and a made-up answer no real machine gives
const asked = [];
const probes = {
  host: (cmd, args) => { asked.push(cmd); return cmd === 'ps' ? '  PID  %CPU COMM\n 4242  77.0 /bin/stub-busy-program\n' : ''; },
  exec: async (cmd, args) => { asked.push(cmd); return { ok: true, out: `${cmd} version 99.9.9-stub`, err: '', code: 0 }; },
};

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'hq-machine-probes-'));
  const repo = join(home, 'hello'), cache = join(home, 'cache');
  mkdirSync(repo, { recursive: true }); mkdirSync(join(cache, 'no-transcripts'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# hello\n');
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'first');
  const { m } = resolveManifest(null, { repo, home, env: {} });
  srv = await start({ port: 0, repo, cache, m: { ...m, cache }, projectsDir: join(cache, 'no-transcripts'), probes, platform: 'darwin' });
});
after(() => { srv.server.close(); rmSync(home, { recursive: true, force: true }); });

test('the Machine page draws from the runner it was given, for the machine and for the tools', async () => {
  const r = await fetch(`${srv.url}/machine`);
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.match(text, /stub-busy-program/, "the busiest programs come from the given runner's ps");
  assert.match(text, />99\.9\.9</, "the tool versions come from the given runner");
  assert.ok(asked.includes('ps') && asked.includes('git'), `the runner was asked for ps and the tools: ${[...new Set(asked)]}`);
});
