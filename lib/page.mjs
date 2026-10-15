// The frame every HQ page shares: the theme (theme/), the header with the pages the manifest turns on and a search box.
import { AsyncLocalStorage } from 'node:async_hooks';
import { ICONS } from './tree.mjs';

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// for building a URL path from a repo path: each part encoded, the slashes kept
export const urlPath = p => String(p).split('/').map(encodeURIComponent).join('/');

// The nav: the baseline pages, then what the manifest turns on and the plugins, set once by the server (lib/manifest.mjs pagesFor).
// A server sets them for its own requests through frame(): two servers in one process (a demo beside a plain one, the
// tests) then each draw their own. setNav and setBrand set the fallback, for a page drawn outside any request.
export const FRAME = new AsyncLocalStorage();
export const frame = ({ nav, brand }, fn) => FRAME.run({ nav, brand }, fn);
const current = () => FRAME.getStore() || {};
export let PAGES = [['home', 'Home', '/'], ['repo', 'Repo', '/repo'], ['machine', 'Machine', '/machine'], ['conversations', 'Conversations', '/conversations'], ['github', 'GitHub', '/github'], ['export', 'Export', '/export']];
export const setNav = list => { PAGES = list; };
// the project's name, shown beside HQ in the header
let BRAND_ = '';
export const setBrand = name => { BRAND_ = String(name || ''); };

// Moss as the app draws him when 3D is off (the .creature rules in web/app.css), at the stage given: 0 a seed, 5 in bloom.
export const moss = (stage = 5, cls = '') => `<div class="hq-moss ${cls}" aria-hidden="true"><div class="creature" data-stage="${stage}">` +
  '<div class="bloom"></div><div class="stem"></div><div class="leaf-r"></div><div class="leaf-l"></div><div class="body"></div>' +
  '<div class="eye l"></div><div class="eye r"></div><div class="cheek l"></div><div class="cheek r"></div><div class="shadow"></div></div></div>';

// A button that shows a file or folder in Finder (Explorer on Windows). hq.js sends it to the server as a POST.
export const revealButton = (root, path, label = 'Show in Finder') =>
  `<button type="button" class="btn btn-ghost hq-reveal" data-root="${esc(root)}" data-path="${esc(path)}">${esc(label)}</button>`;

// What the server knows about claude (hq/lib/claude.mjs), set when HQ starts and when the claude program changes, and
// written into every page so the Chat panel needs no request to say how it runs.
let claudeInfo = null;
export const setClaudeInfo = info => { claudeInfo = info; };

// skip: { href, label } puts a skip link first in the page, past the header to what it names
// scripts: the addresses of scripts a page needs beyond every page's, such as /hq/hq-charts.js for chart tooltips
export function layout({ title, active, body, q = '', wide = false, full = false, head = '', skip = null, scripts = [] }) {
  const PAGES_ = current().nav || PAGES, BRAND = current().brand ?? BRAND_;
  const nav = PAGES_.map(([k, label, href]) => `<a href="${href}"${k === active ? ' class="on" aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${BRAND ? `${esc(BRAND)} HQ` : 'HQ'}</title>
<link rel="stylesheet" href="/theme/nocturne.css">
<link rel="stylesheet" href="/theme/base.css">
<link rel="stylesheet" href="/hq/hq.css">
<link rel="stylesheet" href="/hq/hq-comments.css">
<link rel="stylesheet" href="/hq/hq-conversations.css">
<link rel="stylesheet" href="/hq/hq-files.css">
<link rel="stylesheet" href="/hq/hq-export.css">
<link rel="stylesheet" href="/hq/hq-live.css">
<link rel="stylesheet" href="/hq/hq-ci.css">
</head>
<body data-page="doc">
${skip ? `<a class="hq-skip" href="${esc(skip.href)}">${esc(skip.label)}</a>` : ''}
${ICONS}
<header class="hdr fade-rule hq-hdr">
  <a class="brand" href="/">HQ${BRAND ? ` <span class="hq-brand-name">${esc(BRAND)}</span>` : ''}</a>
  <nav class="hq-nav">${nav}</nav>
  ${head}
  <form class="hq-search" action="/search" method="get" role="search"><input class="input" name="q" value="${esc(q)}" placeholder="Search code, docs and logs" aria-label="Search code, docs and logs"></form>
</header>
<main class="hq-main${wide ? ' wide' : ''}${full ? ' full' : ''}">
${body}
</main>
${claudeInfo ? `<script type="application/json" id="hq-claude-info">${JSON.stringify(claudeInfo).replace(/</g, '\\u003c')}</script>` : ''}
<script src="/hq/hqmath.js" defer></script>
<script src="/hq/hq.js" defer></script>
<script src="/hq/hqanchor.js" defer></script>
<script src="/hq/hq-comments.js" defer></script>${scripts.map(src => `<script src="${esc(src)}" defer></script>`).join('')}
<script src="/hq/hq-claude.js" defer></script>
</body>
</html>`;
}
