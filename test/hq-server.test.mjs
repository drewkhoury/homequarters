// Proves: the server, started on a free port against a small git repo and cache made here that follow the conventions
// their hq.json names, answers every page as text, gates the pages the manifest leaves off, and lets nothing outside
// the repo and the cache be read through it.
// Why: this is the one test that runs the whole site as a stranger's install would, without a browser and without
// reading QuestKeep's files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, realpathSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { start } from '../server.mjs';
import { resolveManifest } from '../lib/manifest.mjs';
import { demoConfig, demoFacts, demoSettings } from '../lib/demo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let server, url, cache, REPO;
// One recorded run, as devpipe keeps it, so the Tests and Runs pages have something to show.
const RUN_ID = '2026-09-26T16-23-53Z_024359';
// the header as lib/page.mjs draws it for this repo: HQ with the project's name beside it
const BRAND = /<a class="brand" href="\/">HQ <span class="hq-brand-name">scratch<\/span><\/a>/;

// A five-field test header, as tests/headers.mjs reads them.
const header = ({ proves, why = 'So the page has a header to show.', runsIn, takes, when = 'When its code changes.' }) =>
  `// Proves: ${proves}\n// Why it exists: ${why}\n// Runs in: ${runsIn}\n// Takes: ${takes}\n// Run it when: ${when}\n`;

// The repo: a README, docs with and without sections, a backlog, a Makefile naming the browser sets, test files with
// headers, the layers and pipeline files, a Firebase project file, and hq.json naming them all. One commit on main.
function scratchRepo(cache) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'hq-scratch-')));
  const put = (rel, text) => { mkdirSync(join(repo, dirname(rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
  put('README.md', '# Scratch\n\nA small repo made for HQ\'s server tests.\n');
  put('docs/TESTING.md', ['# Testing', '', 'How this repo is tested.', '', '## Unit tests', '', 'Pure logic in node.', '', '## The gate', '', 'The browser tests before a merge.', '',
    '### Lanes', '', 'Two at once.', '', '## The long set', '', 'After a deploy.', ''].join('\n'));
  put('docs/notes.md', readFileSync(join(HERE, 'fixtures', 'no-sections.md'), 'utf8'));
  put('docs/backlog/README.md', '# Backlog\n\nOne file per item in inbox, next or parked.\n');
  put('docs/backlog/inbox/name-your-world.md', '---\ntype: feature\nasked: Rose, 28 Sep\n---\n# Name your world\n\nA world could carry a name.\n');
  put('docs/backlog/next/paid-skins.md', '---\ntype: question\nasked: Rose, 29 Sep\n---\n# Paid skins\n\nWhether to charge at all.\n');
  put('Makefile', 'GATE := smoke-sync smoke-reject\nAFTER := walk-world\n\ntest:\n\tnode tests/smoke-sync.js\n');
  put('web/app.js', 'export const x = 1;\n');
  put('tests/smoke-sync.js', header({ proves: 'Two browsers see one change.', runsIn: 'gate', takes: '26 s, budget 30 s on CI' }));
  put('tests/smoke-reject.js', header({ proves: 'A refused save keeps your work.', runsIn: 'gate', takes: '12 s, budget 20 s on CI' }));
  put('tests/walk-world.js', header({ proves: 'A long walk holds together.', runsIn: 'after.yml', takes: '3 min' }));
  put('tests/unit/contract.test.mjs', `${header({ proves: 'What the app sends is what the rules accept.', runsIn: 'make test-rules', takes: 'under a second' })}import { test } from 'node:test';\ntest('contract', () => {});\n`);
  cpSync(join(HERE, 'fixtures', 'hq-layers.json'), join(repo, 'tests', 'layers.json'));
  put('hq/pipeline.json', JSON.stringify({ paths: [{ title: 'A pull request', steps: [
    { title: 'Unit tests', layers: ['unit'], results: [{ where: 'laptop', task: 'unit' }] },
    { title: 'The gate', sets: ['gate'], layers: ['browser'], results: [{ where: 'laptop', task: 'gate' }] }] }] }));
  put('.firebaserc', JSON.stringify({ projects: { default: 'scratch' } }));
  put('hq.json', JSON.stringify(manifestRaw(cache), null, 2));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.com', ...args], { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'A repo for HQ\'s tests');
  git('remote', 'add', 'origin', 'https://github.com/scratch-org/scratch.git'); // a GitHub remote, never fetched: HQ asks gh, not git, about it
  return repo;
}
// hq.json for the scratch repo; `tests` can be swapped for the layers tests below
const manifestRaw = (cache, tests = { layers: 'tests/layers.json', pipeline: 'hq/pipeline.json' }) => ({ schemaVersion: 1, name: 'scratch', cache,
  backlog: { dir: 'docs/backlog' }, tests, stores: ['runs', 'lock', 'problems', 'dora', 'ci'], deploy: [{ env: 'prod', provider: 'firebase-hosting', url: 'https://scratch.web.app' }] });
const manifest = (cache, tests) => resolveManifest(manifestRaw(cache, tests), { repo: REPO }).m;

before(async () => {
  cache = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  REPO = scratchRepo(cache);
  // no transcripts: the Conversations page reads an empty folder here, never the developer's ~/.claude
  mkdirSync(join(cache, 'no-transcripts'));
  const dir = join(cache, 'runs', 'runs', RUN_ID);
  mkdirSync(join(dir, 'logs'), { recursive: true });
  writeFileSync(join(dir, 'logs', 'gate.log'), '=== run {"kind":"gate","where":"laptop","who":"person","branch":"main","commit":"a6cc739","dirty":false}\n=== smoke-sync (26s)\nALL PASS\n');
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ runId: RUN_ID, timestamp: '2026-09-26T16:24:40Z', tasks: [
    { id: 'gate', name: 'Browser gate', status: 'PASS', durationMs: 26000, logPath: join(dir, 'logs', 'gate.log'),
      metrics: { data: { testcases: [{ name: 'smoke-sync', status: 'passed', time: 26 }] } } }] }));
  // the repo's own hq.json is read, as `hq` in that folder would read it
  ({ server, url } = await start({ port: 0, repo: REPO, cache, projectsDir: join(cache, 'no-transcripts'), gh: async () => { const e = new Error('spawn gh ENOENT'); e.code = 'ENOENT'; throw e; },
    fb: { gcloud: async () => { throw Object.assign(new Error('spawn gcloud ENOENT'), { code: 'ENOENT' }); }, cli: async () => { throw new Error('not logged in'); } } }));
});
after(() => { server.close(); rmSync(cache, { recursive: true, force: true }); rmSync(REPO, { recursive: true, force: true }); });

// A raw request, so the path goes out exactly as written (fetch would tidy away the ../).
const get = (path, { method = 'GET', host } = {}) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const req = request({ host: u.hostname, port: u.port, path, method, headers: host ? { host } : {} }, res => {
    const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), location: res.headers.location }));
  });
  req.on('error', reject); req.end();
});

test('every page answers 200', async () => {
  for (const p of ['/', '/code', '/code/web', '/code/web/app.js', '/code/docs/TESTING.md', '/testing', '/testing?tab=tests', '/testing?tab=runs',
    '/testing?tab=runs&where=laptop&branch=main', '/testing?tab=runs&test=smoke-sync', `/runs/${RUN_ID}`, `/runs/${RUN_ID}/log/gate`, '/search?q=closedStream', '/github', '/backlog', '/backlog?tab=list', '/backlog?tab=trends', '/backlog/paid-skins', '/conversations', '/conversations?q=backlog', '/export', `/runs/${RUN_ID}/live`, '/code/docs/backlog/inbox', '/code/web?as=list', '/code/docs?as=gallery', '/repo', '/machine']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.body, BRAND, p);
  }
});

