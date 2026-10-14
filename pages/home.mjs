// Home: the Code page. The repo's files in a tree on the left, narrowed by group (hq/groups.json); the file in the
// middle, with markdown shown rendered, as code, or both; and on the right a narrow panel with the repo's state,
// the tests at a glance, and links. It opens on README.md, rendered. Read-only: editing belongs in your own editor.
import { liveCard } from './live.mjs';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { esc, urlPath, layout, revealButton, moss } from '../lib/page.mjs';
import { walk, isText, kindIn } from '../lib/files.mjs';
import { renderMarkdown, sectionsOf } from '../lib/markdown.mjs';
import { safePath } from '../lib/paths.mjs';
import { gitInfo } from '../lib/outside.mjs';
import { languageOf, highlight, splitLines } from '../lib/highlight.mjs';
import { MAX_FILE } from '../lib/search.mjs';
import { openOutside } from '../lib/outside.mjs';
import { fileTree } from '../lib/tree.mjs';
import { loadGroups, groupOf } from '../lib/groups.mjs';
import { info } from '../lib/ui.mjs';
import { allRuns, flakes } from '../lib/runs.mjs';
import { catalogue } from '../lib/catalogue.mjs';
import { conversationsAboutNow } from './conversations.mjs';
import { folderView } from '../lib/folder.mjs';
import { hiddenPath } from '../lib/demo.mjs';

export { editorLink } from '../lib/outside.mjs';

const crumbs = p => `<a href="/code">repo</a>` + p.split('/').filter(Boolean).map((part, i, all) =>
  ` <span class="sep">/</span> <a href="/code/${urlPath(all.slice(0, i + 1).join('/'))}">${esc(part)}</a>`).join('');

const VIEWS = [['code', 'Code'], ['preview', 'Preview'], ['split', 'Split']];

// The ⋯ menu: everything about the file that is not reading it.
function menu(rel, out, wrap) {
  const gh = out.github
    ? `<a role="menuitem" href="${esc(out.github.file)}" target="_blank" rel="noopener">Open on GitHub ${info(out.github.note, 'Which copy')}</a>`
    : `<span role="menuitem" aria-disabled="true" class="off">Not on GitHub yet ${info(out.githubMissing, 'Why')}</span>`;
  return `<details class="hq-menu"><summary class="btn btn-ghost" aria-label="More for this file" title="More">⋯</summary><div class="hq-menu-list" role="menu">
    <a role="menuitem" href="${esc(out.editor)}">Open in editor</a>${gh}
    ${revealButton('repo', rel).replace('class="btn btn-ghost hq-reveal"', 'role="menuitem" class="hq-reveal"')}
    <a role="menuitem" href="/raw/${urlPath(rel)}" target="_blank" rel="noopener">Raw file</a>
    ${wrap ? '<button type="button" role="menuitem" class="hq-wrap-toggle" aria-pressed="true">Wrap long lines</button>' : ''}
  </div></details>`;
}

