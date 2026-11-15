// Proves: the register keeps test results only for the tests it reads them for, the fixed flaky tests it checks the
// fix of and the tests a page asks it for, and answers for those as before.
// Why: it made a record for each of QuestKeep's 2.8 million results, about 320 MB of heap held for as long as the run
// store stood, and read fewer than one in ten of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { readRegister } from '../lib/problem-register.mjs';
import { testResults } from '../lib/problem-derive.mjs';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc');
const heapMb = () => { gc(); gc(); return process.memoryUsage().heapUsed / 2 ** 20; };
const RUNS = 50, TESTS = 4000;
// fifty unit runs of four thousand passing tests on one clean commit: two hundred thousand results
const store = () => Array.from({ length: RUNS }, (_, i) => ({ id: `run-${i}`, source: 'laptop', when: `2026-11-01T10:${String(i).padStart(2, '0')}:00Z`,
  info: { kind: 'test', commit: 'c0ffee1', dirty: false }, ok: true,
  tasks: [{ id: 'unit', name: 'unit', status: 'pass', seconds: 1, log: null, cases: Array.from({ length: TESTS }, (_, t) => ({ name: `a quest is kept ${t}`, status: 'pass', seconds: 0.01 })) }] }));
const quiet = { lock: [], events: [], files: [], changes: [], cache: '/nonexistent-hq-cache', git: { entries: [], contains: () => null, fixTime: () => null } };

test('reading the register keeps nothing for the results of tests no entry is about', () => {
  const runs = store(), before = heapMb();
  const reg = readRegister({ ...quiet, runs });
  const grew = heapMb() - before;
  assert.equal(reg.sources.runs, RUNS);
  assert.ok(grew < 5, `the register kept ${grew.toFixed(1)} MB over ${RUNS * TESTS} results`);
});

test('the results asked for are the same records as before', () => {
  const runs = store(), keyOf = (task, name) => name;
  const one = testResults(runs, { keyOf, keep: ['a quest is kept 7'] });
  assert.deepEqual(Object.keys(one), ['a quest is kept 7']);
  assert.equal(one['a quest is kept 7'].length, RUNS);
  assert.deepEqual(one['a quest is kept 7'][0], { run: 'run-0', when: '2026-11-01T10:00:00Z', commit: 'c0ffee1', status: 'pass', full: true, kind: 'test', seconds: 0.01 });
  assert.deepEqual(one['a quest is kept 7'], testResults(runs, { keyOf })['a quest is kept 7'], 'as every result read');
});
