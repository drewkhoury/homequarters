// A folder on the Code page, drawn the way Finder offers: Icons, where each file is a small page showing the start
// of what is in it; List, a table of name, kind, size and date; and Gallery, one file large with the rest in a strip.
// The pure parts (what kind a file is, what its preview says, sizes and dates) come first so the tests can feed them;
// folderView at the bottom reads the folder and answers the HTML.
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { esc, urlPath } from './page.mjs';
import { isText, kindIn } from './files.mjs';
import { languageOf, highlight, splitLines } from './highlight.mjs';
import { renderMarkdown } from './markdown.mjs';
import { dataTable } from './ui.mjs';

export const VIEWS = [['icons', 'Icons'], ['list', 'List'], ['gallery', 'Gallery']];
export const HEAD_BYTES = 2048; // read for a preview
export const PREVIEW_CAP = 200; // entries in a folder that get a preview; the rest are plain tiles
const GALLERY_BYTES = 64 * 1024; // read for the gallery's large preview

// What kind a file is, by its name: the words Finder would show, and the family that decides how it is previewed.
const BY_EXT = {
  md: ['Markdown', 'md'], js: ['JavaScript', 'code'], mjs: ['JavaScript module', 'code'], cjs: ['JavaScript', 'code'],
  json: ['JSON', 'json'], webmanifest: ['Web manifest', 'json'], css: ['CSS', 'code'], html: ['HTML', 'code'], rules: ['Rules', 'code'],
  yml: ['YAML', 'code'], yaml: ['YAML', 'code'], sh: ['Shell script', 'code'], toml: ['TOML', 'code'], py: ['Python', 'code'],
  svg: ['SVG image', 'image'], png: ['PNG image', 'image'], jpg: ['JPEG image', 'image'], jpeg: ['JPEG image', 'image'],
  gif: ['GIF image', 'image'], webp: ['WebP image', 'image'], txt: ['Text', 'text'], log: ['Log', 'text'], lock: ['Lock file', 'text'],
  woff2: ['Font', 'other'], webm: ['Video', 'other'], pdf: ['PDF', 'other'],
};
export function kindOf(name, dir = false) {
  if (dir) return { kind: 'Folder', family: 'dir', ext: '' };
  const lower = name.toLowerCase();
  if (lower === 'makefile') return { kind: 'Makefile', family: 'code', ext: 'MAKE' };
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return { kind: 'Dockerfile', family: 'code', ext: 'DOCKER' };
  const dot = lower.lastIndexOf('.'), ext = dot > 0 ? lower.slice(dot + 1) : ''; // .gitignore has no extension
  const [kind, family] = BY_EXT[ext] || [ext ? `${ext.toUpperCase()} file` : 'File', 'text'];
  return { kind, family, ext: ext.toUpperCase() };
}

// 812 B, 4.2 KB, 1.3 MB.
export function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1000, i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

// "just now", "5 min ago", "3 h ago", "2 d ago", then the date.
export function formatWhen(ms, now = Date.now()) {
  const s = (now - ms) / 1000;
  if (!(s >= 0)) return '';
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// A markdown line as plain words for a thumbnail: no heading marks, list bullets, emphasis, links or code ticks.
const plain = line => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[`*_~]/g, '').trim();

// What a file's thumbnail shows, from the start of its text: for markdown, its first heading (the title) and its
// first lines of prose, with frontmatter left out, and for a backlog item its type; for anything else, its first lines.
export function previewOf(name, text, { backlog = false, lines = 14 } = {}) {
  const { family } = kindOf(name);
  const src = String(text ?? '').replace(/\r\n/g, '\n');
  if (family !== 'md') return { family, lines: src.split('\n').slice(0, lines) };
  let body = src, type = '';
  const fm = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (fm) {
    body = src.slice(fm[0].length);
    const t = /^type:\s*(\S+)/m.exec(fm[1]);
    if (backlog && t) type = t[1];
  }
  const all = body.split('\n');
  const h = all.findIndex(l => /^#\s+\S/.test(l));
  const title = h >= 0 ? plain(all[h]) : '';
  const rest = (h >= 0 ? all.slice(h + 1) : all).filter(l => l.trim() && !/^(```|---|\|)/.test(l.trim())).map(plain).filter(Boolean);
  return { family, title, type, lines: rest.slice(0, 6) };
}

