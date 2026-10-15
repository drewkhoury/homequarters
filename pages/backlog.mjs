// The Backlog page: the items in docs/backlog/ as cards on a board, a list of every item ever listed, and trends,
// all read from the files and from git. Which column a card sits in comes from where its file is and from the
// branches: a branch that changes or deletes an item's file is working on it. Opening a card shows its words and
// every commit that touched it. HQ only reads; the items are changed by editing their files in a branch.
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { esc, urlPath, layout } from '../lib/page.mjs';
import { info, dataTable } from '../lib/ui.mjs';
import { renderMarkdown } from '../lib/markdown.mjs';
import { kindIn } from '../lib/files.mjs';
import { gitInfo } from '../lib/outside.mjs';
import { ghPart, runGh } from '../lib/github.mjs';
import { runGit } from '../lib/git.mjs';
import { conversationsAbout } from './conversations.mjs';
import { backlogHistory, branchWork, openBlockers, unblocks, arrivals, stagesOverTime, TYPES, MAX_INBOX, DIR } from '../lib/backlog.mjs';

export const COLUMNS = [
  ['inbox', 'Inbox', 'New items nobody has sorted yet. Whoever picks up work next sorts these into Ready or Parked first.'],
  ['ready', 'Ready', 'In next/ and nothing still on the list blocks them. Pick from here.'],
  ['blocked', 'Blocked', 'In next/, waiting on another item that is still open.'],
  ['doing', 'In progress', 'A branch not yet on main changes or deletes this item\'s file (or its line in the old BACKLOG.md). Deleting it means the branch ships it.'],
  ['parked', 'Parked', 'Not now. Looked at once a month: promote, keep or delete.'],
  ['done', 'Done lately', 'Taken off the list in the last seven days. Shipped when the commit changed more than docs; closed when it only changed docs (moved, merged or dropped).'],
];
const TYPE_LABEL = { bug: 'Bug', feature: 'Feature', chore: 'Chore', question: 'Question', '': 'Unknown' };
const DAY = 86400000;
const DONE_CAP = 20;
// the README's popup; an underscore keeps it apart from every item's name
const README = '_how-it-works';

const day = iso => String(iso || '').slice(0, 10);
const shortDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const age = (iso, now) => { const d = Math.floor((now - new Date(iso)) / DAY); return isNaN(d) ? '' : d < 1 ? 'today' : `${d} d`; };
const typeBadge = t => `<span class="bl-type" data-type="${esc(t || 'unknown')}">${esc(TYPE_LABEL[t] ?? t)}</span>`;
const readMap = repo => { try { return JSON.parse(readFileSync(join(repo, 'hq', 'backlog-map.json'), 'utf8')); } catch { return []; } };
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]); // cap: GitHub may be slow; the page does not wait for it

// Everything the page needs, from the files, git and (when it answers quickly) GitHub's open pull requests.
// The slow part, the history and a diff per branch, is kept until a branch, HEAD or an item file changes: every
// page asks git one question to find out, and backlogHistory answers the same object while nothing has moved.
let kept = null;
async function history(repo, git = runGit) {
  const refs = await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'], repo);
  const hist = await backlogHistory(repo, git);
  if (kept && kept.repo === repo && kept.refs === refs && kept.hist === hist) return kept;
  const base = refs.includes('refs/remotes/origin/main ') ? 'origin/main' : 'main';
  kept = { repo, refs, hist, work: await branchWork(repo, base, { map: readMap(repo), git }) };
  return kept;
}

export async function gather({ repo, gh }, now = Date.now(), { askGithub = true } = {}) {
  const { hist, work } = await history(repo);
  const prsPart = askGithub ? await withTimeout(ghPart('prs', { repo, gh: gh || runGh }), 1500, null) : null;
  const prs = new Map((prsPart?.data || []).map(p => [p.headRefName, p]));
  const gi = gitInfo(repo);
  // what finishing each open item would free, counting chains: tests-without-shadows frees four
  const frees = new Map(unblocks(hist.items).map(x => [x.slug, x.frees]));
  const records = hist.records.map(r => {
    const branches = (work.get(r.slug) || []).filter(w => w.how !== 'adding').map(w => ({ ...w, pr: prs.get(w.branch) || null }));
    const blockers = r.item ? openBlockers(r.item, hist.items) : [];
    // off the list with no commit that took it off yet (its file deleted but not committed): on no column of the board
    const column = !r.open ? (r.closed ? 'done' : 'gone') : branches.length ? 'doing' : r.item.stage === 'inbox' ? 'inbox' : r.item.stage === 'parked' ? 'parked' : blockers.length ? 'blocked' : 'ready';
    return { ...r, branches, blockers, column, blocks: hist.items.filter(i => i.blockedBy.includes(r.slug)).map(i => i.slug), frees: frees.get(r.slug) || [], addedOn: (work.get(r.slug) || []).filter(w => w.how === 'adding').map(w => w.branch) };
  });
  return { ...hist, repo, records, now, commitUrl: sha => (gi?.slug ? `https://github.com/${gi.slug}/commit/${sha}` : null), prsKnown: !!prsPart?.data };
}

