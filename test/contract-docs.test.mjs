// Proves: the contract's docs name what the code does. docs/standards/cli.md has a section for every command bin/hq.mjs
// takes and names every HQ_ environment name the package reads; plugins.md lists exactly the members of the ui object
// lib/ui-api.mjs hands a plugin; and contract.md links each of the five surfaces to a doc and a test that exist.
// Why: a project builds against the docs, not the code. A command, an environment name or a ui member the code gains
// without its doc is a promise nobody can see; one the doc keeps after the code drops it is a broken promise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ui } from '../lib/ui-api.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const doc = p => (existsSync(join(ROOT, p)) ? read(p) : '');

// The package's own code: every .mjs outside test/ and node_modules/.
function sources(dir = ROOT) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (['node_modules', 'test', '.git'].includes(n)) return [];
    return statSync(p).isDirectory() ? sources(p) : n.endsWith('.mjs') ? [p] : [];
  });
}

test('cli.md has a section for every command bin/hq.mjs takes, and no other', () => {
  const bin = read('bin/hq.mjs');
  const commands = [...new Set([...bin.matchAll(/cmd === '([a-z-]+)'/g)].map(m => m[1]))].filter(c => !['help', 'version'].includes(c)).sort();
  const sections = [...doc('docs/standards/cli.md').matchAll(/^## `hq ([a-z-]+)/gm)].map(m => m[1]).sort();
  assert.deepEqual(sections, commands);
});

test('cli.md names every HQ_ environment name the package reads', () => {
  const cli = doc('docs/standards/cli.md');
  const names = new Set(sources().flatMap(f => [...readFileSync(f, 'utf8').matchAll(/\b(HQ_[A-Z][A-Z0-9_]*)\b/g)].map(m => m[1])));
  const missing = [...names].filter(n => !cli.includes(`\`${n}\``)).sort();
  assert.deepEqual(missing, []);
});

test('plugins.md lists exactly the members of the ui object', () => {
  const plugins = doc('docs/standards/plugins.md');
  const section = plugins.slice(plugins.indexOf('## The ui object'), plugins.indexOf('\n## ', plugins.indexOf('## The ui object') + 5));
  const listed = [...section.matchAll(/^\| `([A-Za-z_]+)/gm)].map(m => m[1]).sort();
  assert.deepEqual(listed, Object.keys(ui).sort());
});

test('contract.md links each of the five surfaces to a doc and a test that exist', () => {
  const contract = doc('docs/standards/contract.md');
  const table = contract.slice(contract.indexOf('## The five surfaces'), contract.indexOf('\n## ', contract.indexOf('## The five surfaces') + 5));
  const rows = table.split('\n').filter(l => /^\| \d/.test(l));
  assert.equal(rows.length, 5, 'five rows');
  for (const row of rows) {
    const links = [...row.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
    assert.ok(links.some(l => l.endsWith('.md')), `${row}: links a doc`);
    assert.ok(links.some(l => l.includes('test/')), `${row}: links a test`);
    for (const l of links) assert.ok(existsSync(join(ROOT, 'docs', 'standards', l)), `${row}: ${l} exists`);
  }
});