// The folder's own entries from the repo's file list: each child once, folders first, then by name, with how many
// entries each folder holds directly.
export function folderEntries(files, rel) {
  const prefix = rel ? `${rel}/` : '';
  const kids = new Map();
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    const rest = f.slice(prefix.length), i = rest.indexOf('/');
    const name = i < 0 ? rest : rest.slice(0, i);
    if (!kids.has(name)) kids.set(name, { name, path: prefix + name, dir: i >= 0, inside: new Set() });
    if (i >= 0) kids.get(name).inside.add(rest.slice(i + 1).split('/')[0]);
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
  return [...kids.values()].map(({ inside, ...e }) => ({ ...e, count: e.dir ? inside.size : null }))
    .sort((a, b) => (b.dir - a.dir) || byName(a, b));
}

// The first `max` bytes of a file.
function head(abs, max) {
  let fd;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(max), n = readSync(fd, buf, 0, max, 0);
    return buf.subarray(0, n);
  } catch { return null; } finally { if (fd != null) closeSync(fd); }
}

// Each entry with its size, date and, for the first PREVIEW_CAP, a preview read from its first HEAD_BYTES.
export function describe(repo, entries, { cap = PREVIEW_CAP } = {}) {
  let previewed = 0;
  return entries.map(e => {
    let st = null;
    try { st = statSync(join(repo, e.path)); } catch { /* gone since the walk */ }
    const k = kindOf(e.name, e.dir), out = { ...e, ...k, size: st && !e.dir ? st.size : null, mtime: st ? st.mtimeMs : null, preview: null };
    if (e.dir || previewed >= cap || k.family === 'other') return out;
    previewed++;
    if (k.family === 'image') { out.preview = { family: 'image' }; return out; }
    const buf = head(join(repo, e.path), HEAD_BYTES);
    if (!buf || !isText(buf)) { out.family = 'other'; return out; }
    // a cut in the middle of a character leaves a replacement mark at the end; drop the last, partial line
    let text = buf.toString('utf8');
    if (st && st.size > buf.length) text = text.slice(0, text.lastIndexOf('\n') + 1 || text.length);
    out.preview = previewOf(e.name, text, { backlog: e.path.startsWith('docs/backlog/') });
    return out;
  });
}

// How full a folder looks in Icons: how many sheets rise out of it. None when it is empty, one, two, three for three
// to nine, and 'heaps' (three with a stack behind) from ten.
export const fillOf = count => (!count ? 0 : count <= 2 ? count : count < 10 ? 3 : 'heaps');

// What rises out of a folder: its first files (then its folders, when it has too few files), up to three, each with
// its kind and the lengths of its first lines, which is all a sheet that small can show.
export function peekOf(repo, files, dir) {
  const inside = folderEntries(files, dir);
  const chosen = [...inside.filter(e => !e.dir), ...inside.filter(e => e.dir)].slice(0, 3);
  return describe(repo, chosen, { cap: 3 }).map(e => ({
    family: e.dir ? 'dir' : e.family, path: e.path, name: e.name,
    lines: e.preview?.family === 'md' ? [e.preview.title, ...e.preview.lines].filter(Boolean).slice(0, 6).map(l => l.length) : (e.preview?.lines || []).slice(0, 7).map(l => l.replace(/\t/g, '  ').length),
    title: !!e.preview?.title,
  }));
}

// ---- drawing ----

// A folder drawn larger than the tree's: a back flap, a front, and the count on it.
const FOLDER = count => `<svg class="hqf-folder" viewBox="0 0 64 52" aria-hidden="true"><path class="hqf-folder-back" d="M4 8a4 4 0 0 1 4-4h14l5 5h29a4 4 0 0 1 4 4v31a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/>
  <path class="hqf-folder-front" d="M4 17a4 4 0 0 1 4-4h48a4 4 0 0 1 4 4v27a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/>${count != null ? `<text x="32" y="36" text-anchor="middle">${count}</text>` : ''}</svg>`;

const TYPE_LABEL = { bug: 'Bug', feature: 'Feature', chore: 'Chore', question: 'Question' };
const typeChip = t => (t ? `<span class="bl-type" data-type="${esc(TYPE_LABEL[t] ? t : 'unknown')}">${esc(TYPE_LABEL[t] || t)}</span>` : '');

