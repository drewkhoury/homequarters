// Proves: a test result HQ keeps from a JUnit file holds its own name, never the file it was read from, and one name
// seen in many runs is held once.
// Why: the run store keeps every result read. A name sliced from the file kept the whole file alive: about 980 MB of
// heap for QuestKeep's 3,611 runs and 2.8 million results, whose names are a few thousand tests repeated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { parseJunit } from '../lib/runs.mjs';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc');
const heapMb = () => { gc(); gc(); return process.memoryUsage().heapUsed / 2 ** 20; };
// a JUnit file of about 1 MB, most of it a test's own output, as a browser test's system-out is
const file = i => `<testsuites><testsuite><testcase name="the board folds past three quests" time="0.1"><system-out>${'x'.repeat(1 << 20)}${i}</system-out></testcase>`
  + `<testcase name="a quest &amp; its stamps" time="0.2"/></testsuite></testsuites>`;

test('the results read from twenty 1 MB files keep none of the files', () => {
  const kept = [], before = heapMb();
  for (let i = 0; i < 20; i++) kept.push(parseJunit(file(i)));
  const grew = heapMb() - before;
  assert.ok(grew < 4, `the heap kept ${grew.toFixed(1)} MB for ${kept.length} files' results`);
  assert.deepEqual(kept[19].map(c => c.name), ['the board folds past three quests', 'a quest & its stamps']);
});
