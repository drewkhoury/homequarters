// Proves: the Docs page's markdown keeps links between docs working inside HQ, opens other repo files in the code
// viewer, and turns the docs' habit of naming files in inline code into links.
// Why: a doc that links to a file nobody can open from HQ sends the reader back to the terminal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteHref, rewriteSrc, resolveRepoPath, renderMarkdown, slugger, sectionsOf } from '../lib/markdown.mjs';
import { splitLines } from '../lib/highlight.mjs';

// A small repo, as the kind() the server passes in would see it.
const REPO = { 'README.md': 'file', 'docs': 'dir', 'docs/TESTING.md': 'file', 'docs/DATA.md': 'file', 'docs/history': 'dir',
  'docs/history/research.md': 'file', 'web': 'dir', 'web/firebase.js': 'file', 'docs/design/shot.png': 'file', 'docs/design': 'dir' };
const kind = p => REPO[p] || null;

test('a link to another doc opens it rendered in HQ, relative to the doc it is in, keeping the anchor', () => {
  assert.equal(rewriteHref('DATA.md', 'docs/TESTING.md', kind), '/code/docs/DATA.md');
  assert.equal(rewriteHref('../README.md#run', 'docs/TESTING.md', kind), '/code/README.md#run');
  assert.equal(rewriteHref('history/research.md', 'docs/TESTING.md', kind), '/code/docs/history/research.md');
  assert.equal(rewriteHref('/docs/DATA.md', 'docs/history/research.md', kind), '/code/docs/DATA.md');
});

test('a link to any other repo file or folder opens the code viewer, keeping a line anchor', () => {
  assert.equal(rewriteHref('../web/firebase.js#L12', 'docs/TESTING.md', kind), '/code/web/firebase.js#L12');
  assert.equal(rewriteHref('../web/', 'docs/TESTING.md', kind), '/code/web');
});

test('external links, mail links, anchors, missing files and paths out of the repo are left as written', () => {
  for (const href of ['https://questkeep.web.app', 'mailto:a@b.c', '#run', '//cdn.example/x.js', 'NOPE.md', '../../outside.md'])
    assert.equal(rewriteHref(href, 'docs/TESTING.md', kind), href);
});

test('a path out of the repo resolves to nothing', () => {
  assert.equal(resolveRepoPath('docs/TESTING.md', '../../x.md'), null);
  assert.equal(resolveRepoPath('README.md', 'docs/'), 'docs');
});

test('an image in the repo loads from /raw/, one elsewhere is left alone', () => {
  assert.equal(rewriteSrc('design/shot.png', 'docs/TESTING.md', kind), '/raw/docs/design/shot.png');
  assert.equal(rewriteSrc('https://example.com/a.png', 'docs/TESTING.md', kind), 'https://example.com/a.png');
});

test('inline code naming a repo file becomes a link; other inline code stays code', () => {
  const { html } = renderMarkdown('Read `docs/DATA.md`, then `web/firebase.js` and `TESTING.md`; run `make test` and `x.y`.', 'docs/PRODUCT.md', kind);
  assert.match(html, /<a href="\/code\/docs\/DATA.md"><code>docs\/DATA.md<\/code><\/a>/);
  assert.match(html, /<a href="\/code\/web\/firebase.js"><code>web\/firebase.js<\/code><\/a>/);
  assert.match(html, /<a href="\/code\/docs\/TESTING.md"><code>TESTING.md<\/code><\/a>/, 'relative to the doc');
  assert.match(html, /<code>make test<\/code>/);
  assert.match(html, /<code>x.y<\/code>/);
});

test('inline code is escaped', () => {
  assert.match(renderMarkdown('`<b>` and `a & b`', 'README.md', kind).html, /<code>&lt;b&gt;<\/code> and <code>a &amp; b<\/code>/);
});

test("headings get GitHub's ids, repeats numbered, and are listed for the page's contents", () => {
  const { html, headings } = renderMarkdown('# Testing\n## What is not tested\n## Running `make test`\n## What is not tested', 'docs/TESTING.md', kind);
  assert.deepEqual(headings.map(h => h.id), ['testing', 'what-is-not-tested', 'running-make-test', 'what-is-not-tested-1']);
  assert.match(html, /<h2 id="what-is-not-tested-1" data-line="4">/);
});

test('each heading knows its line in the file, skipping code blocks and counting underlined headings', () => {
  const text = '# One\n\n```sh\n# not a heading\n```\n\nTwo\n---\n\n- a list\n\n---\n\n## Three';
  const { headings } = renderMarkdown(text, 'README.md', kind);
  assert.deepEqual(headings.map(h => [h.text, h.line]), [['One', 1], ['Two', 7], ['Three', 14]]);
});

