// Every HQ page with the demo setting on (hq/lib/demo.mjs), against this repo: no private string reaches a page, a
// part, a raw file, the Chat's stream or the export. The strings are never written here. They come from what this
// checkout knows (git's authors and their emails, the GitHub owner and repo, the home folder), and on a laptop from the
// "private" list in <cache>/hq/demo.json or HQ_DEMO_PRIVATE (comma separated), which git never sees. The conversations
// and GitHub's answers are made here from the same strings, so the pages have something private to hide. The same
// server without the setting still shows them, which is what proves the setting is what hides them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { start } from '../../server.mjs';
import { demoConfig, demoFacts, demoSettings } from '../../lib/demo.mjs';
import { escapePath } from '../../lib/conversations.mjs';
import { loadItems } from '../../lib/backlog.mjs';
import { compute, summarise } from '../../lib/dora.mjs';
import { parseRemote } from '../../lib/outside.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAPTOP = process.env.HQ_CACHE || join(homedir(), '.cache', 'questkeep');
const git = args => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const cap = w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

// Who and where, from this checkout: each author with a first and last name, the remote, the home folder.
const people = [...new Map(git(['log', '--all', '--format=%an%x09%ae']).split('\n').filter(Boolean).map(l => l.split('\t'))
  .filter(([n]) => n.trim().split(/\s+/).length >= 2 && !/\[bot\]/i.test(n))
  .map(([n, e]) => { const [first, ...rest] = n.trim().split(/\s+/); return [first.toLowerCase(), { first: cap(first), last: rest.map(cap).join(' '), email: e }]; })).values()];
const slug = parseRemote(git(['remote', 'get-url', 'origin']).trim()) || '';
// a first name in lower case too, unless it is also a word (hq/demo.json's words), which the demo leaves alone
const words = JSON.parse(readFileSync(join(root, 'hq', 'demo.json'), 'utf8')).words || [];
let laptop = [];
try { laptop = JSON.parse(readFileSync(join(LAPTOP, 'hq', 'demo.json'), 'utf8')).private || []; } catch { /* not on this machine */ }
const PRIVATE = [...new Set([
  homedir(), homedir().replace(/[^a-zA-Z0-9-]/g, '-'), ...(slug ? [slug, slug.split('/')[0]] : []),
  ...people.flatMap(p => [p.first, ...(words.includes(p.first.toLowerCase()) ? [] : [p.first.toLowerCase()]), p.last, p.last.toLowerCase(), `${p.first[0]}${p.last}`.toLowerCase(), `${p.first} ${p.last}`, `${p.first}${p.last}`.toLowerCase(), p.email]),
  'QUESTKEEP HQ', 'QuestKeep HQ', ...laptop, ...(process.env.HQ_DEMO_PRIVATE || '').split(','),
].map(s => String(s).trim()).filter(s => s.length > 2))];
const someone = people.find(p => p.last);

// The strings a text holds that it should not.
const leaks = text => PRIVATE.filter(s => text.includes(s));

let demo, plain, cache;
const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002';
const gotCalls = [];

// gh as the real one answers, with people and the repo in its answers; anything about billing is refused and noted.
function fakeGh() {
  const at = '2026-09-29T10:00:00Z', sha = 'a'.repeat(40), login = `${someone.first}${someone.last}`.toLowerCase(), url = `https://github.com/${slug}`;
  const answers = [
    [a => a[0] === '--version', 'gh version 2.60.0 (2026-09-01)'],
    [a => a[0] === 'auth', `github.com\n  ✓ Logged in to github.com account ${login} (keyring)`],
    [a => a[0] === 'repo', JSON.stringify({ nameWithOwner: slug })],
    [a => a[1] === 'rate_limit', JSON.stringify({ resources: { core: { remaining: 4000, limit: 5000, reset: 0 } } })],
    [a => a[0] === 'pr', JSON.stringify([{ number: 7, title: `${someone.first}'s fix`, author: { login, name: `${someone.first} ${someone.last}` }, headRefName: 'fix/x', baseRefName: 'main', updatedAt: at, url: `${url}/pull/7`, isDraft: false, reviewDecision: '', statusCheckRollup: [] }])],
    [a => a[0] === 'run' && a.includes('40'), JSON.stringify([{ databaseId: 1, displayTitle: `Merge from ${login}`, workflowName: 'CI', status: 'completed', conclusion: 'success', headBranch: 'main', headSha: sha, event: 'push', createdAt: at, updatedAt: at, url: `${url}/actions/runs/1` }])],
    [a => /deployments/.test(a[1]), JSON.stringify([{ environment: 'production', sha, ref: 'main', creator: { login }, created_at: at }])],
    [a => /commits\?/.test(a[1]), JSON.stringify([{ sha, html_url: `${url}/commit/${sha}`, commit: { message: `fix: for ${someone.first}`, author: { name: `${someone.first} ${someone.last}`, email: someone.email, date: at } } }])],
    [a => /branches\?/.test(a[1]), JSON.stringify([{ name: 'main', protected: true }])],
  ];
  return async args => {
    gotCalls.push(args.join(' '));
    const hit = answers.find(([m]) => m(args));
    if (hit) return hit[1];
    throw Object.assign(new Error('HTTP 404: not in this test'), { stderr: '' });
  };
}

