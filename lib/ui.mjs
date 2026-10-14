// The two pieces every HQ page is built from besides its data: an info icon that holds the explaining, and one table
// with sortable columns and a filter on each. hq.js makes both work; without it the table is still a table.
import { esc } from './page.mjs';

// An "i" that shows `text` on hover, on keyboard focus, or on a tap.
export const info = (text, label = 'What this means') =>
  `<span class="hq-info" tabindex="0" role="button" aria-label="${esc(label)}" aria-expanded="false">` +
  `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 7v4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="4.6" r=".95" fill="currentColor"/></svg>` +
  `<span class="hq-tip" role="tooltip">${esc(text)}</span></span>`;

// A cell is HTML, or { html, v, f }: v is what the column sorts by (text or a number), f what its filter matches.
const cellOf = c => (c && typeof c === 'object' ? c : { html: c == null ? '' : String(c) });

// One table for every list in HQ. Its filters sit in one bar above it: a search box over the columns marked filter:
// 'text', and a menu for each column marked 'chips', which hq.js fills with that column's values and their counts. The
// header holds only the columns' names, so a column is as wide as what it holds. Widths come from what a column holds:
// w: 'xs' (a count), 'sm' (a result or a time), 'md' (a date, a commit, a short label), 'lg' (a branch, a name), and a
// column with no w shares what is left. A cell stays on one line, cut short with its whole text on hover, unless its
// column says wrap: true (a description).
//   columns: [{ key, label, filter: 'text' | 'chips' | false, sort: false to turn it off, num: true for numbers,
//               preset: a chip value or values to start with, w, wrap, cls }]
//   rows:    [{ cells: { [key]: cell }, attrs: { name: value } }]
//   empty:   what to say when there are no rows at all
export function dataTable({ id = '', columns, rows, empty = 'Nothing here yet.', cls = '' }) {
  if (!rows.length) return `<p class="hint hq-empty">${esc(empty)}</p>`;
  const searchable = columns.filter(c => c.filter === 'text'), menus = columns.filter(c => c.filter === 'chips');
  const bar = searchable.length || menus.length ? `<div class="hq-dt-bar">` +
    (searchable.length ? `<input class="input hq-dt-search" type="search" placeholder="Search ${esc(searchable.map(c => c.label.toLowerCase()).join(', '))}" aria-label="Search the table" data-cols="${esc(searchable.map(c => c.key).join(' '))}">` : '') +
    menus.map(c => `<details class="hq-dt-menu" data-col="${esc(c.key)}" data-preset="${esc([].concat(c.preset || []).join('\n'))}">` +
      `<summary class="hq-dt-pick">${esc(c.label)}<span class="hq-dt-n" hidden></span></summary><div class="hq-dt-list" role="group" aria-label="${esc(c.label)}"></div></details>`).join('') +
    `<span class="hq-dt-status hint" aria-live="polite"></span><button type="button" class="hq-dt-clear" hidden>Clear filters</button></div>` : '';
  const colgroup = `<colgroup>${columns.map(c => `<col${c.w ? ` class="w-${esc(c.w)}"` : ''}>`).join('')}</colgroup>`;
  const head = columns.map(c => `<th scope="col" class="${esc(c.cls || '')}"${c.sort === false ? '' : ` aria-sort="none" data-sort="${c.num ? 'num' : 'text'}"`}>` +
    (c.sort === false ? esc(c.label) : `<button type="button" class="hq-sort">${esc(c.label)}<span aria-hidden="true"></span></button>`) + '</th>').join('');
  const body = rows.map(r => {
    const attrs = Object.entries(r.attrs || {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return `<tr${attrs}>${columns.map(c => {
      const x = cellOf(r.cells[c.key]), kind = c.wrap ? 'wrap' : 'nw';
      return `<td data-col="${esc(c.key)}" data-label="${esc(c.label)}"${x.v != null ? ` data-v="${esc(x.v)}"` : ''}${x.f != null ? ` data-f="${esc(x.f)}"` : ''} class="${esc([c.cls, kind].filter(Boolean).join(' '))}">${x.html === '' ? '' : `<span class="hq-cell">${x.html}</span>`}</td>`;
    }).join('')}</tr>`;
  }).join('');
  return `${bar}<div class="hq-scroll"><table class="hq-table hq-dt ${esc(cls)}"${id ? ` id="${esc(id)}"` : ''}>${colgroup}
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody>
    <tfoot hidden><tr><td colspan="${columns.length}" class="hint">No rows match the filters.</td></tr></tfoot></table></div>`;
}