// A folder in Icons: its back and tab, the sheets rising out of it (fillOf, peekOf), and its front with the count.
// Each sheet is a miniature of a real file: lines as long as its lines, on paper for prose, dark for code, the image
// itself, or a small folder.
function miniSheet(p) {
  if (p.family === 'image') return `<span class="hqf-ps img"><img src="/raw/${urlPath(p.path)}" alt="" loading="lazy"></span>`;
  if (p.family === 'dir') return '<span class="hqf-ps dir"></span>';
  const code = p.family !== 'md' && p.family !== 'other';
  const bars = p.lines.map((n, i) => `<i style="width:${Math.max(12, Math.min(100, Math.round(n / (code ? 0.5 : 0.7))))}%${code && n ? `;margin-left:${Math.min(30, (p.indent?.[i] || 0))}%` : ''}"${i === 0 && p.title ? ' class="t"' : ''}></i>`).join('');
  return `<span class="hqf-ps ${code ? 'code' : p.family === 'other' ? 'blank' : 'md'}">${bars}</span>`;
}
function folderThumb(e) {
  const fill = fillOf(e.count), peek = (e.peek || []).slice(0, fill === 'heaps' ? 3 : fill || 0);
  return `<span class="hqf-thumb hqf-dirthumb" data-fill="${fill}"><span class="hqf-fback"></span>
    <span class="hqf-peek">${fill === 'heaps' ? '<span class="hqf-stack"></span>' : ''}${peek.map(miniSheet).join('')}</span>
    <span class="hqf-ffront">${e.count ? `<span class="hqf-count">${e.count}</span>` : ''}</span></span>`;
}

// The small page inside an Icons tile or a Gallery thumbnail.
function sheet(e) {
  const p = e.preview, ext = e.ext ? `<span class="hqf-ext">${esc(e.ext.slice(0, 6))}</span>` : '';
  if (e.dir) return folderThumb(e);
  if (!p) return `<span class="hqf-thumb"><span class="hqf-sheet hqf-blank"></span>${ext}</span>`;
  if (p.family === 'image') return `<span class="hqf-thumb"><span class="hqf-sheet hqf-img"><img src="/raw/${urlPath(e.path)}" alt="" loading="lazy"></span>${ext}</span>`;
  if (p.family === 'md') {
    return `<span class="hqf-thumb"><span class="hqf-sheet hqf-md">${p.type ? `<span class="hqf-chip">${typeChip(p.type)}</span>` : ''}` +
      `${p.title ? `<b class="hqf-h">${esc(p.title)}</b>` : ''}${p.lines.map(l => `<span class="hqf-l">${esc(l)}</span>`).join('')}</span>${ext}</span>`;
  }
  const lang = languageOf(e.path);
  const code = splitLines(highlight(p.lines.join('\n'), lang)).map(l => `<span class="hqf-cl">${l || ' '}</span>`).join('');
  return `<span class="hqf-thumb"><span class="hqf-sheet hqf-code"><span class="hqf-codein">${code}</span></span>${ext}</span>`;
}

