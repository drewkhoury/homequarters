// HQ's one table (hq/lib/ui.mjs): what every list in HQ is drawn with. Its filters sit in a bar above the table, never in
// its header, so a column is as wide as what it holds; each column's width comes from what kind of value it holds, and
// a cell stays on one line unless its column is one that wraps (27 September: a column of filter chips pushed the
// table's result and time off the screen, and dates wrapped over three lines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataTable } from '../lib/ui.mjs';

const columns = [
  { key: 'when', label: 'When', w: 'md' },
  { key: 'kind', label: 'Kind', filter: 'chips', w: 'md', preset: ['Gate (container)', 'Long set'] },
  { key: 'branch', label: 'Branch', filter: 'chips', w: 'lg' },
  { key: 'failed', label: 'Failed', filter: 'text' },
  { key: 'about', label: 'About', filter: 'text', wrap: true },
];
const rows = [{ cells: { when: 'today', kind: 'Gate (container)', branch: 'main', failed: '', about: 'a long description' } }];
const html = dataTable({ id: 'runs', columns, rows });
const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));

test('a table\'s filters sit in one bar above it, never in its header', () => {
  assert.ok(html.indexOf('class="hq-dt-bar"') > -1 && html.indexOf('class="hq-dt-bar"') < html.indexOf('<table'), 'a bar before the table');
  assert.doesNotMatch(head, /hq-chips|hq-colfilter|hq-filters|<input/, 'no filters in the header');
  assert.match(html, /<input[^>]*class="[^"]*hq-dt-search[^"]*"[^>]*type="search"/, 'one search box');
  const menus = [...html.matchAll(/<details class="hq-dt-menu" data-col="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(menus, ['kind', 'branch'], 'one menu for each column filtered by its values');
  assert.match(html, /data-col="kind"[^>]*data-preset="Gate \(container\)\nLong set"/, 'a column\'s preset values go with its menu');
});

test('each column\'s width comes from what it holds, and a column with none takes what is left', () => {
  const cols = [...html.matchAll(/<col( class="([^"]*)")?>/g)].map(m => m[2] || '');
  assert.deepEqual(cols, ['w-md', 'w-md', 'w-lg', '', ''], 'one <col> for each column, in order');
  assert.match(html, /<table class="hq-table hq-dt[^"]*"/);
});

test('a cell stays on one line unless its column wraps', () => {
  const td = key => (html.match(new RegExp(`<td data-col="${key}"[^>]*class="([^"]*)"`)) || [])[1];
  assert.match(td('when'), /\bnw\b/); assert.match(td('failed'), /\bnw\b/);
  assert.match(td('about'), /\bwrap\b/); assert.doesNotMatch(td('about'), /\bnw\b/);
});

// On a narrow screen each cell is a card's row, a grid of its label and its value. A cell mixing text with code or a link
// was several grid items, which overlapped (2 October, found on the Decisions page after #109 fixed only that page).
test('a cell\'s contents sit in one element, so a narrow screen\'s card keeps text, code and links together', () => {
  const t = dataTable({ columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], rows: [{ cells: { a: 'Run <code>make up</code> first, see <a href="#x">this</a>', b: '' } }] });
  const inner = key => (t.match(new RegExp(`<td data-col="${key}"[^>]*>([\\s\\S]*?)</td>`)) || [])[1];
  assert.equal(inner('a'), '<span class="hq-cell">Run <code>make up</code> first, see <a href="#x">this</a></span>');
  assert.equal(inner('b'), '', 'an empty cell stays empty, so the card leaves its row out');
});

test('a table with no filters has no bar, and one with no rows says so', () => {
  assert.doesNotMatch(dataTable({ columns: [{ key: 'a', label: 'A' }], rows: [{ cells: { a: 1 } }] }), /hq-dt-bar/);
  assert.match(dataTable({ columns, rows: [], empty: 'Nothing yet.' }), /Nothing yet\./);
});
