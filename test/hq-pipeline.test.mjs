// Proves: the pipeline (lib/pipeline.mjs, pages/pipeline.mjs): which run stands for a step's last result, and the
// full drawing of a small pipeline file written in the test. Whether a project's own pipeline file names real sets
// and tests is hq check's.
// Why: the Testing page's picture of how a change reaches production is read at a glance; a step with the wrong
// result misleads at a glance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastResult, allSteps } from '../lib/pipeline.mjs';
import { pipelineSvg, wrapText } from '../pages/pipeline.mjs';

// Two paths: a pull request's steps, one of them in two parts, and a merge's, one of them not built yet.
const PIPELINE = { paths: [
  { title: 'A pull request', steps: [
    { title: 'Unit tests', layers: ['unit'], results: [{ where: 'laptop', task: 'unit' }] },
    { title: 'The gate', sets: ['gate'], results: [{ where: 'container', task: 'docker-gate' }], parts: [{ title: 'Lane one', tests: ['smoke-sync'] }, { title: 'Lane two', tests: ['smoke-reject'] }] },
  ] },
  { title: 'A merge to main', steps: [
    { title: 'Deploy', what: 'The served files go to Hosting.' },
    { title: 'Live check', planned: 'prod-smoke' },
  ] },
] };
const FILES = [{ path: 'tests/smoke-sync.js', name: 'smoke-sync', set: 'gate' }, { path: 'tests/smoke-reject.js', name: 'smoke-reject', set: 'gate' }, { path: 'tests/unit/day.test.mjs', name: 'day', set: 'unit' }];

test('every step and part is listed flat, so a part is checked like a step', () => {
  assert.deepEqual(allSteps(PIPELINE).map(s => s.title), ['Unit tests', 'The gate', 'Lane one', 'Lane two', 'Deploy', 'Live check']);
});

test('a result comes from the newest run in that place that ran that task', () => {
  const run = (id, where, task, status) => ({ id, info: { where }, tasks: [{ id: task, status, seconds: 1 }] });
  const runs = [run('3', 'laptop', 'gate', 'pass'), run('2', 'ci', 'gate', 'fail'), run('1', 'ci', 'gate', 'pass')];
  assert.equal(lastResult(runs, { where: 'ci', task: 'gate' }).run.id, '2');
  assert.equal(lastResult(runs, { where: 'container', task: 'docker-gate' }), null);
});

test('a run of only some of a set\'s tests is not the set\'s result, and a full run is', () => {
  const run = (id, task, partial) => ({ id, info: { where: 'container', ...(partial ? { partial } : {}) }, tasks: [{ id: task, status: 'pass', seconds: 1 }] });
  const runs = [run('3', 'docker-gate', true), run('2', 'docker-gate'), run('1', 'docker-gate', true)];
  assert.equal(lastResult(runs, { where: 'container', task: 'docker-gate' }).run.id, '2');
  assert.equal(lastResult([run('1', 'docker-gate', true)], { where: 'container', task: 'docker-gate' }), null);
  assert.equal(lastResult([run('1', 'unit', true)], { where: 'container', task: 'unit' }).run.id, '1', 'a partial run still counts for unit');
});

test('the full drawing has a box for every step, in a row per path, none overlapping', () => {
  const { boxes, width, height, svg } = pipelineSvg(PIPELINE, FILES, [], { where: '', branch: '' });
  assert.equal(boxes.length, PIPELINE.paths.reduce((n, p) => n + p.steps.length, 0));
  for (const a of boxes) for (const b of boxes) {
    if (a === b) continue;
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    assert.ok(apart, `${a.title} and ${b.title} overlap`);
  }
  for (const b of boxes) assert.ok(b.x + b.w <= width && b.y + b.h <= height, `${b.title} is inside the drawing`);
  assert.equal((svg.match(/class="box planned"/g) || []).length, boxes.filter(b => b.planned).length);
  assert.equal(boxes.filter(b => b.planned).length, 1, 'the one step not built yet is drawn as planned');
  assert.deepEqual(wrapText('one two three four', 9), ['one two', 'three', 'four']);
});
