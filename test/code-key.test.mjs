// Proves: a module's code key changes when its own text or any module it imports, however deep, changes, and stays the
// same when a module it does not import changes. Why: HQ's saved indexes are kept across upgrades by this key, so a
// release that changes how a run or its causes are read must start them again, and one that does not must not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { codeKey } from '../lib/code-key.mjs';

test('the code key follows a module and everything it imports, and nothing else', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-code-key-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (name, text) => writeFileSync(join(dir, name), text);
  put('reader.mjs', "import { parse } from './parse.mjs';\nimport { join } from 'node:path';\nexport const read = s => parse(s);\n");
  put('parse.mjs', "export { words } from './words.mjs';\nexport const parse = s => s.split(',');\n");
  put('words.mjs', 'export const words = s => s.split(" ");\n');
  put('page.mjs', 'export const page = () => "<p>";\n');
  const key = () => codeKey(pathToFileURL(join(dir, 'reader.mjs')));
  const before = key();
  assert.match(before, /^[0-9a-f]{40}$/);
  assert.equal(key(), before, 'the same code, the same key');
  put('page.mjs', 'export const page = () => "<div>";\n');
  assert.equal(key(), before, 'a module it does not import');
  put('words.mjs', 'export const words = s => s.split(/\\s+/);\n');
  const deep = key();
  assert.notEqual(deep, before, 'a module two imports down');
  put('reader.mjs', "import { parse } from './parse.mjs';\nimport { join } from 'node:path';\nexport const read = s => parse(s.trim());\n");
  assert.notEqual(key(), deep, 'its own text');
});
