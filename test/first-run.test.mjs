// Proves: the first page a stranger sees works and explains itself: a repo with no README.md opens on its folder view,
// a repo with no hq.json gets a card on Home saying what HQ is, what it found, the manifest it would propose and the
// pages that would turn on; GitHub leaves the nav when the repo has no GitHub remote; and no baseline page speaks
// QuestKeep. Why: Noor's review of the served pages and the stranger's install both met a 404, a chat panel over the
// page, and Firebase, emulators and gates on a hello-world repo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { start } from '../server.mjs';
import { resolveManifest } from '../lib/manifest.mjs';

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
let home, repo, cache, srv;
const noGh = async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); };

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'hq-first-run-'));
  repo = join(home, 'hello'); cache = join(home, 'cache');
  mkdirSync(join(repo, 'src'), { recursive: true }); mkdirSync(join(cache, 'no-transcripts'), { recursive: true });
  writeFileSync(join(repo, 'src', 'hello.mjs'), 'console.log("hello");\n');
  writeFileSync(join(repo, 'Makefile'), 'test:\n\t@node src/hello.mjs\n');
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'first');
  const { m } = resolveManifest(null, { repo, home, env: {} });
  srv = await start({ port: 0, repo, cache, m: { ...m, cache }, projectsDir: join(cache, 'no-transcripts'), gh: noGh,
    fb: { gcloud: noGh, cli: noGh } });
});
after(() => { srv.server.close(); rmSync(home, { recursive: true, force: true }); });
const page = async p => { const r = await fetch(`${srv.url}${p}`); return { status: r.status, text: await r.text() }; };

test('with no README.md, Home opens on the folder view instead of a 404', async () => {
  const r = await page('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /src\//);
  assert.doesNotMatch(r.text, /No such file/);
});

test('with no hq.json, Home says what HQ is, what it found, the hq.json it proposes and the pages it would turn on', async () => {
  const { text } = await page('/');
  assert.match(text, /class="kicker"[^>]*>First run/, 'a first-run card');
  assert.match(text, /HQ is a local website for this repo/);
  assert.match(text, /Makefile/, 'what the scan found');
  assert.match(text, /&quot;name&quot;: &quot;hello&quot;/, 'the proposed manifest, as hq setup would print it');
  assert.match(text, /Testing|Backlog|Decisions/, 'the pages a manifest would turn on');
  assert.match(text, /href="\/machine"/);
});

test('with no GitHub remote, GitHub is not in the nav and its page says why', async () => {
  const { text } = await page('/');
  assert.doesNotMatch(text, /<nav class="hq-nav">[^]*?href="\/github"/, 'no GitHub link in the nav');
  const gh = await page('/github');
  assert.equal(gh.status, 404);
  assert.match(gh.text, /no GitHub remote/);
});

test('no baseline page speaks QuestKeep', async () => {
  const words = /QuestKeep|Firebase|emulator|players|docker-test|ci-history|make dora|deploy gate|2 October 2026|docs\/plans|CLAUDE\.md|OrbStack|status line/;
  for (const p of ['/', '/code', '/code/Makefile', '/repo', '/machine', '/conversations', '/export', '/search?q=hello']) {
    const r = await page(p);
    assert.equal(r.status, 200, p);
    const m = words.exec(r.text);
    assert.equal(m, null, `${p} says "${m && m[0]}"`);
  }
});

test('the Chat panel starts closed, and the comments button tucked away, until the person opens them', async () => {
  const chat = await page('/static/hq-claude.js'), comments = await page('/static/hq-comments.js');
  assert.match(chat.text, /open: false/, 'the saved view defaults to closed');
  assert.match(comments.text, /store\.get\(PLACE, 'tucked'\)/, 'the button defaults to the edge tab');
});