test('a page the manifest has not turned on is not there, and says what would turn it on', async () => {
  // the same repo with nothing but its name declared: the baseline pages only
  const bare = await start({ port: 0, repo: REPO, cache, m: resolveManifest({ schemaVersion: 1, name: 'scratch', cache }, { repo: REPO }).m, projectsDir: join(cache, 'no-transcripts'), gh: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
  try {
    for (const p of ['/testing', '/backlog', '/decisions', '/delivery', '/problems', `/runs/${RUN_ID}`]) {
      const r = await fetch(`${bare.url}${p}`);
      assert.equal(r.status, 404, p);
      assert.match(await r.text(), /hq\.json does not name what it reads/, p);
    }
    const home = await (await fetch(`${bare.url}/`)).text();
    assert.doesNotMatch(home, /href="\/testing"|href="\/backlog"/, 'the nav shows only the baseline');
    assert.match(home, /href="\/machine"/);
    // and Home shows only the cards the manifest turns on: no Backlog or Tests card, and none of the GitHub cards without a remote (e76b5b8 had no test)
    assert.doesNotMatch(home, /class="kicker" href="\/(testing|backlog|decisions|delivery|problems)"/, 'no card for a page that is off');
    assert.doesNotMatch(home, /data-load-part="firebase"/, 'no Live site card without a deploy provider');
    assert.match(home, /data-load-part="ci-now"/, 'the GitHub cards follow the remote, which this scratch repo has');
    assert.match(home, /class="kicker" href="\/repo"/, 'the Repo card stays');
  } finally { bare.server.close(); }
});

test('Home opens on README.md, rendered', async () => {
  const r = await get('/');
  assert.match(r.body, /class="hq-mdview" data-view="preview" data-asked/);
  assert.match(r.body, /<h1 id="scratch"/);
});

test('the old pages send you to their new places', async () => {
  assert.equal((await get('/tests')).location, '/testing?tab=tests');
  assert.equal((await get('/runs')).location, '/testing?tab=runs');
  assert.equal((await get('/pipeline')).location, '/testing');
  assert.equal((await get('/docs/docs/TESTING.md')).location, '/code/docs/TESTING.md');
});

test('the Tests tab shows the recorded result for a test, and a test opens to its runs', async () => {
  const r = await get('/testing?tab=tests');
  assert.match(r.body, /id="t-smoke-sync"[\s\S]*?hq-res pass/);
  assert.match(r.body, /href="\/testing\?tab=runs&amp;test=smoke-sync"/);
  const runs = await get('/testing?tab=runs&test=smoke-sync');
  assert.match(runs.body, new RegExp(`/runs/${RUN_ID}`));
});

test('the filter keeps runs from elsewhere out, and carries across the tabs', async () => {
  assert.doesNotMatch((await get('/testing?tab=runs&where=ci')).body, new RegExp(`/runs/${RUN_ID}`));
  assert.match((await get('/testing?tab=runs&where=laptop')).body, new RegExp(`/runs/${RUN_ID}`));
  assert.match((await get('/testing?tab=runs&where=ci')).body, /href="\/testing\?where=ci&amp;tab=tests"/);
});

test('a run opens to its tests', async () => {
  assert.match((await get(`/runs/${RUN_ID}`)).body, /data-col="test"[^>]*><span class="hq-cell"><a href="\/testing\?tab=runs&amp;test=smoke-sync"/);
});

test("the theme's stylesheets, HQ's own, and a cache file are served; the app's old /web path is not", async () => {
  assert.equal((await get('/theme/nocturne.css')).status, 200);
  assert.equal((await get('/theme/base.css')).status, 200);
  assert.equal((await get('/hq/hq.css')).status, 200);
  assert.equal((await get(`/cache/runs/runs/${RUN_ID}/run.json`)).status, 200);
  assert.equal((await get('/web/nocturne.css')).status, 404, 'the theme is HQ\'s own copy, not the app\'s file');
});

test('a path out of the repo or the cache is refused', async () => {
  for (const p of ['/raw/../../../../etc/passwd', '/raw/%2e%2e/%2e%2e/%2e%2e/etc/passwd', '/cache/../../../etc/passwd', '/raw/.git/HEAD', '/raw/node_modules/marked/package.json', '/web/../../etc/passwd']) {
    const r = await get(p);
    assert.ok(r.status === 403 || r.status === 404, `${p} answered ${r.status}`);
    assert.doesNotMatch(r.body, /root:|ref: refs/, p);
  }
});

test('another host name is refused, so a page elsewhere cannot rebind a name to HQ', async () => {
  assert.equal((await get('/tests', { host: 'evil.example:80' })).status, 403);
});

test('anything but GET and HEAD is refused', async () => {
  assert.equal((await get('/tests', { method: 'POST' })).status, 405);
});

test('a file that is not there is a 404', async () => {
  assert.equal((await get('/code/docs/NOPE.md')).status, 404);
  assert.equal((await get('/code/../../../etc/passwd')).status, 404);
});

test("a run's log shows its lines, and a log path that climbs out of the run is a 404", async () => {
  assert.match((await get(`/runs/${RUN_ID}/log/gate`)).body, /id="L3"[\s\S]*ALL PASS/);
  assert.equal((await get(`/runs/${RUN_ID}/log/..%2F..%2Frun.json`)).status, 404);
  assert.equal((await get('/runs/no-such-run')).status, 404);
});

test('the code viewer numbers every line and links each to the editor', async () => {
  const r = await get('/code/Makefile');
  assert.match(r.body, /<tr id="L1">/);
  assert.match(r.body, /vscode:\/\/file\/[^"]*Makefile:1"/);
});

test('the code viewer refuses the same paths the files do', async () => {
  for (const p of ['/code/../../../etc/passwd', '/code/.git/config', '/code/node_modules/marked/package.json']) assert.equal((await get(p)).status, 404, p);
});

test('the GitHub page loads each tab on its own, and says so when gh is not installed', async () => {
  const page = (await get('/github?tab=runs')).body;
  assert.match(page, /data-part="runs"[^>]*aria-label="Runs"/);
  assert.match(page, /data-part="dashboard" hidden/);
  assert.match((await get('/github')).body, /data-load-part="actions"/);
  for (const name of ['dashboard', 'prs', 'runs', 'actions']) {
    const part = JSON.parse((await get(`/github/part/${name}`)).body);
    assert.equal(part.ok, false, name);
    assert.match(part.html, /gh is not installed/, name);
  }
  const health = JSON.parse((await get('/github/part/health')).body);
  assert.equal(health.ok, false);
  assert.match(health.html, /cli\.github\.com/);
});

test('a markdown file on the Code page offers Code, Preview and Split, with its headings tied to their lines', async () => {
  const r = await get('/code/docs/TESTING.md?view=split');
  assert.match(r.body, /class="hq-mdview" data-view="split"/);
  assert.match(r.body, /class="seg hq-views"/);
  assert.match(r.body, /<tr id="L1">/);
  assert.match(r.body, /<h1 id="testing" data-line="1">/);
  assert.doesNotMatch((await get('/code/Makefile')).body, /hq-mdview|hq-views/);
});

test("a markdown file's sections show as a rail beside it, with a button in its header, and a short or code file has neither", async () => {
  const r = await get('/code/docs/TESTING.md');
  const rail = /<nav class="hq-rail" aria-label="On this page"[^>]*>([\s\S]*?)<\/nav>/.exec(r.body);
  assert.ok(rail, 'the page has a section rail');
  const side = r.body.indexOf('class="hq-side"'), main = r.body.indexOf('class="hq-codemain'), at = r.body.indexOf('class="hq-rail"'), panel = r.body.indexOf('class="hq-panel"');
  assert.ok(side >= 0 && side < main && main < at && at < panel, 'it sits in the document column, not under the file tree');
  // one entry per second- and third-level heading of the rendered file, and each goes to a heading that is there
  const headings = [...r.body.matchAll(/<h[23] id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(headings.length > 2, 'the fixture file has enough headings to be worth a rail');
  const card = /<ol class="hq-rail-list">([\s\S]*?)<\/ol>/.exec(rail[1]);
  assert.ok(card, 'the rail holds the list of sections the card shows');
  assert.deepEqual([...card[1].matchAll(/href="#([^"]+)"/g)].map(m => m[1]), headings);
  for (const [, id] of rail[1].matchAll(/href="#([^"]+)"/g)) assert.ok(headings.includes(id), `${id} is a heading on the page`);
  const button = /<button type="button" class="[^"]*hq-sections[^"]*"[^>]*aria-expanded="false"[^>]*><span aria-hidden="true">≡<\/span> (\d+) sections<\/button>/.exec(r.body);
  assert.ok(button, 'the file header has a sections button');
  assert.equal(+button[1], headings.length);
  assert.ok(r.body.indexOf('class="hq-filehead-right"') < button.index, 'the button is in the file header');
  // in the Code view the preview is hidden, so each goes to its heading's line instead
  const code = (await get('/code/docs/TESTING.md?view=code')).body;
  const lines = [.../<ol class="hq-rail-list">([\s\S]*?)<\/ol>/.exec(code)[1].matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.equal(lines.length, headings.length);
  for (const href of lines) { assert.match(href, /^#L\d+$/); assert.match(code, new RegExp(`<tr id="${href.slice(1)}">`)); }
  // a markdown file with a title and no sections, and a Makefile with none to speak of
  for (const path of ['/code/Makefile', '/code/docs/notes.md']) assert.doesNotMatch((await get(path)).body, /class="hq-rail"|hq-sections/, path);
});

test('on Home each section of a markdown file is wrapped on its own, heading and all', async () => {
  const body = (await get('/code/docs/TESTING.md')).body, preview = body.slice(body.indexOf('hq-pane-preview'));
  assert.ok((preview.match(/<section class="hq-sec"><h2 /g) || []).length > 2);
  assert.equal((preview.match(/<h2 /g) || []).length, (preview.match(/<section class="hq-sec"><h2 /g) || []).length, 'no second-level heading is left outside a section');
});

// the same repo with another `tests` key in its manifest
const withTests = tests => start({ port: 0, repo: REPO, cache, m: manifest(cache, tests), projectsDir: join(cache, 'no-transcripts'), gh: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });

test('with no layers file, the kinds of test are left out quietly', async () => {
  // a manifest naming a layers file that is not there, and one naming none at all
  for (const tests of [{ layers: 'nonexistent/hq-layers.json', pipeline: 'hq/pipeline.json' }, { pipeline: 'hq/pipeline.json' }]) {
    const other = await withTests(tests);
    try { assert.doesNotMatch(await (await fetch(`${other.url}/testing`)).text(), /hq-layercard|<dialog/, JSON.stringify(tests)); }
    finally { other.server.close(); }
  }
});

test('with the layers file, Testing shows a card and a modal per kind, and steps and tests open them', async () => {
  const other = await withTests({ layers: 'tests/layers.json', pipeline: 'hq/pipeline.json' });
  try {
    const page = await (await fetch(`${other.url}/testing`)).text();
    assert.equal((page.match(/class="hq-layercard/g) || []).length, 5);
    assert.equal((page.match(/<dialog class="hq-modal/g) || []).length, 5);
    assert.match(page, /class="hq-layercard planned" data-layer="prod-smoke"/);
    assert.match(page, /stops a deploy[\s\S]*reported only/);
    assert.match(page, /id="layer-browser"[\s\S]*?<h3>Does not prove<\/h3>[\s\S]*?data-copy="make test, or one test: S=\/tmp node tests\/smoke-sync.js"[\s\S]*?href="\/code\/tests\/smoke-sync.js"/);
    assert.match(page, /class="hq-step-kinds"><button type="button" class="hq-layerlink" data-layer="unit"/);
    const tests = await (await fetch(`${other.url}/testing?tab=tests`)).text();
    assert.match(tests, /id="t-contract"[\s\S]*?data-layer="rules"/);
  } finally { other.server.close(); }
});

test('the Firebase tab says what to run when neither gcloud nor the Firebase CLI can read Hosting', async () => {
  const part = JSON.parse((await get('/github/part/firebase')).body);
  assert.equal(part.ok, false);
  assert.match(part.html, /Could not load Firebase[\s\S]*gcloud auth login/);
  assert.match((await get('/github?tab=firebase')).body, /data-part="firebase"[^>]*aria-label="Firebase"/);
});

// ---- Claude: Ask and Open in Claude, against a claude that replays what the real one printed ----
const SESSION = '2dd45ba5-8d8f-46a6-8f53-610e4ea5c1fd';
const REPLAY = [
  { type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-opus-5-5', apiKeySource: 'none', tools: ['Read', 'Grep', 'Glob'] },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'It is in `web/app.js`.' } } },
  { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.02 }, seven_day: { utilization: 0.04 } } } },
  { type: 'result', is_error: false, result: 'It is in `web/app.js`.', session_id: SESSION, duration_ms: 900, num_turns: 1, total_cost_usd: 0.01, permission_denials: [] },
];
function fakeClaude(lines = REPLAY) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, kill() {} });
    let input = '';
    child.stdin = new Writable({
      write(c, _, cb) { input += c; cb(); },
      final(cb) { cb(); setImmediate(() => { for (const l of lines) child.stdout.write(JSON.stringify(l) + '\n'); child.stdout.end(); child.exitCode = 0; child.emit('close', 0, null); }); },
    });
    calls.push({ cmd, args, opts, input: () => input });
    return child;
  };
  return { spawn, find: async () => ({ version: '2.1.284 (Claude Code)', path: '/opt/claude' }), calls };
}

async function withClaudeServer(opts, fn) {
  const c = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  mkdirSync(join(c, 'no-transcripts'));
  const s = await start({ port: 0, repo: REPO, cache: c, m: manifest(c), projectsDir: join(c, 'no-transcripts'), gh: async () => { throw Object.assign(new Error('no gh'), { code: 'ENOENT' }); }, ...opts });
  try { await fn(s.url); } finally { s.server.close(); rmSync(c, { recursive: true, force: true }); }
}
// A POST as HQ's own page sends it: JSON, with an Origin naming HQ.
const postAs = (base, path, body, { origin = base } = {}) => new Promise((resolve, reject) => {
  const u = new URL(base), data = JSON.stringify(body);
  const req = request({ host: u.hostname, port: u.port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...(origin ? { origin } : {}) } }, res => {
    let text = ''; res.on('data', d => (text += d)); res.on('end', () => resolve({ status: res.statusCode, text, type: res.headers['content-type'] }));
  });
  req.on('error', reject); req.end(data);
});

test('Ask streams claude\'s answer, runs it read-only without the API key, and passes the question and the page on stdin', async () => {
  const claude = { ...fakeClaude(), env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-test' } };
  await withClaudeServer({ claude }, async base => {
    const r = await postAs(base, '/claude/ask', { question: 'Where is the day computed?', file: 'docs/backlog/next/which-day-counts.md', title: 'Which day' });
    assert.equal(r.status, 200);
    assert.match(r.type, /ndjson/);
    const events = r.text.trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(events.map(e => e.type), ['billing', 'start', 'text', 'limits', 'done']);
    assert.deepEqual(events[0].stripped, ['ANTHROPIC_API_KEY']);
    assert.equal(events[1].bill.subscription, true);
    assert.match(events[4].html, /<a href="\/code\/web\/app\.js"><code>web\/app\.js<\/code><\/a>/, 'the answer is rendered, with files linked');
    const [call] = claude.calls;
    assert.equal(call.cmd, '/opt/claude');
    assert.ok(call.args.includes('--restricted'));
    assert.equal(call.opts.env.ANTHROPIC_API_KEY, undefined);
    assert.match(call.input(), /which-day-counts\.md[\s\S]*Where is the day computed\?$/);
  });
});

// claude's stream-json as it arrives: the text in pieces of a few characters, as the deltas come.
const delta = text => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const piecesOf = (text, n = 3) => text.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g'));
const result = text => ({ type: 'result', is_error: false, result: text, session_id: SESSION, duration_ms: 900, num_turns: 1, permission_denials: [] });
const askEvents = async lines => {
  let events;
  await withClaudeServer({ claude: fakeClaude(lines) }, async base => {
    const r = await postAs(base, '/claude/ask', { question: 'Where is the day computed?' });
    events = r.text.trim().split('\n').map(l => JSON.parse(l));
  });
  return events;
};

test('Ask sends the answer so far rendered as it streams, a list or an unclosed code fence included, and not for every piece', async () => {
  // a sentence before claude reads a file, then the answer: a list, and a code block whose fence closes only at the end
  const before = 'Let me look.';
  const answer = 'Two places:\n\n- **web/app.js** works out the day\n- **tests/unit/day.test.mjs** checks the edges\n\nLike this:\n\n```js\nconst day = dayOf(new Date());\nconst week = weekOf(day);\n```\n';
  const events = await askEvents([REPLAY[0], ...piecesOf(before).map(delta),
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'web/app.js' } }] } },
    ...piecesOf(answer).map(delta), result(answer)]);
  // what the panel would be showing after each event: the latest html sent, and the text received by then
  let soFar = '', html;
  const shown = [];
  for (const e of events) {
    if (e.type === 'text') soFar += e.text;
    if (e.html && e.type !== 'done') html = e.html;
    shown.push({ e, soFar, html });
  }
  const texts = shown.filter(s => s.e.type === 'text');
  assert.ok(texts[0].e.html, 'the first piece is shown at once');
  const atTools = shown.find(s => s.e.type === 'tools');
  assert.match(atTools.html || '', /<p>Let me look\.<\/p>/, 'when claude stops to read a file, all it wrote so far is shown');
  const inList = texts.filter(s => s.e.html && s.soFar.includes('- **web') && !s.soFar.includes('Like this'));
  assert.ok(inList.length, 'some render arrives while the list is being written');
  for (const s of inList) assert.match(s.e.html, /<ul>\s*<li>/, 'a list half written renders as a list');
  const inFence = texts.filter(s => s.e.html && s.soFar.split('```').length === 2 && s.soFar.includes('const day'));
  assert.ok(inFence.length, 'some render arrives while the code block is open');
  for (const s of inFence) assert.match(s.e.html, /<pre class="hq-pre"><code class="hljs">[\s\S]*dayOf/, 'an unclosed code fence renders as code, not as text with backticks');
  const rendered = texts.filter(s => s.e.html).length;
  assert.ok(rendered < texts.length / 2, `rendered ${rendered} times for ${texts.length} pieces: a long answer is not rendered again for every piece`);
});

test('the answer streamed is rendered the way the finished answer is, so it does not jump when it ends', async () => {
  const answer = 'It is in `web/app.js`:\n\n1. **dayOf** reads the clock\n2. the rest follows';
  const events = await askEvents([REPLAY[0], delta(answer), result(answer)]);
  const text = events.find(e => e.type === 'text'), done = events.find(e => e.type === 'done');
  assert.ok(done.html.includes('<ol>'));
  assert.equal(text.html, done.html);
});

test('HTML in an answer is shown as text, while it streams and once it ends, never run in the panel', async () => {
  // Mid-stream, a backtick that has not closed yet leaves its tag outside code, where marked passes raw HTML through:
  // the first piece ends just after the tag, before the closing backtick.
  const quoted = 'Load it with `<img src=x onerror=alert(1)>` and the page shows it.', cut = quoted.indexOf('>') + 1;
  const streamed = await askEvents([REPLAY[0], delta(quoted.slice(0, cut)), ...piecesOf(quoted.slice(cut)).map(delta), result(quoted)]);
  for (const e of streamed.filter(e => e.html)) assert.ok(!e.html.includes('<img'), `a ${e.type} event carried a live tag: ${e.html}`);
  // a finished answer with HTML outside backticks, inline and as a block
  const raw = 'Use <b>bold</b> or <img src=x onerror=alert(1)> here.\n\n<div onclick="alert(1)">a block</div>\n';
  const done = (await askEvents([REPLAY[0], delta(raw), result(raw)])).find(e => e.type === 'done');
  assert.ok(!/<(img|b|div)\b/.test(done.html), `the finished answer carried a live tag: ${done.html}`);
  assert.match(done.html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'the tag is shown as text');
});

test('Ask refuses, and starts no claude, when the bill would go elsewhere or the request is not from HQ\'s page', async () => {
  const cloud = { ...fakeClaude(), env: { CLAUDE_CODE_USE_BEDROCK: '1' } };
  await withClaudeServer({ claude: cloud }, async base => {
    const r = await postAs(base, '/claude/ask', { question: 'Hi' });
    assert.equal(r.status, 409);
    assert.match(JSON.parse(r.text).message, /CLAUDE_CODE_USE_BEDROCK/);
    assert.equal(cloud.calls.length, 0);
  });
  const plain = fakeClaude();
  await withClaudeServer({ claude: plain }, async base => {
    assert.equal((await postAs(base, '/claude/ask', { question: 'Hi' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await postAs(base, '/claude/ask', { question: 'Hi' }, { origin: null })).status, 403);
    assert.equal((await get('/claude/ask')).status, 405, 'a GET cannot ask');
    assert.equal(plain.calls.length, 0);
  });
});

test('the status says whether claude is there, what is set that bills elsewhere, and whether Terminal can open', async () => {
  await withClaudeServer({ claude: { ...fakeClaude(), env: { ANTHROPIC_API_KEY: 'x' } }, platform: 'darwin' }, async base => {
    const s = JSON.parse(await new Promise(r => request(`${base}/claude/status`, res => { let t = ''; res.on('data', d => (t += d)); res.on('end', () => r(t)); }).end()));
    assert.deepEqual([s.installed, s.canOpen, s.billing.stripped], [true, true, ['ANTHROPIC_API_KEY']]);
  });
});

test('Open in Claude hands Terminal a script and keeps the comments out of its arguments', async () => {
  const ran = [];
  // HQ_TERMINAL pins Terminal, so the test does not depend on whether this machine has iTerm
  await withClaudeServer({ claude: { ...fakeClaude(), env: { HQ_TERMINAL: 'terminal' } }, platform: 'darwin', run: async (cmd, args) => { ran.push([cmd, ...args]); return null; } }, async base => {
    const r = await postAs(base, '/claude/open', { text: 'Comments from HQ (1)' });
    assert.equal(r.status, 200);
    assert.equal(ran.length, 1);
    assert.equal(ran[0][0], 'open');
    assert.match(ran[0][1], /\.command$/);
    assert.ok(!ran[0].join(' ').includes('Comments from'));
  });
});

test('claude is looked up once when HQ starts, and every page says how Chat runs without a request of its own', async () => {
  let lookups = 0;
  const claude = { ...fakeClaude(), find: async () => { lookups++; return { version: '2.1.284 (Claude Code)', path: '/opt/claude' }; }, env: { ANTHROPIC_API_KEY: 'x' } };
  await withClaudeServer({ claude }, async base => {
    for (const p of ['/', '/backlog', '/testing']) {
      const html = await new Promise(r => request(`${base}${p}`, res => { let t = ''; res.on('data', d => (t += d)); res.on('end', () => r(t)); }).end());
      const info = JSON.parse(/<script type="application\/json" id="hq-claude-info">(.*?)<\/script>/.exec(html)[1]);
      assert.deepEqual([info.installed, info.billing.stripped, 'path' in info], [true, ['ANTHROPIC_API_KEY'], false], p);
    }
    assert.equal(lookups, 1);
  });
});

test('Continue in Terminal resumes a conversation through the same guarded route', async () => {
  const ran = [];
  await withClaudeServer({ claude: fakeClaude(), platform: 'darwin', run: async (cmd, args) => { ran.push(args[0]); return null; } }, async base => {
    assert.equal((await postAs(base, '/claude/open', { resume: SESSION, cwd: '/Users/dev/questkeep-sync' })).status, 200);
    assert.equal((await postAs(base, '/claude/open', { resume: 'not an id' })).status, 400);
    assert.equal(ran.length, 1);
  });
});

// ---- Plugins: a project's own pages, named in the manifest and handed to the server once loaded (lib/plugins.mjs) ----

// Two plugins as loadPlugins answers them: one in the demo, with an action; one that keeps out of the demo.
const PLUGINS = [
  { id: 'notes', label: 'Notes', path: 'notes', demo: true, page: async (ctx, params, rest) => (rest ? null : `<!doctype html><h1>Notes for ${ctx.m.name}</h1><p>${params.get('q') || ''}</p>`),
    actions: { add: async (body, ctx) => ({ added: body.text, repo: ctx.repo }), boom: async () => { throw new Error('no'); } } },
  { id: 'launch', label: 'Launch', path: 'launch', demo: false, page: async () => '<!doctype html><h1>Sign-ups</h1>', actions: { count: async () => ({ n: 1 }) } },
];
async function withPlugins(opts, fn) {
  const c = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  mkdirSync(join(c, 'no-transcripts'));
  const s = await start({ port: 0, repo: REPO, cache: c, m: manifest(c), plugins: PLUGINS, projectsDir: join(c, 'no-transcripts'), gh: async () => { throw Object.assign(new Error('no gh'), { code: 'ENOENT' }); }, ...opts });
  const page = p => new Promise(r => request(`${s.url}${p}`, res => { let t = ''; res.on('data', d => (t += d)); res.on('end', () => r({ status: res.statusCode, body: t })); }).end());
  try { await fn(s.url, page); } finally { s.server.close(); rmSync(c, { recursive: true, force: true }); }
}

test('a plugin gets its own nav entry and its own page, with the rest of its path handed to it', async () => {
  await withPlugins({}, async (base, page) => {
    const home = await page('/');
    assert.match(home.body, /<a href="\/problems">Problems<\/a><a href="\/notes">Notes<\/a><a href="\/launch">Launch<\/a><a href="\/export">Export<\/a>/, 'after the pages the manifest turns on, before Export');
    assert.deepEqual([(await page('/notes')).status, (await page('/notes?q=hello')).body, (await page('/notes/deeper')).status], [200, '<!doctype html><h1>Notes for scratch</h1><p>hello</p>', 404]);
    assert.equal((await page('/launch')).status, 200);
    assert.deepEqual([(await postAs(base, '/plugin/launch/count', {})).status, JSON.parse((await postAs(base, '/plugin/launch/count', {})).text)], [200, { n: 1 }], 'outside the demo its action runs');
    assert.equal((await page('/nothing-here')).status, 404);
  });
});

test("a plugin's action runs only as a POST of JSON from HQ's own page, and its error is said, not thrown", async () => {
  await withPlugins({}, async base => {
    const ok = await postAs(base, '/plugin/notes/add', { text: 'milk' });
    assert.deepEqual([ok.status, JSON.parse(ok.text)], [200, { added: 'milk', repo: REPO }]);
    assert.equal((await postAs(base, '/plugin/notes/add', { text: 'x' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await postAs(base, '/plugin/notes/nope', {})).status, 404);
    assert.equal((await postAs(base, '/plugin/other/add', {})).status, 404);
    assert.equal((await get('/plugin/notes/add')).status, 404, 'the main server has no plugins');
    const boom = await postAs(base, '/plugin/notes/boom', {});
    assert.deepEqual([boom.status, JSON.parse(boom.text).message], [500, 'no']);
  });
});

test('in the demo a plugin that keeps out of it leaves the nav, and its page and actions answer not in the demo', async () => {
  const demo = demoConfig(demoFacts(REPO, undefined, { name: 'scratch' }), demoSettings(null));
  await withPlugins({ demo }, async (base, page) => {
    const home = await page('/');
    assert.match(home.body, /<a href="\/notes">Notes<\/a><a href="\/export">Export<\/a>/);
    assert.doesNotMatch(home.body, /href="\/launch"/, 'the nav does not link a page the demo will not show');
    const r = await page('/launch');
    assert.equal(r.status, 404);
    assert.match(r.body, /not in the demo/);
    assert.doesNotMatch(r.body, /Sign-ups/);
    assert.equal((await page('/notes')).status, 200, 'the other plugin stays');
    assert.equal((await postAs(base, '/plugin/launch/count', {})).status, 403, 'its action is refused in the demo');
    assert.equal((await postAs(base, '/plugin/launch/nope', {})).status, 404, 'an action it does not have is not there, demo or not');
  });
});

test('a backlog popup comes on its own, the README too, and an unknown one is a 404', async () => {
  // any item still in the backlog will do: paid-skins waits on whether to charge at all (sprint, used here before, shipped)
  const item = await get('/backlog/paid-skins?part=1');
  assert.equal(item.status, 200);
  assert.match(item.body, /^<article class="bl-detail" data-slug="paid-skins"/);
  assert.doesNotMatch(item.body, BRAND, 'no page frame around it');
  assert.match((await get('/backlog/_how-it-works?part=1')).body, /data-path="docs\/backlog\/README\.md"/);
  assert.equal((await get('/backlog/no-such-item?part=1')).status, 404);
});

test('HQ\'s scripts come with an etag, and the same etag back gets a 304 with no body', async () => {
  const u = new URL(url);
  const once = headers => new Promise(r => request({ host: u.hostname, port: u.port, path: '/hq/hq.js', headers }, res => { let t = ''; res.on('data', d => (t += d)); res.on('end', () => r({ status: res.statusCode, etag: res.headers.etag, cc: res.headers['cache-control'], body: t })); }).end());
  const first = await once({});
  assert.deepEqual([first.status, first.cc, !!first.etag], [200, 'no-cache', true]);
  const again = await once({ 'if-none-match': first.etag });
  assert.deepEqual([again.status, again.body], [304, '']);
});

// A transcript in a temp session folder named for the scratch repo's main checkout, as claude would file it.
async function transcriptFor(id) {
  const { mainCheckout } = await import('../lib/conversations.mjs');
  const main = await mainCheckout(REPO);
  const projects = mkdtempSync(join(tmpdir(), 'hq-projects-'));
  const folder = join(projects, main.replace(/[^A-Za-z0-9-]/g, '-'));
  mkdirSync(folder);
  const file = join(folder, `${id}.jsonl`);
  writeFileSync(file, JSON.stringify({ type: 'user', uuid: 'old', message: { content: 'said before following' } }) + '\n');
  return { projects, file };
}

test('Follow sends the turns a terminal adds, and says when its claude is running and when it has ended', async () => {
  const { appendFileSync } = await import('node:fs');
  const { projects, file } = await transcriptFor(SESSION);
  let alive = true;
  const claude = { ...fakeClaude(), alive: async () => alive, followEvery: { read: 20, alive: 20 } };
  await withClaudeServer({ claude, projectsDir: projects }, async base => {
    const events = [];
    let wake = () => {};
    const until = cond => new Promise(r => { wake = () => cond() && r(); wake(); });
    const req = request(`${base}/claude/follow?session=${SESSION}`, res => {
      let buf = '';
      res.on('data', d => { buf += d; for (let i; (i = buf.indexOf('\n')) >= 0;) { events.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } wake(); });
    });
    req.end();
    await until(() => events.some(e => e.type === 'running'));
    appendFileSync(file, JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'Now make the change.' } }) + '\n' +
      JSON.stringify({ type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'text', text: 'Done in `web/app.js`.' }] } }) + '\n');
    await until(() => events.some(e => e.type === 'claude'));
    alive = false;
    await until(() => events.some(e => e.type === 'ended'));
    req.destroy();
    const turns = events.filter(e => e.type === 'you' || e.type === 'claude');
    assert.deepEqual(turns.map(t => [t.type, t.text]), [['you', 'Now make the change.'], ['claude', 'Done in `web/app.js`.']], 'what was there before following is not sent again');
    assert.match(turns[1].html, /<a href="\/code\/web\/app\.js">/);
    assert.ok(events.filter(e => e.type === 'at').at(-1).offset > 0);
  });
  rmSync(projects, { recursive: true, force: true });
});

test('Follow picks up from where the panel had read to, and refuses what is not a conversation of this repo', async () => {
  const { projects } = await transcriptFor(SESSION);
  const claude = { ...fakeClaude(), alive: async () => false, followEvery: { read: 20, alive: 20 } };
  await withClaudeServer({ claude, projectsDir: projects }, async base => {
    const first = await new Promise(r => { const q = request(`${base}/claude/follow?session=${SESSION}&from=0`, res => { let t = ''; res.on('data', d => { t += d; if (/"ended"/.test(t)) { q.destroy(); r(t); } }); }); q.end(); });
    assert.match(first, /said before following/, 'from=0 sends the transcript from the start');
    const code = path => new Promise(r => request(`${base}${path}`, res => { res.resume(); r(res.statusCode); }).end());
    assert.equal(await code('/claude/follow?session=--help'), 400);
    assert.equal(await code('/claude/follow?session=00000000-0000-0000-0000-000000000000'), 404);
  });
  rmSync(projects, { recursive: true, force: true });
});

test('Follow says whether the conversation is filed under the folder Chat runs in, where Chat could carry it on', async () => {
  const { mainCheckout, escapePath, belongs } = await import('../lib/conversations.mjs');
  // the scratch repo is its own main checkout; a worktree elsewhere would make HQ run from the main one, as on the laptop
  const here = REPO, main = await mainCheckout(here), repo = belongs(here, main) ? here : main;
  const projects = mkdtempSync(join(tmpdir(), 'hq-projects-'));
  const HERE_ID = '11111111-0000-4000-8000-000000000001', AWAY_ID = '22222222-0000-4000-8000-000000000002';
  for (const [id, folder] of [[HERE_ID, escapePath(repo)], [AWAY_ID, `${escapePath(main)}-elsewhere`]]) {
    mkdirSync(join(projects, folder), { recursive: true });
    writeFileSync(join(projects, folder, `${id}.jsonl`), JSON.stringify({ type: 'user', uuid: 'u', message: { content: 'hello' } }) + '\n');
  }
  const claude = { ...fakeClaude(), alive: async () => false, followEvery: { read: 20, alive: 20 } };
  await withClaudeServer({ claude, projectsDir: projects, repo }, async base => {
    // the stream's first lines say where the conversation is filed; a stream that ends or fails before then fails the test
    const filed = id => new Promise((resolve, reject) => {
      const q = request(`${base}/claude/follow?session=${id}`, res => {
        let t = '';
        const seen = () => t.split('\n').slice(0, -1).map(l => JSON.parse(l)).find(e => e.type === 'filed');
        res.on('data', d => { t += d; const e = seen(); if (e) { q.destroy(); resolve(e); } });
        res.on('end', () => reject(new Error(`the follow stream ended with no filed event: ${t}`)));
      });
      q.on('error', reject);
      q.end();
    });
    assert.deepEqual(await filed(HERE_ID), { type: 'filed', here: true }, 'a conversation filed under the folder Chat runs in');
    assert.deepEqual(await filed(AWAY_ID), { type: 'filed', here: false }, 'a conversation filed under another folder');
  });
  rmSync(projects, { recursive: true, force: true });
});

test('Export sends one Markdown file as a download, holding the sections asked for', async () => {
  const r = await new Promise((resolve, reject) => { const q = request(`${url}/export/download?sections=repo,backlog`, res => { let t = ''; res.on('data', d => (t += d)); res.on('end', () => resolve({ status: res.statusCode, cd: res.headers['content-disposition'], type: res.headers['content-type'], body: t })); }); q.on('error', reject); q.end(); });
  assert.equal(r.status, 200);
  assert.match(r.cd, /^attachment; filename="hq-\d{4}-\d{2}-\d{2}-[0-9a-f]+\.md"$/);
  assert.match(r.type, /text\/markdown/);
  assert.match(r.body, /Backlog/);
  assert.equal((await get('/export/nothing')).status, 404);
});

test('Export as a zip sends a zip of files, with the README first', async () => {
  const r = await new Promise((resolve, reject) => { const q = request(`${url}/export/download?sections=repo,docs&format=zip`, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, cd: res.headers['content-disposition'], type: res.headers['content-type'], body: Buffer.concat(c) })); }); q.on('error', reject); q.end(); });
  assert.equal(r.status, 200);
  assert.equal(r.type, 'application/zip');
  assert.match(r.cd, /filename="hq-[\d-]+-[0-9a-f]+\.zip"/);
  assert.equal(r.body.readUInt32LE(0), 0x04034b50, 'a zip starts with a local file header');
  const first = r.body.subarray(30, 30 + r.body.readUInt16LE(26)).toString();
  assert.match(first, /^hq-[\d-]+-[0-9a-f]+\/README\.md$/);
});

