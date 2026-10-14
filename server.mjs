// QuestKeep HQ: a small intranet for developers, on 127.0.0.1 only. `make hq` starts it; Ctrl-C stops it.
// This header is the one full list of what HQ reads, writes and does; README.md points here.
//
// It reads:
//   - the repo, the worktrees beside it and their git state (git), and ~/.cache/questkeep: the run history, CI's
//     results and the backlog hunter's passes
//   - the Claude Code transcripts about this repo under ~/.claude/projects/ (the Conversations page, and each hunter
//     pass), and the process list, to tell whether a claude it handed a conversation to is still running
//   - GitHub, through gh with the developer's own login (the GitHub page, and the Backlog page's pull requests)
//   - make dora's figures in ~/.cache/questkeep/dora/dora.json (the Delivery page). When they are over 30 minutes old,
//     or on Refresh, the page runs hq/dora.mjs, which reads GitHub through gh and writes only that cache; it never
//     runs git fetch, and with no figures yet it waits for Refresh
//   - the live Firebase project with gcloud's login, or the Firebase CLI's for Hosting alone: the releases and preview
//     channels, and for the Launch page the launch page's visits, sign-ups and feedback in Firestore. That login passes
//     no security rules, so HQ reads what nobody else can. HQ never logs in to anything itself.
//   - the live site's /version.json, which is public, for the commit it serves
// It writes only its own caches in ~/.cache/questkeep, and web/.hq.json, so a local run of the app can link to HQ.
// It runs no shell: file walking and search are done here in node.
//
// What it does rather than reads, each a POST taken only from HQ's own pages (everything else is GET and HEAD):
//   - Show in Finder (/reveal) opens the file manager on a file in the repo or the cache
//   - Fetch (/git/fetch) runs git fetch --prune; HQ never fetches on its own
//   - Open in Claude (/claude/open) opens a Terminal running claude, with the developer's own subscription. It also
//     starts a backlog hunter pass (the Backlog page's Hunter tab) in the hunter's own checkout, which the server
//     names, never the page, and takes control of a pass: its Terminal tab to the front while it runs (the tab found
//     by the tty the pass wrote in its session.json), or its conversation continued once it has ended
//   - Chat (/claude/ask) runs a read-only claude and streams its answer
//   - Stop and Clean up (/hunt/manage) run hq/hunt.mjs for a hunter pass named by its folder: Stop ends the pass's
//     claude, and Clean up removes the worktrees, branches and claims an ended pass left that hold no unfinished work
//
// HQ_PORT picks the port (8780, or the next free one); HQ_CACHE points it at another cache folder. HQ_DEMO=1 shows the
// pages safe to film in public (hq/lib/demo.mjs).
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync, realpathSync, writeFileSync, unlinkSync, watch } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { safePath } from './lib/paths.mjs';
import { layout, esc, setClaudeInfo } from './lib/page.mjs';
import { homePage } from './pages/home.mjs';
import { testingPage, runPage, logPage, testLogPage } from './pages/testing.mjs';
import { searchPage } from './pages/search.mjs';
import { githubPage, githubPart } from './pages/github.mjs';
import { setStash } from './lib/github.mjs';
import { makeStash } from './lib/stash.mjs';
import { reveal, forgetGit } from './lib/outside.mjs';
import { checkoutHealth, repoHealth } from './lib/git.mjs';
import { repoCard, repoPage } from './pages/repo.mjs';
import { backlogPage, backlogItemPage, backlogCard } from './pages/backlog.mjs';
import { conversationsPage, conversationPage, closedInDemo } from './pages/conversations.mjs';
import { exportPage, exportFile } from './pages/export.mjs';
import { ciRunPage } from './pages/ci.mjs';
import { livePage, liveStream } from './pages/live.mjs';
import { deliveryPage } from './pages/delivery.mjs';
import { problemsPage, problemPage, groupPage, exportView, entryJSON } from './pages/problems.mjs';
import { decisionsPage } from './pages/decisions.mjs';
import { sessionFile, turnsFrom, resumedRunning } from './lib/follow.mjs';
import { mainCheckout, readNew, escapePath } from './lib/conversations.mjs';
import { execFile, spawn } from 'node:child_process';
import { billing, childEnv, askArgs, askPrompt, validSession, mapEvent, answerSoFar, loginMeaning, openInClaude, findClaude, programStamp, projectFolder, pickTerminal, focusTabCommand } from './lib/claude.mjs';
import { renderMarkdown } from './lib/markdown.mjs';
import { kindIn } from './lib/files.mjs';
import { loadDemo, demoResponse, hiddenPath } from './lib/demo.mjs';
import { loadManifest, pagesFor } from './lib/manifest.mjs';
import { setNav, setBrand } from './lib/page.mjs';
import { machinePage } from './pages/machine.mjs';
import { configureBacklog } from './lib/backlog.mjs';
import { configureDecisions } from './lib/decisions.mjs';
import { configureDelivery } from './lib/dora.mjs';
import { configureStages } from './lib/problems.mjs';
import { configureSets } from './lib/sets.mjs';
import { conventionWarnings } from './lib/schema.mjs';
import { stagesFrom } from './lib/stages.mjs';
import { loadPipeline } from './lib/pipeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// HQ's own files, served at /hq and /theme. With no manifest, the repo is the folder HQ was started for and the cache
// sits under ~/.cache/hq by its name (lib/manifest.mjs).
export const STATIC = join(HERE, 'static');
export const THEME = join(HERE, 'theme');
export const REPO = process.cwd();
export const CACHE = process.env.HQ_CACHE || join(homedir(), '.cache', 'hq', basename(REPO));
// ports other tools on this laptop already use: the app, the emulators and the rendering experiment
const TAKEN = new Set([8765, 8381, 8790, 4100, 9399, 9599]);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webm': 'video/webm',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.xml': 'text/plain; charset=utf-8',
};

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}
const notFound = (res, what = 'Nothing here.') => send(res, 404, layout({ title: 'Not found', active: '', body: `<h1>Not found</h1><p>${esc(what)}</p>` }));

