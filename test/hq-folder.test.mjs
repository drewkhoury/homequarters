// A folder on HQ's Code page (hq/lib/folder.mjs): what kind each file is, what its thumbnail says, sizes and dates in
// words, folders before files with their counts, and the three views drawn from a small folder made here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { kindOf, formatSize, formatWhen, previewOf, folderEntries, describe, folderView, fillOf, peekOf } from '../lib/folder.mjs';

// A backlog item as docs/backlog/README.md describes one: frontmatter, a title, then prose.
const ITEM = '---\ntype: feature\nasked: Jane, 28 Sep\n---\n# Customise the bird\n\nMoss\'s **familiar** has fixed [colours](web/world-familiar.js).\n\nDone when: a person can change them.\n';
// A doc with no frontmatter and a table after its prose.
const DOC = 'Intro before any heading.\n# Testing\n\n- Unit tests run first.\n| a | b |\n|---|---|\n';
const CODE = Array.from({ length: 20 }, (_, i) => `const line${i} = ${i};`).join('\n');
const NOW = Date.parse('2026-09-29T12:00:00Z');

test('each file has a kind in Finder\'s words and a family that decides its preview', () => {
  assert.deepEqual(kindOf('app.js'), { kind: 'JavaScript', family: 'code', ext: 'JS' });
  assert.deepEqual(kindOf('README.md'), { kind: 'Markdown', family: 'md', ext: 'MD' });
  assert.deepEqual(kindOf('shot.PNG'), { kind: 'PNG image', family: 'image', ext: 'PNG' });
  assert.equal(kindOf('Makefile').kind, 'Makefile');
  assert.equal(kindOf('.gitignore').kind, 'File', 'a leading dot is not an extension');
  assert.equal(kindOf('web', true).family, 'dir');
});