test('the Tests tab keeps What it proves to three lines, with the whole text on hover', async () => {
  const r = await get('/testing?tab=tests');
  assert.equal(r.status, 200);
  const cell = /<div class="hq-desc hq-clamp3" title="([^"]*)">/.exec(r.body);
  assert.ok(cell, 'a clamped cell with its text on hover');
  assert.match(cell[1], /^Proves: /);
});

test('the CI-now part answers even when gh is missing, and an unknown CI run is a 404', async () => {
  const r = await get('/github/part/ci-now');
  assert.equal(r.status, 200);
  const d = JSON.parse(r.body);
  assert.equal(typeof d.html, 'string');
  assert.equal((await get('/ci/not-a-number')).status, 404);
});

// A failed browser test's whole log lives in the run's results folder, which the run line names as out; the JUnit
// message names it as logs/<test>.log. The run page links the failed test to it, and the log page reads it only from
// inside the cache, so an out that points elsewhere opens nothing.
test("a failed test in a run links to its own log in the run's results folder, and only inside the cache", async () => {
  const id = '2026-10-04T10-00-00Z_000001', out = join(cache, 'results', '2026-10-04T10-00-00Z-abc123');
  mkdirSync(join(out, 'logs'), { recursive: true });
  writeFileSync(join(out, 'logs', 'smoke-reject.log'), 'the refused write\nFAIL the cloud kept the old title\n');
  const run = (runId, where) => {
    const d = join(cache, 'runs', 'runs', runId);
    mkdirSync(join(d, 'logs'), { recursive: true });
    writeFileSync(join(d, 'logs', 'docker-gate.log'), `=== run {"kind":"docker-gate","where":"container","who":"agent","branch":"main","commit":"a6cc739","dirty":false,"out":${JSON.stringify(where)}}\n`);
    writeFileSync(join(d, 'run.json'), JSON.stringify({ runId, timestamp: '2026-10-04T10:05:00Z', tasks: [
      { id: 'docker-gate', name: 'Gate in the test image', status: 'FAIL', durationMs: 12000, logPath: join(d, 'logs', 'docker-gate.log'),
        metrics: { data: { testcases: [{ name: 'smoke-reject', status: 'failed', time: 12, message: 'see logs/smoke-reject.log' }] } } }] }));
  };
  run(id, out);
  assert.match((await get(`/runs/${id}`)).body, new RegExp(`href="/runs/${id}/test/smoke-reject"`));
  const page = await get(`/runs/${id}/test/smoke-reject`);
  assert.equal(page.status, 200);
  assert.match(page.body, /id="L2"[\s\S]*FAIL the cloud kept the old title/);
  assert.equal((await get(`/runs/${id}/test/smoke-sync`)).status, 404, 'a test that did not fail has no log page');
  // a run whose out is outside the cache: the same message leads nowhere
  const outside = mkdtempSync(join(tmpdir(), 'hq-outside-'));
  mkdirSync(join(outside, 'logs')); writeFileSync(join(outside, 'logs', 'smoke-reject.log'), 'not for HQ\n');
  run('2026-10-04T10-00-00Z_000002', outside);
  try { assert.equal((await get('/runs/2026-10-04T10-00-00Z_000002/test/smoke-reject')).status, 404); }
  finally { rmSync(outside, { recursive: true, force: true }); }
});