// A file from one of the two roots, as it is. Anything outside them, or refused inside them, is a 404. With `revalidate`
// (HQ's own scripts and styles, and the app's) the browser keeps its copy and asks each time whether it changed, and a
// 304 with no body answers when it has not; everything else is never kept.
function sendFile(res, root, rel, { revalidate = false } = {}) {
  const real = safePath(root, rel);
  const st = real && statSync(real);
  if (!st || !st.isFile()) return notFound(res);
  const type = TYPES[extname(real).toLowerCase()] || 'application/octet-stream';
  if (!revalidate) return send(res, 200, readFileSync(real), type);
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  if (res.req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': 'no-cache' }); return res.end(); }
  res.writeHead(200, { 'content-type': type, etag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  res.end(res.req.method === 'HEAD' ? undefined : readFileSync(real));
}

export function handler({ repo = REPO, m = loadManifest(repo).m, plugins = [], pluginsFailed = [], warnings = [], cache = m.cache, gh, run, platform, fb, claude = {}, projectsDir, demo = null } = {}) {
  const links = { cache, repo, hasDashboard: false };
  // the manifest, applied once: where the conventions live, the nav, and the project's name in the header
  if (m.backlog) configureBacklog({ rel: m.backlog.rel, mapRel: m.backlog.map ? m.backlog.map.slice(repo.length + 1) : null, earlierRel: m.backlog.earlierRel, stages: m.backlog.stages });
  if (m.decisions) configureDecisions({ rel: m.decisions.rel, earlierRel: m.decisions.earlierRel });
  configureDelivery(m.delivery);
  configureSets({ file: m.tests && m.tests.sets });
  warnings.push(...conventionWarnings(m));
  // the problem register's stages: the pipeline file's, with HQ's fixed five around them, or the shipped default
  const stageSpec = stagesFrom(loadPipeline(m.tests && m.tests.pipeline));
  configureStages(stageSpec);
  warnings.push(...stageSpec.warnings);
  // in the demo a plugin that keeps out of it (demo: false) is out of the nav too, and its page below answers not found
  setNav(pagesFor(m, demo ? plugins.filter(p => p.demo) : plugins)); setBrand(m.name);
  const ctx = { repo, cache, m, plugins, pluginsFailed, warnings, links, gh, fb, demo, ...(projectsDir ? { projectsDir } : {}) };
  const off = f => !m.features[f];
  const cw = claudeWatcher({ find: claude.find, env: claude.env || process.env, platform, repo });
  cw.get(); // look claude up now, so the first page already knows
  // GitHub's answers kept on disk, so a restart shows the last ones at once
  setStash(makeStash({ dir: join(cache, 'hq') }));
  return async (req, res) => {
    try {
      demoResponse(res, demo);
      // only this machine's names for itself: another site in the browser cannot reach HQ by pointing a name of its own
      // at 127.0.0.1 (DNS rebinding) and reading what the GitHub page fetched with the developer's login
      const host = (req.headers.host || '').replace(/:\d+$/, '');
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(res, 403, 'Refused: HQ answers only on 127.0.0.1.', 'text/plain');
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/reveal') return revealRoute(req, res, { roots: { repo, cache }, run, platform });
      if (url.pathname === '/git/fetch') return fetchRoute(req, res, { repo, run });
      if (url.pathname === '/claude/open') return claudeOpenRoute(req, res, { repo, cache, run, platform, cw, demo, projectsDir: ctx.projectsDir });
      if (url.pathname === '/claude/ask') return claudeAskRoute(req, res, { repo, claude, cw, demo });
      if (url.pathname === '/claude/status') return json(res, 200, await claudeStatus(cw));
      if (url.pathname === '/claude/follow') return claudeFollowRoute(req, res, url.searchParams, { repo, projectsDir: ctx.projectsDir, claude, closed: id => closedInDemo(ctx, id) });
      await cw.get(); // a stat of the claude program; looks it up again only after an update
      // a plugin's own action: POST /plugin/<id>/<name>, JSON in and out, from HQ's own page only
      if (url.pathname.startsWith('/plugin/')) return pluginActionRoute(req, res, url, ctx);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'HQ only reads, apart from Show in Finder, Fetch, Claude and a plugin\'s own actions.', 'text/plain');
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { return notFound(res); }
      const [, top = '', ...restParts] = path.split('/');
      const rest = restParts.join('/');
      ctx.links.hasDashboard = existsSync(join(cache, 'runs', 'report.html'));
      ctx.links.origin = `http://${req.headers.host}`;
      const moved = to => { res.writeHead(301, { location: to }); return res.end(); };
      // the demo's hidden files are not there at all
      if (['code', 'raw'].includes(top) && hiddenPath(demo, rest)) return notFound(res);
      // a page the manifest has not turned on is not there
      const gated = { backlog: 'backlog', decisions: 'decisions', testing: 'testing', runs: 'testing', ci: 'testing', delivery: 'delivery', problems: 'problems' };
      if (gated[top] && off(gated[top])) return notFound(res, `The ${gated[top]} page is off: hq.json does not name what it reads. Run hq setup to see what it would.`);
      switch (top) {
        case '': case 'code': {
          const [c, blCard] = await Promise.all([checkoutHealth(repo), backlogCard(ctx)]);
          const page = { ...ctx, repoCard: () => repoCard(c), backlogCard: () => blCard };
          const html = top ? homePage(page, rest.replace(/\/$/, ''), url.searchParams) : homePage(page, 'README.md', url.searchParams, { home: true });
          return html ? send(res, 200, html) : notFound(res, 'No such file.');
        }
        case 'repo': return rest ? notFound(res) : send(res, 200, repoPage(ctx, await repoHealth(repo)));
        case 'backlog': {
          if (!rest) return send(res, 200, await backlogPage(ctx, url.searchParams));
          const html = restParts.length === 1 ? await backlogItemPage(ctx, restParts[0], url.searchParams) : null;
          return html ? send(res, 200, html) : notFound(res, 'No such backlog item.');
        }
        case 'decisions': return rest ? notFound(res) : send(res, 200, decisionsPage(ctx));
        case 'conversations': {
          if (!rest) return send(res, 200, await conversationsPage(ctx, url.searchParams));
          const html = restParts.length === 1 ? await conversationPage(ctx, restParts[0], url.searchParams) : null;
          return html ? send(res, 200, html) : notFound(res, 'No such conversation.');
        }
        case 'ci': {
          const html = restParts.length === 1 ? await ciRunPage(ctx, restParts[0], url.searchParams) : null;
          return html ? send(res, 200, html) : notFound(res, 'No such CI run.');
        }
        case 'export': {
          if (!rest) return send(res, 200, await exportPage(ctx, url.searchParams));
          if (rest !== 'download') return notFound(res);
          // the whole file, as a download: a GET that only reads, like every page
          const f = await exportFile(ctx, url.searchParams);
          res.writeHead(200, { 'content-type': f.type, 'content-disposition': `attachment; filename="${f.name.replace(/[^\w.-]/g, '_')}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          return res.end(req.method === 'HEAD' ? undefined : f.body);
        }
        case 'testing': return rest ? notFound(res) : send(res, 200, testingPage(ctx, url.searchParams));
        case 'runs': {
          const [id, sub, task] = restParts;
          if (!id) return moved('/testing?tab=runs');
          // a run going now on this laptop or in its container, and what its log gains as it goes (hq/pages/live.mjs)
          if (sub === 'live' && restParts[2] === 'stream' && restParts.length === 3) return (await liveStream(ctx, id, url.searchParams.get('task'), +url.searchParams.get('from') || 0))(res);
          if (sub === 'live' && restParts.length === 2) { const live = await livePage(ctx, id, url.searchParams); return live ? send(res, 200, live) : notFound(res, 'No such run.'); }
          const html = restParts.length > 3 ? null : sub === 'log' ? logPage(ctx, id, task) : sub === 'test' ? testLogPage(ctx, id, task, url.searchParams.get('task')) : restParts.length === 1 ? runPage(ctx, id) : null;
          return html ? send(res, 200, html) : notFound(res, 'No such run.');
        }
        case 'search': return send(res, 200, searchPage(ctx, url.searchParams));
        case 'delivery': return rest ? notFound(res) : send(res, 200, await deliveryPage(ctx, url.searchParams));
        case 'problems': {
          if (!rest) return send(res, 200, problemsPage(ctx, url.searchParams));
          // the page or one entry as JSON (download=1 saves it as a file), an entry's page, or an unexplained group's
          const asJson = rest === 'export.json' ? exportView(ctx, url.searchParams) : restParts.length === 1 && rest.endsWith('.json') ? entryJSON(ctx, rest.slice(0, -5)) : null;
          if (asJson) {
            const name = rest === 'export.json' ? `${m.name}-problems-${url.searchParams.get('range') || '7d'}${url.searchParams.get('record') === 'live' ? '-live' : ''}.json` : rest;
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(url.searchParams.has('download') ? { 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"` } : {}) });
            return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(asJson, null, 2));
          }
          // a group's signature can hold a "/" (a unit test's file, an error line), so its parts are split before decoding
          const raw = url.pathname.split('/').slice(2), part = x => { try { return decodeURIComponent(x); } catch { return null; } };
          const html = raw[0] === 'group' && raw.length === 3 ? groupPage(ctx, part(raw[1]), part(raw[2])) : restParts.length === 1 ? problemPage(ctx, restParts[0]) : null;
          return html ? send(res, 200, html) : notFound(res, 'No such problem.');
        }
        case 'github':
          if (restParts[0] === 'part' && restParts.length === 2) return json(res, 200, await githubPart(ctx, restParts[1], { fresh: url.searchParams.has('fresh'), wait: url.searchParams.has('wait') }));
          return rest ? notFound(res) : send(res, 200, githubPage(ctx, url.searchParams));
        // the pages before Home and Testing, so old links still land
        case 'docs': return moved(rest ? `/code/${restParts.map(encodeURIComponent).join('/')}${url.hash}` : '/');
        case 'tests': return moved('/testing?tab=tests');
        case 'pipeline': return moved('/testing');
        case 'machine': return rest ? notFound(res) : send(res, 200, await machinePage(ctx, url.searchParams));
        case 'hq': return sendFile(res, STATIC, rest, { revalidate: true });
        case 'theme': return sendFile(res, THEME, rest, { revalidate: true });
        case 'raw': return sendFile(res, repo, rest);
        case 'cache': return sendFile(res, cache, rest);
        default: {
          // a plugin's page, when one claims this path
          const pl = plugins.find(p => p.path === top && (!demo || p.demo));
          if (!pl) return notFound(res, plugins.some(p => p.path === top) ? 'That page is not in the demo.' : 'Nothing here.');
          const html = await pl.page(ctx, url.searchParams, rest);
          return html ? send(res, 200, html) : notFound(res);
        }
      }
    } catch (e) {
      console.error(e);
      send(res, 500, layout({ title: 'Error', active: '', body: `<h1>Something went wrong</h1><pre>${esc(e.stack || e)}</pre>` }));
    }
  };
}

