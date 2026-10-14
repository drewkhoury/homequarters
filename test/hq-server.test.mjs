// HQ's server, started on a free port against this repo and a small cache made here: every page answers, and nothing
// outside the repo and the cache can be read through it. No browser; the pages are read as text.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { start, REPO } from '../server.mjs';
import { mainCheckout, escapePath } from '../lib/conversations.mjs';
import { spawnSync } from 'node:child_process';

let server, url, cache;
// One recorded run, as devpipe keeps it, so the Tests and Runs pages have something to show.
const RUN_ID = '2026-09-26T16-23-53Z_024359';

before(async () => {
  cache = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  // no transcripts: the Conversations page reads an empty folder here, never the developer's ~/.claude
  mkdirSync(join(cache, 'no-transcripts'));
  const dir = join(cache, 'runs', 'runs', RUN_ID);
  mkdirSync(join(dir, 'logs'), { recursive: true });
  writeFileSync(join(dir, 'logs', 'gate.log'), '=== run {"kind":"gate","where":"laptop","who":"person","branch":"main","commit":"a6cc739","dirty":false}\n=== smoke-sync (26s)\nALL PASS\n');
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ runId: RUN_ID, timestamp: '2026-09-26T16:24:40Z', tasks: [
    { id: 'gate', name: 'Browser gate', status: 'PASS', durationMs: 26000, logPath: join(dir, 'logs', 'gate.log'),
      metrics: { data: { testcases: [{ name: 'smoke-sync', status: 'passed', time: 26 }] } } }] }));
  ({ server, url } = await start({ port: 0, cache, projectsDir: join(cache, 'no-transcripts'), gh: async () => { const e = new Error('spawn gh ENOENT'); e.code = 'ENOENT'; throw e; },
    fb: { gcloud: async () => { throw Object.assign(new Error('spawn gcloud ENOENT'), { code: 'ENOENT' }); }, cli: async () => { throw new Error('not logged in'); } } }));
});
after(() => { server.close(); rmSync(cache, { recursive: true, force: true }); });

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
    '/testing?tab=runs&where=laptop&branch=main', '/testing?tab=runs&test=smoke-sync', `/runs/${RUN_ID}`, `/runs/${RUN_ID}/log/gate`, '/search?q=closedStream', '/github', '/backlog', '/backlog?tab=list', '/backlog?tab=trends', '/backlog/paid-skins', '/conversations', '/conversations?q=backlog', '/export', `/runs/${RUN_ID}/live`, '/code/docs/backlog/inbox', '/code/web?as=list', '/code/docs?as=gallery']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.body, /QUESTKEEP HQ/, p);
  }
});

