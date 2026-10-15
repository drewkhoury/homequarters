// Proves: the file tree on the Code and Docs pages gives each kind of file an icon, puts folders before files, and
// unfolds the way to the open file with the file marked.
// Why: the tree is how a person finds their place in the repo from any page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconFor, fileTree } from '../lib/tree.mjs';

const FILES = ['README.md', 'Makefile', 'docs/TESTING.md', 'docs/history/research.md', 'web/app.js', 'web/app.css', 'web/index.html', 'web/manifest.webmanifest', 'tests/unit/contract.test.mjs'];
const tree = current => fileTree(FILES, { current, href: f => `/code/${f}`, name: 'code' });

test('each kind of file gets its icon, and anything else the plain one', () => {
  assert.deepEqual(['a.md', 'a.js', 'a.test.mjs', 'package.json', 'm.webmanifest', 'index.html', 'app.css', 'Makefile', 'firestore.rules'].map(iconFor),
    ['md', 'js', 'js', 'json', 'json', 'html', 'css', 'file', 'file']);
});

test('the folders on the way to the open file start open, and no others', () => {
  const html = tree('docs/history/research.md');
  assert.match(html, /data-path="docs" open/);
  assert.match(html, /data-path="docs\/history" open/);
  assert.doesNotMatch(html, /data-path="web" open/);
  assert.doesNotMatch(html, /data-path="tests" open/);
});

test('the open file is marked as the current page, once', () => {
  const html = tree('web/app.js');
  assert.equal(html.match(/aria-current="page"/g).length, 1);
  assert.match(html, /href="\/code\/web\/app.js" class="on" aria-current="page"/);
});

test('folders come before files, each in name order, and a folder named like a prefix is not opened', () => {
  const html = fileTree(['z.md', 'b/x.md', 'a/y.md', 'ab/w.md'], { current: 'ab/w.md', href: f => f, name: 't' });
  const order = [...html.matchAll(/data-path="([^"]+)"|href="([^"#][^"]*)"/g)].map(m => m[1] || m[2]);
  assert.deepEqual(order, ['a', 'a/y.md', 'ab', 'ab/w.md', 'b', 'b/x.md', 'z.md']);
  assert.doesNotMatch(html, /data-path="a" open/);
});

test('names are escaped', () => {
  assert.match(fileTree(['<b>.md'], { href: f => f, name: 't' }), /&lt;b&gt;\.md/);
});
