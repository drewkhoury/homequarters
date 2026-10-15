// The file tree beside the Code and Docs pages. Folders are <details>, so they open and close without JavaScript;
// hq.js remembers which are open and scrolls the current file into view. The icons are symbols drawn once per page
// (ICONS, in the layout) and used by name.
import { posix } from 'node:path';
import { esc, urlPath } from './page.mjs';

// The icon for a file, by its name.
export function iconFor(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (ext === 'md') return 'md';
  if (['js', 'mjs', 'cjs'].includes(ext)) return 'js';
  if (['json', 'webmanifest'].includes(ext)) return 'json';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (ext === 'css') return 'css';
  return 'file';
}

const use = (id, cls = '') => `<svg class="hq-i ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

// Nested folders from a flat list of paths.
export function nest(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.split('/'); let node = root;
    for (const d of parts.slice(0, -1)) { if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [] }); node = node.dirs.get(d); }
    node.files.push(f);
  }
  return root;
}

// The tree as HTML. `current` is the open file or folder; the folders on the way to it start open. `href` makes a
// file's link. `name` tells hq.js which tree's open folders to remember.
export function fileTree(files, { current = '', href, name, label = 'Files', groupOf = null }) {
  const draw = (node, prefix, depth) => {
    const dirs = [...node.dirs].sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'base' })).map(([dir, child]) => {
      const p = prefix ? `${prefix}/${dir}` : dir, on = current === p || current.startsWith(p + '/');
      return `<li><details data-path="${esc(p)}"${on ? ' open' : ''}><summary>` +
        `${use('chev', 'chev')}${use('dir', 'shut')}${use('dir-open', 'open')}<span>${esc(dir)}</span></summary>` +
        `<ul>${draw(child, p, depth + 1)}</ul></details></li>`;
    });
    const leaves = node.files.map(f => {
      const base = posix.basename(f), on = f === current;
      return `<li${groupOf ? ` data-group="${esc(groupOf(f))}"` : ''}><a href="${esc(href(f))}"${on ? ' class="on" aria-current="page"' : ''}>` +
        `<span class="chev-space"></span>${use(iconFor(base), 'k-' + iconFor(base))}<span>${esc(base)}</span></a></li>`;
    });
    return dirs.join('') + leaves.join('');
  };
  // plain nested lists under details/summary: the native markup already works with a keyboard and a screen reader, and
  // the tree role would promise arrow keys it does not have (Noor, WCAG 4.1.2)
  return `<nav class="hq-ftree" data-tree="${esc(name)}" aria-label="${esc(label)}"><ul>${draw(nest(files), '', 1)}</ul></nav>`;
}

// Drawn once per page and used by the tree. Lines in the text colour; the file kinds get a small coloured mark.
export const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-chev" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-dir" viewBox="0 0 16 16"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.5h5.9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.9a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></symbol>
  <symbol id="i-dir-open" viewBox="0 0 16 16"><path d="M1.5 12.5v-8a1 1 0 0 1 1-1h3.6l1.4 1.5h5a1 1 0 0 1 1 1v1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2.6 7h11.6a.6.6 0 0 1 .58.75l-1.3 4.6a1 1 0 0 1-.96.72H1.6z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></symbol>
  <symbol id="i-file" viewBox="0 0 16 16"><path d="M4 1.5h5l3.5 3.5v9a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1v-11.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 1.5v3.5h3.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></symbol>
  <symbol id="i-md" viewBox="0 0 16 16"><rect x="1" y="3.5" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 10.5v-5l2 2.2 2-2.2v5M10.5 5.5v5m-1.8-1.8 1.8 1.8 1.8-1.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-js" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.2"/><text x="8.6" y="12" text-anchor="middle" font-size="6.6" font-weight="700" font-family="ui-sans-serif, system-ui, sans-serif" fill="currentColor">JS</text></symbol>
  <symbol id="i-json" viewBox="0 0 16 16"><path d="M5.5 2.5c-1.6 0-2 .7-2 2v1.6c0 .9-.5 1.4-1.5 1.9 1 .5 1.5 1 1.5 1.9v1.6c0 1.3.4 2 2 2M10.5 2.5c1.6 0 2 .7 2 2v1.6c0 .9.5 1.4 1.5 1.9-1 .5-1.5 1-1.5 1.9v1.6c0 1.3-.4 2-2 2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></symbol>
  <symbol id="i-html" viewBox="0 0 16 16"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-css" viewBox="0 0 16 16"><path d="M3 2.5h10l-1 10.5-4 1.5-4-1.5z" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10.5 5.5h-5l.3 2.5h4.4l-.3 2.6-1.9.6-1.9-.6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></symbol>
</svg>`;