const json = (res, status, body) => send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');

// The two things HQ does rather than reads, Show in Finder and Fetch, take a POST, so no link, prefetch or image on any
// page can set them off; from HQ's own page only, which the browser proves with an Origin header naming this server;
// and as JSON, which another site cannot send without asking first. Answers the parsed body, or null once it has
// already refused.
async function guardedJson(req, res, what, max = 4096) {
  if (req.method !== 'POST') { res.setHeader('allow', 'POST'); json(res, 405, { message: `${what} takes a POST.` }); return null; }
  if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { message: 'Only HQ\'s own pages can ask for this.' }); return null; }
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) { json(res, 415, { message: 'Send JSON.' }); return null; }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > max) { json(res, 413, { message: 'Too long.' }); return null; } }
  try { return JSON.parse(body || '{}') || {}; } catch { json(res, 400, { message: 'Send JSON.' }); return null; }
}

// Show in Finder. The path goes through the same check as reading a file.
async function revealRoute(req, res, opts) {
  const ask = await guardedJson(req, res, 'Show in Finder');
  if (!ask) return;
  const out = await reveal({ ...opts, root: ask.root, path: ask.path });
  return json(res, out.status, { message: out.message });
}

// git fetch --prune, when the Fetch button asks. HQ never fetches on its own. It only updates the remote-tracking
// refs, so nothing in the working tree or any branch changes.
const runChecked = (cmd, args, opts) => new Promise(done => {
  execFile(cmd, args, { ...opts, timeout: 60000, windowsHide: true }, (err, stdout, stderr) => done(err ? Object.assign(err, { stderr: String(stderr || '') }) : null));
});
async function fetchRoute(req, res, { repo, run = runChecked }) {
  if (!(await guardedJson(req, res, 'Fetch'))) return;
  const err = await run('git', ['fetch', '--prune'], { cwd: repo });
  forgetGit();
  if (err) return json(res, 502, { message: `git fetch failed: ${(err.stderr || err.message || '').trim().split('\n').pop()}` });
  return json(res, 200, { message: 'Fetched.', at: new Date().toISOString() });
}