// A red container gate's failing tests run once more (the Makefile's _rerun), with their logs in rerun/logs in the run's
// folder. A test red in both has two logs, and the run page links each to its own: the rerun's names its task.
test("a test red in the gate and again on its rerun links to each run's own log", async () => {
  const id = '2026-10-11T05-00-00Z_000003', out = join(cache, 'results', '2026-10-11T05-00-00Z-abc123'), d = join(cache, 'runs', 'runs', id);
  mkdirSync(join(out, 'logs'), { recursive: true }); mkdirSync(join(out, 'rerun', 'logs'), { recursive: true }); mkdirSync(join(d, 'logs'), { recursive: true });
  writeFileSync(join(out, 'logs', 'smoke-reject.log'), 'the gate\nFAIL in the gate\n');
  writeFileSync(join(out, 'rerun', 'logs', 'smoke-reject.log'), 'the rerun\nFAIL on the rerun\n');
  writeFileSync(join(out, 'rerun.xml'), '<testsuite name="rerun"><testcase name="smoke-reject" classname="browser" time="11"><failure message="see logs/smoke-reject.log"/></testcase></testsuite>');
  writeFileSync(join(d, 'logs', 'docker-gate.log'), `=== run {"kind":"docker-gate","where":"container","who":"agent","branch":"main","commit":"a6cc739","dirty":false,"out":${JSON.stringify(out)}}\n`);
  writeFileSync(join(d, 'run.json'), JSON.stringify({ runId: id, timestamp: '2026-10-11T05:05:00Z', tasks: [
    { id: 'docker-gate', name: 'Gate in the test image', status: 'FAIL', durationMs: 12000, logPath: join(d, 'logs', 'docker-gate.log'),
      metrics: { data: { testcases: [{ name: 'smoke-reject', status: 'failed', time: 12, message: 'see logs/smoke-reject.log' }] } } }] }));
  const body = (await get(`/runs/${id}`)).body;
  assert.match(body, new RegExp(`href="/runs/${id}/test/smoke-reject"`));
  assert.match(body, new RegExp(`href="/runs/${id}/test/smoke-reject\\?task=rerun"`));
  assert.match((await get(`/runs/${id}/test/smoke-reject`)).body, /FAIL in the gate/);
  assert.match((await get(`/runs/${id}/test/smoke-reject?task=rerun`)).body, /FAIL on the rerun/);
});

