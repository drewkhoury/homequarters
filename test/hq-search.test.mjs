// Proves: search, done in node with no grep: plain text in any case, long lines cut around the match, a cap on how
// much comes back, and the open-in-editor link the code viewer puts on every line.
// Why: search is the way into a large repo; an uncapped answer or a missed case is a page that never loads or never
// finds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findInText, searchAll } from '../lib/search.mjs';
import { editorLink } from '../lib/outside.mjs';

test('lines are matched in any case, with their line numbers and where the match starts', () => {
  assert.deepEqual(findInText('one\nClosedStream(m)\nthree closedstream', 'closedStream'), [
    { line: 2, text: 'ClosedStream(m)', at: 0 },
    { line: 3, text: 'three closedstream', at: 6 },
  ]);
});

test('what is typed is plain text, never a pattern', () => {
  assert.deepEqual(findInText('a.b\naxb', 'a.b').map(h => h.line), [1]);
  assert.deepEqual(findInText('x (y\n', '(y').map(h => h.at), [2]);
});

test('a long line is cut around the match and the match is still where `at` says', () => {
  const line = 'x'.repeat(1000) + 'NEEDLE' + 'y'.repeat(1000);
  const [h] = findInText(line, 'needle');
  assert.ok(h.text.length <= 242);
  assert.equal(h.text.slice(h.at, h.at + 6), 'NEEDLE');
});

test('a file gives at most its limit of lines', () => {
  assert.equal(findInText('hit\n'.repeat(100), 'hit', 30).length, 30);
});

test('code, docs and run logs are searched apart, and binary files and one-letter queries are skipped', () => {
  const base = mkdtempSync(join(tmpdir(), 'hq-search-'));
  try {
    const repo = join(base, 'repo'), cache = join(base, 'cache');
    mkdirSync(join(repo, 'web'), { recursive: true });
    mkdirSync(join(cache, 'runs', 'runs', 'r1', 'logs'), { recursive: true });
    writeFileSync(join(repo, 'web', 'sync.js'), 'const pushNow = 1;\n');
    writeFileSync(join(repo, 'README.md'), 'Call pushNow first.\n');
    writeFileSync(join(repo, 'web', 'pic.png'), Buffer.from([0x89, 0x50, 0, 0, 0x70, 0x75, 0x73, 0x68, 0x4e, 0x6f, 0x77]));
    writeFileSync(join(cache, 'runs', 'runs', 'r1', 'logs', 'gate.log'), '=== smoke-sync\npushNow refused\n');
    const all = searchAll({ repo, cache, q: 'pushnow' });
    assert.deepEqual(all.code.map(f => f.path), ['web/sync.js']);
    assert.deepEqual(all.docs.map(f => f.path), ['README.md']);
    assert.deepEqual(all.logs.map(f => [f.run, f.task, f.hits[0].line]), [['r1', 'gate', 2]]);
    assert.deepEqual(searchAll({ repo, cache, q: 'pushnow', scopes: ['logs'] }).code, []);
    assert.deepEqual(searchAll({ repo, cache, q: 'p' }).code, []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('the editor link carries the whole path and the line, on a Mac and on Windows', () => {
  assert.equal(editorLink('/Users/me/questkeep/web/app.js', 12, 'vscode://file/{path}:{line}'), 'vscode://file/Users/me/questkeep/web/app.js:12');
  assert.equal(editorLink('C:\\Users\\me\\questkeep\\web\\app.js', 3, 'vscode://file/{path}:{line}'), 'vscode://file/C:/Users/me/questkeep/web/app.js:3');
  assert.equal(editorLink('/Users/me/my repo/a.js', 1, 'cursor://file/{path}:{line}'), 'cursor://file/Users/me/my%20repo/a.js:1');
});