// claude replaying an answer that names someone and the home folder, with the plan's usage after it.
function fakeClaude() {
  const lines = [
    { type: 'system', subtype: 'init', session_id: B, model: 'claude-opus-5-5', apiKeySource: 'none', tools: ['Read'] },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: `${someone.first} wrote it, in ${homedir()}/repos.` } } },
    { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.02 }, seven_day: { utilization: 0.04 } } } },
    { type: 'result', is_error: false, result: `${someone.first} ${someone.last} wrote it.`, session_id: B, duration_ms: 900, num_turns: 1, permission_denials: [] },
  ];
  const spawn = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, kill() {} });
    child.stdin = new Writable({ write(c, _, cb) { cb(); }, final(cb) { cb(); setImmediate(() => { for (const l of lines) child.stdout.write(JSON.stringify(l) + '\n'); child.stdout.end(); child.exitCode = 0; child.emit('close', 0, null); }); } });
    return child;
  };
  return { spawn, find: async () => ({ version: '2.1.284 (Claude Code)', path: '/opt/claude' }), env: { PATH: process.env.PATH } };
}

// Two conversations about this repo: one from a terminal, whose title and prompt name someone, and one from HQ's Chat.
function transcripts(dir) {
  const main = dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
  const folder = join(dir, escapePath(main));
  mkdirSync(folder, { recursive: true });
  const line = o => JSON.stringify(o) + '\n';
  const base = (id, entrypoint, t) => ({ sessionId: id, cwd: main, gitBranch: 'main', entrypoint, timestamp: `2026-09-29T${t}:00Z` });
  writeFileSync(join(folder, `${A}.jsonl`), [
    { type: 'user', uuid: 'u1', ...base(A, 'cli', '09:00'), message: { role: 'user', content: `${someone.first} asked for this; write to ${someone.email}.` } },
    { type: 'ai-title', aiTitle: `Pairing with ${someone.first}`, sessionId: A },
    { type: 'assistant', uuid: 'u2', ...base(A, 'cli', '09:01'), message: { id: 'm1', role: 'assistant', usage: { input_tokens: 1, output_tokens: 1 }, content: [
      { type: 'text', text: `Done, ${someone.first} ${someone.last}.` }, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: `${main}/web/app.js` } }] } },
  ].map(line).join(''));
  writeFileSync(join(folder, `${B}.jsonl`), [
    { type: 'user', uuid: 'u3', ...base(B, 'sdk-cli', '10:00'), message: { role: 'user', content: `I am looking at the file docs/TESTING.md in QuestKeep HQ.\n\nWhat did ${someone.first} change?` } },
    { type: 'assistant', uuid: 'u4', ...base(B, 'sdk-cli', '10:01'), message: { id: 'm2', role: 'assistant', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: `The tests, in ${homedir()}/repos and on ${slug}.` }] } },
  ].map(line).join(''));
}