const KIND_WORD = { reopened: 'put back', added: 'added', edited: 'edited', renamed: 'renamed', closed: 'taken off', migrated: 'moved to its own file', moved: 'moved' };

function timeline(r, commitUrl) {
  if (!r.events.length) return '<p class="hint">No commits yet: this item is only in the working tree.</p>';
  return `<ol class="bl-timeline">${[...r.events].reverse().map(e => {
    const url = commitUrl(e.sha), sha = `<code>${esc(e.sha.slice(0, 7))}</code>`;
    const what = e.kind === 'closed' ? (e.shipped ? 'shipped' : 'taken off (docs only)') : e.kind === 'renamed' ? `renamed from “${esc(e.from)}”` : e.kind === 'moved' ? `moved ${esc(e.fromStage)} → ${esc(e.stage)}` : KIND_WORD[e.kind] || e.kind;
    return `<li data-kind="${esc(e.kind)}"${e.shipped && e.kind === 'closed' ? ' data-shipped' : ''}><span class="bl-when">${esc(shortDate(e.date))}</span><span class="bl-what">${what}</span>
      <span class="bl-commit">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${sha}</a>` : sha} ${esc(e.subject)}</span></li>`;
  }).join('')}</ol>`;
}

const slugLink = (s, records) => { const r = records.find(x => x.slug === s); return `<a class="bl-ref" href="/backlog/${urlPath(s)}" data-open="${esc(s)}">${esc(r ? r.title : s)}</a>`; };

function branchLine(w) {
  const pr = w.pr ? ` <a href="${esc(w.pr.url)}" target="_blank" rel="noopener">#${w.pr.number}</a>` : '';
  return `<span class="bl-branch" data-how="${esc(w.how)}"><code>${esc(w.branch)}</code> ${w.how === 'shipping' ? 'ships it' : 'works on it'}${pr}${w.remoteOnly ? ' <span class="hint">(on GitHub only)</span>' : ''}</span>`;
}

