// The GitHub page: a dashboard that answers "is everything OK?", then open pull requests, workflow runs, deploys,
// recent commits and branches on tabs, all through gh with the developer's own login. A chip in the header says
// whether gh works here. The page comes back at once; hq.js asks /github/part/<name> for the open tab, which answers
// that tab's HTML.
import { ciNowPart } from './ci.mjs';
import { join } from 'node:path';
import { esc, layout } from '../lib/page.mjs';
import { ghPart, checksOf } from '../lib/github.mjs';
import { gitInfo, remoteMainSha } from '../lib/outside.mjs';
import { consoleLinks, compareLive } from '../lib/firebase.mjs';
// Whether live serves this tree was QuestKeep's deploy-reuse hash (scripts/tree-hash.mjs). A deploy provider may answer it; until one does, the commits decide.
const servedHashOf = () => null;
import { info, dataTable } from '../lib/ui.mjs';
import { actionsHtml } from './actions.mjs';

const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('sv-SE', { hour12: false }).slice(0, 16); };
const ago = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (!(s >= 0)) return '';
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const short = sha => String(sha || '').slice(0, 7);
const ext = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
const repoUrlOf = repo => { const gi = gitInfo(repo); return gi ? `https://github.com/${gi.slug}` : ''; };
const RESULT = { success: 'pass', failure: 'fail', cancelled: 'fail', timed_out: 'fail', startup_failure: 'fail' };
const MARK = { ok: '<span class="hq-mark ok" aria-label="OK">✓</span>', bad: '<span class="hq-mark bad" aria-label="Problem">!</span>' };
const at = iso => ({ html: `<span title="${esc(when(iso))}">${esc(ago(iso))}</span>`, v: iso || '' });
const runResult = r => (r.status === 'completed'
  ? { html: `<span class="hq-res ${RESULT[r.conclusion] || ''}">${esc((r.conclusion || 'done').replace(/_/g, ' '))}</span>`, f: r.conclusion || 'done' }
  : { html: `<span class="hint">${esc(r.status.replace(/_/g, ' '))}</span>`, f: r.status.replace(/_/g, ' ') });

export const TABS = [['dashboard', 'Dashboard'], ['prs', 'Pull requests'], ['runs', 'Runs'], ['deploys', 'Deploys'], ['commits', 'Commits'], ['branches', 'Branches'], ['firebase', 'Firebase']];

