// The repo's git health: a card at the top of Home's panel, and a full view with every worktree, stashes and merged
// branches. HQ shows these and never acts on them; the one thing it does is Fetch, when you press it.
import { esc, layout } from '../lib/page.mjs';
import { info, dataTable } from '../lib/ui.mjs';

const ago = iso => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
// how long ago the page's git picture was read: just now, 25 s ago, 3 min ago
const readAgo = ms => (ms < 2000 ? 'just now' : ms < 90000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60000)} min ago`);
const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;
const state = h => (h.clean ? '<span class="pass">clean</span>'
  : `<span class="hq-dirty">${[h.changed && n(h.changed, 'changed', 'changed'), h.untracked && n(h.untracked, 'untracked', 'untracked'), h.conflicted && n(h.conflicted, 'conflict', 'conflicts')].filter(Boolean).join(', ')}</span>`);

const FETCH_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v9m-4-4 4 4 4-4M3 14h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function remoteLine(c) {
  const r = c.remote;
  if (!c.hasRemote) return '<span class="hint">No remote named origin.</span>';
  if (!r.against) return '<span class="hint">Nothing to compare with.</span>';
  const counts = `<b>${r.toPush ?? '?'}</b> to push · <b>${r.toPull ?? '?'}</b> to pull`;
  return r.pushed ? `${counts} ${info(`Against ${r.against}, as of the last fetch.`, 'Against what')}`
    : `<span class="hq-dirty">Not pushed yet.</span> ${counts.replace('to push', 'not on main').replace('to pull', 'new on main')} ${info(`${c.branch} is not on GitHub. The numbers are against ${r.against}, as of the last fetch.`, 'Against what')}`;
}

export function repoCard(c) {
  return `<section class="card hq-card hq-repo"><div class="hq-card-head"><a class="kicker" href="/repo">Repo</a><a class="hint" href="/repo">details</a></div>
    <div class="hq-repo-branch"><code>${esc(c.branch || 'detached')}</code> ${state(c)}</div>
    <div>${remoteLine(c)}</div>
    <div class="hq-repo-fetch"><span class="hint" data-fetched="${esc(c.lastFetch || '')}">${c.lastFetch ? `As of the last fetch, ${ago(c.lastFetch)}` : 'Never fetched'}</span>
      <button type="button" class="btn btn-secondary hq-fetch" ${c.hasRemote ? '' : 'disabled'}>${FETCH_ICON} Fetch</button></div></section>`;
}

export function repoPage({ repo }, h, { readAt = null, now = Date.now() } = {}) {
  const c = h.checkout;
  const wt = dataTable({ id: 'worktrees', columns: [
    { key: 'path', label: 'Folder', filter: 'text' }, { key: 'branch', label: 'Branch', filter: 'text', w: 'lg' }, { key: 'state', label: 'State', filter: 'chips', w: 'md' },
    { key: 'ahead', label: `Ahead of ${h.base}`, num: true, w: 'sm' }, { key: 'behind', label: `Behind ${h.base}`, num: true, w: 'sm' }, { key: 'last', label: 'Last commit' },
  ], rows: h.worktrees.map(w => ({ cells: {
    path: `<code>${esc(w.path)}</code>${w.path === repo ? ' <span class="hint">this one</span>' : ''}`,
    branch: w.branch ? `<code>${esc(w.branch)}</code>` : '<span class="hint">detached</span>',
    state: w.missing ? { html: '<span class="hq-dirty">folder is gone</span>', f: 'folder gone' } : { html: state(w), f: w.clean ? 'clean' : 'changes' },
    ahead: { html: String(w.ahead ?? '?'), v: w.ahead ?? -1 }, behind: { html: String(w.behind ?? '?'), v: w.behind ?? -1 },
    last: { html: `<span title="${esc(w.lastCommit || '')}">${esc(ago(w.lastCommit))}</span>`, v: w.lastCommit || '' },
  } })), empty: 'No worktrees.' });
  const stashes = dataTable({ id: 'stashes', columns: [{ key: 'ref', label: 'Stash', w: 'md' }, { key: 'msg', label: 'Message', filter: 'text' }, { key: 'when', label: 'When', w: 'md' }],
    rows: h.stashes.map(s => ({ cells: { ref: `<code>${esc(s.ref)}</code>`, msg: esc(s.message), when: { html: esc(ago(s.when)), v: s.when } } })), empty: 'No stashes.' });
  const merged = dataTable({ id: 'merged', columns: [{ key: 'b', label: 'Branch', filter: 'text' }],
    rows: h.merged.map(b => ({ cells: { b: `<code>${esc(b)}</code>` } })), empty: `No local branches merged into ${h.base} besides main.` });
  const body = `<p class="hq-crumbs"><a href="/">Home</a> <span class="sep">/</span> Repo</p>
    <div class="hq-pagehead"><h1>Repo${info('What git says about this checkout and its worktrees. HQ only shows these; it never changes a branch, a stash or a worktree. Fetch is the one thing it does, and only when you press it.', 'About this page')}</h1></div>
    ${readAt == null ? '' : `<p class="hint hq-read">Read ${esc(readAgo(now - readAt))} · <a href="/repo?fresh=1">Read again</a></p>`}
    <div class="hq-repo-top">${repoCard(c)}</div>
    <h2>Worktrees${info(`Every checkout of this repo on this machine. Ahead and behind are against ${h.base}, as of the last fetch.`, 'About worktrees')}</h2>${wt}
    <h2>Stashes</h2>${stashes}
    <h2>Merged into ${esc(h.base)}${info('Local branches whose commits are all on main already, so deleting them would lose nothing. HQ does not delete them.', 'About merged branches')}</h2>${merged}`;
  return layout({ title: 'Repo', active: 'home', body, wide: true });
}