// What HQ knows about an item, as [label, html] rows: the item's popup and page show them, and so does a deck card
// about it.
function factRows(r, g, talks = []) {
  const it = r.item;
  const col = COLUMNS.find(c => c[0] === r.column) || ['', 'Off the list'];
  return [
    ['Type', typeBadge(r.type)],
    ['Where', `${esc(col[1])}${it ? ` <span class="hint">(${esc(it.stage)}/)</span>` : ''}`],
    it && ['Asked', esc(it.asked)],
    r.added && ['Listed', `${esc(shortDate(r.added))} <span class="hint">${esc(age(r.added, g.now))} ago</span>`],
    r.closed && ['Off the list', `${esc(shortDate(r.closed.date))} <span class="hint">${r.closed.shipped ? 'shipped' : 'docs only'}</span>`],
    r.blockers.length && ['Blocked by', r.blockers.map(s => slugLink(s, g.records)).join(', ')],
    it && it.blockedBy.length > r.blockers.length && ['Was blocked by', it.blockedBy.filter(b => !r.blockers.includes(b)).map(esc).join(', ') + ' <span class="hint">(done)</span>'],
    r.blocks.length && ['Blocks', r.blocks.map(s => slugLink(s, g.records)).join(', ')],
    r.branches.length && ['Branches', r.branches.map(branchLine).join('<br>')],
    r.addedOn.length && ['New on', r.addedOn.map(b => `<code>${esc(b)}</code>`).join(', ')],
    it?.plan && ['Plan', `<a href="/code/${urlPath(it.plan)}">${esc(it.plan)}</a>`],
    r.titles.length > 1 && ['Also called', r.titles.filter(t => t !== r.title).map(t => `“${esc(t)}”`).join('<br>')],
    talks.length && ['Conversations', talks.slice(0, 6).map(c => `<a href="/conversations/${urlPath(c.id)}">${esc(c.title)}</a> <span class="hint">${esc(shortDate(c.lastActive))}${c.branch ? ` · ${esc(c.branch)}` : ''}</span>`).join('<br>') + (talks.length > 6 ? `<br><span class="hint">and ${talks.length - 6} more</span>` : '')],
  ].filter(Boolean);
}
const factsHtml = rows => `<dl class="bl-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
// The button that shows an open item's chain on the board, under its facts in the item's popup and page. It is a
// control, not a fact, so a deck card, which shows the same facts, leaves it out and the two still agree.
const chainHtml = r => (r.open && (r.blockers.length || r.blocks.length)
  ? `<p class="bl-chain"><a class="btn btn-secondary bl-chainbtn" href="/backlog?chain=${encodeURIComponent(r.slug)}" data-chain-of="${esc(r.slug)}">Show the chain</a> <span class="hint">or press F on its card</span></p>` : '');

// The full view of one item, shown in the dialog on the board and as its own page. `talks` are the conversations
// that mention it (hq/pages/conversations.mjs).
function detail(r, g, talks = []) {
  const { repo } = g, it = r.item;
  const facts = factRows(r, g, talks);
  const body = it
    ? renderMarkdown(it.body, it.path, kindIn(repo)).html
    : r.oldBody ? `<p class="hint">Its last words in docs/BACKLOG.md:</p>${renderMarkdown(r.oldBody, 'docs/BACKLOG.md', kindIn(repo)).html}` : '';
  return `<article class="bl-detail" data-slug="${esc(r.slug)}"${it ? ` data-path="${esc(it.path)}"` : ''}>
    <h2 class="bl-detail-title">${esc(r.title)}</h2>
    ${factsHtml(facts)}${chainHtml(r)}
    <div class="hq-md bl-body">${body}</div>
    <h3>History ${info('Every commit that added, changed, renamed or took off this item: its line in docs/BACKLOG.md before the items were files, then its own file. Renames in the old file are matched by their words, so a heavily rewritten entry can show as one taken off and a new one added.', 'About the history')}</h3>
    ${timeline(r, g.commitUrl)}
    ${it ? `<p class="bl-file"><a href="/code/${urlPath(it.path)}?view=code">${esc(it.path)}</a></p>` : ''}
  </article>`;
}

// A card on the board, always the same shape so the columns line up: a top line, the title in two lines, two lines
// kept for "blocked by", and one line of chips. A blocked card names what blocks it, and a card others wait on says
// how many things finishing it would free. data-blockers and data-blocks carry the ties for backlog.js, which lights
// them up while the card is hovered or focused and lists them in a note under it.
function card(r, g) {
  const it = r.item, twice = r.branches.length > 1;
  const who = it ? it.askedBy : r.closed ? (r.closed.shipped ? `shipped ${shortDate(r.closed.date)}` : `closed ${shortDate(r.closed.date)}`) : '';
  const titleOf = slug => g.records.find(x => x.slug === slug)?.title || slug;
  const blockedChip = r.blockers.length && `<span class="bl-chip bl-rel" data-k="blocked" title="${esc(`Blocked by ${r.blockers.map(titleOf).join(', ')}`)}">` +
    `blocked by ${esc(titleOf(r.blockers[0]))}${r.blockers.length > 1 ? ` <b>+${r.blockers.length - 1}</b>` : ''}</span>`;
  const n = r.open ? r.frees.length : 0;
  const chips = [
    n && `<span class="bl-chip" data-k="frees">unblocks ${n} thing${n === 1 ? '' : 's'}</span>`,
    ...r.branches.map(w => `<span class="bl-chip" data-k="${w.how === 'shipping' ? 'shipping' : 'branch'}" title="${esc(w.branch)}">${w.pr ? `#${w.pr.number} ` : ''}${esc(w.branch)}</span>`),
    twice && '<span class="bl-chip" data-k="warn" title="More than one branch touches this item">two branches</span>',
    r.column === 'done' && r.closed?.type && `<span class="bl-chip">${esc(r.closed.type)}</span>`,
  ].filter(Boolean);
  const text = `${r.title} ${r.slug} ${it ? it.body : r.oldBody || ''} ${r.titles.join(' ')}`.toLowerCase();
  return `<a class="bl-card" href="/backlog/${urlPath(r.slug)}" data-open="${esc(r.slug)}" data-slug="${esc(r.slug)}" data-type="${esc(r.type || 'unknown')}" data-who="${esc(it ? it.askedBy : '')}" data-text="${esc(text)}"${r.blockers.length ? ` data-blockers="${esc(r.blockers.join(' '))}"` : ''}${r.open && r.blocks.length ? ` data-blocks="${esc(r.blocks.join(' '))}"` : ''} data-title="${esc(r.title)}">
    <span class="bl-card-top">${typeBadge(r.type)}<span class="hint">${esc(who)}${it && r.added ? ` · ${esc(age(r.added, g.now))}` : ''}</span></span>
    <span class="bl-card-title" title="${esc(r.title)}">${esc(r.title)}</span>
    <span class="bl-card-blocked">${blockedChip || ''}</span>
    <span class="bl-chips">${chips.join('')}</span></a>`;
}

function board(g) {
  const allRecent = g.records.filter(r => r.column === 'done' && g.now - new Date(r.closed.date) < 7 * DAY).sort((a, b) => b.closed.date.localeCompare(a.closed.date));
  const recent = allRecent.slice(0, DONE_CAP);
  const byCol = Object.fromEntries(COLUMNS.map(([k]) => [k, k === 'done' ? recent : g.records.filter(r => r.column === k)]));
  // newest first within a column, except Ready, where the oldest ask comes first
  for (const k of ['inbox', 'blocked', 'doing', 'parked']) byCol[k].sort((a, b) => String(b.added).localeCompare(String(a.added)));
  byCol.ready.sort((a, b) => String(a.added).localeCompare(String(b.added)));
  const whos = [...new Set(g.records.filter(r => r.item).map(r => r.item.askedBy))].sort();
  const filters = `<div class="bl-filters" role="group" aria-label="Filter the cards">
    <input class="input bl-q" type="search" placeholder="Search titles and text" aria-label="Search the cards">
    <span class="bl-typechips">${TYPES.map(t => `<button type="button" class="hq-chip" data-filter-type="${t}" aria-pressed="false">${TYPE_LABEL[t]}</button>`).join('')}</span>
    <label class="bl-who">Asked by <select class="input" aria-label="Asked by"><option value="">anyone</option>${whos.map(w => `<option>${esc(w)}</option>`).join('')}</select></label>
    <label class="bl-across">Cards across <input type="range" min="1" max="4" step="1" value="1" aria-label="Cards across in each column"><output>1</output></label>
    <span class="hint bl-shown" aria-live="polite"></span>
    <button type="button" class="btn btn-ghost bl-fullbtn" data-full aria-pressed="false" title="The board fills the screen (Esc to leave)">Full screen</button></div>`;
  const cols = COLUMNS.map(([k, label, about]) => `<section class="bl-col" data-col="${k}" aria-label="${esc(label)}">
    <header class="bl-col-head"><h2>${esc(label)}</h2><span class="bl-count" data-count>${byCol[k].length}</span>${k === 'inbox' ? `<span class="hint">of ${MAX_INBOX}</span>` : ''}${info(about, `About ${label}`)}</header>
    <div class="bl-cards">${byCol[k].map(r => card(r, g)).join('') || '<p class="hint bl-none">Nothing here.</p>'}${k === 'done' && allRecent.length > recent.length ? `<a class="hint bl-more" href="?tab=list">${allRecent.length - recent.length} more in Every item</a>` : ''}</div></section>`).join('');
  // the filters and the board together, so Full screen takes both (backlog.js)
  return `<div class="bl-boardwrap">${filters}<div class="bl-board">${cols}</div></div>`;
}

// What every tab can open without leaving the page: each item, and the README that explains the backlog.
// The popup every tab opens items in. Its contents come from /backlog/<item>?part=1 when a card is opened (or
// hovered), so the page does not carry every item's history.
const popups = () => `<dialog class="bl-dialog" aria-label="Backlog item"><form method="dialog" class="bl-dialog-bar"><button class="btn btn-ghost" aria-label="Close">Close</button></form><div class="bl-dialog-body"></div></dialog>`;

function readmeDetail(repo) {
  let html;
  try { html = renderMarkdown(readFileSync(join(repo, DIR, 'README.md'), 'utf8'), `${DIR}/README.md`, kindIn(repo)).html; } catch { html = '<p class="hint">docs/backlog/README.md is missing.</p>'; }
  return `<article class="bl-detail" data-path="${DIR}/README.md"><div class="hq-md">${html}</div><p class="bl-file"><a href="/code/${DIR}/README.md">${DIR}/README.md</a></p></article>`;
}

function list(g) {
  const colLabel = Object.fromEntries(COLUMNS.map(([k, l]) => [k, l]));
  const rows = g.records.map(r => ({ attrs: { 'data-open': r.slug }, cells: {
    title: { html: openLink(r), v: r.title, f: `${r.title} ${r.slug}` },
    type: { html: typeBadge(r.type), f: TYPE_LABEL[r.type] ?? r.type },
    where: { html: esc(r.column === 'done' ? (r.closed?.shipped ? 'Shipped' : 'Closed') : colLabel[r.column] || 'Taken off, not committed'), f: r.column === 'done' ? (r.closed?.shipped ? 'Shipped' : 'Closed') : colLabel[r.column] || 'Taken off, not committed' },
    who: { html: esc(r.item?.askedBy || ''), f: r.item?.askedBy || '—' },
    added: { html: esc(shortDate(r.added)), v: r.added || '' },
    closed: { html: r.closed ? esc(shortDate(r.closed.date)) : '', v: r.closed?.date || '' },
    days: { html: r.added ? String(Math.round(((r.closed ? new Date(r.closed.date) : g.now) - new Date(r.added)) / DAY * 10) / 10) : '', v: r.added ? ((r.closed ? new Date(r.closed.date) : g.now) - new Date(r.added)) / DAY : -1 },
    commits: { html: String(r.events.length), v: r.events.length },
    branch: { html: r.branches.map(w => `<code>${esc(w.branch)}</code>`).join(' '), f: r.branches.map(w => w.branch).join(' ') || 'none' },
  } }));
  return dataTable({ id: 'backlog-all', columns: [
    { key: 'title', label: 'Item', filter: 'text' }, { key: 'type', label: 'Type', filter: 'chips', w: 'sm' },
    { key: 'where', label: 'Where', filter: 'chips', w: 'md' }, { key: 'who', label: 'Asked by', filter: 'chips', w: 'md' },
    { key: 'added', label: 'Listed', w: 'sm' }, { key: 'closed', label: 'Off', w: 'sm' }, { key: 'days', label: 'Days on list', num: true, w: 'sm' },
    { key: 'commits', label: 'Commits', num: true, w: 'xs' }, { key: 'branch', label: 'Branch', filter: 'chips', w: 'lg' },
  ], rows, empty: 'No items yet.' });
}

// ---- Trends: small charts drawn here as SVG, so the page needs no chart library ----

const W = 640;
function barsChart(days, series, { h = 200, label, xLabel }) {
  const pad = { l: 34, r: 10, t: 12, b: 28 }, iw = W - pad.l - pad.r, ih = h - pad.t - pad.b;
  const groupSum = (d, gk) => series.filter(x => x.bar && (x.group || x.key) === gk).reduce((n, x) => n + (d[x.key] || 0), 0);
  const max = Math.max(1, ...days.map(d => series.reduce((n, x) => n + (x.stack ? d[x.key] || 0 : 0), 0)), ...days.map(d => Math.max(0, ...series.filter(x => x.line).map(x => d[x.key] || 0), ...series.filter(x => x.bar).map(x => groupSum(d, x.group || x.key)))));
  const bw = iw / Math.max(1, days.length), y = v => pad.t + ih - (v / max) * ih;
  const grid = [0, .5, 1].map(f => { const v = Math.round(max * f); return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="bl-grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; }).join('');
  const bars = days.map((d, i) => {
    let acc = 0;
    const x0 = pad.l + i * bw + bw * .18, w = bw * .64;
    const stacked = series.filter(s => s.stack).map(s => { const v = d[s.key] || 0; const out = v ? `<rect x="${x0}" y="${y(acc + v)}" width="${w}" height="${y(acc) - y(acc + v)}" class="bl-s-${s.key}"><title>${d.day}: ${v} ${s.label}</title></rect>` : ''; acc += v; return out; }).join('');
    // side-by-side bars, one per group; the series in one group stack on each other
    const groups = [...new Set(series.filter(s => s.bar).map(s => s.group || s.key))], sw = w / Math.max(1, groups.length);
    const pair = groups.map((gk, j) => { let up = 0; return series.filter(s => s.bar && (s.group || s.key) === gk).map(s => { const v = d[s.key] || 0; const r = v ? `<rect x="${x0 + j * sw}" y="${y(up + v)}" width="${sw - 2}" height="${y(up) - y(up + v)}" class="bl-s-${s.key}"><title>${esc(d.day)}: ${v} ${esc(s.label)}</title></rect>` : ''; up += v; return r; }).join(''); }).join('');
    return `${stacked}${pair}<text x="${pad.l + i * bw + bw / 2}" y="${h - 8}" text-anchor="middle">${esc(xLabel ? xLabel(d) : shortDate(d.day))}</text>`;
  }).join('');
  const lines = series.filter(s => s.line).map(s => {
    const pts = days.map((d, i) => `${pad.l + i * bw + bw / 2},${y(d[s.key] || 0)}`).join(' ');
    return `<polyline points="${pts}" class="bl-line bl-s-${s.key}"/>${days.map((d, i) => `<circle cx="${pad.l + i * bw + bw / 2}" cy="${y(d[s.key] || 0)}" r="3.5" class="bl-s-${s.key}"><title>${d.day}: ${d[s.key]} ${s.label}</title></circle>`).join('')}`;
  }).join('');
  const legend = `<div class="bl-legend">${series.map(s => `<span><i class="bl-s-${s.key}"></i>${esc(s.label)}</span>`).join('')}</div>`;
  return `<figure class="bl-chart"><svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${grid}${bars}${lines}</svg>${legend}</figure>`;
}

function hbar(rows, { label }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return `<div class="bl-hbars" role="img" aria-label="${esc(label)}">${rows.map(r => `<div class="bl-hbar"${r.cls ? ` data-k="${esc(r.cls)}"` : ''}><span class="bl-hbar-k">${esc(r.k)}</span><span class="bl-hbar-bar"><i style="width:${(r.n / max) * 100}%"></i></span><span class="bl-hbar-n">${r.n}</span></div>`).join('')}</div>`;
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

const TYPE_OF_COMMIT = t => (t === 'fix' ? 'fix' : t === 'feat' ? 'feat' : ['test', 'ci', 'chore', 'refactor', 'build', 'perf', 'style', 'revert'].includes(t) ? 'chore' : t === 'docs' ? 'docs' : 'other');
const COMMIT_SERIES = [{ key: 'fix', label: 'fix', stack: true }, { key: 'feat', label: 'feat', stack: true }, { key: 'chore', label: 'test, ci, chore, refactor', stack: true }, { key: 'docs', label: 'docs', stack: true }, { key: 'other', label: 'no type (the first days)', stack: true }];
const openLink = (r, label = r.title) => `<a href="/backlog/${urlPath(r.slug)}" data-open="${esc(r.slug)}">${esc(label)}</a>`;

function trends(g) {
  const days = g.trend.map(d => ({ ...d, docsOnly: d.closed - d.shipped }));
  // what was shipped each day, by the kind of commit that shipped it
  const shippedBy = new Map(days.map(d => [d.day, { day: d.day, fix: 0, feat: 0, chore: 0, docs: 0, other: 0 }]));
  for (const r of g.records.filter(r => r.closed?.shipped)) { const d = shippedBy.get(day(r.closed.date)); if (d) d[TYPE_OF_COMMIT(r.closed.type)]++; }
  const open = g.records.filter(r => r.open), closed = g.records.filter(r => r.closed);
  const bySlug = new Map(g.records.map(r => [r.slug, r]));
  const ageRows = [['under 1 day', 0, 1], ['1 to 2 days', 1, 2], ['2 to 3 days', 2, 3], ['3 to 4 days', 3, 4], ['4 days or more', 4, 1e9]]
    .map(([k, a, b]) => ({ k, n: open.filter(r => { const d = (g.now - new Date(r.added)) / DAY; return d >= a && d < b; }).length }));
  const byType = TYPES.map(t => ({ k: TYPE_LABEL[t], n: open.filter(r => r.type === t).length, cls: t }));
  const byWho = Object.entries(open.reduce((m, r) => { const w = r.item?.askedBy || '?'; m[w] = (m[w] || 0) + 1; return m; }, {})).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
  const churn = g.records.map(r => ({ r, n: r.events.filter(e => e.kind === 'edited').length })).sort((a, b) => b.n - a.n).slice(0, 8);
  const shipDays = closed.filter(r => r.closed.shipped && r.added).map(r => ({ r, d: (new Date(r.closed.date) - new Date(r.added)) / DAY }));
  const toShip = median(shipDays.map(x => x.d));
  const shippedN = closed.filter(r => r.closed.shipped).length;
  // time to ship, in buckets, by the kind of commit that shipped it
  const BUCKETS = [['under 3 h', 0, 0.125], ['3 to 12 h', 0.125, 0.5], ['12 h to 1 d', 0.5, 1], ['1 to 2 d', 1, 2], ['2 d or more', 2, 1e9]];
  const shipHist = BUCKETS.map(([label, a, b]) => {
    const row = { day: label, label, fix: 0, feat: 0, chore: 0, docs: 0, other: 0 };
    for (const { r, d } of shipDays) if (d >= a && d < b) row[TYPE_OF_COMMIT(r.closed.type)]++;
    return row;
  });
  const frees = unblocks(g.items).slice(0, 8);
  const arr = arrivals(g.records), batch = arr.filter(a => a.n >= 3), inBatches = batch.reduce((n, a) => n + a.n, 0), allAdded = arr.reduce((n, a) => n + a.n, 0);
  const flow = stagesOverTime(g.records);
  const stat = (n, label) => `<div class="bl-stat"><b>${n}</b><span>${esc(label)}</span></div>`;
  const panel = (title, about, inner, wide = false) => `<section class="card bl-panel${wide ? ' wide' : ''}"><h3>${esc(title)}${about ? info(about, `About ${title}`) : ''}</h3>${inner}</section>`;
  return `<div class="bl-stats">${stat(open.length, 'open now')}${stat(g.records.length, 'ever listed')}${stat(shippedN, 'shipped')}${stat(closed.length - shippedN, 'taken off with docs only')}${stat(toShip == null ? '–' : `${toShip.toFixed(1)} d`, 'median time to ship')}</div>
    <p class="hint">Rebuilt from git: every version of docs/BACKLOG.md, then each item's own file. The days before the move to files are a best effort, since an entry rewritten heavily in one commit reads as one taken off and a new one added.</p>
    <div class="bl-charts">
      ${panel('In and out, per day', 'Added in purple. Taken off in green: solid when the commit also changed code (shipped), pale when it only changed docs (moved, merged or dropped). The line is how many were open at the day\'s end; while it climbs, the list is growing faster than it is worked off.',
        barsChart(days, [{ key: 'added', label: 'added', bar: true, group: 'a' }, { key: 'shipped', label: 'shipped', bar: true, group: 'b' }, { key: 'docsOnly', label: 'taken off, docs only', bar: true, group: 'b' }, { key: 'open', label: 'open at the day\'s end', line: true }], { label: 'Items added and taken off per day, and open at each day\'s end' }))}
      ${panel('What would unblock the most', 'Open items that others wait on, counting chains: finishing the first frees everything listed after it. The quickest way to shorten Blocked.',
        frees.length ? `<ol class="bl-frees">${frees.map(f => `<li>${openLink(bySlug.get(f.slug))} <span class="hint">frees ${f.frees.length}: ${f.frees.map(x => esc(bySlug.get(x)?.title || x)).join('; ')}</span></li>`).join('')}</ol>` : '<p class="hint">Nothing open waits on anything.</p>')}
      ${panel('Shipped, by the commit that shipped it', 'Each item taken off in a commit that also changed code, by that commit\'s Conventional Commits type.', barsChart([...shippedBy.values()], COMMIT_SERIES, { label: 'Items shipped per day by commit type' }))}
      ${panel('How long items took to ship', 'From the commit that listed an item to the one that shipped it, by that commit\'s type.', barsChart(shipHist, COMMIT_SERIES, { label: 'Time from listed to shipped', xLabel: d => d.label }))}
      ${panel('Arrivals, by commit', `How many entries each commit listed, oldest first; commits that listed three or more at once are highlighted. ${batch.length} such commits listed ${inBatches} of ${allAdded} entries.`,
        arrivalsChart(arr) + `<p class="hint">${batch.length} commits listed 3 or more at once: ${inBatches} of ${allAdded} entries (${allAdded ? Math.round(inBatches / allAdded * 100) : 0}%).</p>`)}
      ${panel('Words on the list', 'The whole backlog in words at each day\'s end. It grew while the count held still, because entries were rewritten in place as parts of them shipped; with each item capped at 150 words it should stop growing that way.', lineChart(g.words, 'words', { label: 'Words in the backlog per day' }))}
      ${panel('Open, by type', '', hbar(byType, { label: 'Open items by type' }) + `<h3>Open, by who asked</h3>${hbar(byWho, { label: 'Open items by who asked' })}`)}
      ${panel('How long open items have waited', '', hbar(ageRows, { label: 'Age of open items' }))}
      ${panel('Rewritten the most', 'Entries edited in place most often. An entry that keeps growing as parts of it ship should be split, or cut to what is left.',
        `<ol class="bl-churn">${churn.map(({ r, n }) => `<li>${openLink(r)} <span class="hint">${n} edits${r.open ? '' : ', off the list'}</span></li>`).join('')}</ol>`)}
      ${panel('Where open items sit, day by day', 'Inbox, next and parked at each day\'s end, since the move to files. The old file had no stages, so this starts on the day of the move.',
        flow.length > 1 ? barsChart(flow, [{ key: 'next', label: 'next', stack: true }, { key: 'inbox', label: 'inbox', stack: true }, { key: 'parked', label: 'parked', stack: true }], { label: 'Items per stage per day' })
          : `<p class="hint">One day so far${flow[0] ? `: ${flow[0].next} next, ${flow[0].inbox} inbox, ${flow[0].parked} parked` : ''}. It draws once the files have a second day.</p>`)}
    </div>`;
}

function arrivalsChart(arr) {
  const h = 160, pad = { l: 30, r: 8, t: 10, b: 20 }, iw = W - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max(1, ...arr.map(a => a.n)), bw = iw / Math.max(1, arr.length), y = v => pad.t + ih - (v / max) * ih;
  const bars = arr.map((a, i) => `<rect x="${pad.l + i * bw}" y="${y(a.n)}" width="${Math.max(1, bw - 1)}" height="${y(0) - y(a.n)}" class="${a.n >= 3 ? 'bl-s-batch' : 'bl-s-single'}"><title>${esc(shortDate(a.date))} ${esc(a.sha.slice(0, 7))}: ${a.n} listed. ${esc(a.subject)}</title></rect>`).join('');
  const grid = [0, max].map(v => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="bl-grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const first = arr[0], last = arr[arr.length - 1];
  const ends = first ? `<text x="${pad.l}" y="${h - 4}">${esc(shortDate(first.date))}</text><text x="${W - pad.r}" y="${h - 4}" text-anchor="end">${esc(shortDate(last.date))}</text>` : '';
  return `<figure class="bl-chart"><svg viewBox="0 0 ${W} ${h}" role="img" aria-label="Entries listed per commit">${grid}${bars}${ends}</svg><div class="bl-legend"><span><i class="bl-s-batch"></i>3 or more at once</span><span><i class="bl-s-single"></i>1 or 2</span></div></figure>`;
}

function lineChart(points, key, { label }) {
  const h = 170, pad = { l: 44, r: 10, t: 12, b: 24 }, iw = W - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max(1, ...points.map(p => p[key])), step = iw / Math.max(1, points.length - 1), y = v => pad.t + ih - (v / max) * ih;
  const x = i => pad.l + (points.length > 1 ? i * step : iw / 2);
  const grid = [0, .5, 1].map(f => { const v = Math.round(max * f); return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="bl-grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString('en-GB')}</text>`; }).join('');
  const line = `<polyline points="${points.map((p, i) => `${x(i)},${y(p[key])}`).join(' ')}" class="bl-line bl-s-words"/>`;
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p[key])}" r="3.5" class="bl-s-words"><title>${esc(p.day)}: ${p[key].toLocaleString('en-GB')} words</title></circle><text x="${x(i)}" y="${h - 6}" text-anchor="middle">${esc(shortDate(p.day))}</text>`).join('');
  return `<figure class="bl-chart"><svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${grid}${line}${dots}</svg></figure>`;
}