// ---- Claude (hq/lib/claude.mjs) ----

// What HQ knows about claude: looked up when HQ starts, then again only when the claude program's file changes (an
// update). The environment cannot change under a running HQ, so who pays is worked out once. Every page carries the
// result (setClaudeInfo), so the Chat panel asks for nothing when a page loads.
function claudeWatcher({ find = findClaude, env = process.env, platform = process.platform, repo }) {
  let info = null, stamp = '', pending = null;
  const refresh = async () => {
    const c = await find();
    stamp = c ? programStamp(c.path) : '';
    info = { installed: !!c, version: c?.version || null, path: c?.path || null, billing: billing(env), canOpen: platform === 'darwin',
      terminal: platform === 'darwin' ? pickTerminal({ env }) : null, sessions: projectFolder(repo, homedir()) };
    const { path, ...shown } = info; // the page needs no path to the program
    setClaudeInfo(shown);
    pending = null;
    return info;
  };
  return {
    env,
    async get() {
      if (pending) return pending;
      if (!info || (info.path && programStamp(info.path) !== stamp)) return (pending = refresh());
      return info;
    },
  };
}

async function claudeStatus(cw) { const { path, ...shown } = await cw.get(); return shown; }

// A plugin's action, run only from HQ's own page (the same guards as Show in Finder), with the JSON body as its input.
async function pluginActionRoute(req, res, url, ctx) {
  const [, , id, name] = url.pathname.split('/');
  const pl = ctx.plugins.find(p => p.id === id);
  const action = pl && pl.actions && Object.hasOwn(pl.actions, name) ? pl.actions[name] : null;
  if (!action) return json(res, 404, { message: 'No such action.' });
  if (ctx.demo && !pl.demo) return json(res, 403, { message: `${pl.label} is not in the demo.` });
  const body = await guardedJson(req, res, `${pl.label}: ${name}`);
  if (!body) return;
  try { const out = await action(body, ctx); return json(res, 200, out == null ? {} : out); }
  catch (e) { return json(res, 500, { message: String(e.message || e) }); }
}