// make dora's figures for the Delivery page, from the real runs in fixtures/dora, whose links already name the GitHub
// owner; one red's branch is given someone's name, as a branch can be. Written now, so the page reads them as they are.
function delivery(dir) {
  const fx = n => JSON.parse(readFileSync(join(root, 'tests', 'unit', 'fixtures', 'dora', `${n}.json`), 'utf8'));
  const runs = fx('runs').map(r => r.id === 37168916705 ? { ...r, head_branch: `fix/${someone.first.toLowerCase()}-${someone.last.toLowerCase()}` } : r), jobs = fx('jobs');
  const main = runs.filter(r => r.path.endsWith('deploy.yml') && r.event === 'push').map(r => r.head_sha);
  const d = compute({ runs, jobsOf: (id, a) => jobs[`${id}-${a}`], pulls: fx('pulls'), lock: fx('lock'), git: { changed: () => true, contains: (a, b) => main.indexOf(b) <= main.indexOf(a) } });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'dora.json'), JSON.stringify(summarise(d, { asOf: Date.parse('2026-10-06T12:00:00Z'), repo: slug, sources: { runs: { status: 'read' } } })));
}

before(async () => {
  assert.ok(someone, 'git knows at least one author with a first and last name');
  cache = mkdtempSync(join(tmpdir(), 'hq-demo-cache-'));
  transcripts(join(cache, 'projects'));
  delivery(join(cache, 'dora'));
  const opts = { port: 0, cache, projectsDir: join(cache, 'projects'), gh: fakeGh(), claude: fakeClaude(),
    fb: { gcloud: async () => { throw Object.assign(new Error('spawn gcloud ENOENT'), { code: 'ENOENT' }); }, cli: async () => { throw new Error('not logged in'); } } };
  demo = await start({ ...opts, demo: demoConfig(demoFacts(root), demoSettings(LAPTOP)) });
  plain = await start({ ...opts, demo: null });
});
after(() => { demo?.server.close(); plain?.server.close(); rmSync(cache, { recursive: true, force: true }); });

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

// Each page answers, and none holds a private string. Failures are gathered so one run names them all.
async function sweep(paths) {
  const bad = [];
  for (const p of paths) {
    const r = await get(demo.url, p);
    if (r.status !== 200) bad.push(`${p}: ${r.status}`);
    if (r.body.startsWith('<!doctype html>') && /<nav class="hq-nav">[^]*?href="\/launch"[^]*?<\/nav>/.test(r.body)) bad.push(`${p}: the nav links to the Launch page`);
    for (const s of leaks(r.body)) bad.push(`${p}: ${s}`);
  }
  assert.deepEqual(bad, []);
}

const PAGES = ['/', '/code', '/code/web', '/code/docs', '/code/docs/TESTING.md', '/code/docs/backlog/inbox', '/code/web?as=list', '/code/docs?as=gallery', '/code/web?as=gallery',
  '/repo', '/testing', '/testing?tab=tests', '/testing?tab=runs', '/backlog', '/backlog?tab=list', '/backlog?tab=trends', '/backlog/paid-skins', '/decisions',
  '/conversations', '/conversations?q=asked', `/conversations/${A}`, `/conversations/${B}`, '/github', '/export', '/export?preview=1',
  '/export/download', '/export/download?sections=repo,docs,plans,backlog,tests,github,conversations&prompts=1', '/export/download?format=zip&preview=1', '/search?q=asked', '/claude/status',
  '/delivery', '/delivery?range=30d', '/delivery?list=changes', '/delivery?list=deploys&day=2026-10-05', '/delivery?range=30d&list=reds',
  ...['health', 'dashboard', 'prs', 'runs', 'deploys', 'commits', 'branches', 'firebase', 'ci-now', 'actions'].map(n => `/github/part/${n}`)];

test('every page, and every part of the GitHub page, holds no private string', async () => {
  await get(demo.url, '/conversations'); // the index loads once, so Home's "Changed in" lines have it
  await sweep(PAGES);
});

test('every backlog item holds no private string', async () => {
  await sweep(loadItems(root).map(i => `/backlog/${encodeURIComponent(i.slug)}`));
});

test('every file that holds a private string shows none, on its page and as a raw file', async () => {
  const files = git(['grep', '-l', '-I', '-F', ...PRIVATE.flatMap(s => ['-e', s])]).split('\n').filter(Boolean).filter(f => !f.startsWith('web/images/'));
  assert.ok(files.length > 0, 'this repo has files that name someone, so the sweep has something to prove');
  await sweep(files.flatMap(f => [`/code/${f}`, `/raw/${f}`]));
});