const TABS = [['board', 'Board'], ['list', 'List'], ['trends', 'Trends']];


export async function backlogPage(ctx, params) {
  const g = await gather(ctx);
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'board';
  const problems = g.problems.length ? `<div class="bl-problems card"><b>${g.problems.length} item${g.problems.length === 1 ? '' : 's'} break the backlog's rules</b>${info('The same checks tests/unit/backlog.test.mjs makes before a push.', 'Which checks')}<ul>${g.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : '';
  const hasReadme = existsSync(join(ctx.repo, DIR, 'README.md'));
  const body = `<div class="hq-pagehead"><h1>Backlog${info(`One file per item in ${DIR}/, read from this checkout. HQ only shows them: to change an item, edit its file in a branch.${hasReadme ? ` See ${DIR}/README.md.` : ''} The inbox holds at most ${MAX_INBOX} items; past that the backlog's rules fail.`, 'About this page')}</h1>
      ${hasReadme ? `<a class="hint" href="/code/${DIR}/README.md" data-open="${README}">How the backlog works</a>` : ''}</div>
    ${problems}
    <nav class="hq-tabs" aria-label="Backlog">${TABS.map(([k, label]) => `<a href="?tab=${k}"${k === tab ? ' class="on" aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    ${tab === 'board' ? board(g) : tab === 'list' ? list(g) : trends(g)}
    ${popups()}
    <script src="/hq/backlog.js" defer></script>`;
  return layout({ title: 'Backlog', active: 'backlog', body, wide: true, full: tab === 'board' });
}

// An item's own page, or with ?part=1 just its popup's contents.
export async function backlogItemPage(ctx, slug, params = new URLSearchParams()) {
  const part = params.has('part');
  if (slug === README) return part ? readmeDetail(ctx.repo) : null;
  const g = await gather(ctx);
  const r = g.records.find(x => x.slug === slug);
  if (!r) return null;
  const talks = await conversationsAbout(ctx, { slug }).catch(() => []);
  if (part) return detail(r, g, talks);
  const body = `<p class="hq-crumbs"><a href="/backlog">Backlog</a> <span class="sep">/</span> ${esc(r.slug)}</p>${detail(r, g, talks)}<script src="/hq/backlog.js" defer></script>`;
  return layout({ title: r.title, active: 'backlog', body });
}

// The Backlog card on Home: the columns' counts, and what needs someone.
export async function backlogCard(ctx) {
  let g;
  try { g = await gather(ctx, Date.now(), { askGithub: false }); } catch { return ''; }
  const count = k => g.records.filter(r => r.column === k).length;
  const twice = g.records.filter(r => r.branches.length > 1);
  const inbox = count('inbox');
  return `<section class="card hq-card bl-homecard"><div class="hq-card-head"><a class="kicker" href="/backlog">Backlog</a><a class="hint" href="/backlog?tab=trends">trends</a></div>
    <ul class="hq-glance">
      <li><a href="/backlog">Ready</a> <b>${count('ready')}</b> <span class="hint">· blocked ${count('blocked')} · parked ${count('parked')}</span></li>
      <li><a href="/backlog">In progress</a> <b>${count('doing')}</b></li>
      <li><a href="/backlog">Inbox</a> <b${inbox > MAX_INBOX ? ' class="fail"' : ''}>${inbox}</b> <span class="hint">of ${MAX_INBOX}</span></li>
    </ul>
    ${twice.length ? `<p class="hq-warn">${twice.length} item${twice.length === 1 ? '' : 's'} on two branches ${info(twice.map(r => `${r.title}: ${r.branches.map(b => b.branch).join(', ')}`).join('; '), 'Which')}</p>` : ''}
    ${g.problems.length ? `<p class="hq-warn"><a href="/backlog">${g.problems.length} rule problem${g.problems.length === 1 ? '' : 's'}</a></p>` : ''}</section>`;
}
