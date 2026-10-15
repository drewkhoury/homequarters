// Proves: the test sets come from the file hq.json names under tests.sets, with a Makefile's GATE and AFTER lines read
// only when no file is named, and hq setup proposes that file from such a Makefile. Why: Testing and the live-run page
// parsed `GATE :=` out of a Makefile, which only QuestKeep's has (Nell); a project says its sets in one small file instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSets, makeSets, testSets, configureSets, proposeSets, SETS_V } from '../lib/sets.mjs';

const MAKEFILE = 'GATE    := load-check smoke-stamps \nAFTER   := walk-universe walk-world\n\ntest:\n\tnode tests/x.js\n';

test('a sets file names each set\'s tests; a set that is not a list of names is left out with a warning', () => {
  const { sets, warnings } = parseSets(JSON.stringify({ schema: 1, sets: { gate: ['smoke-sync', 'smoke-sync', 'load-check'], after: ['walk-world'], 'Bad Name': ['x'], unit: 'all' } }));
  assert.deepEqual(sets, { gate: ['smoke-sync', 'load-check'], after: ['walk-world'] });
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some(w => w.includes('"Bad Name"')));
  assert.ok(warnings.some(w => w.includes('set "unit" should be a list')));
});

test('a file that is not JSON, not an object, or has no sets key gives no sets and says why; a newer schema is read with a warning', () => {
  assert.deepEqual(parseSets('nope').warnings, ['tests.sets: not JSON']);
  assert.deepEqual(parseSets('[]').warnings, ['tests.sets: should be an object with a sets key']);
  assert.deepEqual(parseSets('{"schema":1}').warnings, ['tests.sets: no sets key']);
  const r = parseSets(JSON.stringify({ schema: SETS_V + 1, sets: { gate: ['a'] } }));
  assert.deepEqual(r.sets, { gate: ['a'] });
  assert.ok(r.warnings[0].includes('newer than this HQ'));
});

test('a Makefile\'s GATE and AFTER lines are read as sets, as QuestKeep kept them', () => {
  assert.deepEqual(makeSets(MAKEFILE), { gate: ['load-check', 'smoke-stamps'], after: ['walk-universe', 'walk-world'] });
  assert.deepEqual(makeSets('test:\n\tnode x\n'), {});
});

test('the configured file wins over a Makefile; without one the Makefile is read; without either there are no sets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-sets-'));
  writeFileSync(join(dir, 'Makefile'), MAKEFILE);
  mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'tests', 'sets.json'), JSON.stringify({ schema: 1, sets: { gate: ['from-file'] } }));
  configureSets({ file: join(dir, 'tests', 'sets.json') });
  assert.deepEqual(testSets(dir), { gate: ['from-file'] });
  configureSets({ file: join(dir, 'tests', 'missing.json') });
  assert.deepEqual(testSets(dir), {}, 'a named file that is not there gives no sets, never the Makefile\'s');
  configureSets();
  assert.deepEqual(testSets(dir), { gate: ['load-check', 'smoke-stamps'], after: ['walk-universe', 'walk-world'] });
  const bare = mkdtempSync(join(tmpdir(), 'hq-sets-bare-'));
  assert.deepEqual(testSets(bare), {});
  rmSync(dir, { recursive: true, force: true }); rmSync(bare, { recursive: true, force: true });
});

test('hq setup proposes the sets file from a Makefile\'s lines, and nothing from a Makefile without them', () => {
  assert.deepEqual(proposeSets(MAKEFILE), { schema: SETS_V, sets: { gate: ['load-check', 'smoke-stamps'], after: ['walk-universe', 'walk-world'] } });
  assert.equal(proposeSets('test:\n\tnode x\n'), null);
});

test('a set with a name that is not a test name is left out and said, and a file holding null is a warning, not a crash', () => {
  const r = parseSets(JSON.stringify({ schema: 1, sets: { gate: ['smoke-sync', 'not a name'], after: ['walk-world'] } }));
  assert.deepEqual(r.sets, { after: ['walk-world'] });
  assert.ok(r.warnings.some(w => /set "gate" should be a list of test names/.test(w)));
  assert.deepEqual(parseSets('null').sets, {});
  assert.match(parseSets('null').warnings[0], /should be an object/);
});
