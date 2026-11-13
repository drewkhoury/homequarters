// Proves: with the demo setting on, the server swaps the names in what comes from outside the repo: Chat's answer, which
// also arrives without the plan's usage figures; GitHub's answers on the GitHub page; and a conversation from a
// terminal, which stays closed and offers no Continue. It never asks for the Actions minutes. The same server without
// the setting still shows every one of those names, which is what proves the setting is what hides them.
// Why: hq check --demo renders the pages against the repo, but it asks no GitHub, starts no Claude and reads no
// conversation files, so on those pages it sees nothing to hide. QuestKeep's tests/unit/hq-demo-pages.test.mjs checked
// them from inside QuestKeep with fakes; these are its checks the package had not taken with it (decision 17).
// The names here are made up, as in test/check-demo.test.mjs: Rose Quartzfake is a git author with an email, the home
// folder is a scratch folder, and fakeowner/fakerepo is the GitHub remote. gh, claude and the transcripts are fakes
// handed to the server through its own options, so nothing here reaches GitHub, Claude or ~/.claude.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { start } from '../server.mjs';
import { demoConfig, demoFacts, demoSettings } from '../lib/demo.mjs';
import { escapePath } from '../lib/conversations.mjs';
import { resolveManifest } from '../lib/manifest.mjs';

const PACKAGE_SETTINGS = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo.json');
const SOMEONE = { first: 'Rose', last: 'Quartzfake', email: 'rose.q@mail.invalid' };
const SLUG = 'fakeowner/fakerepo', LOGIN = 'rosequartzfake';
// A terminal conversation (A) and one HQ's Chat started (B), which the demo keeps open.
const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002';

let home, repo, cache, demo, plain, PRIVATE;
const gotCalls = [];

// The strings a page must not hold with the setting on: the person in each way a page writes them (Rose is also a word,
// so only its capitalised form is swapped), their email and login, the home folder and the GitHub remote.
const privateStrings = () => [SOMEONE.first, SOMEONE.last, SOMEONE.last.toLowerCase(), `${SOMEONE.first} ${SOMEONE.last}`, LOGIN,
  `r${SOMEONE.last}`.toLowerCase(), SOMEONE.email, home, home.replace(/[^a-zA-Z0-9-]/g, '-'), SLUG, SLUG.split('/')[0]];
const leaks = text => PRIVATE.filter(s => text.includes(s));

// gh as the real one answers, with the person and the repo in its answers; anything about billing is refused and noted.
function fakeGh() {
  const at = '2026-09-29T10:00:00Z', sha = 'a'.repeat(40), url = `https://github.com/${SLUG}`, name = `${SOMEONE.first} ${SOMEONE.last}`;
  const answers = [
    [a => a[0] === '--version', 'gh version 2.60.0 (2026-09-01)'],
    [a => a[0] === 'auth', `github.com\n  ✓ Logged in to github.com account ${LOGIN} (keyring)`],
    [a => a[0] === 'repo', JSON.stringify({ nameWithOwner: SLUG })],
    [a => a[1] === 'rate_limit', JSON.stringify({ resources: { core: { remaining: 4000, limit: 5000, reset: 0 } } })],
    [a => a[0] === 'pr', JSON.stringify([{ number: 7, title: `${SOMEONE.first}'s fix`, author: { login: LOGIN, name }, headRefName: 'fix/x', baseRefName: 'main', updatedAt: at, url: `${url}/pull/7`, isDraft: false, reviewDecision: '', statusCheckRollup: [] }])],
    [a => a[0] === 'run' && a.includes('40'), JSON.stringify([{ databaseId: 1, displayTitle: `Merge from ${LOGIN}`, workflowName: 'CI', status: 'completed', conclusion: 'success', headBranch: 'main', headSha: sha, event: 'push', createdAt: at, updatedAt: at, url: `${url}/actions/runs/1` }])],
    [a => /deployments/.test(a[1]), JSON.stringify([{ environment: 'production', sha, ref: 'main', creator: { login: LOGIN }, created_at: at }])],
    [a => /commits\?/.test(a[1]), JSON.stringify([{ sha, html_url: `${url}/commit/${sha}`, commit: { message: `fix: for ${SOMEONE.first}`, author: { name, email: SOMEONE.email, date: at } } }])],
    [a => /branches\?/.test(a[1]), JSON.stringify([{ name: 'main', protected: true }])],
  ];
  return async args => {
    gotCalls.push(args.join(' '));
    const hit = answers.find(([m]) => m(args));
    if (hit) return hit[1];
    throw Object.assign(new Error('HTTP 404: not in this test'), { stderr: '' });
  };
}