// The Problems page, on a server of its own with a cache holding four entries (one merged into another, two written at
// different offsets) and two reds of a test no entry owns, so its counts are only these. Git's entries come from this
// repo's fix commits, whose signatures name real tests and not this one; a test here never counts on them, since a CI
// checkout holds one commit.
const ENTRY = 'P-2026-10-11-agent-mistake-0f0f0f', MERGED = 'P-2026-10-11-agent-mistake-1e1e1e';
async function problemsServer(t) {
  const pcache = mkdtempSync(join(tmpdir(), 'hq-problems-')), had = process.env.HQ_PROBLEMS_DIR;
  process.env.HQ_PROBLEMS_DIR = join(pcache, 'problems');
  const day = n => new Date(Date.now() - n * 86400000).toISOString();
  for (const [n, seq] of [[1, '000001'], [2, '000002']]) {
    const id = `${day(n).slice(0, 19).replace(/:/g, '-')}Z_${seq}`, d = join(pcache, 'runs', 'runs', id);
    mkdirSync(join(d, 'logs'), { recursive: true });
    writeFileSync(join(d, 'logs', 'gate.log'), '=== run {"kind":"gate","where":"laptop","who":"person","branch":"main","commit":"b7dd840","dirty":false}\n');
    writeFileSync(join(d, 'run.json'), JSON.stringify({ runId: id, timestamp: day(n), tasks: [
      { id: 'gate', name: 'Browser gate', status: 'FAIL', durationMs: 30000, logPath: join(d, 'logs', 'gate.log'),
        metrics: { data: { testcases: [{ name: 'smoke-register-fixture', status: 'failed', time: 30 }, { name: 'tests/unit/register/fixture.test.mjs', status: 'failed', time: 1 }] } } }] }));
  }
  // two waits for the test slot behind another session's run, oldest first as the lock log holds them
  const plus = (iso, min) => new Date(Date.parse(iso) + min * 60000).toISOString();
  mkdirSync(join(pcache, 'lock'));
  writeFileSync(join(pcache, 'lock', 'log.jsonl'), [2, 1].flatMap((n, i) => [{ at: day(n), event: 'take', pid: 10 + i * 2, session: 'a' },
    { at: plus(day(n), 1), event: 'wait', pid: 11 + i * 2, session: 'b' }, { at: plus(day(n), 11), event: 'take', pid: 11 + i * 2, session: 'b' }]).map(e => JSON.stringify(e)).join('\n') + '\n');
  mkdirSync(join(pcache, 'problems'));
  writeFileSync(join(pcache, 'problems', 'events.jsonl'), [
    { at: day(1), ev: 'opened', id: ENTRY, by: 'builder', fields: { title: 'A builder pushed to the wrong branch', kind: 'agent-mistake', evidence: 'told by ana@builders.test' } },
    { at: day(1), ev: 'opened', id: MERGED, by: 'builder', fields: { title: 'A builder pushed to main by mistake', kind: 'agent-mistake', evidence: 'run 2026-10-10T00-00-00Z_000001' } },
    { at: day(1), ev: 'closed', id: MERGED, by: 'builder', fields: { disposition: 'duplicate' } },
    { at: day(1), ev: 'merged-into', id: MERGED, into: ENTRY, by: 'builder' },
    // two times whose text sorts the other way round from the times themselves: 01:02 at -04:00 is 05:02Z
    { at: '2026-10-10T01:02:39-04:00', ev: 'opened', id: 'P-2026-10-10-tooling-breakage-2a2a2a', by: 'builder', fields: { title: 'Opened at 05:02Z, written at -04:00', kind: 'tooling-breakage', evidence: 'run 2026-10-10T00-00-00Z_000002' } },
    { at: '2026-10-10T01:32:17Z', ev: 'opened', id: 'P-2026-10-10-tooling-breakage-3b3b3b', by: 'builder', fields: { title: 'Opened at 01:32Z', kind: 'tooling-breakage', evidence: 'run 2026-10-10T00-00-00Z_000003' } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n');
  const p = await start({ port: 0, repo: REPO, cache: pcache, m: manifest(pcache), projectsDir: join(cache, 'no-transcripts'), gh: async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); } });
  t.after(() => { p.server.close(); rmSync(pcache, { recursive: true, force: true }); if (had === undefined) delete process.env.HQ_PROBLEMS_DIR; else process.env.HQ_PROBLEMS_DIR = had; });
  return path => fetch(new URL(path, p.url));
}

test('the Problems page, an entry, an unexplained group and the export answer, and the export withholds an email on a domain HQ does not keep', async t => {
  const at = await problemsServer(t), entry = ENTRY;

  for (const [tab, label] of [['overview', 'Overview'], ['trends', 'Trends'], ['tests', 'Tests'], ['slot', 'Test slot'], ['list', 'List']]) {
    const r = await at(`/problems?tab=${tab}`);
    assert.equal(r.status, 200, tab);
    assert.match(await r.text(), new RegExp(`${BRAND.source}[\\s\\S]*aria-current="page">${label}<`), tab);
  }
  const list = await (await at('/problems?tab=list&range=all')).text();
  assert.match(list, new RegExp(`href="/problems/${entry}"`), 'the list links the entry');
  const group = list.match(/href="(\/problems\/group\/smoke-register-fixture\/[^"]+)"/);
  assert.ok(group, 'the red no entry owns is listed as an unexplained group');

  assert.match(await (await at(`/problems/${entry}`)).text(), /A builder pushed to the wrong branch/);
  assert.match(await (await at(group[1])).text(), /smoke-register-fixture[\s\S]*2 observations/);
  assert.equal((await at('/problems/P-2026-01-01-nothing-000000')).status, 404);
  assert.equal((await at('/problems/group/smoke-register-fixture/wait')).status, 404, 'a group is found by its signature and its family');
  // Juno: a signature holding a "/" (a unit test's file, or an error line) split into extra path parts, and its page 404'd
  const slashed = list.match(/href="(\/problems\/group\/tests%2Funit%2Fregister%2Ffixture\.test\.mjs\/[^"]+)"/);
  assert.ok(slashed, 'a group whose signature holds a slash is listed');
  const page = await at(slashed[1]);
  assert.equal(page.status, 200, "a group whose signature holds a slash opens its page");
  assert.match(await page.text(), /tests\/unit\/register\/fixture\.test\.mjs/);

  const one = await at(`/problems/${entry}.json`);
  assert.match(one.headers.get('content-type'), /application\/json/);
  assert.equal((await one.json()).entry.id, entry);
  assert.equal((await at('/problems/P-2026-01-01-nothing-000000.json')).status, 404);

  const all = await at('/problems/export.json?range=all&download=1');
  assert.equal(all.headers.get('content-disposition'), 'attachment; filename="scratch-problems-all.json"', 'named for the project');
  const text = await all.text();
  assert.ok(JSON.parse(text).entries.some(e => e.id === entry), 'the export carries the entry');
  assert.doesNotMatch(text, /ana@builders\.test/, 'an email on a domain HQ does not keep is withheld');
  assert.match(text, /\[withheld: it holds an email address/);
});