test('slugs drop punctuation and keep letters from any language', () => {
  const s = slugger();
  assert.equal(s('24 September 2026, evening'), '24-september-2026-evening');
  assert.equal(s('Café & co.'), 'café--co');
});

test('a fenced code block is highlighted by its language', () => {
  assert.match(renderMarkdown('```js\nconst a = 1;\n```', 'README.md', kind).html, /<span class="hljs-keyword">const<\/span>/);
});

test('highlighted lines each close and reopen a span that runs over the line end', () => {
  assert.deepEqual(splitLines('a<span class="c">/* one\ntwo */</span>b\nc'), [
    'a<span class="c">/* one</span>',
    '<span class="c">two */</span>b',
    'c',
  ]);
  assert.deepEqual(splitLines('<span class="a"><span class="b">x\ny</span></span>'), [
    '<span class="a"><span class="b">x</span></span>',
    '<span class="a"><span class="b">y</span></span>',
  ]);
});

// A backlog item, frontmatter first, as docs/backlog/README.md describes one.
const ITEM = '---\ntype: bug\nasked: Jane, 27 Sep\nblocked-by: stamp-copies, one-word\nplan: docs/DATA.md\n---\n# A reward drawn twice\n\nText.\n';

test('frontmatter shows as properties, and its closing --- is not read as a heading underline', () => {
  const { html, headings } = renderMarkdown(ITEM, 'docs/backlog/next/redraw.md', kind);
  assert.match(html, /^<dl class="hq-props">/);
  assert.match(html, /<dt>Asked<\/dt><dd><span class="hq-person">Jane<\/span><span class="hint">27 Sep<\/span><\/dd>/);
  assert.deepEqual(headings.map(h => [h.text, h.line]), [['A reward drawn twice', 7]], 'one heading, on its line in the file');
  assert.doesNotMatch(html, /<h2/);
});

test('a backlog item\'s properties carry the board\'s chips: its type, the items blocking it, its plan and its stage', () => {
  const { html } = renderMarkdown(ITEM, 'docs/backlog/next/redraw.md', kind);
  assert.match(html, /<dt>Type<\/dt><dd><span class="bl-type" data-type="bug">Bug<\/span><\/dd>/);
  assert.match(html, /<a class="hq-refchip" href="\/backlog#stamp-copies">stamp-copies<\/a><a class="hq-refchip" href="\/backlog#one-word">one-word<\/a>/);
  assert.match(html, /<a href="\/code\/docs\/DATA\.md"><code>docs\/DATA\.md<\/code><\/a>/);
  assert.match(html, /<dt>Stage<\/dt><dd><span class="hq-stage">next<\/span><a class="hint" href="\/backlog#redraw">open on the board<\/a>/);
});

test('frontmatter outside the backlog is plain properties, with no backlog chips', () => {
  const { html } = renderMarkdown('---\nname: who-drew-is\ntype: user\n---\nText.\n', 'docs/notes.md', kind);
  assert.match(html, /<dt>Name<\/dt><dd>who-drew-is<\/dd><dt>Type<\/dt><dd>user<\/dd>/);
  assert.doesNotMatch(html, /bl-type|Stage/);
});

test('a --- that does not open the file is left to markdown', () => {
  assert.doesNotMatch(renderMarkdown('# Title\n\n---\n\nmore\n', 'README.md', kind).html, /hq-props/);
});

test('each second-level section is wrapped on its own, so its pinned heading leaves with it', () => {
  const html = renderMarkdown('# Title\n\nIntro.\n\n## One\n\nFirst.\n\n### One a\n\nMore.\n\n## Two\n\nSecond.\n', 'README.md', kind).html;
  const out = sectionsOf(html);
  assert.equal((out.match(/<section class="hq-sec">/g) || []).length, 2);
  assert.match(out, /^<h1[^]*Intro\.<\/p>\n<section class="hq-sec"><h2 id="one"[^]*One a[^]*<\/section><section class="hq-sec"><h2 id="two"[^]*Second\.<\/p>\n<\/section>$/);
});

test('a heading inside a quote or a list stays where it is', () => {
  const html = renderMarkdown('## Out\n\n> ## Quoted\n\n- item\n\n  ## Listed\n\n## After\n', 'README.md', kind).html;
  const out = sectionsOf(html);
  assert.equal((out.match(/<section class="hq-sec">/g) || []).length, 2, out);
  assert.match(out, /<blockquote>\n<h2 id="quoted"/);
});