// claude replaying an answer that names the person and the home folder, with the plan's usage after it.
function fakeClaude() {
  const lines = [
    { type: 'system', subtype: 'init', session_id: B, model: 'claude-opus-5-5', apiKeySource: 'none', tools: ['Read'] },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: `${SOMEONE.first} wrote it, in ${home}/repos.` } } },
    { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.02 }, seven_day: { utilization: 0.04 } } } },
    { type: 'result', is_error: false, result: `${SOMEONE.first} ${SOMEONE.last} wrote it.`, session_id: B, duration_ms: 900, num_turns: 1, permission_denials: [] },
  ];
  const spawn = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, kill() {} });
    child.stdin = new Writable({ write(c, _, cb) { cb(); }, final(cb) { cb(); setImmediate(() => { for (const l of lines) child.stdout.write(JSON.stringify(l) + '\n'); child.stdout.end(); child.exitCode = 0; child.emit('close', 0, null); }); } });
    return child;
  };
  return { spawn, find: async () => ({ version: '2.1.284 (Claude Code)', path: '/opt/claude' }), env: { PATH: process.env.PATH }, alive: async () => false };
}

// The two conversations about this repo, as Claude Code files them: the terminal one's title and prompt name the person.
function transcripts(dir) {
  const folder = join(dir, escapePath(repo));
  mkdirSync(folder, { recursive: true });
  const line = o => JSON.stringify(o) + '\n';
  const base = (id, entrypoint, t) => ({ sessionId: id, cwd: repo, gitBranch: 'main', entrypoint, timestamp: `2026-09-29T${t}:00Z` });
  writeFileSync(join(folder, `${A}.jsonl`), [
    { type: 'user', uuid: 'u1', ...base(A, 'cli', '09:00'), message: { role: 'user', content: `${SOMEONE.first} asked for this; write to ${SOMEONE.email}.` } },
    { type: 'ai-title', aiTitle: `Pairing with ${SOMEONE.first}`, sessionId: A },
    { type: 'assistant', uuid: 'u2', ...base(A, 'cli', '09:01'), message: { id: 'm1', role: 'assistant', usage: { input_tokens: 1, output_tokens: 1 }, content: [
      { type: 'text', text: `Done, ${SOMEONE.first} ${SOMEONE.last}.` }, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: `${repo}/web/app.js` } }] } },
  ].map(line).join(''));
  writeFileSync(join(folder, `${B}.jsonl`), [
    { type: 'user', uuid: 'u3', ...base(B, 'sdk-cli', '10:00'), message: { role: 'user', content: `I am looking at the file README.md.\n\nWhat did ${SOMEONE.first} change?` } },
    { type: 'assistant', uuid: 'u4', ...base(B, 'sdk-cli', '10:01'), message: { id: 'm2', role: 'assistant', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: `The tests, in ${home}/repos and on ${SLUG}.` }] } },
  ].map(line).join(''));
}

before(async () => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'hq-demo-server-')));
  repo = join(home, 'repos', 'doors'); cache = join(home, 'cache');
  PRIVATE = privateStrings();
  mkdirSync(join(repo, 'web'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# Doors\n\nA repo.\n');
  writeFileSync(join(repo, 'web', 'app.js'), 'export const door = 1;\n');
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: `${SOMEONE.first} ${SOMEONE.last}`, GIT_AUTHOR_EMAIL: SOMEONE.email, GIT_COMMITTER_NAME: `${SOMEONE.first} ${SOMEONE.last}`, GIT_COMMITTER_EMAIL: SOMEONE.email };
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { env });
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', `https://github.com/${SLUG}.git`], { env });
  execFileSync('git', ['-C', repo, 'add', '.'], { env });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'doors'], { env });
  transcripts(join(cache, 'projects'));
  const { m } = resolveManifest({ schemaVersion: 1, name: 'doors', cache }, { repo, home, env: {} });
  const opts = { port: 0, repo, m, cache, projectsDir: join(cache, 'projects'), gh: fakeGh(), claude: fakeClaude(),
    fb: { gcloud: async () => { throw Object.assign(new Error('spawn gcloud ENOENT'), { code: 'ENOENT' }); }, cli: async () => { throw new Error('not logged in'); } } };
  // demoFacts adds git's own user.name as a person; the test's HOME may set one ("HQ Test" would make every "hq" in the
  // markup a stand-in), so git reads no global config while the facts are gathered
  const was = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  let facts;
  try { facts = demoFacts(repo, home, { name: 'doors' }); } finally { if (was === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = was; }
  demo = await start({ ...opts, demo: demoConfig(facts, demoSettings(cache, PACKAGE_SETTINGS)) });
  plain = await start({ ...opts, demo: null });
});
after(() => { demo?.server.close(); plain?.server.close(); rmSync(home, { recursive: true, force: true }); });