const sub = e => (e.dir ? `${e.count} item${e.count === 1 ? '' : 's'}` : formatSize(e.size));
const exact = ms => (ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const href = e => `/code/${urlPath(e.path)}`;
const titleOf = e => (e.preview?.title && e.path.startsWith('docs/backlog/') ? e.preview.title : '');

function iconsView(list) {
  return `<div class="hqf-grid">${list.map(e => `<a class="hqf-tile${e.dir ? ' dir' : ''}" href="${href(e)}" title="${esc(`${e.name}${titleOf(e) ? ` · ${titleOf(e)}` : ''} · ${e.kind}${e.size != null ? ` · ${formatSize(e.size)}` : ''}`)}">
    ${sheet(e)}<span class="hqf-name">${esc(e.name)}</span><span class="hqf-sub">${esc(sub(e))}</span></a>`).join('')}</div>`;
}

const smallIcon = e => (e.dir ? FOLDER(null).replace('class="hqf-folder"', 'class="hqf-folder hqf-mini"')
  : `<svg class="hq-i" aria-hidden="true"><use href="#i-${e.family === 'md' ? 'md' : /JavaScript/.test(e.kind) ? 'js' : e.family === 'json' ? 'json' : e.ext === 'HTML' ? 'html' : e.ext === 'CSS' ? 'css' : 'file'}"/></svg>`);

function listView(list, now) {
  return dataTable({ id: 'hqf-list', cls: 'hqf-table', columns: [
    { key: 'name', label: 'Name', filter: 'text' }, { key: 'kind', label: 'Kind', filter: 'chips', w: 'md' },
    { key: 'size', label: 'Size', num: true, w: 'sm' }, { key: 'when', label: 'Date modified', w: 'md' },
  ], rows: list.map(e => ({ cells: {
    // folders sort first under either direction of Name
    name: { html: `<a class="hqf-row" href="${href(e)}">${smallIcon(e)}<span>${esc(e.name)}</span>${titleOf(e) ? ` <span class="hint">${esc(titleOf(e))}</span>` : ''}${e.preview?.type ? ` ${typeChip(e.preview.type)}` : ''}</a>`, v: `${e.dir ? 0 : 1}${e.name.toLowerCase()}`, f: `${e.name} ${titleOf(e)}` },
    kind: { html: esc(e.kind), f: e.kind },
    size: { html: e.dir ? `<span class="hint">${esc(sub(e))}</span>` : esc(formatSize(e.size)), v: e.dir ? -1 : e.size ?? 0 },
    when: { html: `<span title="${esc(exact(e.mtime))}">${esc(formatWhen(e.mtime, now))}</span>`, v: e.mtime ?? 0 },
  } })), empty: 'This folder is empty.' });
}

// The gallery's large preview of one file: rendered markdown, highlighted code, or the image.
function bigPreview(repo, e) {
  if (e.family === 'image') return `<div class="hqf-big-img"><img src="/raw/${urlPath(e.path)}" alt="${esc(e.name)}"></div>`;
  const buf = e.family === 'other' ? null : head(join(repo, e.path), GALLERY_BYTES);
  if (!buf || !isText(buf)) return '<p class="hint">No preview for this kind of file. Open it for the raw file.</p>';
  const more = e.size > buf.length ? `<p class="hint hqf-more">The first ${formatSize(buf.length)} of ${formatSize(e.size)}. Open the file for the rest.</p>` : '';
  let text = buf.toString('utf8');
  if (e.size > buf.length) text = text.slice(0, text.lastIndexOf('\n') + 1 || text.length);
  if (e.family === 'md') return `<div class="hq-md">${renderMarkdown(text, e.path, kindIn(repo)).html}</div>${more}`;
  return `<pre class="hq-pre hqf-big-code"><code class="hljs">${highlight(text, languageOf(e.path))}</code></pre>${more}`;
}

function galleryView(repo, list, sel, now) {
  const files = list.filter(e => !e.dir);
  if (!files.length) return `<p class="hint">No files here to show large; the folders are in Icons and List.</p>${iconsView(list)}`;
  const cur = files.find(e => e.name === sel) || files[0];
  const strip = files.map(e => `<a class="hqf-strip-item${e === cur ? ' on' : ''}" href="?as=gallery&amp;sel=${encodeURIComponent(e.name)}" data-sel="${esc(e.name)}"${e === cur ? ' aria-current="true"' : ''} title="${esc(e.name)}">${sheet(e)}<span class="hqf-name">${esc(e.name)}</span></a>`).join('');
  return `<div class="hqf-gallery">
    <section class="hqf-stage card"><header class="hqf-stage-head">${smallIcon(cur)}<b>${esc(cur.name)}</b>${cur.preview?.type ? typeChip(cur.preview.type) : ''}
      <span class="hint">${esc(cur.kind)} · ${esc(formatSize(cur.size))} · <span title="${esc(exact(cur.mtime))}">${esc(formatWhen(cur.mtime, now))}</span></span>
      <a class="btn btn-secondary hqf-open" href="${href(cur)}">Open</a></header>
      <div class="hqf-stage-body">${bigPreview(repo, cur)}</div></section>
    <nav class="hqf-strip" aria-label="Files in this folder">${strip}</nav></div>`;
}

// The whole folder view: the path, the view switch, and the view asked for (?as=; Icons by default). hq-files.js
// keeps the choice per browser and moves through the gallery without reloading the page.
export function folderView({ repo, files, rel, params = new URLSearchParams(), crumbs, now = Date.now() }) {
  const as = VIEWS.some(([k]) => k === params.get('as')) ? params.get('as') : 'icons';
  const list = describe(repo, folderEntries(files, rel));
  // the files rising out of each folder, for Icons (the first 60 folders; past that a folder is drawn without them)
  if (as === 'icons') list.filter(e => e.dir).slice(0, 60).forEach(e => { e.peek = peekOf(repo, files, e.path); });
  const switcher = `<div class="seg hq-spans hqf-views" role="group" aria-label="View as">${VIEWS.map(([k, label]) =>
    `<a class="seg-opt" href="?as=${k}" data-as="${k}"${k === as ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</div>`;
  const nd = list.filter(e => e.dir).length, nf = list.length - nd;
  const counts = [nd && `${nd} folder${nd === 1 ? '' : 's'}`, nf && `${nf} file${nf === 1 ? '' : 's'}`].filter(Boolean).join(', ');
  const view = as === 'list' ? listView(list, now) : as === 'gallery' ? galleryView(repo, list, params.get('sel'), now) : iconsView(list);
  return `<div class="hqf-folderview" data-as="${as}"${params.has('as') ? ' data-asked' : ''}>
    <div class="hq-filehead"><nav class="hq-crumbs" aria-label="Where this folder is">${crumbs}</nav><div class="hq-filehead-right"><span class="hint">${esc(counts)}</span>${switcher}</div></div>
    ${list.length ? view : '<p class="hint">This folder is empty.</p>'}</div>
    <script src="/hq/hq-files.js" defer></script>`;
}
