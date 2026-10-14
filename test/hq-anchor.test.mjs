// Finding a comment's words on the page again (hq/static/hqanchor.js): the page's text as pieces, one per text node,
// and a comment's quote with a little text either side. Each test is text in, the covered part of each piece out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../static/hqanchor.js';
const { locate, groupRows, strip } = globalThis.hqAnchor;

// A backlog item's body as the page holds it: a paragraph split by inline code, then the lines after it.
const ITEM = ['The device that lost the race keeps its own copy until it ', 'reloads', '.', '\n\n', 'Done when: smoke-reward compares both browsers.'];
// Code-view rows, each line's text in its own piece, and the same call on two lines.
const CODE = ['const day = dayKey(t);', 'if (day === board) count++;', 'const day = dayKey(t);', 'return count;'];
// The part of a piece that some words cover, worked out from the fixture rather than counted by hand.
const span = (piece, text, words) => ({ piece, start: text.indexOf(words), end: text.indexOf(words) + words.length });

test('a quote inside one piece covers just its words', () => {
  assert.deepEqual(locate(ITEM, { quote: 'keeps its own copy' }), [span(0, ITEM[0], 'keeps its own copy')]);
});

test('a quote across pieces covers the end of the first, all of those between, and the start of the last', () => {
  // the first piece is covered to its end, so the space before the next piece is highlighted with the words
  assert.deepEqual(locate(ITEM, { quote: 'until it reloads.' }), [{ piece: 0, start: ITEM[0].indexOf('until it'), end: ITEM[0].length }, { piece: 1, start: 0, end: 7 }, { piece: 2, start: 0, end: 1 }]);
});

test('whitespace does not have to agree: a selection over lines comes back with newlines and tabs the page lacks', () => {
  const r = locate(CODE, { quote: 'count++;\n\tconst day' });
  assert.deepEqual(r, [span(1, CODE[1], 'count++;'), span(2, CODE[2], 'const day')]);
  assert.deepEqual(locate(ITEM, { quote: 'reloads .   Done  when' }).map(x => x.piece), [1, 2, 3, 4]);
});

test('of two matches, the one whose surroundings agree with the prefix and suffix wins', () => {
  const second = locate(CODE, { quote: 'const day = dayKey(t);', prefix: 'if (day === board) count++;', suffix: 'return count;' });
  assert.equal(second[0].piece, 2);
  const first = locate(CODE, { quote: 'const day = dayKey(t);', prefix: '', suffix: 'if (day' });
  assert.equal(first[0].piece, 0);
});

test('an old comment with no prefix or suffix takes the first match, or the one nearest its line', () => {
  assert.equal(locate(CODE, { quote: 'const day' })[0].piece, 0);
  assert.equal(locate(CODE, { quote: 'const day' }, { near: 2 })[0].piece, 2);
});

test('a quote no longer on the page is not found, and an empty quote finds nothing', () => {
  assert.equal(locate(ITEM, { quote: 'until it rebuilds' }), null);
  assert.equal(locate(ITEM, { quote: '   ' }), null);
  assert.equal(locate([], { quote: 'x' }), null);
});

test('markers on the same line share one, and say how many', () => {
  assert.deepEqual(groupRows([{ id: 'b', top: 104 }, { id: 'a', top: 100 }, { id: 'c', top: 140 }]), [{ top: 100, ids: ['a', 'b'] }, { top: 140, ids: ['c'] }]);
  assert.deepEqual(groupRows([]), []);
});

test('strip leaves out every kind of whitespace', () => {
  assert.equal(strip(' a\tb\nc  d '), 'abcd');
  assert.equal(strip(undefined), '');
});
