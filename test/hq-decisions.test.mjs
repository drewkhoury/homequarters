// HQ's Decisions page (hq/lib/decisions.mjs, hq/pages/decisions.mjs): the frozen lines of docs/DECISIONS.md and the
// files in docs/decisions/ read into rows, the rules a file keeps to, and the page drawn from them. The data is
// tests/unit/fixtures/decisions/, a small repo of its own: a DECISIONS.md of three lines (one whose title names a date,
// one that is partly superseded in a sentence, one dated in October) and four files, two on the same day and one
// wholly superseded by a later one whose own text is partly superseded. The page is drawn from a copy of it in a
// temporary folder, never from the real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFrozen, parseDecision, loadDecisions, check } from '../lib/decisions.mjs';
import { decisionsPage } from '../pages/decisions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'decisions');
const BLUE = '2026-10-03-biscuits-in-the-blue-tin.md', RED = '2026-10-09-biscuits-in-the-red-tin.md';
const CUPS = '2026-10-05-cups-on-hooks.md', MILK = '2026-10-05-milk-in-the-door.md';

// a copy of the fixture repo to change freely, removed when the test ends
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'qk-decisions-'));
  cpSync(FIXTURE, dir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const file = (name, { date = name.slice(0, 10), title = 'A decision', body = 'Why.', extra = '' } = {}) =>
  parseDecision(`---\n${date ? `date: ${date}\n` : ''}${extra}---\n${title ? `# ${title}\n\n` : ''}${body}\n`, name);

test('a frozen line gives its title from the bold, and a date only when the title ends in one', () => {
  const lines = parseFrozen(readFileSync(join(FIXTURE, 'docs', 'DECISIONS.md'), 'utf8'));
  assert.deepEqual(lines.map(l => [l.title, l.date]), [
    ['Tea before coffee', ''],
    ['The shed is painted green', '2026-09-30'],
    ['Coffee on Saturdays', '2026-10-01'],
  ]);
  assert.equal(lines[1].body, 'Green hides the moss, which `paint.json` lists.');
  // a date inside a title is not when it was decided, so it gives none
  assert.equal(parseFrozen('## September 2026\n\n- **`make hq-probe` (named `hq-look` until 29 September) is the way.** Body.')[0].date, '');
  assert.equal(parseFrozen('- **Under no heading (30 September).** Body.')[0].date, '', 'no heading, no year, no date');
});

test('a decision file gives its date, what replaced it, its title and its body', () => {
  const d = parseDecision(readFileSync(join(FIXTURE, 'docs', 'decisions', BLUE), 'utf8'), BLUE);
  assert.deepEqual([d.date, d.supersededBy, d.title], ['2026-10-03', RED, 'Biscuits live in the blue tin']);
  assert.equal(d.body, 'The blue tin has the tighter lid. Would change if the lid broke.');
  assert.equal(d.path, `docs/decisions/${BLUE}`);
});

test('the files come newest first, a day\'s files by name, and then the frozen lines in file order', () => {
  const { files, frozen } = loadDecisions(FIXTURE);
  assert.deepEqual(files.map(f => f.name), [RED, CUPS, MILK, BLUE]);
  assert.deepEqual(frozen.map(l => l.title), ['Tea before coffee', 'The shed is painted green', 'Coffee on Saturdays']);
});

test('a new decision is one new file: it is listed with no other file changed', t => {
  const dir = scratch(t);
  const before = Object.fromEntries(readdirSync(join(dir, 'docs', 'decisions')).map(f => [f, readFileSync(join(dir, 'docs', 'decisions', f), 'utf8')]));
  const old = readFileSync(join(dir, 'docs', 'DECISIONS.md'), 'utf8');
  writeFileSync(join(dir, 'docs', 'decisions', '2026-10-11-spoons-in-the-drawer.md'), '---\ndate: 2026-10-11\n---\n# Spoons go in the drawer\n\nThe hooks are full.\n');
  const { files, frozen } = loadDecisions(dir);
  assert.deepEqual(files.map(f => f.name), ['2026-10-11-spoons-in-the-drawer.md', RED, CUPS, MILK, BLUE]);
  assert.equal(frozen.length, 3);
  for (const [f, text] of Object.entries(before)) assert.equal(readFileSync(join(dir, 'docs', 'decisions', f), 'utf8'), text, f);
  assert.equal(readFileSync(join(dir, 'docs', 'DECISIONS.md'), 'utf8'), old);
  assert.deepEqual(check(files), []);
});

test('the fixture keeps to the rules, and each rule a file can break is named', () => {
  assert.deepEqual(check(loadDecisions(FIXTURE).files), []);
  const problems = files => check(files).join('\n');
  assert.match(problems([file('decision-about-tea.md', { date: '2026-10-05' })]), /decision-about-tea\.md: the name is not <yyyy-mm-dd>-<slug>\.md/);
  assert.match(problems([file('2026-10-05-Tea.md')]), /the name is not/, 'the slug is lower case');
  assert.match(problems([file('2026-10-05-tea.md', { date: '' })]), /2026-10-05-tea\.md: no date/);
  assert.match(problems([file('2026-10-05-tea.md', { date: '2026-10-06' })]), /date is 2026-10-06, but the name says 2026-10-05/);
  assert.match(problems([file('2026-02-30-tea.md', { date: '2026-02-30' })]), /2026-02-30 is not a date/);
  assert.match(problems([file('2026-10-05-tea.md', { title: '' })]), /no # title/);
  const by = to => file('2026-10-05-tea.md', { extra: `superseded-by: ${to}\n` });
  assert.match(problems([by('2026-10-09-coffee.md')]), /superseded by 2026-10-09-coffee\.md, which is not a file in docs\/decisions/);
  assert.match(problems([by('2026-10-05-tea.md')]), /superseded by itself/);
  assert.match(problems([by('2026-10-01-coffee.md'), file('2026-10-01-coffee.md')]), /superseded by 2026-10-01-coffee\.md, which is dated earlier/);
  assert.deepEqual(check([by('2026-10-05-coffee.md'), file('2026-10-05-coffee.md')]), [], 'a replacement from the same day is fine');
});

const page = (repo, params = '') => decisionsPage({ repo, cache: null }, new URLSearchParams(params));
// each table row's HTML, in the order the page draws them
const rowsOf = html => [...html.matchAll(/<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*<\/tr>/g)].map(m => m[0]).filter(r => !r.includes('<th'));

test('the page: Decisions in the header, one table, the files newest first and then the frozen lines', t => {
  const html = page(scratch(t));
  assert.match(html, /<a href="\/decisions" class="on" aria-current="page">Decisions<\/a>/);
  // one search and one count over every decision, so a search finds a frozen line as readily as a file
  assert.equal(html.match(/class="input hq-dt-search"/g)?.length, 1, 'one search box on the page');
  assert.equal(html.match(/<table\b/g)?.length, 1, 'one table on the page');
  // where each title is drawn as a link; a title can also appear in another row's text
  const at = s => { const i = html.indexOf(`>${s}</a>`); assert.ok(i > 0, `${s} is on the page`); return i; };
  const order = ['Biscuits move to the red tin', 'Cups hang on hooks', 'Milk goes in the fridge door', 'Biscuits live in the blue tin',
    'Tea before coffee', 'The shed is painted green', 'Coffee on Saturdays'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  const rows = rowsOf(html), row = title => rows.find(r => r.includes(`>${title}</a>`));
  assert.match(row('Cups hang on hooks'), /<td data-col="part"[^>]*><span class="hq-cell">From 2 Oct 2026<\/span><\/td>/, 'a file says which part of the log it is in');
  assert.match(row('Coffee on Saturdays'), /<td data-col="part"[^>]*><span class="hq-cell">To 2 Oct 2026<\/span><\/td>/, 'and so does a frozen line');
  assert.match(html, /href="\/code\/docs\/decisions\/2026-10-05-cups-on-hooks\.md"/, 'a file links to itself');
  assert.match(html, /<code>hooks\.txt<\/code>/, 'code in the text is drawn as code');
  assert.match(row('The shed is painted green'), /data-v="2026-09-30"/, 'a frozen line whose title names a date shows it');
  assert.match(row('Tea before coffee'), /<span class="hint">none<\/span>/, 'and one whose title does not shows none');
  // on a narrow screen a cell is a grid of its label and its value, so the text must be one element, or each run of
  // text and each <code> becomes a grid cell of its own; the table wraps every cell so (hq-ui.test.mjs)
  for (const r of rows.filter(r => r.includes('data-col="text"'))) assert.match(r, /<td data-col="text"[^>]*><span class="hq-cell">(?:(?!<\/td>)[\s\S])*<\/span><\/td>/);
});

test('the page dims a decision replaced whole and links to what replaced it; a partial replacement is not dimmed', t => {
  const rows = rowsOf(page(scratch(t)));
  const blue = rows.find(r => r.includes('Biscuits live in the blue tin'));
  assert.match(blue, /^<tr class="dc-superseded"/);
  assert.match(blue, /Superseded by <a href="\/code\/docs\/decisions\/2026-10-09-biscuits-in-the-red-tin\.md">Biscuits move to the red tin<\/a>/);
  for (const title of ['Biscuits move to the red tin', 'Tea before coffee', 'Cups hang on hooks']) assert.doesNotMatch(rows.find(r => r.includes(title)), /dc-superseded/, title);
});

test('the page names a file that breaks the rules, as the Backlog does', t => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'docs', 'decisions', 'notes.md'), '# Notes\n');
  assert.match(page(dir), /notes\.md: the name is not/);
  assert.doesNotMatch(page(FIXTURE), /break the rules/);
});

test('the page from a repo with no decision files yet still lists the frozen lines', t => {
  const dir = scratch(t);
  rmSync(join(dir, 'docs', 'decisions'), { recursive: true });
  const html = page(dir);
  assert.match(html, /No decision files yet/);
  assert.match(html, />Coffee on Saturdays<\/a>/);
});

// Both are FAST in .githooks/pre-push, which runs no git: neither the reader nor the page may reach a module that
// starts a program, however far down its imports.
test('the reader and the page start no program, so the page needs no git', () => {
  const seen = new Set(), reached = [];
  const walk = path => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const [, spec] of readFileSync(path, 'utf8').matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)) {
      if (spec.startsWith('.')) walk(join(dirname(path), spec));
      else reached.push(spec);
    }
  };
  walk(join(HERE, '..', '..', 'hq', 'pages', 'decisions.mjs'));
  assert.ok(seen.has(join(HERE, '..', '..', 'hq', 'lib', 'decisions.mjs')));
  assert.deepEqual(reached.filter(s => /child_process/.test(s)), []);
});