test('the Launch page, which lists sign-ups, is not in the demo', async () => {
  for (const p of ['/launch', '/launch?range=7', '/launch/', '/launch?fresh=1']) {
    const r = await get(demo.url, p);
    assert.equal(r.status, 404, p);
    assert.match(r.body, /not in the demo/, p);
    assert.deepEqual(leaks(r.body), [], p);
  }
});

test('the photos in web/images are not listed and not served', async () => {
  const photos = git(['ls-files', 'web/images']).split('\n').filter(Boolean);
  for (const f of photos) for (const p of [`/code/${f}`, `/raw/${f}`, `/${f}`, `/raw/${f.toUpperCase()}`]) assert.equal((await get(demo.url, p)).status, 404, p);
  assert.equal((await get(demo.url, '/code/web/images')).status, 404);
  for (const p of ['/', '/code/web', '/code/web?as=gallery']) assert.doesNotMatch((await get(demo.url, p)).body, /web\/images/, p);
});

test('a terminal conversation gets a title from what it did and keeps its transcript closed; a Chat one shows its own', async () => {
  const list = (await get(demo.url, '/conversations')).body;
  assert.match(list, /Changes to web\/app\.js/);
  const a = (await get(demo.url, `/conversations/${A}`)).body;
  assert.match(a, /This transcript stays closed in the demo/);
  assert.doesNotMatch(a, /asked for this/);
  assert.match((await get(demo.url, `/conversations/${B}`)).body, /What did \w+ change\?/);
});

test('a closed conversation offers no Continue and cannot be followed in the demo; a Chat one can', async () => {
  // the status a follow answers with, then the stream is let go
  const follow = (base, id) => new Promise((resolve, reject) => { const u = new URL(base); const q = request({ host: u.hostname, port: u.port, path: `/claude/follow?session=${id}` }, res => { resolve(res.statusCode); q.destroy(); }); q.on('error', e => (e.code === 'ECONNRESET' ? null : reject(e))); q.end(); });
  assert.doesNotMatch((await get(demo.url, `/conversations/${A}`)).body, /data-resume=/);
  assert.match((await get(demo.url, `/conversations/${B}`)).body, /data-resume=/);
  assert.equal(await follow(demo.url, A), 404, 'the demo will not follow a closed conversation');
  assert.equal(await follow(demo.url, B), 200, 'it follows one HQ\'s Chat started');
  assert.equal(await follow(plain.url, A), 200, 'without the demo setting it follows either');
});

test('the header reads HQ with its wordmark, and the Actions minutes are neither shown nor asked for', async () => {
  const home = (await get(demo.url, '/')).body;
  assert.match(home, /HQ<small class="hq-wordmark"[^>]*>HomeQuarters<\/small><\/a>/);
  assert.doesNotMatch(home, /data-load-part="actions"/);
  assert.doesNotMatch((await get(demo.url, '/github')).body, /data-load-part="actions"/);
  assert.equal(JSON.parse((await get(demo.url, '/github/part/actions')).body).html, '');
  assert.deepEqual(gotCalls.filter(c => /billing|\/orgs\//.test(c)), []);
});

test('Chat\'s answer arrives swapped, without the plan\'s usage', async () => {
  const r = await post(demo.url, '/claude/ask', { question: 'Who wrote the tests?' });
  assert.equal(r.status, 200);
  assert.deepEqual(leaks(r.text), []);
  const types = r.text.trim().split('\n').map(l => JSON.parse(l).type);
  assert.ok(types.includes('done') && !types.includes('limits'), types.join(' '));
});

test('without the demo setting the same pages still show what the setting hides', async () => {
  const home = (await get(plain.url, '/')).body;
  assert.match(home, /QUESTKEEP HQ/);
  assert.match(home, /data-load-part="actions"/);
  assert.match(home, /href="\/launch"/, 'the nav links to the Launch page');
  assert.ok(home.includes(homedir()), 'the Links card names the checkout by its full path');
  assert.ok((await get(plain.url, '/conversations')).body.includes(`Pairing with ${someone.first}`));
  assert.equal((await get(plain.url, `/raw/${git(['ls-files', 'web/images']).split('\n')[0]}`)).status, 200);
  const r = await post(plain.url, '/claude/ask', { question: 'Who wrote the tests?' });
  assert.ok(r.text.includes('"type":"limits"'));
});