// The Firebase tab: what is live and which commit it is, the releases before it, preview channels, and the console's pages.
// main is { sha, served }: origin/main's commit and the hash of what it serves, either null when not known here.
function drawFirebase(d, main, repoUrl) {
  const mainSha = main.sha;
  const live = d.releases[0] || (d.channels.find(c => c.live) || {}).release || null;
  const stamp = d.live || {}, commit = stamp.status === 'ok' ? stamp.v.commit : null;
  const cmp = compareLive(commit, mainSha, { live: commit ? stamp.v.served : null, main: main.served });
  const words = stamp.status === 'error' ? `Could not read live's version.json (${stamp.detail}), so which commit is live is not known.` : cmp.words;
  const versionNote = 'The version is the id Firebase gives each upload. The commit comes from the version.json each deploy puts on the site.';
  const commitLine = commit ? `<p>Commit ${repoUrl ? ext(`${repoUrl}/commit/${commit}`, `<code>${short(commit)}</code>`) : `<code>${short(commit)}</code>`}${stamp.v.dirty ? ' <span class="hint">with uncommitted changes</span>' : ''}</p>` : '';
  const liveCard = live ? `<section class="card hq-live"><div class="kicker">Live now</div>
      <p class="hq-live-main">Released <b>${esc(ago(live.when))}</b> <span class="hint">${esc(when(live.when))}</span> by <b>${esc(live.by || 'unknown')}</b></p>
      ${commitLine}<p>Version <code>${esc(live.version)}</code>${info(versionNote, 'About the version')}${live.message ? ` · ${esc(live.message)}` : ' <span class="hint">· no message</span>'}</p>
      <p class="hint">${esc(words)}</p></section>` : '<p class="hint">No live release found.</p>';
  const rel = dataTable({ id: 'fb-releases', columns: [{ key: 'when', label: 'Released', w: 'md' }, { key: 'version', label: 'Version', filter: 'text', w: 'sm' }, { key: 'by', label: 'By', filter: 'chips', w: 'lg' },
    { key: 'type', label: 'Kind', filter: 'chips', w: 'sm' }, { key: 'msg', label: 'Message', filter: 'text' }],
  rows: d.releases.map(r => ({ cells: { when: at(r.when), version: `<code>${esc(r.version)}</code>`, by: esc(r.by), type: esc(r.type.toLowerCase().replace(/_/g, ' ')), msg: r.message ? esc(r.message) : '<span class="hint">none</span>' } })),
  empty: 'No releases found.' });
  const previews = d.channels.filter(c => !c.live);
  const ch = dataTable({ id: 'fb-channels', columns: [{ key: 'id', label: 'Channel', filter: 'text', w: 'lg' }, { key: 'url', label: 'Address' }, { key: 'expires', label: 'Expires', w: 'md' }, { key: 'released', label: 'Last release', w: 'md' }],
    rows: previews.map(c => ({ cells: {
      id: esc(c.id), url: c.url ? ext(c.url, esc(c.url.replace(/^https:\/\//, ''))) : '',
      expires: c.expires ? { html: `${Date.parse(c.expires) < Date.now() ? 'expired' : 'in ' + esc(until(c.expires))} <span class="hint">${esc(when(c.expires))}</span>`, v: c.expires } : { html: '<span class="hint">never</span>', v: '9' },
      released: c.release ? at(c.release.when) : '',
    } })), empty: 'No preview channels. make preview CHANNEL=name makes one for a week.' });
  const links = dataTable({ id: 'fb-links', columns: [{ key: 'name', label: 'Console page', filter: 'text', w: 'lg' }, { key: 'url', label: 'Address', sort: false }, { key: 'what', label: 'What it is for', sort: false, wrap: true }],
    rows: consoleLinks(d.project).map(([name, url, what]) => ({ cells: { name: ext(url, esc(name)), url: `<code class="hq-url">${esc(url.replace(/^https:\/\//, ''))}</code>`, what: esc(what) } })) });
  const source = d.source === 'gcloud' ? 'Read through the Hosting API with gcloud\'s login.' : 'Read through the Firebase CLI\'s login. With gcloud logged in, HQ also shows the releases before the live one.';
  return `${liveCard}<p class="hint hq-source">Project <code>${esc(d.project)}</code>. ${esc(source)}</p>
    <h3>Releases</h3>${rel}<h3>Preview channels</h3>${ch}<h3>In the console</h3>${links}`;
}
// origin/main as this checkout last fetched it; a git error reading its served hash leaves the commits to decide.
function mainOf(repo) {
  const sha = repo ? remoteMainSha(repo) : null;
  let served = null; try { served = sha ? servedHashOf(sha, repo) : null; } catch { /* the commits decide */ }
  return { sha, served };
}
const until = iso => { const s = (Date.parse(iso) - Date.now()) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`; };

function draw(name, data, repoUrl, repo) {
  if (name === 'firebase') return drawFirebase(data, mainOf(repo), repoUrl);
  const shaLink = s => (repoUrl ? ext(`${repoUrl}/commit/${s}`, `<code>${short(s)}</code>`) : `<code>${short(s)}</code>`);
  const list = Array.isArray(data) ? data : [];
  if (name === 'health') return `<ul class="hq-health">${list.map(c => `<li>${c.ok ? MARK.ok : MARK.bad}<b>${esc(c.label)}</b><span>${esc(c.detail)}${c.fix ? `<span class="hint"> ${esc(c.fix)}</span>` : ''}</span></li>`).join('')}</ul>`;
  if (name === 'dashboard') {
    const d = data, tile = (ok, title, body) => `<section class="card hq-tile ${ok == null ? '' : ok ? 'good' : 'bad'}"><div class="kicker">${title}</div>${body}</section>`;
    const run = r => r ? `${ext(r.url, esc(r.workflowName))} ${runResult(r).html} <span class="hint">${esc(ago(r.createdAt))}</span><div class="hint">${esc(r.displayTitle)}</div>` : '<span class="hint">No runs yet.</span>';
    return `<p class="hq-verdict ${d.ok ? 'good' : 'bad'}">${d.ok ? MARK.ok + ' Everything looks fine.' : MARK.bad + ' Something needs a look.'}</p>
      <div class="hq-tiles">
        ${tile(d.mainRun && (d.mainRun.status !== 'completed' || d.mainRun.conclusion === 'success'), 'main on CI', run(d.mainRun))}
        ${tile(d.lastDeploy ? d.lastDeploy.conclusion === 'success' : null, 'Last deploy', run(d.lastDeploy))}
        ${tile(d.failing.length === 0, `Failing runs <span class="hq-count">${d.failing.length}</span>`, d.failing.length
          ? `<ul>${d.failing.map(r => `<li>${ext(r.url, esc(r.workflowName))} on <code>${esc(r.headBranch)}</code> <span class="hint">${esc(ago(r.createdAt))}</span></li>`).join('')}</ul>`
          : '<span class="hint">None. The newest run of every workflow on every branch passed.</span>')}
        ${tile(null, `Open pull requests <span class="hq-count">${d.prs.length}</span>`, d.prs.length
          ? `<ul>${d.prs.map(p => `<li>${ext(p.url, `#${p.number}`)} ${esc(p.title)} <span class="${{ passing: 'pass', failing: 'fail' }[checksOf(p)] || 'hint'}">${checksOf(p)}</span></li>`).join('')}</ul>`
          : '<span class="hint">None open.</span>')}
        ${tile(null, `Branches ahead of main <span class="hq-count">${d.ahead.length}</span>`, d.ahead.length
          ? `<ul>${d.ahead.map(b => `<li><code>${esc(b.name)}</code> <span class="hint">${b.ahead} ahead, ${b.behind} behind</span></li>`).join('')}</ul>`
          : '<span class="hint">None.</span>')}
      </div>`;
  }
  if (name === 'prs') return dataTable({ columns: [{ key: 'n', label: '#', num: true, w: 'xs' }, { key: 'title', label: 'Title', filter: 'text' }, { key: 'branch', label: 'Branch', filter: 'text', w: 'lg' },
    { key: 'author', label: 'Author', filter: 'chips', w: 'md' }, { key: 'checks', label: 'Checks', filter: 'chips', w: 'sm' }, { key: 'review', label: 'Review', filter: 'chips', w: 'md' }, { key: 'updated', label: 'Updated', w: 'md' }],
  rows: list.map(p => ({ cells: {
    n: { html: ext(p.url, '#' + p.number), v: p.number }, title: `${esc(p.title)}${p.isDraft ? ' <span class="tag tag-neutral">draft</span>' : ''}`,
    branch: `<code>${esc(p.headRefName)}</code> <span class="hint">into ${esc(p.baseRefName || '')}</span>`, author: esc(p.author && (p.author.name || p.author.login)),
    checks: { html: `<span class="${{ passing: 'pass', failing: 'fail' }[checksOf(p)] || 'hint'}">${checksOf(p)}</span>`, f: checksOf(p) },
    review: esc((p.reviewDecision || '').toLowerCase().replace(/_/g, ' ') || 'none'), updated: at(p.updatedAt),
  } })), empty: 'No open pull requests.' });
  if (name === 'runs') return dataTable({ columns: [{ key: 'wf', label: 'Workflow', filter: 'chips', w: 'md' }, { key: 'title', label: 'Title', filter: 'text' }, { key: 'branch', label: 'Branch', filter: 'chips', w: 'lg' },
    { key: 'commit', label: 'Commit', filter: 'text', w: 'sm' }, { key: 'event', label: 'Trigger', filter: 'chips', w: 'md' }, { key: 'result', label: 'Result', filter: 'chips', w: 'sm' }, { key: 'started', label: 'Started', w: 'md' }],
  rows: list.map(r => ({ cells: {
    wf: esc(r.workflowName), title: ext(r.url, esc(r.displayTitle)), branch: esc(r.headBranch), commit: shaLink(r.headSha),
    event: esc(r.event.replace(/_/g, ' ')), result: runResult(r), started: at(r.createdAt),
  } })), empty: 'No workflow runs.' });
  if (name === 'deploys') return dataTable({ columns: [{ key: 'env', label: 'Where', filter: 'chips', w: 'md' }, { key: 'commit', label: 'Commit', filter: 'text', w: 'sm' }, { key: 'ref', label: 'Branch', filter: 'chips' },
    { key: 'by', label: 'By', filter: 'chips', w: 'lg' }, { key: 'when', label: 'When', w: 'md' }],
  rows: list.map(x => ({ cells: { env: esc(x.environment), commit: shaLink(x.sha), ref: esc(x.ref), by: esc(x.creator && x.creator.login), when: at(x.created_at) } })),
  empty: 'No deploys on GitHub. A deploy from a laptop does not show here.' });
  if (name === 'commits') return dataTable({ columns: [{ key: 'sha', label: 'Commit', filter: 'text', w: 'sm' }, { key: 'msg', label: 'Summary', filter: 'text' }, { key: 'author', label: 'Author', filter: 'chips', w: 'md' }, { key: 'when', label: 'When', w: 'md' }],
    rows: list.map(c => ({ cells: { sha: ext(c.html_url, `<code>${short(c.sha)}</code>`), msg: esc(c.commit.message.split('\n')[0]), author: esc(c.commit.author && c.commit.author.name), when: at(c.commit.author && c.commit.author.date) } })),
    empty: 'No commits.' });
  return dataTable({ columns: [{ key: 'name', label: 'Branch', filter: 'text' }, { key: 'ahead', label: 'Ahead of main', num: true, w: 'sm' }, { key: 'behind', label: 'Behind main', num: true, w: 'sm' }, { key: 'flags', label: 'State', filter: 'chips', sort: false, w: 'md' }],
    rows: list.map(b => ({ cells: {
      name: repoUrl ? ext(`${repoUrl}/tree/${b.name.split('/').map(encodeURIComponent).join('/')}`, esc(b.name)) : esc(b.name),
      ahead: b.isDefault ? { html: '', v: -1 } : { html: b.ahead == null ? '?' : String(b.ahead), v: b.ahead ?? -1 },
      behind: b.isDefault ? { html: '', v: -1 } : { html: b.behind == null ? '?' : String(b.behind), v: b.behind ?? -1 },
      flags: { html: [b.isDefault && 'default', b.protected && 'protected'].filter(Boolean).map(x => `<span class="hint">${x}</span>`).join(' '), f: b.isDefault ? 'default' : 'other' },
    } })), empty: 'No branches.' });
}

// { html, at, ok, count } for one tab or the health chip, for /github/part/<name>.
export async function githubPart({ repo, gh, cache, fb, demo }, name, { fresh = false, wait = false } = {}) {
  if (name === 'actions' && demo) return { ok: true, at: Date.now(), html: '', mini: '', count: null }; // the demo shows no billing
  // CI runs going now, step by step (hq/pages/ci.mjs), which keeps GitHub's answers itself
  if (name === 'ci-now') return { ok: true, ...(await ciNowPart({ repo, cache, gh })) };
  const out = await ghPart(name, { repo, gh, fresh, wait, dir: cache ? join(cache, 'hq') : null, fb });
  if (out.data === undefined) {
    const html = `<p class="hq-problem">${MARK.bad} Could not load ${name === 'actions' ? 'the Actions minutes' : name === 'firebase' ? 'Firebase' : 'this'}. ${esc(out.problem.message)}${out.problem.fix ? ` <span class="hint">${esc(out.problem.fix)}</span>` : ''}</p>`;
    return { ok: false, at: out.at, html, mini: html };
  }
  // an old answer still showing because asking again failed says so above it
  const stale = out.problem ? `<p class="hq-problem hq-stalenote">${MARK.bad} Could not update, so this is from ${esc(ago(new Date(out.at).toISOString()))}. ${esc(out.problem.message)}</p>` : '';
  const extra = { at: out.at, refreshing: !!out.refreshing };
  if (name === 'firebase') {
    const live = out.data.releases[0] || (out.data.channels.find(c => c.live) || {}).release;
    const mini = live ? `<p class="hq-liveline">Released <b>${esc(ago(live.when))}</b> by ${esc((live.by || 'unknown').replace(/@.*$/, ''))} · <code>${esc(live.version.slice(0, 8))}</code></p>` : '<p class="hint">No live release found.</p>';
    return { ...extra, ok: true, html: stale + draw(name, out.data, repoUrlOf(repo), repo), mini: stale + mini, count: null };
  }
  if (name === 'actions') { const a = actionsHtml(out.data); return { ...extra, ok: a.level !== 'red', html: stale + a.html, mini: stale + a.mini, count: null }; }
  const gi = gitInfo(repo), repoUrl = gi ? `https://github.com/${gi.slug}` : '';
  const list = Array.isArray(out.data) ? out.data : [];
  const ok = name === 'health' ? list.every(c => c.ok) : name === 'dashboard' ? out.data.ok : true;
  const problem = name === 'health' ? (list.find(c => !c.ok) || {}).detail : null;
  return { ...extra, ok, count: ['health', 'dashboard'].includes(name) ? null : list.length, problem, html: stale + draw(name, out.data, repoUrl, repo) };
}

const REFRESH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

export function githubPage({ repo, demo }, params = new URLSearchParams()) {
  const gi = gitInfo(repo), tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'dashboard';
  const chip = `<details class="hq-ghchip"><summary class="hq-chip-status" data-health aria-label="Whether gh works on this machine">gh <span data-health-text>checking…</span></summary>
    <div class="hq-ghchip-body"><div class="kicker">gh on this machine</div><div data-health-body><p class="hq-loading">Loading…</p></div></div></details>`;
  const body = `<div class="hq-pagehead"><h1>GitHub &amp; Firebase${info('HQ asks GitHub through gh and Firebase through gcloud or the Firebase CLI, logged in as you, and only reads. Answers are kept on disk and shown at once; anything older than 30 seconds is asked again behind the page, every minute while it is on screen. Refresh asks now.', 'About this page')}</h1>
      ${gi ? ext(`https://github.com/${gi.slug}`, esc(gi.slug)) : ''}${chip}
      <span class="hq-gh-bar"><span class="hint" data-updated>Loading…</span><button type="button" class="btn btn-secondary" data-refresh>${REFRESH} Refresh</button></span></div>
    <nav class="hq-tabs" role="tablist" aria-label="GitHub">${TABS.map(([k, label]) =>
      `<a role="tab" href="?tab=${k}" data-tab="${k}"${k === tab ? ' aria-selected="true" class="on"' : ' aria-selected="false"'}>${label} <span class="hq-gh-count" data-count="${k}"></span></a>`).join('')}</nav>
    <noscript><p class="hq-warn">This page needs JavaScript to load from GitHub.</p></noscript>
    ${TABS.map(([k]) => `<section class="hq-gh-part" data-part="${k}"${k === tab ? '' : ' hidden'} role="tabpanel"><div class="hq-gh-body"><p class="hq-loading">Loading…</p></div>${k === 'dashboard'
      ? '<div class="hq-ci-slot" data-load-part="ci-now"><p class="hq-loading">Looking for CI runs going now…</p></div>' + (demo ? '' : '<div class="hq-actions-slot" data-load-part="actions"><p class="hq-loading">Loading the Actions minutes…</p></div>') : ''}</section>`).join('')}`;
  return layout({ title: 'GitHub & Firebase', active: 'github', body, wide: true });
}