test('sizes and dates read the way Finder writes them', () => {
  assert.deepEqual([formatSize(812), formatSize(4200), formatSize(1_300_000), formatSize(52_000)], ['812 B', '4.2 KB', '1.3 MB', '52 KB']);
  assert.equal(formatWhen(NOW - 30_000, NOW), 'just now');
  assert.equal(formatWhen(NOW - 3 * 3600_000, NOW), '3 h ago');
  // an older moment is a local date, so the expectation is formed the same way: in Kiritimati it is 1 Aug (Hollis)
  assert.equal(formatWhen(NOW - 60 * 86400_000, NOW), new Date(NOW - 60 * 86400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
});

test('a backlog item\'s thumbnail shows its type and title, and its prose without markdown marks or frontmatter', () => {
  const p = previewOf('customise-the-bird.md', ITEM, { backlog: true });
  assert.equal(p.type, 'feature');
  assert.equal(p.title, 'Customise the bird');
  assert.deepEqual(p.lines, ['Moss\'s familiar has fixed colours.', 'Done when: a person can change them.']);
  assert.equal(previewOf('x.md', ITEM).type, '', 'outside the backlog, type is not a chip');
});

test('a doc\'s title is its first heading wherever it is, and tables are left out of its lines', () => {
  const p = previewOf('TESTING.md', DOC);
  assert.equal(p.title, 'Testing');
  assert.deepEqual(p.lines, ['Unit tests run first.']);
});

test('code shows its first fourteen lines', () => {
  const p = previewOf('app.js', CODE);
  assert.equal(p.family, 'code');
  assert.equal(p.lines.length, 14);
  assert.equal(p.lines[0], 'const line0 = 0;');
});

test('a folder lists each child once, folders first, with how many entries each folder holds', () => {
  const files = ['docs/b.md', 'docs/a.md', 'docs/backlog/next/x.md', 'docs/backlog/next/y.md', 'docs/backlog/README.md', 'docs/history/old.md', 'web/app.js'];
  assert.deepEqual(folderEntries(files, 'docs').map(e => [e.name, e.dir, e.count]), [
    ['backlog', true, 2], ['history', true, 1], ['a.md', false, null], ['b.md', false, null],
  ]);
  assert.deepEqual(folderEntries(files, '').map(e => e.name), ['docs', 'web']);
});

// A small repo folder with one of each kind, made fresh for each test that needs it.
function tree() {
  const repo = mkdtempSync(join(tmpdir(), 'hq-folder-'));
  mkdirSync(join(repo, 'docs', 'backlog', 'inbox'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'backlog', 'inbox', 'customise-the-bird.md'), ITEM);
  writeFileSync(join(repo, 'docs', 'backlog', 'inbox', 'app.js'), CODE);
  writeFileSync(join(repo, 'docs', 'backlog', 'inbox', 'blob.bin'), Buffer.from([0, 1, 2, 0, 3]));
  mkdirSync(join(repo, 'docs', 'backlog', 'inbox', 'old'));
  writeFileSync(join(repo, 'docs', 'backlog', 'inbox', 'old', 'z.md'), '# Z\n');
  for (const f of ['customise-the-bird.md', 'app.js', 'blob.bin']) utimesSync(join(repo, 'docs', 'backlog', 'inbox', f), new Date(NOW - 7200_000), new Date(NOW - 7200_000));
  const files = ['docs/backlog/inbox/old/z.md', 'docs/backlog/inbox/app.js', 'docs/backlog/inbox/blob.bin', 'docs/backlog/inbox/customise-the-bird.md'];
  return { repo, files, done: () => rmSync(repo, { recursive: true, force: true }) };
}

test('each entry gets its size and date, a preview for text, and none for a binary file or past the cap', () => {
  const t = tree();
  const d = describe(t.repo, folderEntries(t.files, 'docs/backlog/inbox'));
  const by = Object.fromEntries(d.map(e => [e.name, e]));
  assert.equal(by.old.count, 1);
  assert.equal(by['customise-the-bird.md'].preview.title, 'Customise the bird');
  assert.equal(by['blob.bin'].preview, null);
  assert.equal(by['blob.bin'].family, 'other');
  assert.equal(by['app.js'].size, CODE.length);
  assert.equal(describe(t.repo, folderEntries(t.files, 'docs/backlog/inbox'), { cap: 1 }).filter(e => e.preview).length, 1);
  t.done();
});

test('Icons is the default: a tile per entry, the item\'s type chip, and code drawn highlighted', () => {
  const t = tree();
  const html = folderView({ repo: t.repo, files: t.files, rel: 'docs/backlog/inbox', crumbs: 'here', now: NOW });
  assert.match(html, /data-as="icons"/);
  assert.equal((html.match(/class="hqf-tile/g) || []).length, 4);
  assert.match(html, /<span class="bl-type" data-type="feature">Feature<\/span><\/span><b class="hqf-h">Customise the bird<\/b>/);
  assert.match(html, /hqf-code[\s\S]*hljs-keyword/);
  assert.match(html, /1 folder, 3 files/);
  t.done();
});

test('List is a table with kind, size and date; Gallery shows the chosen file large with the rest in a strip', () => {
  const t = tree();
  const list = folderView({ repo: t.repo, files: t.files, rel: 'docs/backlog/inbox', params: new URLSearchParams('as=list'), crumbs: '', now: NOW });
  assert.match(list, /id="hqf-list"/);
  assert.match(list, />JavaScript<\/span><\/td>/);
  assert.match(list, />2 h ago</);
  const gallery = folderView({ repo: t.repo, files: t.files, rel: 'docs/backlog/inbox', params: new URLSearchParams('as=gallery&sel=customise-the-bird.md'), crumbs: '', now: NOW });
  assert.match(gallery, /class="hqf-stage[\s\S]*<b>customise-the-bird\.md<\/b>/);
  assert.match(gallery, /<div class="hq-md">[\s\S]*<h1[^>]*>.*Customise the bird<\/h1>/, 'the markdown is rendered, frontmatter as its table');
  assert.equal((gallery.match(/class="hqf-strip-item/g) || []).length, 3, 'files only in the strip');
  assert.match(gallery, /class="hqf-strip-item on"[^>]*data-sel="customise-the-bird\.md"/);
  t.done();
});

test('a name or preview cannot break out of the page', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hq-folder-'));
  writeFileSync(join(repo, 'x.md'), '# <img src=x onerror=alert(1)>\n');
  const html = folderView({ repo, files: ['x.md'], rel: '', crumbs: '', now: NOW });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
  rmSync(repo, { recursive: true, force: true });
});

test('a folder shows how full it is: no sheets, one, two, three for three to nine, and heaps from ten', () => {
  assert.deepEqual([0, 1, 2, 3, 9, 10, 94].map(fillOf), [0, 1, 2, 3, 3, 'heaps', 'heaps']);
});

test('the sheets rising out of a folder are its first files, then its folders, each drawn from its own lines', () => {
  const t = tree();
  const peek = peekOf(t.repo, t.files, 'docs/backlog/inbox');
  assert.deepEqual(peek.map(p => p.family), ['code', 'other', 'md'], 'files first, by name, at most three');
  assert.equal(peek[2].title, true);
  assert.equal(peek[2].lines[0], 'Customise the bird'.length, 'a doc\'s first line is its title');
  const html = folderView({ repo: t.repo, files: t.files, rel: 'docs/backlog', crumbs: 'here', now: NOW });
  assert.match(html, /class="hqf-thumb hqf-dirthumb" data-fill="3"/);
  assert.equal((html.match(/class="hqf-ps /g) || []).length, 3);
  assert.match(html, /<span class="hqf-count">4<\/span>/);
  t.done();
});