// got: filled in for the page around the file, with a markdown file's section rail when it has one
function fileView(repo, rel, real, params, home, extra = '', got = {}) {
  const s = statSync(real), out = openOutside({ repo, rel, abs: real }), md = /\.md$/i.test(rel);
  const asked = home ? 'preview' : VIEWS.some(([k]) => k === params.get('view')) ? params.get('view') : null;
  const view = asked || (md ? 'preview' : 'code');
  let content, text = false;
  if (s.size > MAX_FILE * 2) content = `<p class="hint">This file is ${Math.round(s.size / 1024)} KB, too big to show. It is in the ⋯ menu as a raw file.</p>`;
  else {
    const buf = readFileSync(real);
    if (!isText(buf)) {
      content = /\.(png|jpe?g|svg|gif|webp)$/i.test(extname(real)) ? `<img class="hq-img" src="/raw/${urlPath(rel)}" alt="${esc(rel)}">` : '<p class="hint">Not a text file. It is in the ⋯ menu as a raw file.</p>';
    } else {
      text = true;
      const src = buf.toString('utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
      const code = `<div class="hq-code wrap" data-file="${esc(rel)}" ${out.data}><table><tbody>${splitLines(highlight(src, languageOf(rel))).map((l, i) =>
        `<tr id="L${i + 1}"><td class="ln"><a href="#L${i + 1}">${i + 1}</a></td><td class="tx">${l || ' '}</td></tr>`).join('')}</tbody></table></div>`;
      const rendered = md ? renderMarkdown(src, rel, kindIn(repo)) : null;
      if (rendered) Object.assign(got, sectionRail({ headings: rendered.headings, view }));
      content = md
        ? `<div class="hq-mdview" data-view="${view}"${asked ? ' data-asked' : ''}><div class="hq-panes"><div class="hq-pane hq-pane-code">${code}</div>` +
          `<div class="hq-pane hq-pane-preview"><div class="hq-md" ${out.data}>${sectionsOf(rendered.html)}</div></div></div></div>`
        : code;
    }
  }
  const views = md && text ? `<div class="seg hq-views" role="group" aria-label="Show as">${VIEWS.map(([k, label]) =>
    `<a class="seg-opt" href="?view=${k}" data-view="${k}"${k === view ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</div>` : '';
  return `<div class="hq-filehead"><nav class="hq-crumbs" aria-label="Where this file is">${crumbs(rel)}</nav><div class="hq-filehead-right">${views}${got.button || ''}${menu(rel, out, text)}</div></div>${extra}${content}`;
}

// A markdown file's sections, once it has three or more second- and third-level headings: a rail of ticks along the
// right edge of the file, one per section, which opens to a card of their names (hq.js lights the one being read and
// opens the card), and a "≡ N sections" button for the file's header that opens the same card. The card's list is
// the real navigation; the ticks are a shortcut for the mouse, kept out of the tab order. The Code view hides the
// preview, so there each goes to its heading's line; hq.js swaps the links when the view changes.
export function sectionRail({ headings = [], view } = {}) {
  const hs = headings.filter(h => h.depth === 2 || h.depth === 3);
  if (hs.length < 3) return { rail: '', button: '' };
  const link = h => `class="d${h.depth}" href="${esc(view === 'code' && h.line ? `#L${h.line}` : `#${h.id}`)}" data-id="${esc(h.id)}"${h.line ? ` data-line="${h.line}"` : ''}`;
  return {
    rail: `<nav class="hq-rail" aria-label="On this page" id="hq-rail"><div class="hq-rail-ticks" aria-hidden="true">${hs.map(h => `<a ${link(h)} tabindex="-1"></a>`).join('')}</div>` +
      `<div class="hq-rail-card" id="hq-rail-card"><div class="kicker">On this page</div><ol class="hq-rail-list">${hs.map(h => `<li><a ${link(h)}>${esc(h.text)}</a></li>`).join('')}</ol></div></nav>`,
    button: `<button type="button" class="btn btn-ghost hq-sections" aria-expanded="false" aria-controls="hq-rail-card"><span aria-hidden="true">≡</span> ${hs.length} sections</button>`,
  };
}

// A folder: Icons, List or Gallery, as Finder offers (hq/lib/folder.mjs).
const dirView = (repo, files, rel, params) => folderView({ repo, files, rel, params, crumbs: crumbs(rel) });

const ago = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (!(s >= 0)) return '';
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

// "Changed in N conversations": the Claude Code sessions that edited this file (hq/pages/conversations.mjs), newest
// first. Empty until the conversations index has loaded once, which the first call starts.
function changedIn(ctx, rel) {
  const list = conversationsAboutNow(ctx, { file: rel });
  if (!list.length) return '';
  return `<p class="cv-changed hint">Changed in ${list.length} conversation${list.length === 1 ? '' : 's'}: ${list.slice(0, 5).map(c => `<a href="/conversations/${urlPath(c.id)}">${esc(c.title)}</a>`).join(' · ')}${list.length > 5 ? ` and ${list.length - 5} more` : ''}</p>`;
}

// The tests at a glance: the last run in each place, and flaky tests.
function testsCard(repo, cache) {
  const runs = allRuns(cache), flaky = flakes(runs), n = catalogue(repo).filter(f => f.set !== 'helper').length;
  const rows = [['ci', 'CI'], ['laptop', 'Laptop'], ['container', 'Container']].map(([w, label]) => {
    const r = runs.find(x => (x.info.where || x.source) === w);
    return `<li><a href="/testing?tab=runs&amp;where=${w}">${label}</a> ${r
      ? `<a class="hq-res ${r.ok ? 'pass' : 'fail'}" href="/runs/${encodeURIComponent(r.id)}">${r.ok ? 'pass' : 'FAIL'}</a> <span class="hint">${esc(r.info.kind || '')} · ${ago(r.when)}</span>`
      : '<span class="hint">no runs yet</span>'}</li>`;
  }).join('');
  // Moss looks as well as the newest run went: in bloom when it passed, a sprout when it failed
  const newest = runs[0];
  return `<section class="card hq-card"><div class="hq-card-head">${moss(newest ? (newest.ok ? 5 : 1) : 3, 'hq-moss-card')}<a class="kicker" href="/testing">Tests</a><span class="hint">${n} files</span></div>
    <ul class="hq-glance">${rows}</ul>
    ${flaky.length ? `<p class="hq-warn"><a href="/testing?tab=tests&amp;flaky=1">${flaky.length} flaky</a> ${info(flaky.map(f => `${f.test} on ${f.commit}`).join('; '), 'Which')}</p>` : ''}</section>`;
}

function linksCard({ cache, repo, origin, hasDashboard }) {
  const rows = [
        hasDashboard && ["devpipe's report", `${origin}/cache/runs/report.html`, "devpipe's page for the saved test runs."],
    ['This checkout', repo, 'The repo HQ is showing.', ['repo', '']],
    ['Saved test runs', `${cache}/runs`, 'Every make test on this laptop, from any checkout.', ['cache', 'runs']],
    ['Screenshots', `${cache}/shots`, 'Test screenshots. Empty for now: the tests save theirs to /tmp, or to the folder S names.', ['cache', 'shots']],
    ['CI results', `${cache}/ci`, 'Test results from CI. make ci-history fetches them.', ['cache', 'ci']],
  ].filter(Boolean);
  return `<section class="card hq-card"><div class="hq-card-head"><span class="kicker">Links</span></div><ul class="hq-linklist">${rows.map(([title, where, note, reveal]) => `<li>
    ${/^https?:/.test(where) ? `<a href="${esc(where)}" target="_blank" rel="noopener">${esc(title)}</a>` : `<span class="hq-linkname">${esc(title)}</span>`}
    <code title="${esc(where)}">${esc(where.replace(/^https?:\/\//, ''))}</code>${info(note, `About ${title}`)}${reveal ? revealButton(reveal[0], reveal[1], 'Finder') : ''}</li>`).join('')}</ul></section>`;
}

export function homePage(ctx, rel, params = new URLSearchParams(), { home = false } = {}) {
  const { repo, cache, links } = ctx;
  // the cards the manifest turns on, and GitHub only when the repo has a GitHub remote
  const f = ctx.m?.features || {}, github = !!gitInfo(repo)?.slug;
  const real = safePath(repo, rel || '.');
  if (!real) return null;
  const files = walk(repo).filter(f => !hiddenPath(ctx.demo, f)), groups = loadGroups(ctx.m?.docs?.groups);
  const got = {}, main = statSync(real).isDirectory() ? dirView(repo, files, rel, params) : fileView(repo, rel, real, params, home, changedIn(ctx, rel), got);
  const groupBar = `<div class="hq-groups" role="group" aria-label="Show files from">${[{ id: 'all', title: 'All' }, ...groups].map(g =>
    `<button type="button" class="hq-chip" data-group="${esc(g.id)}" aria-pressed="${g.id === 'all'}">${esc(g.title)}</button>`).join('')}</div>`;
  const body = `<div class="hq-home">
    <div class="hq-side">${groupBar}${fileTree(files, { current: rel, href: f => `/code/${urlPath(f)}`, name: 'code', groupOf: f => groupOf(f, groups) })}</div>
    <div class="hq-codemain${got.rail ? ' has-rail' : ''}">${got.rail ? `${got.rail}<div class="hq-doc">${main}</div>` : main}</div>
    <aside class="hq-panel" aria-label="The repo at a glance">${ctx.repoCard ? ctx.repoCard() : ''}${f.backlog && ctx.backlogCard ? ctx.backlogCard() : ''}${f.testing ? liveCard(ctx) + testsCard(repo, cache) : ''}
      ${github ? `<section class="card hq-card hq-linkcard"><div class="hq-card-head"><span class="kicker">CI now</span><span class="hint" data-updated-for="ci-now"></span></div>
        <div data-load-part="ci-now" data-mini><p class="hq-loading">Loading…</p></div></section>` : ''}
      ${ctx.demo || !github ? '' : `<section class="card hq-card hq-linkcard"><div class="hq-card-head"><span class="kicker">Actions minutes</span><span class="hint" data-updated-for="actions"></span></div>
        <div data-load-part="actions" data-mini><p class="hq-loading">Loading…</p></div>
        <a class="hq-details" href="/github?tab=dashboard">Details →</a></section>`}
      ${f.deploys ? `<section class="card hq-card hq-linkcard"><div class="hq-card-head"><span class="kicker">Live site</span><span class="hint" data-updated-for="firebase"></span></div>
        <div data-load-part="firebase" data-mini><p class="hq-loading">Loading…</p></div>
        <a class="hq-details" href="/github?tab=firebase">Details →</a></section>` : ''}
      ${linksCard(links)}</aside>
  </div>`;
  return layout({ title: home ? 'Home' : rel || 'Code', active: 'home', body, wide: true, full: true });
}