const get = (base, path) => new Promise((resolve, reject) => {
  const u = new URL(base);
  request({ host: u.hostname, port: u.port, path }, res => { const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') })); }).on('error', reject).end();
});
const post = (base, path, body) => new Promise((resolve, reject) => {
  const u = new URL(base), data = JSON.stringify(body);
  request({ host: u.hostname, port: u.port, path, method: 'POST', headers: { 'content-type': 'application/json', origin: base } }, res => {
    let text = ''; res.on('data', d => (text += d)); res.on('end', () => resolve({ status: res.statusCode, text }));
  }).on('error', reject).end(data);
});
// the status a follow answers with, then the stream is let go
const follow = (base, id) => new Promise((resolve, reject) => {
  const u = new URL(base);
  const q = request({ host: u.hostname, port: u.port, path: `/claude/follow?session=${id}` }, res => { resolve(res.statusCode); q.destroy(); });
  q.on('error', e => (e.code === 'ECONNRESET' ? null : reject(e)));
  q.end();
});
const GITHUB = ['/github', ...['health', 'dashboard', 'prs', 'runs', 'deploys', 'commits', 'branches'].map(n => `/github/part/${n}`)];

test('Chat\'s answer arrives swapped, without the plan\'s usage', async () => {
  const r = await post(demo.url, '/claude/ask', { question: 'Who wrote the tests?' });
  assert.equal(r.status, 200);
  assert.deepEqual(leaks(r.text), []);
  const types = r.text.trim().split('\n').map(l => JSON.parse(l).type);
  assert.ok(types.includes('done') && !types.includes('limits'), types.join(' '));
});

test('GitHub\'s answers reach the GitHub page swapped', async () => {
  const bad = [];
  for (const p of GITHUB) {
    const r = await get(demo.url, p);
    if (r.status !== 200) bad.push(`${p}: ${r.status}`);
    for (const s of leaks(r.body)) bad.push(`${p}: ${s}`);
  }
  assert.deepEqual(bad, []);
});

test('the Actions minutes are neither shown nor asked for in the demo', async () => {
  assert.doesNotMatch((await get(demo.url, '/')).body, /data-load-part="actions"/);
  assert.doesNotMatch((await get(demo.url, '/github')).body, /data-load-part="actions"/);
  assert.equal(JSON.parse((await get(demo.url, '/github/part/actions')).body).html, '');
  assert.deepEqual(gotCalls.filter(c => /billing|\/orgs\//.test(c)), []);
});

test('a terminal conversation stays closed, with no Continue and no following; a Chat one stays open', async () => {
  const list = (await get(demo.url, '/conversations')).body;
  assert.match(list, /Changes to web\/app\.js/, 'its title is made from what it did');
  assert.deepEqual(leaks(list), []);
  const a = (await get(demo.url, `/conversations/${A}`)).body;
  assert.match(a, /This transcript stays closed in the demo/);
  assert.doesNotMatch(a, /asked for this/);
  assert.doesNotMatch(a, /data-resume=/, 'no Continue in Terminal');
  assert.equal(await follow(demo.url, A), 404, 'the demo will not follow a closed conversation');
  const b = (await get(demo.url, `/conversations/${B}`)).body;
  assert.match(b, /What did \w+ change\?/);
  assert.match(b, /data-resume=/);
  assert.equal(await follow(demo.url, B), 200, 'it follows one HQ\'s Chat started');
});

test('without the demo setting the same pages still show the names the setting hides', async () => {
  const r = await post(plain.url, '/claude/ask', { question: 'Who wrote the tests?' });
  assert.ok(r.text.includes(`${SOMEONE.first} wrote it`), 'Chat\'s answer names the person');
  assert.ok(r.text.includes('"type":"limits"'), 'and carries the plan\'s usage');
  const gh = (await Promise.all(GITHUB.map(p => get(plain.url, p)))).map(x => x.body).join('\n');
  for (const s of [LOGIN, SLUG, `${SOMEONE.first}'s fix`]) assert.ok(gh.includes(s) || gh.includes(s.replace("'", '&#39;')), `the GitHub page shows ${s}`);
  assert.match((await get(plain.url, '/')).body, /data-load-part="actions"/);
  assert.ok((await get(plain.url, '/conversations')).body.includes(`Pairing with ${SOMEONE.first}`));
  const a = (await get(plain.url, `/conversations/${A}`)).body;
  assert.match(a, /asked for this/);
  assert.match(a, /data-resume=/);
  assert.equal(await follow(plain.url, A), 200, 'without the demo setting it follows either');
});
