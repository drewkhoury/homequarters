// Proves: HQ's reading of the recorded runs answers what 0.3.0's did, on a store holding the shapes devpipe, the
// Makefile and CI write: the runs, the flakes, each test file's results and the Problems page's results, cold and warm.
// Why: the run store reads each run once and keeps it, so every page that says "the last run passed" must still say
// what the old reading said. test/fixtures/runs-store/expected.json is 0.3.0's answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStore, answersOf } from './run-fixtures.mjs';

const EXPECTED = JSON.parse(readFileSync(new URL('./fixtures/runs-store/expected.json', import.meta.url), 'utf8'));

test("the runs, flakes and results read from the store are 0.3.0's, read cold and read again", () => {
  const s = buildStore();
  try {
    assert.deepEqual(answersOf(s), EXPECTED, 'cold');
    assert.deepEqual(answersOf(s), EXPECTED, 'warm');
  } finally { s.done(); }
});