test('Home opens on README.md, rendered', async () => {
  const r = await get('/');
  assert.match(r.body, /class="hq-mdview" data-view="preview" data-asked/);
  assert.match(r.body, /<h1 id="questkeep"/);
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

test("the app's stylesheet and a cache file are served", async () => {
  assert.equal((await get('/web/nocturne.css')).status, 200);
  assert.equal((await get(`/cache/runs/runs/${RUN_ID}/run.json`)).status, 200);
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
  assert.match(page, /data-part="runs" role="tabpanel"/);
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
  for (const path of ['/code/Makefile', '/code/tests/unit/fixtures/no-sections.md']) assert.doesNotMatch((await get(path)).body, /class="hq-rail"|hq-sections/, path);
});

test('on Home each section of a markdown file is wrapped on its own, heading and all', async () => {
  const body = (await get('/code/docs/TESTING.md')).body, preview = body.slice(body.indexOf('hq-pane-preview'));
  assert.ok((preview.match(/<section class="hq-sec"><h2 /g) || []).length > 2);
  assert.equal((preview.match(/<h2 /g) || []).length, (preview.match(/<section class="hq-sec"><h2 /g) || []).length, 'no second-level heading is left outside a section');
});

test('with no layers file, the kinds of test are left out quietly', async () => {
  // a path that is not there, rather than the repo's own tests/layers.json, which main now has
  const other = await start({ port: 0, cache, layersFile: '/nonexistent/hq-layers.json', gh: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
  try { assert.doesNotMatch(await (await fetch(`${other.url}/testing`)).text(), /hq-layercard|<dialog/); }
  finally { other.server.close(); }
});

test('with the layers file, Testing shows a card and a modal per kind, and steps and tests open them', async () => {
  const { join: j, dirname: d } = await import('node:path');
  const { fileURLToPath: f } = await import('node:url');
  const fixture = j(d(f(import.meta.url)), 'fixtures', 'hq-layers.json');
  const other = await start({ port: 0, cache, layersFile: fixture, gh: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
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
  assert.match((await get('/github?tab=firebase')).body, /data-part="firebase" role="tabpanel"/);
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
  const s = await start({ port: 0, cache: c, projectsDir: join(c, 'no-transcripts'), gh: async () => { throw Object.assign(new Error('no gh'), { code: 'ENOENT' }); }, ...opts });
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
    const r = await postAs(base, '/claude/open', { text: 'Comments from QuestKeep HQ (1)' });
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

test("Start a pass opens claude in the hunter's checkout with the skill as its message, and says how to make a missing one", async () => {
  const hunt = mkdtempSync(join(tmpdir(), 'questkeep-hunt-'));
  const ran = [];
  const run = async (cmd, args) => { ran.push(args[0]); return null; };
  await withClaudeServer({ claude: { ...fakeClaude(), env: { HQ_TERMINAL: 'terminal' } }, platform: 'darwin', run, huntDir: hunt }, async base => {
    const r = await postAs(base, '/claude/open', { hunt: true, text: 'not this', cwd: '/not/this' });
    assert.equal(r.status, 200);
    const script = readFileSync(ran[0], 'utf8');
    assert.ok(script.includes(`cd -- '${hunt}'`), 'the folder is the one the server knows');
    assert.equal(readFileSync(/cat -- '([^']+)'/.exec(script)[1], 'utf8'), '/backlog-hunter', 'the message is the skill, not what the page sent');
    assert.equal((await postAs(base, '/claude/open', { hunt: true }, { origin: 'http://evil.example' })).status, 403);
  });
  rmSync(hunt, { recursive: true, force: true });
  await withClaudeServer({ claude: fakeClaude(), platform: 'darwin', run, huntDir: hunt }, async base => {
    const r = await postAs(base, '/claude/open', { hunt: true });
    assert.equal(r.status, 409);
    assert.match(JSON.parse(r.text).message, /worktree add --detach .*questkeep-hunt-.* origin\/main/);
  });
  assert.equal(ran.length, 1, 'nothing opened for the missing checkout or the other origin');
});

test("the Backlog page's Hunter tab shows each pass's report and deck, the claims and whether their pass runs, and Start a pass", async () => {
  const c = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  mkdirSync(join(c, 'no-transcripts'));
  const pass = join(c, 'hunt', '2026-10-02');
  mkdirSync(pass, { recursive: true });
  mkdirSync(join(c, 'hunt', 'claims'));
  // a report as the hunter writes it, with a tag in it that must show as text
  writeFileSync(join(pass, 'report.md'), '# Pass, 2 Oct\n\nBuilt lock-stale-claims-pile-up. Skipped <script>alert(1)</script> name-your-world: needs Drew.\n');
  writeFileSync(join(pass, 'deck.json'), JSON.stringify({ id: 'hunt-2026-10-02', cards: [{ id: 'name-your-world', kind: 'needs-drew' }] }));
  writeFileSync(join(pass, 'backlog-deck.html'), '<!doctype html>');
  writeFileSync(join(c, 'hunt', 'claims', 'lock-stale-claims-pile-up.json'), JSON.stringify({ slug: 'lock-stale-claims-pile-up', branch: 'hunt/lock-stale-claims-pile-up', pid: process.pid, started: new Date().toISOString() }));
  const missing = join(c, 'no-hunt-checkout-here');
  const s = await start({ port: 0, cache: c, projectsDir: join(c, 'no-transcripts'), huntDir: missing, gh: async () => { throw Object.assign(new Error('no gh'), { code: 'ENOENT' }); } });
  try {
    const html = await new Promise(r => request(`${s.url}/backlog?tab=hunter`, res => { let t = ''; res.on('data', d => (t += d)); res.on('end', () => r(t)); }).end());
    assert.match(html, /aria-current="page">Hunter</);
    assert.match(html, /<button type="button" class="hunt-open" aria-expanded="false" aria-controls="hunt-pass-0">2026-10-02<\/button>/, 'each pass is a row that opens');
    assert.match(html, /href="\/backlog\?tab=hunter&amp;deck=2026-10-02&amp;play=1">1 card<\/a>/, 'its cards link to its deck in HQ');
    assert.match(html, /<a class="btn btn-primary" href="\/backlog\?tab=hunter&amp;deck=2026-10-02&amp;play=1">Play the deck<\/a>/, 'and the newest deck waits at the top, to play');
    assert.doesNotMatch(html, /Show the deck in Finder/);
    assert.match(html, /<details class="hunt-reportbox"><summary>Report<\/summary>/, 'the report is behind a disclosure, not the body');
    assert.doesNotMatch(html, /<script>alert/, 'the report is shown as text');
    assert.match(html, /data-open="lock-stale-claims-pile-up">lock-stale-claims-pile-up<\/a>/);
    assert.match(html, /data-state="running"/, 'this process holds the claim, so its pass runs');
    assert.match(html, /data-hunt-start disabled/, 'no checkout, so no Start');
    assert.doesNotMatch(html, /<section class="card hunt-start">/, 'Start a pass is one button, not a card with a label');
    assert.match(html, /aria-label="About Start a pass"/, 'its explanation sits behind an info mark');
    assert.ok(html.includes(`worktree add --detach ${missing} origin/main`));
  } finally { s.server.close(); rmSync(c, { recursive: true, force: true }); }
});

// A pass as the hunter leaves it: session.json in today's folder, naming this repo's <main>-hunt checkout, and its
// conversation's transcript in that checkout's folder of a projects dir of the test's own.
async function seedPass(c, { pid }) {
  const checkout = `${await mainCheckout(REPO)}-hunt`;
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  mkdirSync(join(c, 'hunt', '2026-10-02'), { recursive: true });
  const folder = join(c, 'projects', escapePath(checkout));
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${id}.jsonl`), [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-02T08:31:00Z', message: { role: 'user', content: '/backlog-hunter' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-10-02T08:31:05Z', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Scanning origin/main: one item can be built.' }] } },
  ].map(o => JSON.stringify(o)).join('\n') + '\n');
  // claude makes its transcript first; the pass records itself a moment later, and claude writes on after that
  const started = new Date(Date.now() - 5000).toISOString();
  writeFileSync(join(c, 'hunt', '2026-10-02', 'session.json'), JSON.stringify({ pid, tty: '/dev/ttys004', started, checkout }));
  appendFileSync(join(folder, `${id}.jsonl`), JSON.stringify({ type: 'assistant', uuid: 'a2', timestamp: new Date().toISOString(), message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'Building now.' }] } }) + '\n');
  return { checkout, id, projectsDir: join(c, 'projects') };
}
const endedPid = () => spawnSync('true').pid; // a process that has already gone

test("Take control brings a running pass's own Terminal tab to the front, by the tty in its session.json", async () => {
  const c = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  const { projectsDir } = await seedPass(c, { pid: process.pid });
  const ran = [];
  const s = await start({ port: 0, cache: c, projectsDir, platform: 'darwin', claude: { ...fakeClaude(), env: { HQ_TERMINAL: 'terminal' } }, run: async (cmd, args) => { ran.push([cmd, ...args]); return null; }, gh: async () => { throw Object.assign(new Error('no gh'), { code: 'ENOENT' }); } });
  try {
    const html = await new Promise(r => request(`${s.url}/backlog?tab=hunter`, res => { let t = ''; res.on('data', d => (t += d)); res.on('end', () => r(t)); }).end());
    assert.match(html, /Running now: the 2026-10-02 pass/);
    assert.match(html, /class="hunt-chip" data-s="running"/);
    assert.match(html, /Building now\./, 'its latest message shows');
    assert.match(html, /href="\/conversations\/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"/);
    const r = await postAs(s.url, '/claude/open', { pass: 'take', date: '2026-10-02', tty: '/dev/ttys999' });
    assert.equal(r.status, 200);
    assert.equal(ran.length, 1);
    assert.equal(ran[0][0], 'osascript');
    assert.equal(ran[0][ran[0].length - 1], '/dev/ttys004', 'the tty comes from session.json, not the page');
    assert.equal((await postAs(s.url, '/claude/open', { pass: 'take' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal(ran.length, 1);
    const results = 'Backlog deck results: hunt-example, 1 of 4 answered\n';
    const sent = await postAs(s.url, '/claude/open', { pass: 'answers', text: results });
    assert.deepEqual([sent.status, JSON.parse(sent.text).message], [200, 'Copied: paste it into the pass']);
    assert.equal(ran[1][ran[1].length - 1], '/dev/ttys004', 'Send to a running pass brings its tab forward too');
  } finally { s.server.close(); rmSync(c, { recursive: true, force: true }); }
});

test('once the pass has ended, Take control continues its conversation in its checkout, and Send to the pass sends the answers as its first message', async () => {
  const c = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  const { checkout, id, projectsDir } = await seedPass(c, { pid: endedPid() });
  const ran = [];
  const s = await start({ port: 0, cache: c, projectsDir, platform: 'darwin', claude: { ...fakeClaude(), env: { HQ_TERMINAL: 'terminal' } }, run: async (cmd, args) => { ran.push(args[0]); return null; }, gh: async () => { throw Object.assign(new Error('no gh'), { code: 'ENOENT' }); } });
  try {
    assert.equal((await postAs(s.url, '/claude/open', { pass: 'take' })).status, 200);
    const script = readFileSync(ran[0], 'utf8');
    assert.ok(script.includes(`cd -- '${checkout}'`));
    assert.ok(script.trimEnd().endsWith(`--resume '${id}'`), 'continued with no message');
    const results = 'Backlog deck results: hunt-2026-10-02, 1 of 1 answered\n\nAGREE, do what Claude recommended (1)\n- name-your-world: decide [0123456789ab]\n';
    assert.equal((await postAs(s.url, '/claude/open', { pass: 'answers', text: results })).status, 200);
    const sent = readFileSync(ran[1], 'utf8');
    assert.ok(sent.includes(`--resume '${id}' "$(cat -- `));
    assert.equal(readFileSync(/cat -- '([^']+)'/.exec(sent)[1], 'utf8'), `/backlog-hunter answers\n\n${results}`);
    assert.equal((await postAs(s.url, '/claude/open', { pass: 'answers', text: 'rm -rf ~' })).status, 400, 'only deck results are sent');
    assert.equal(ran.length, 2);
  } finally { s.server.close(); rmSync(c, { recursive: true, force: true }); }
});

test("a session.json naming a folder that is not one of this repo's checkouts is refused", async () => {
  const c = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  mkdirSync(join(c, 'hunt', '2026-10-02'), { recursive: true });
  writeFileSync(join(c, 'hunt', '2026-10-02', 'session.json'), JSON.stringify({ pid: endedPid(), tty: '/dev/ttys004', started: new Date().toISOString(), checkout: '/tmp/elsewhere' }));
  const ran = [];
  const s = await start({ port: 0, cache: c, projectsDir: join(c, 'projects'), platform: 'darwin', claude: fakeClaude(), run: async (cmd, args) => { ran.push(args[0]); return null; }, gh: async () => { throw Object.assign(new Error('no gh'), { code: 'ENOENT' }); } });
  try {
    const r = await postAs(s.url, '/claude/open', { pass: 'take' });
    assert.equal(r.status, 409);
    assert.match(JSON.parse(r.text).message, /not a checkout of this repo/);
    assert.equal(ran.length, 0);
  } finally { s.server.close(); rmSync(c, { recursive: true, force: true }); }
});

test("a pass's deck opens on the Hunter tab as an HQ page: each item card carries what HQ knows about the item, its words linked", async () => {
  const c = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  mkdirSync(join(c, 'no-transcripts'));
  for (const d of ['2026-10-02', '2026-10-01']) mkdirSync(join(c, 'hunt', d), { recursive: true });
  const deck = JSON.parse(readFileSync(new URL('./fixtures/hunt-deck.json', import.meta.url), 'utf8'));
  deck.cards[1].title = 'Who sees </script><script>alert(1)</script> a name?';
  // a card about an item on the list, with evidence naming a commit and a file
  // a real item on the board: any feature in next/ that nothing blocks, picked when the test runs, so the item it named
  // shipping breaks nothing (Jane, #124)
  const live = readdirSync(new URL('../../docs/backlog/next/', import.meta.url)).find(f => { const t = readFileSync(new URL(`../../docs/backlog/next/${f}`, import.meta.url), 'utf8'); return /^type: feature$/m.test(t) && !/^blocked-by:/m.test(t); }).replace(/\.md$/, '');
  deck.cards.push({ id: live, title: 'An item on the board', rec: { action: 'decide', line: 'Leave it, as `web/app.js` does today.' }, evidence: { verdict: 'open', text: 'Nothing since 00c2598 touches it.' } });
  writeFileSync(join(c, 'hunt', '2026-10-02', 'deck.json'), JSON.stringify(deck));
  writeFileSync(join(c, 'hunt', '2026-10-01', 'deck.json'), JSON.stringify({ id: 'x', cards: [] }));
  const s = await start({ port: 0, cache: c, projectsDir: join(c, 'no-transcripts'), gh: async () => { throw Object.assign(new Error('no gh'), { code: 'ENOENT' }); } });
  const page = p => new Promise(r => request(`${s.url}${p}`, res => { let t = ''; res.on('data', d => (t += d)); res.on('end', () => r(t)); }).end());
  try {
    const html = await page('/backlog?tab=hunter&deck=2026-10-02');
    assert.match(html, /<div class="hq-pagehead dk-head"><h2>Deck from the 2026-10-02 pass/, 'an HQ page heading, with the pass date');
    assert.match(html, /<div class="dk" id="hunt-deck" data-date="2026-10-02"><\/div>/);
    assert.match(html, /<button type="button" class="btn btn-primary" data-dm-open>Play the deck<\/button>/, 'Play the deck, the primary button on the page');
    assert.match(html, /<dialog class="dm" id="hunt-play" aria-label="Play the 2026-10-02 deck"><div class="dk dm-deck" id="hunt-play-deck"><\/div><\/dialog>/);
    assert.doesNotMatch(html, /qk-deck|\/hq\/deck\.css/, 'none of the standalone page\'s look');
    assert.match(html, /<script src="\/hq\/deck.js" defer><\/script><script src="\/hq\/deck-hq.js" defer><\/script>[\s\S]*<script src="\/hq\/backlog.js" defer>/, 'the engine and HQ\'s view load before the page script that mounts them');
    const data = JSON.parse(/<script type="application\/json" id="hunt-deck-data">(.*?)<\/script>/.exec(html)[1]);
    assert.equal(data.cards[1].title, deck.cards[1].title, 'the deck arrives whole');
    assert.ok(!html.includes('</script><script>alert(1)'), 'and no card can close the script');
    const item = data.cards.find(x => x.id === live).hq;
    assert.equal(item.item.href, `/backlog/${live}`);
    assert.match(item.item.type, /class="bl-type" data-type="feature"/, 'its badge, as the board shows it');
    // where the item stands depends on this checkout's branches (one named for it reads as in progress), so the facts are
    // checked against its own page rather than a state: a branch for it on the laptop failed every run here, 2 October
    assert.match(item.item.facts, /^<dl class="bl-facts"><dt>Where<\/dt><dd>/, 'its facts');
    // the page leads with the item's type, which the card shows as its badge; every fact after it is the page's own
    assert.ok((await page(item.item.href)).includes(item.item.facts.replace('<dl class="bl-facts">', '')), 'as its page shows them');
    assert.match(item.line, /<a href="\/code\/web\/app.js"><code>web\/app.js<\/code><\/a>/, 'a file in its words links to HQ');
    assert.match(item.evidence, /<code>00c2598<\/code>/);
    assert.equal(data.cards.find(x => x.id === 'branches-and-prs').hq.item, null, 'a decision about the process is no item');
    assert.doesNotMatch(html, /data-send/, 'no pass began here, so there is nothing to send to: Copy results only');
    assert.match(await page('/backlog?tab=hunter&deck=2026-10-01'), /cannot be shown: the deck has no title/);
    assert.match(await page('/backlog?tab=hunter&deck=1999-01-01'), /data-hunt-start/, 'no such pass: the tab itself');
    for (const f of ['/hq/deck.js', '/hq/deck-hq.js']) assert.equal((await get(f)).status, 200, f);
  } finally { s.server.close(); rmSync(c, { recursive: true, force: true }); }
});

// Stop and Clean up run hq/hunt.mjs; here a runner stands in for it and says what it was asked
async function withManage(answer, fn) {
  const c = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  mkdirSync(join(c, 'no-transcripts'));
  for (const d of ['2026-10-02', '2026-10-02-2']) mkdirSync(join(c, 'hunt', d), { recursive: true });
  const asked = [];
  const huntRun = async args => { asked.push(args); return answer(args); };
  const s = await start({ port: 0, cache: c, projectsDir: join(c, 'no-transcripts'), huntRun, gh: async () => { throw Object.assign(new Error('no gh'), { code: 'ENOENT' }); } });
  try { await fn(s.url, asked); } finally { s.server.close(); rmSync(c, { recursive: true, force: true }); }
}

test('Stop runs hunt.mjs stop for a pass folder that is there, and says what it answered; a page names only the date', async () => {
  await withManage(args => (args[1] === '2026-10-02-2' ? { code: 1, stdout: 'refused: pid 4242 is not claude\n' } : { code: 0, stdout: 'stopped the 2026-10-02 pass (pid 4242)\n' }), async (base, asked) => {
    const ok = await postAs(base, '/hunt/manage', { action: 'stop', date: '2026-10-02' });
    assert.deepEqual([ok.status, JSON.parse(ok.text)], [200, { stopped: true, message: 'stopped the 2026-10-02 pass (pid 4242)' }]);
    const no = await postAs(base, '/hunt/manage', { action: 'stop', date: '2026-10-02-2' });
    assert.deepEqual([no.status, JSON.parse(no.text).message], [409, 'refused: pid 4242 is not claude'], "a day's second pass is its own folder");
    for (const date of ['../../etc', '2026-10-02; rm -rf ~', '2026-10-03', 20261002]) assert.equal((await postAs(base, '/hunt/manage', { action: 'stop', date })).status, 404, String(date));
    assert.equal((await postAs(base, '/hunt/manage', { action: 'rm', date: '2026-10-02' })).status, 400);
    assert.equal((await postAs(base, '/hunt/manage', { action: 'stop', date: '2026-10-02' }, { origin: 'http://evil.example' })).status, 403);
    assert.deepEqual(asked, [['stop', '2026-10-02'], ['stop', '2026-10-02-2']], 'hunt.mjs ran only for the two real passes');
  });
});

test("Clean up asks hunt.mjs for its plan first, and only a second ask removes; a refusal is said, not shown as an empty plan", async () => {
  const plan = { remove: [{ kind: 'claim', slug: 'x', why: 'its pass has gone' }], keep: [{ kind: 'item', slug: 'lock-stale-claims-pile-up', branch: 'hunt/lock-stale-claims-pile-up', worktree: '/Users/dev/repos/questkeep-hunts/lock-stale-claims-pile-up', why: 'commits not on origin/main and no pull request' }] };
  await withManage(args => (args[1] === '2026-10-02-2' ? { code: 1, stdout: 'refused: the 2026-10-02-2 pass is still running\n' }
    : args.includes('--yes') ? { code: 0, stdout: JSON.stringify({ done: [{ ...plan.remove[0], done: true }], keep: plan.keep }) } : { code: 0, stdout: JSON.stringify(plan) }), async (base, asked) => {
    const p = JSON.parse((await postAs(base, '/hunt/manage', { action: 'plan', date: '2026-10-02' })).text);
    assert.deepEqual(p.remove.map(x => [x.kind, x.what, x.why]), [['claim', 'x', 'its pass has gone']]);
    assert.deepEqual(p.keep.map(x => [x.branch, x.why]), [['hunt/lock-stale-claims-pile-up', 'commits not on origin/main and no pull request']]);
    const did = await postAs(base, '/hunt/manage', { action: 'cleanup', date: '2026-10-02' });
    assert.deepEqual([did.status, JSON.parse(did.text).done.map(x => [x.what, x.done])], [200, [['x', true]]]);
    const refused = await postAs(base, '/hunt/manage', { action: 'plan', date: '2026-10-02-2' });
    assert.deepEqual([refused.status, JSON.parse(refused.text).message], [409, 'refused: the 2026-10-02-2 pass is still running']);
    assert.deepEqual(asked, [['cleanup', '2026-10-02', '--json'], ['cleanup', '2026-10-02', '--yes', '--json'], ['cleanup', '2026-10-02-2', '--json']]);
  });
});

test("the Hunter tab shows each pass as a row with its state, built, cards, skipped and Terminal, and its details below", async () => {
  const c = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  mkdirSync(join(c, 'no-transcripts'));
  const live = join(c, 'hunt', '2026-10-02-2'), old = join(c, 'hunt', '2026-10-02');
  mkdirSync(live, { recursive: true }); mkdirSync(old, { recursive: true });
  // a pass with the live record, stopped by Drew; and the first pass, from before it, with its hand-written record
  writeFileSync(join(live, 'pass.json'), JSON.stringify({ started: '2026-10-02T08:30:00Z', phase: 'stopped', stopped: { at: '2026-10-02T09:00:00Z', by: 'Drew, from HQ', why: 'wrong item' },
    timeline: [{ at: '2026-10-02T08:30:00Z', phase: 'look' }, { at: '2026-10-02T09:00:00Z', phase: 'stopped', note: 'from HQ' }],
    items: { 'lock-stale-claims-pile-up': { state: 'pr', pr: 90, branch: 'hunt/lock-stale-claims-pile-up', proof: ['FAIL on 1a2b3c4: kept 63', 'pass on 5d6e7f8'] }, 'name-your-world': { state: 'skipped', why: 'needs Drew' } } }));
  writeFileSync(join(live, 'session.json'), JSON.stringify({ pid: spawnSync('true').pid, tty: '/dev/ttys004', started: '2026-10-02T08:30:00Z', checkout: `${await mainCheckout(REPO)}-hunt` }));
  writeFileSync(join(old, 'pass.json'), JSON.stringify({ started: '2026-10-02T02:20:49Z', ended: '2026-10-02T02:35:00Z', stopped: 'before handing over: the guard refuses git rm', built: [{ slug: 'lock-stale-claims-pile-up', pr: null, proof: 'proven' }], skipped: [{ slug: 'a', why: 'parked' }] }));
  const s = await start({ port: 0, cache: c, projectsDir: join(c, 'no-transcripts'), gh: async () => { throw Object.assign(new Error('no gh'), { code: 'ENOENT' }); } });
  try {
    const html = await new Promise(r => request(`${s.url}/backlog?tab=hunter`, res => { let t = ''; res.on('data', d => (t += d)); res.on('end', () => r(t)); }).end());
    const rows = [...html.matchAll(/<tr class="hunt-row" data-state="([^"]+)">[\s\S]*?<button type="button" class="hunt-open"[^>]*>([^<]+)<\/button>/g)].map(m => [m[2], m[1]]);
    assert.deepEqual(rows, [['2026-10-02-2', 'stopped'], ['2026-10-02', 'stopped']], 'newest first, each with its state');
    assert.match(html, /<code>ttys004<\/code>/, 'its Terminal');
    assert.match(html, /data-hunt-take data-date="2026-10-02-2"/, 'an ended pass with a session can continue its conversation');
    assert.doesNotMatch(html, /data-hunt-take data-date="2026-10-02"/, 'the first pass has no session to go to');
    assert.match(html, /data-hunt-clean data-date="2026-10-02-2"/);
    assert.doesNotMatch(html, /data-hunt-stop/, 'nothing runs, so nothing to stop');
    assert.match(html, /<b>Stopped by Drew, from HQ, [^<]*:<\/b> wrong item/);
    assert.match(html, /<span class="hunt-chip" data-s="pr">pull request<\/span>/);
    assert.match(html, /<pre class="hunt-proof">FAIL on 1a2b3c4: kept 63\npass on 5d6e7f8<\/pre>/, 'the prove lines');
    assert.match(html, /<span class="hunt-chip" data-s="built">built, not pushed<\/span>/, 'the old record reads too');
    assert.match(html, /<dialog class="bl-dialog hunt-dialog"/, 'the confirm Stop and Clean up open');
  } finally { s.server.close(); rmSync(c, { recursive: true, force: true }); }
});

test("a claim and a pass's built item show their pull request once merged, asked of GitHub by branch; Its pull requests stays open ones", async () => {
  const c = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  mkdirSync(join(c, 'no-transcripts')); mkdirSync(join(c, 'hunt', 'claims'), { recursive: true }); mkdirSync(join(c, 'hunt', '2026-10-02'));
  writeFileSync(join(c, 'hunt', 'claims', 'lock-stale-claims-pile-up.json'), JSON.stringify({ slug: 'lock-stale-claims-pile-up', branch: 'hunt/lock-stale-claims-pile-up', pid: spawnSync('true').pid, started: '2026-10-02T02:20:49Z' }));
  writeFileSync(join(c, 'hunt', '2026-10-02', 'pass.json'), JSON.stringify({ started: '2026-10-02T02:20:49Z', ended: '2026-10-02T02:35:00Z', built: [{ slug: 'lock-stale-claims-pile-up', pr: null }] }));
  const asked = [];
  const gh = async args => {
    asked.push(args.join(' '));
    if (args[0] === 'pr' && args.includes('--head')) return JSON.stringify([{ number: 90, state: 'MERGED', url: 'https://github.com/o/r/pull/90' }]);
    if (args[0] === 'pr') return JSON.stringify([{ number: 93, title: 'An open one', headRefName: 'hunt/other', url: 'https://github.com/o/r/pull/93', isDraft: false, statusCheckRollup: [] }]);
    throw Object.assign(new Error('not here'), { code: 'ENOENT' });
  };
  const s = await start({ port: 0, cache: c, projectsDir: join(c, 'no-transcripts'), gh });
  try {
    const html = await new Promise(r => request(`${s.url}/backlog?tab=hunter`, res => { let t = ''; res.on('data', d => (t += d)); res.on('end', () => r(t)); }).end());
    const merged = (html.match(/>#90<\/a> <span class="hunt-prstate" data-s="merged">merged<\/span>/g) || []).length;
    assert.equal(merged, 3, 'on the claim, on the pass that built it, and on the item in that pass\'s details');
    assert.match(html, /<ul class="hunt-prs"><li><a href="https:\/\/github.com\/o\/r\/pull\/93"/, 'Its pull requests lists the open one only');
    const open = html.slice(html.indexOf('<ul class="hunt-prs">'), html.indexOf('</ul>', html.indexOf('<ul class="hunt-prs">')));
    assert.doesNotMatch(open, /#90/, 'the merged one is not among the open');
    assert.equal(asked.filter(a => a.includes('--head hunt/lock-stale-claims-pile-up')).length, 1, 'one question for the branch, though three places show it');
  } finally { s.server.close(); rmSync(c, { recursive: true, force: true }); }
});

test('Continue in Terminal resumes a conversation through the same guarded route', async () => {
  const ran = [];
  await withClaudeServer({ claude: fakeClaude(), platform: 'darwin', run: async (cmd, args) => { ran.push(args[0]); return null; } }, async base => {
    assert.equal((await postAs(base, '/claude/open', { resume: SESSION, cwd: '/Users/dev/questkeep-sync' })).status, 200);
    assert.equal((await postAs(base, '/claude/open', { resume: 'not an id' })).status, 400);
    assert.equal(ran.length, 1);
  });
});

test('a backlog popup comes on its own, the README too, and an unknown one is a 404', async () => {
  // any item still in the backlog will do: paid-skins waits on whether to charge at all (sprint, used here before, shipped)
  const item = await get('/backlog/paid-skins?part=1');
  assert.equal(item.status, 200);
  assert.match(item.body, /^<article class="bl-detail" data-slug="paid-skins"/);
  assert.doesNotMatch(item.body, /QUESTKEEP HQ/, 'no page frame around it');
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

// A transcript in a temp session folder named for this repo's main checkout, as claude would file it.
async function transcriptFor(id) {
  const { mainCheckout } = await import('../lib/conversations.mjs');
  const main = await mainCheckout(process.cwd());
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
  // In the test image a worktree is mounted at /repo with its main checkout's .git at the laptop's path, so this checkout
  // is not beside its main one there; HQ then runs from the main checkout, as it would on the laptop.
  const here = process.cwd(), main = await mainCheckout(here), repo = belongs(here, main) ? here : main;
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
  assert.match(r.cd, /^attachment; filename="questkeep-hq-\d{4}-\d{2}-\d{2}-[0-9a-f]+\.md"$/);
  assert.match(r.type, /text\/markdown/);
  assert.match(r.body, /Backlog/);
  assert.equal((await get('/export/nothing')).status, 404);
});

test('Export as a zip sends a zip of files, with the README first', async () => {
  const r = await new Promise((resolve, reject) => { const q = request(`${url}/export/download?sections=repo,docs&format=zip`, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, cd: res.headers['content-disposition'], type: res.headers['content-type'], body: Buffer.concat(c) })); }); q.on('error', reject); q.end(); });
  assert.equal(r.status, 200);
  assert.equal(r.type, 'application/zip');
  assert.match(r.cd, /filename="questkeep-hq-[\d-]+-[0-9a-f]+\.zip"/);
  assert.equal(r.body.readUInt32LE(0), 0x04034b50, 'a zip starts with a local file header');
  const first = r.body.subarray(30, 30 + r.body.readUInt16LE(26)).toString();
  assert.match(first, /^questkeep-hq-[\d-]+-[0-9a-f]+\/README\.md$/);
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
  const pcache = mkdtempSync(join(tmpdir(), 'hq-problems-')), had = process.env.QK_PROBLEMS_DIR;
  process.env.QK_PROBLEMS_DIR = join(pcache, 'problems');
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
  const p = await start({ port: 0, cache: pcache, projectsDir: join(cache, 'no-transcripts'), gh: async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); } });
  t.after(() => { p.server.close(); rmSync(pcache, { recursive: true, force: true }); if (had === undefined) delete process.env.QK_PROBLEMS_DIR; else process.env.QK_PROBLEMS_DIR = had; });
  return path => fetch(new URL(path, p.url));
}

test('the Problems page, an entry, an unexplained group and the export answer, and the export withholds an email on a domain HQ does not keep', async t => {
  const at = await problemsServer(t), entry = ENTRY;

  for (const [tab, label] of [['overview', 'Overview'], ['trends', 'Trends'], ['tests', 'Tests'], ['slot', 'Test slot'], ['list', 'List']]) {
    const r = await at(`/problems?tab=${tab}`);
    assert.equal(r.status, 200, tab);
    assert.match(await r.text(), new RegExp(`QUESTKEEP HQ[\\s\\S]*aria-current="page">${label}<`), tab);
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
  assert.equal(all.headers.get('content-disposition'), 'attachment; filename="questkeep-problems-all.json"');
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