// Noor's review of the built page, findings 1, 2, 3, 8, 9 and 10.
const cellValues = (html, col) => [...html.matchAll(new RegExp(`<td data-col="${col}"[^>]* data-v="([^"]*)"`, 'g'))].map(m => m[1]);

test("the Problems list puts the newest first, whatever offset each time was written with", async t => {
  const at = await problemsServer(t);
  const page = await (await at('/problems?tab=list&range=all')).text(), list = page.slice(page.indexOf('id="pr-list"'), page.indexOf('</table>', page.indexOf('id="pr-list"')));
  const last = cellValues(list, 'last').filter(Boolean);
  assert.ok(last.includes('2026-10-10T05:02:39.000Z') && last.includes('2026-10-10T01:32:17.000Z'), 'both read back as UTC');
  assert.ok(last.indexOf('2026-10-10T05:02:39.000Z') < last.indexOf('2026-10-10T01:32:17.000Z'), "the fixture's own pair, whatever git's history holds");
  assert.deepEqual(last, [...last].sort((a, b) => Date.parse(b) - Date.parse(a)), 'newest first by the time itself');
  assert.ok(last.every(v => v.endsWith('Z')), 'each sorts as UTC: git writes -04:00 and the run store Z');
});

test('an entry that owns no observations is not seen, never seen in 1969', async t => {
  const at = await problemsServer(t), body = await (await at(`/problems/${ENTRY}`)).text();
  assert.doesNotMatch(body, /19(69|70)-/);
  assert.match(body, /not seen/);
});

test('with no pull request figures read yet, the page says so in place of 0 min', async t => {
  const at = await problemsServer(t), body = await (await at('/problems')).text();
  assert.doesNotMatch(body, /waited on you for 0 min/);
  assert.match(body, /<b>not read yet<\/b><span>waiting on you/);
});

test("an unexplained group's page lists the newest first", async t => {
  const at = await problemsServer(t), when = cellValues(await (await at('/problems/group/slot/wait')).text(), 'at');
  assert.equal(when.length, 2);
  assert.ok(Date.parse(when[0]) > Date.parse(when[1]));
});

test('a merged entry says what it was merged into, without a disposition beside it', async t => {
  const at = await problemsServer(t), body = await (await at(`/problems/${MERGED}`)).text();
  assert.match(body, new RegExp(`<dd>Merged into <a href="/problems/${ENTRY}">A builder pushed to the wrong branch</a>`));
});

test('came back names the entry filed again by its title, never by its id alone', async t => {
  const at = await problemsServer(t), body = await (await at('/problems?range=all')).text();
  assert.doesNotMatch(body, /filed again as <a href="[^"]*">F-[0-9a-f]{8}<\/a>/);
});
