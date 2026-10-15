// Proves: the screen sums hq.js does (static/hqmath.js): where an info popover goes so the page edge never cuts it
// off, how many filter chips fit on one row, and the pipeline canvas's zoom, fit and mini map.
// Why: these are pure maths a browser test would be slow to pin, and a popover cut off by the edge is unreadable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../static/hqmath.js';
const { place, fitChips, zoomAt, fit, visible, centreOn, miniToWorld, menuValues, rowMatches, showing, currentSection } = globalThis.hqMath;

// a 16px icon at (x, y) in a 1280 × 800 window, and a 300 × 120 popover
const icon = (x, y) => ({ left: x, top: y, right: x + 16, bottom: y + 16 });
const TIP = { width: 300, height: 120 };

test('with room, the popover sits below the icon, lined up with its left edge', () => {
  assert.deepEqual(place(icon(100, 100), TIP, 1280, 800), { top: 124, left: 100, side: 'below' });
});

test('near the bottom it flips above the icon', () => {
  const p = place(icon(100, 760), TIP, 1280, 800);
  assert.deepEqual([p.side, p.top], ['above', 760 - 8 - 120]);
});

test('near the right edge it ends at the icon instead, and never leaves the window', () => {
  assert.equal(place(icon(1200, 100), TIP, 1280, 800).left, 1216 - 300);
  assert.equal(place(icon(1270, 100), { width: 300, height: 120 }, 1280, 800).left, 1280 - 8 - 300);
  assert.equal(place(icon(2, 100), { width: 2000, height: 50 }, 1280, 800).left, 8, 'wider than the window: pinned to the left margin');
});

test('with no room either way it takes the side with more room and stays inside', () => {
  const p = place(icon(100, 300), { width: 300, height: 700 }, 1280, 800);
  assert.equal(p.side, 'below');
  assert.ok(p.top >= 8 && p.top + 700 <= 800 - 8 || p.top === 8);
});

test('all the chips when they fit; otherwise as many as leave room for "+N more"', () => {
  assert.equal(fitChips([40, 40, 40], 200, 4, 60), 3);
  // 40 + 4 + 40 + 4 + 60 = 148 fits in 150; a third chip would not
  assert.equal(fitChips([40, 40, 40, 40], 150, 4, 60), 2);
  assert.equal(fitChips([400, 40], 150, 4, 60), 1, 'at least one always shows');
});

test('zooming keeps the point under the pointer still', () => {
  const v = zoomAt({ x: 0, y: 0, k: 1 }, 200, 100, 2);
  assert.deepEqual(v, { x: -200, y: -100, k: 2 });
  // the drawing point under the pointer is (200, 100) before and after
  assert.deepEqual([(200 - v.x) / v.k, (100 - v.y) / v.k], [200, 100]);
  assert.equal(zoomAt({ x: 0, y: 0, k: 5 }, 0, 0, 10).k, 6, 'zoom has a limit');
});

test('fit centres the drawing and the mini map moves the view to the point clicked', () => {
  const v = fit(2000, 500, 1000, 500, 1);
  assert.deepEqual(v, { x: 0, y: 125, k: 0.5 });
  assert.deepEqual(visible(v, 1000, 500), { x: 0, y: -250, w: 2000, h: 1000 });
  // a 200 × 50 mini map of a 2000 × 500 drawing: its point (150, 25) is the drawing's (1500, 250)
  assert.deepEqual(miniToWorld(150, 25, 2000, 500, 200, 50), [1500, 250]);
  assert.deepEqual(centreOn({ x: 0, y: 0, k: 1 }, 1500, 250, 1000, 500), { x: -1000, y: 0, k: 1 });
});

// A table's filter menus and search (hq.js): which values a menu offers, which rows a filter keeps, and what the bar says.
test('a filter menu offers the values in the rows, most common first, each with its count, and no blanks', () => {
  assert.deepEqual(menuValues(['main', 'fix/a', 'main', '', 'fix/b', 'main', 'fix/a']),
    [{ value: 'main', count: 3 }, { value: 'fix/a', count: 2 }, { value: 'fix/b', count: 1 }]);
});

test('a row stays when every word searched is in it and each menu with a choice holds its value', () => {
  const row = { text: 'Gate (container) main smoke-sync: the public record', vals: { kind: 'Gate (container)', branch: 'main' } };
  assert.equal(rowMatches(row, { query: '', sets: {} }), true);
  assert.equal(rowMatches(row, { query: 'SMOKE-sync public', sets: {} }), true, 'words in any order, any case');
  assert.equal(rowMatches(row, { query: 'smoke-sync private', sets: {} }), false, 'every word must be there');
  assert.equal(rowMatches(row, { query: '', sets: { kind: new Set(['Gate (container)', 'Long set']) } }), true);
  assert.equal(rowMatches(row, { query: '', sets: { kind: new Set(['Long set']) } }), false);
  assert.equal(rowMatches(row, { query: '', sets: { kind: new Set() } }), true, 'a menu with nothing chosen keeps every row');
});

test('the bar says how many rows show, and says all when nothing is hidden', () => {
  assert.equal(showing(18, 342), 'Showing 18 of 342');
  assert.equal(showing(342, 342), 'All 342');
  assert.equal(showing(0, 342), 'None of 342 match');
});

// A markdown file's section rail (hq.js): which section is being read, from where each heading is on screen. A section
// counts once its heading has passed a line near the top of the window; a heading not shown has no place (null).
const TOPS = [-900, -300, 40, 400, 1200]; // the first three headings are above the reading line at 96
test('the section being read is the last one whose heading has passed the reading line', () => {
  assert.equal(currentSection(TOPS, 96), 2);
  assert.equal(currentSection(TOPS, 30), 1, 'a heading just under the line is not reached yet');
  assert.equal(currentSection([200, 600], 96), -1, 'above the first heading, none is lit');
});

test('at the end of the document the last section is lit, even if its heading never reaches the line', () => {
  assert.equal(currentSection(TOPS, 96, true), TOPS.length - 1);
});

test('a heading with no place on screen is passed over', () => {
  assert.equal(currentSection([-300, null, 40, null], 96), 2);
  assert.equal(currentSection([null, null], 96, true), -1, 'nothing shown, nothing lit');
});
