// The Conversations page: every Claude Code session about this repo on this laptop (hq/lib/conversations.mjs), a
// search through what people and Claude wrote in them, and one transcript at a time, a page of turns at once. Each
// session links to the commits it made, the files it changed and the backlog items it talked about. HQ only reads the
// transcripts; Continue in Terminal (hq-claude.js) opens the session again in claude.
import { existsSync } from 'node:fs';
import { localMinute } from '../lib/when.mjs';
import { esc, urlPath, layout } from '../lib/page.mjs';
import { info, dataTable } from '../lib/ui.mjs';
import { renderMarkdown } from '../lib/markdown.mjs';
import { kindIn } from '../lib/files.mjs';
import { gitInfo } from '../lib/outside.mjs';
import { runGit } from '../lib/git.mjs';
import {
  conversationsIndex, resolveCommits, mentions, search, runningNow, readTurns, readAgent, subagentsOf, backlogItems,
  transcriptPath, sourceOf,
} from '../lib/conversations.mjs';
import { demoSession } from '../lib/demo.mjs';

const PAGE = 30; // turns on one page of a transcript
const DAY = 86400000;
const when = iso => localMinute(iso) ?? '';
const ago = (iso, now = Date.now()) => { const s = (now - new Date(iso)) / 1000; return !(s >= 0) ? '' : s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < DAY / 1000 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const k = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const copyable = text => `<div class="hq-command"><code>${esc(text)}</code><button type="button" class="btn btn-ghost hq-copy" data-copy="${esc(text)}">Copy</button></div>`;
const where = (s, main) => { const c = s.cwd || ''; return c === main ? 'main checkout' : c.startsWith(`${main}-`) ? c.slice(main.length + 1).split('/')[0] : c.startsWith(`${main}/`) ? c.slice(main.length + 1) : c || '?'; };

// The index with each session's commits and the backlog items it mentions, kept until a transcript or a ref moves.
let memo = null, last = null;
async function gather({ repo, cache, projectsDir, demo }) {
  const idx = await conversationsIndex({ repo, cache, projectsDir });
  const refs = await runGit(['for-each-ref', '--format=%(objectname)', 'refs/heads', 'refs/remotes'], repo);
  const items = backlogItems(repo);
  const key = `${idx.sessions.map(s => `${s.id}:${s.lastActive}:${s.gone}`).join()}|${refs}|${items.map(i => i.slug).join()}`;
  if (!memo || memo.key !== key || memo.repo !== repo || memo.demo !== demo) {
    const sessions = await resolveCommits(repo, idx.sessions);
    const said = mentions(cache, sessions, items);
    const bySession = new Map();
    for (const [slug, ids] of said) for (const id of ids) { if (!bySession.has(id)) bySession.set(id, []); bySession.get(id).push(slug); }
    memo = { key, repo, demo, main: idx.main, projectsDir: idx.projectsDir, items, sessions: sessions.map(s => demoSession(demo, { ...s, mentions: bySession.get(s.id) || [] })).sort((a, b) => String(b.lastActive).localeCompare(String(a.lastActive))) };
  }
  last = { ...memo, cache };
  return { ...memo, running: runningNow(cache) };
}

// Sessions that talked about a backlog item (by its file name or title) or changed a file, newest first.
export async function conversationsAbout(ctx, { slug, file } = {}) {
  const g = await gather(ctx);
  return about(g, { slug, file });
}
function about(g, { slug, file }) {
  return g.sessions.filter(s => (slug && s.mentions.includes(slug)) || (file && s.edited.includes(file)))
    .map(s => ({ id: s.id, title: s.title, lastActive: s.lastActive, branch: s.branches[0] || '', how: file && s.edited.includes(file) ? 'edited' : 'mentions' }));
}
// The same from what is already in memory, for pages that cannot wait: nothing until the first load, which it starts.
export function conversationsAboutNow(ctx, q) {
  if (!last || last.repo !== ctx.repo) { gather(ctx).catch(() => {}); return []; }
  return about(last, q);
}

// Whether the demo keeps a conversation closed: one it does not know is closed too. Without the demo, none is.
export async function closedInDemo(ctx, id) {
  if (!ctx.demo) return false;
  const s = (await gather(ctx)).sessions.find(x => x.id === id);
  return !s || !!s.demoClosed;
}

// ---- the list ----

export async function conversationsPage(ctx, params = new URLSearchParams()) {
  const g = await gather(ctx), q = (params.get('q') || '').trim();
  const hits = q ? search(ctx.cache, g.sessions, q) : null;
  const shown = hits ? hits.map(h => { const s = g.sessions.find(x => x.id === h.id); return { ...s, snippet: s.demoClosed ? '' : h.snippet }; }) : g.sessions;
  const tokens = g.sessions.reduce((n, s) => n + s.tokens.out, 0);
  const rows = shown.map(s => ({ cells: {
    title: { html: `<a href="/conversations/${urlPath(s.id)}">${esc(s.title)}</a>${g.running.has(s.id) ? ' <span class="cv-live">running</span>' : ''}${s.gone ? ' <span class="cv-gone">transcript deleted</span>' : ''}${s.snippet ? `<div class="cv-snippet">…${esc(s.snippet)}…</div>` : ''}`, v: s.title, f: `${s.title} ${s.id}` },
    branch: { html: s.branches.map(b => `<code>${esc(b)}</code>`).join(' '), f: s.branches.join(' ') || 'none' },
    source: { html: esc(sourceOf(s.entrypoint)), f: sourceOf(s.entrypoint) },
    where: { html: esc(where(s, g.main)), f: where(s, g.main) },
    started: { html: esc(when(s.started)), v: s.started || '' },
    active: { html: `<span title="${esc(when(s.lastActive))}">${esc(ago(s.lastActive))}</span>`, v: s.lastActive || '' },
    prompts: { html: String(s.prompts), v: s.prompts },
    tokens: { html: `<span title="in ${s.tokens.in}, out ${s.tokens.out}, cache read ${s.tokens.cacheRead}, cache write ${s.tokens.cacheWrite}">${k(s.tokens.out)}</span>`, v: s.tokens.out },
    edited: { html: String(s.edited.length), v: s.edited.length },
    commits: { html: String(s.commitsFound.length), v: s.commitsFound.length },
  } }));
  const table = dataTable({ id: 'conversations', columns: [
    { key: 'title', label: 'Conversation', filter: 'text', wrap: true }, { key: 'branch', label: 'Branch', filter: 'chips', w: 'md' },
    { key: 'source', label: 'From', filter: 'chips', w: 'md' }, { key: 'where', label: 'Started in', filter: 'chips', w: 'md' },
    { key: 'started', label: 'Started', w: 'md' }, { key: 'active', label: 'Last active', w: 'sm' },
    { key: 'prompts', label: 'Prompts', num: true, w: 'xs' }, { key: 'tokens', label: 'Tokens out', num: true, w: 'sm' },
    { key: 'edited', label: 'Files changed', num: true, w: 'xs' }, { key: 'commits', label: 'Commits', num: true, w: 'xs' },
  ], rows, empty: q ? `Nothing said in any conversation matches “${q}”.` : 'No conversations found for this repo.' });
  const body = `<div class="hq-pagehead"><h1>Conversations${info(`Every Claude Code session on this laptop that ran in this repo or one of its worktrees, read from ${g.projectsDir}. HQ keeps an index of them in ${ctx.cache}/hq/conversations/, so a conversation stays listed after Claude Code deletes its transcript (after 30 days unless cleanupPeriodDays says otherwise).`, 'About this page')}</h1></div>
    <p class="hint">${g.sessions.length} conversations · ${g.running.size} running now · ${k(tokens)} tokens written by Claude</p>
    <form class="cv-search" action="/conversations" method="get" role="search"><input class="input" type="search" name="q" value="${esc(q)}" placeholder="Search what people and Claude wrote" aria-label="Search the conversations">${q ? ` <a class="hint" href="/conversations">Clear</a> <span class="hint">${shown.length} match${shown.length === 1 ? '' : 'es'}</span>` : ''}</form>
    ${table}`;
  return layout({ title: 'Conversations', active: 'conversations', body, wide: true });
}

// ---- one conversation ----

// What a tool call was about, in a few words: the file, the command, the pattern.
function toolKey(t) {
  const i = t.input || {};
  return i.file_path || i.notebook_path || i.command || i.pattern || i.path || i.url || i.description || i.query || i.skill || i.action || '';
}

function toolHtml(t, s, agents) {
  const key = String(toolKey(t)).split('\n')[0].slice(0, 160);
  const agent = t.agentId && agents.find(a => a.agentId === t.agentId);
  const input = JSON.stringify(t.input, null, 2);
  const result = t.result == null ? '<p class="hint">No result recorded.</p>'
    : `<pre class="cv-result${t.error ? ' error' : ''}">${esc(t.result)}${t.size > t.result.length ? `\n… ${k(t.size - t.result.length)} more characters` : ''}</pre>`;
  return `<details class="cv-tool${t.error ? ' error' : ''}"><summary><b>${esc(t.name)}</b> <code>${esc(key)}</code>${agent ? ` <a href="/conversations/${urlPath(s.id)}?agent=${encodeURIComponent(agent.agentId)}">open its transcript</a>` : ''}</summary>
    <pre class="cv-input">${esc(input.length > 4000 ? `${input.slice(0, 4000)}\n…` : input)}</pre>${result}</details>`;
}

const md = (text, repo) => renderMarkdown(text, 'README.md', kindIn(repo)).html;

// What Claude wrote and the tools it called in one turn, as this page shows them (the Hunter tab shows a pass's last
// ones the same way).
export function itemsHtml(items, s, repo, agents) {
  return items.map(it => (it.kind === 'text' ? `<div class="cv-claude hq-md">${md(it.text, repo)}</div>` : toolHtml(it, s, agents))).join('');
}

function facts(s, g, gi) {
  const t = s.tokens, running = g.running.has(s.id), file = transcriptPath(s);
  const commit = c => { const url = gi?.slug ? `https://github.com/${gi.slug}/commit/${c.sha}` : null; const sha = `<code>${esc(c.sha.slice(0, 7))}</code>`; return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${sha}</a>` : sha} ${esc(c.subject)}</li>`; };
  const rows = [
    ['From', esc(sourceOf(s.entrypoint))],
    ['Started in', `<code>${esc(s.cwd)}</code>${s.cwds.length > 1 ? ` <span class="hint">and ${s.cwds.length - 1} more</span>` : ''}`],
    ['Branch', s.branches.map(b => `<code>${esc(b)}</code>`).join(' ') || '<span class="hint">none recorded</span>'],
    ['When', `${esc(when(s.started))} to ${esc(when(s.lastActive))}${running ? ' <span class="cv-live">running now</span>' : ''}`],
    ['Size', `${s.prompts} prompts, ${s.replies} replies${s.subagents ? `, ${s.subagents} subagents` : ''}`],
    ['Tokens', `in ${k(t.in)} · out ${k(t.out)} · cache read ${k(t.cacheRead)} · cache write ${k(t.cacheWrite)}`],
    ['Session', copyable(s.id)],
    ['On disk', s.gone ? `<span class="cv-gone">deleted by Claude Code</span> <code>${esc(file)}</code>` : copyable(file)],
    ['Resume', copyable(`claude --resume ${s.id}`)],
  ];
  return `<dl class="cv-facts">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
    ${s.gone || s.demoClosed ? '' : `<p><button type="button" data-resume="${esc(s.id)}" data-cwd="${esc(s.cwd)}" data-title="${esc(s.title)}" class="btn btn-secondary">Continue in Terminal</button></p>`}
    <div class="cv-links">
      ${s.commitsFound.length ? `<section><h3>Commits (${s.commitsFound.length})</h3><ul>${s.commitsFound.map(commit).join('')}</ul></section>` : ''}
      ${s.edited.length ? `<section><h3>Files changed (${s.edited.length})</h3><ul>${s.edited.map(f => `<li><a href="/code/${urlPath(f)}">${esc(f)}</a></li>`).join('')}</ul></section>` : ''}
      ${s.mentions.length ? `<section><h3>Backlog items it talks about</h3><ul>${s.mentions.map(sl => `<li><a href="/backlog#${esc(sl)}">${esc(g.items.find(i => i.slug === sl)?.title || sl)}</a></li>`).join('')}</ul></section>` : ''}
    </div>`;
}

export async function conversationPage(ctx, id, params = new URLSearchParams()) {
  const g = await gather(ctx);
  const s = g.sessions.find(x => x.id === id);
  if (!s) return null;
  const gi = gitInfo(ctx.repo), file = transcriptPath(s);
  const crumbs = `<p class="hq-crumbs"><a href="/conversations">Conversations</a> <span class="sep">/</span> ${params.get('agent') ? `<a href="/conversations/${urlPath(s.id)}">${esc(s.title)}</a> <span class="sep">/</span> subagent` : esc(s.title)}</p>`;
  const agents = subagentsOf(s.folder, s.id);
  // one subagent's transcript
  if (params.get('agent')) {
    if (s.demoClosed) return null;
    const a = agents.find(x => x.agentId === params.get('agent'));
    if (!a) return null;
    const t = await readAgent(a.file);
    const body = `${crumbs}<h1 class="cv-title">${esc(a.description || a.agentId)}</h1><p class="hint">${esc(a.agentType || 'subagent')} · <code>${esc(a.file)}</code></p>
      <section class="cv-turn"><div class="cv-you">${esc(t.prompt)}</div>${itemsHtml(t.items, s, ctx.repo, [])}</section>`;
    return layout({ title: a.description || 'Subagent', active: 'conversations', body });
  }
  let turns = '', pager = '';
  if (s.demoClosed) turns = '<p class="hint">This transcript stays closed in the demo.</p>';
  else if (s.gone || !existsSync(file)) turns = '<p class="hint">Claude Code has deleted this transcript. What HQ noted about it is above.</p>';
  else {
    const total = s.prompts, pages = Math.max(1, Math.ceil(total / PAGE));
    const p = Math.min(pages - 1, Math.max(0, +params.get('p') || 0)); // 0 is the latest page
    const to = total - 1 - p * PAGE, from = Math.max(0, to - PAGE + 1);
    const t = await readTurns(file, { from, to });
    const link = (n, label) => `<a class="btn btn-ghost" href="/conversations/${urlPath(s.id)}${n ? `?p=${n}` : ''}">${label}</a>`;
    pager = pages > 1 ? `<nav class="cv-pager" aria-label="Pages">${p < pages - 1 ? link(p + 1, '← Earlier') : ''}<span class="hint">prompts ${from + 1} to ${to + 1} of ${total}</span>${p > 0 ? link(p - 1, 'Later →') : ''}</nav>` : '';
    turns = t.turns.map(tn => `<section class="cv-turn" id="turn-${tn.n + 1}">${tn.prompt ? `<div class="cv-you"><span class="cv-when">${esc(when(tn.at))}</span>${esc(tn.prompt)}</div>` : ''}${itemsHtml(tn.items, s, ctx.repo, agents)}</section>`).join('')
      || '<p class="hint">No prompts in this transcript yet.</p>';
  }
  // the transcript with its minimap beside it (hq/static/cv-minimap.js)
  const read = s.demoClosed ? turns : `<div class="cv-read"><div class="cv-transcript">${turns}</div><aside class="cv-minimap" aria-label="Minimap: click or drag to move through the transcript"><canvas></canvas><div class="cv-mm-view"></div><div class="cv-mm-tip" hidden></div></aside></div>`;
  const body = `${crumbs}<h1 class="cv-title">${esc(s.title)}</h1>${facts(s, g, gi)}<h2>Transcript</h2>${pager}${read}${pager}<script src="/hq/cv-minimap.js" defer></script>`;
  return layout({ title: s.title, active: 'conversations', body });
}