async function claudeOpenRoute(req, res, { repo, cache, run = runChecked, platform = process.platform, cw, demo, projectsDir }) {
  const ask = await guardedJson(req, res, 'Open in Claude', 65536);
  if (!ask) return;
  const c = await cw.get();
  if (!c.installed) return json(res, 503, { message: 'claude is not installed, or not on the PATH HQ started with.' });
  const out = await openInClaude({ repo, cache, text: ask.text, resume: ask.resume, cwd: typeof ask.cwd === 'string' && ask.cwd.startsWith('/') ? ask.cwd : undefined,
    platform, run: (cmd, args) => run(cmd, args, {}), claudePath: c.path, terminal: c.terminal });
  return json(res, out.status, { message: out.message });
}

// What claude wrote, as the Chat panel shows it: rendered as a doc at the repo's root is, with files linked, and any
// HTML in it shown as text, since the panel puts this in the page and claude may quote a tag (half a quote, mid-stream).
const chatHtml = (text, repo) => renderMarkdown(text, 'README.md', kindIn(repo), { rawHtml: false }).html;

// One question at a time: a second waits for the first, or for Stop.
let asking = null;
async function claudeAskRoute(req, res, { repo, claude, cw, demo }) {
  const ask = await guardedJson(req, res, 'Chat', 65536);
  if (!ask) return;
  const env = cw.env, c = await cw.get(), b = c.billing;
  if (!b.ok) return json(res, 409, { message: `${b.blocked.join(' and ')} ${b.blocked.length > 1 ? 'are' : 'is'} set where HQ runs, so claude would bill that cloud account. Chat stays off until HQ is started without it.` });
  if (asking) return json(res, 429, { message: 'Claude is still answering the last question. Stop it, or wait.' });
  if (!String(ask.question || '').trim()) return json(res, 400, { message: 'Write a message first.' });
  if (!c.installed) return json(res, 503, { message: 'claude is not installed, or not on the PATH HQ started with.' });
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  const out = o => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
  out({ type: 'billing', stripped: b.stripped });
  const child = (claude.spawn || spawn)(c.path, askArgs({ session: validSession(ask.session), fork: ask.fork === true }), { cwd: repo, env: childEnv(env), windowsHide: true });
  asking = child;
  child.stdin.on('error', () => { /* claude went before reading the question; its exit says why */ });
  child.stdin.end(askPrompt({ question: ask.question, file: ask.file, title: ask.title, page: ask.page }));
  let buf = '', err = '';
  const render = text => chatHtml(text, repo);
  const soFar = answerSoFar(render); // the answer as it arrives, rendered as the finished one is
  child.stdout.on('data', d => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let e;
      try { e = mapEvent(JSON.parse(line)); } catch { continue; }
      if (!e || (demo && e.type === 'limits')) continue; // the demo leaves out how much of the plan is used
      if (e.type === 'start') e.bill = loginMeaning(e.login);
      if (e.type === 'text') { const html = soFar.add(e.text); if (html != null) e.html = html; }
      if (e.type === 'tools') { const html = soFar.pause(); if (html != null) e.html = html; }
      if (e.type === 'done') e.html = render(e.text);
      out(e);
    }
  });
  child.stderr.on('data', d => { err = (err + d).slice(-4000); });
  const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60000); // cap: an answer still running after ten minutes is stuck
  // the browser pressed Stop or left the page: claude stops too
  res.on('close', () => { if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM'); });
  const finish = message => { clearTimeout(timer); if (asking === child) asking = null; if (message) out({ type: 'error', message }); if (!res.writableEnded) res.end(); };
  child.on('error', e => finish(`claude could not start: ${e.message}`));
  child.on('close', (code, signal) => finish(code ? `claude stopped with exit ${code}. ${err.trim().split('\n').slice(-2).join(' ')}` : signal ? 'Stopped.' : ''));
}

// Follow: the turns a terminal adds to a conversation, as they are written, and whether its claude is still running.
// A GET that only reads: the transcript file and the process list. `from` is the byte offset the panel had reached,
// so a page change picks up where the last one stopped; without it, following starts at the file's end. It says first
// whether the conversation is filed under the folder Chat's claude runs in (this checkout's), the only place Chat
// could carry it on; one filed under a worktree or a folder inside the repo can be followed but not continued here.
// The demo follows no conversation whose transcript it keeps closed.
async function claudeFollowRoute(req, res, params, { repo, projectsDir, claude, closed = async () => false }) {
  if (req.method !== 'GET') return json(res, 405, { message: 'Follow takes a GET.' });
  const id = validSession(params.get('session'));
  if (!id) return json(res, 400, { message: 'That is not a conversation id.' });
  if (await closed(id)) return json(res, 404, { message: 'That conversation stays closed in the demo.' });
  const file = sessionFile({ projectsDir: projectsDir || join(homedir(), '.claude', 'projects'), main: await mainCheckout(repo), id });
  if (!file) return json(res, 404, { message: 'No transcript for that conversation in this repo.' });
  const every = claude.followEvery || { read: 2000, alive: 3000 }, alive = claude.alive || resumedRunning;
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  const out = o => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
  const size0 = statSync(file).size, from = params.has('from') ? Number(params.get('from')) : NaN;
  let offset = Number.isInteger(from) && from >= 0 && from <= size0 ? from : size0, running = null;
  const seen = new Set();
  const pump = () => {
    let size;
    try { size = statSync(file).size; } catch { return; }
    if (size < offset) offset = 0; // rewritten: read it again; the uuids already sent are skipped
    const r = readNew(file, offset, size);
    if (r.offset === offset) return;
    offset = r.offset;
    for (const t of turnsFrom(r.lines, seen)) {
      if (t.type === 'claude') t.html = chatHtml(t.text, repo);
      out(t);
    }
    out({ type: 'at', offset });
  };
  const check = async () => { const on = await alive(id); if (on !== running) { running = on; out({ type: on ? 'running' : 'ended' }); } };
  out({ type: 'filed', here: basename(dirname(file)) === escapePath(repo) });
  out({ type: 'at', offset });
  pump(); check();
  let watcher = null;
  try { watcher = watch(file, pump); } catch { /* the timer below still reads */ }
  const reads = setInterval(pump, every.read); // cap: fs.watch can miss an append on some filesystems; this reads anyway
  const lives = setInterval(check, every.alive); // cap: the process list has no event to wait on
  res.on('close', () => { clearInterval(reads); clearInterval(lives); if (watcher) watcher.close(); });
}

// Listens on the port given, or on 8780 and upwards past any port in use. Port 0 takes any free one, for the tests.
export function start({ port = +(process.env.HQ_PORT || 8780), repo = REPO, m = loadManifest(repo).m, plugins = [], pluginsFailed = [], warnings = [], cache = m.cache, gh, run, platform, fb, claude, projectsDir, demo = loadDemo({ repo, cache, name: m.name }) } = {}) {
  const server = createServer(handler({ repo, m, plugins, pluginsFailed, warnings, cache, gh, run, platform, fb, claude, projectsDir, demo }));
  const fixed = !!process.env.HQ_PORT || port === 0;
  return new Promise((resolve, reject) => {
    const attempt = p => {
      if (!fixed && TAKEN.has(p)) return attempt(p + 1);
      server.once('error', e => (e.code === 'EADDRINUSE' && !fixed && p < port + 20 ? attempt(p + 1) : reject(e)));
      server.listen(p, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
    };
    attempt(port);
  });
}

