// Proves: a laptop-runner job's results land in the laptop's CI store the moment the job ends, in the folder make
// ci-history would later fetch them into (scripts/ci-keep.mjs), so HQ and the problem register read a CI red the day it
// happens. A copy never overwrites a folder already kept, and never keeps results without the run.json HQ reads them by.
// Why: CI never records to the run store (the Makefile turns devpipe off under CI), so CI's results reached the laptop
// only when someone ran make dora or make ci-history, up to 3 h 20 later, and the nightly load job's never did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { keep } from '../../../scripts/ci-keep.mjs';
import { allRuns } from '../../lib/runs.mjs';

// a job's results folder as the workflows leave it: run.json from tests/run-info.mjs and a JUnit file per task
const results = (meta = { kind: 'load', where: 'ci', who: 'ci', branch: 'main', commit: '3f21a4b7', run: '38153884477', attempt: '1', at: '2026-10-11T16:32:00Z' }) => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-keep-results-'));
  if (meta) writeFileSync(join(dir, 'run.json'), JSON.stringify(meta));
  writeFileSync(join(dir, 'unit.xml'), '<testsuite name="unit"><testcase name="the Problems list puts the newest first" classname="unit" time="1.25"><failure message="false"/></testcase></testsuite>');
  return dir;
};

test("a job's results are kept under the artifact's own name, where make ci-history keeps them", () => {
  const ci = mkdtempSync(join(tmpdir(), 'ci-keep-store-'));
  const r = keep(results(), 'junit-38153884477-1-load', ci);
  assert.deepEqual(r, { kept: join(ci, 'junit-38153884477-1-load') });
  assert.deepEqual(readdirSync(r.kept).sort(), ['run.json', 'unit.xml']);
});

test('a folder already kept is left as it is, so make ci-history and a rerun of the step agree', () => {
  const ci = mkdtempSync(join(tmpdir(), 'ci-keep-store-'));
  mkdirSync(join(ci, 'junit-1-1-gate'));
  writeFileSync(join(ci, 'junit-1-1-gate', 'run.json'), '{"first":true}');
  assert.match(keep(results(), 'junit-1-1-gate', ci).skipped, /already kept/);
  assert.equal(readFileSync(join(ci, 'junit-1-1-gate', 'run.json'), 'utf8'), '{"first":true}');
});

test('a name HQ would not read, or results without their run.json, are not kept', () => {
  const ci = mkdtempSync(join(tmpdir(), 'ci-keep-store-'));
  assert.match(keep(results(), 'two-cores-38153884477-1', ci).skipped, /not a name HQ reads/);
  assert.match(keep(results(), 'junit-1-1-gate/../../x', ci).skipped, /not a name HQ reads/);
  assert.match(keep(results(null), 'junit-2-1-gate', ci).skipped, /no run\.json/);
  assert.match(keep(join(ci, 'nowhere'), 'junit-3-1-gate', ci).skipped, /no results/);
  assert.equal(existsSync(join(ci, 'junit-2-1-gate')), false);
});

test("HQ reads the nightly load job's kept results as a CI run of its own kind", () => {
  const cache = mkdtempSync(join(tmpdir(), 'ci-keep-cache-'));
  keep(results(), 'junit-38153884477-1-load', join(cache, 'ci'));
  const [run] = allRuns(cache).filter(r => r.source === 'ci');
  assert.equal(run.id, 'junit-38153884477-1-load');
  assert.equal(run.info.kind, 'load', 'never read as a gate run, so the gate figures stay its own');
  assert.deepEqual(run.tasks.map(t => [t.id, t.status]), [['unit', 'fail']]);
});
