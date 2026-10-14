// hq/pipeline.json is the one place the Pipeline page's picture is described. It must name only test sets and tests
// the Makefile and tests/ really have, or the page would quietly show a step with nothing in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPipeline, allSteps, lastResult } from '../lib/pipeline.mjs';
import { makeSets, catalogue } from '../lib/catalogue.mjs';
import { loadItems } from '../lib/backlog.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pipeline = loadPipeline(REPO);
const sets = makeSets(readFileSync(join(REPO, 'Makefile'), 'utf8'));
const files = catalogue(REPO);

test('every set a step names is a set of tests that exists', () => {
  const known = new Set([...Object.keys(sets), ...files.map(f => f.set)]);
  for (const s of allSteps(pipeline)) for (const set of s.sets || []) {
    assert.ok(known.has(set), `${s.title} names the set ${set}`);
    assert.ok(files.some(f => f.set === set), `${s.title}: no test files in ${set}`);
  }
});

test("every test a step names is in one of the Makefile's sets", () => {
  const inMakefile = new Set(Object.values(sets).flat());
  for (const s of allSteps(pipeline)) for (const name of s.tests || []) assert.ok(inMakefile.has(name), `${s.title} names ${name}`);
});

test("the gate and long-set steps cover the Makefile's gate and after sets, so no browser test is missing from the picture", () => {
  const named = new Set(allSteps(pipeline).flatMap(s => [...(s.sets || []), ...(s.tests || [])]));
  for (const set of Object.keys(sets)) assert.ok(named.has(set) || sets[set].every(t => named.has(t)), `the ${set} set is on no step`);
});

test('every step has a title, and a planned step names a backlog item that is still open', () => {
  const open = new Set(loadItems(REPO).map(i => i.slug));
  for (const s of allSteps(pipeline)) {
    assert.ok(s.title, JSON.stringify(s));
    if ('planned' in s) assert.ok(open.has(s.planned), `${s.title}: planned names ${s.planned}, which is not in docs/backlog/ (shipped? then the step is built)`);
  }
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

test('the full drawing has a box for every step, in a row per path, none overlapping', async () => {
  const { pipelineSvg, wrapText } = await import('../pages/pipeline.mjs');
  const { boxes, width, height, svg } = pipelineSvg(pipeline, files, [], { where: '', branch: '' });
  assert.equal(boxes.length, pipeline.paths.reduce((n, p) => n + p.steps.length, 0));
  for (const a of boxes) for (const b of boxes) {
    if (a === b) continue;
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    assert.ok(apart, `${a.title} and ${b.title} overlap`);
  }
  for (const b of boxes) assert.ok(b.x + b.w <= width && b.y + b.h <= height, `${b.title} is inside the drawing`);
  assert.equal((svg.match(/class="box planned"/g) || []).length, boxes.filter(b => b.planned).length);
  assert.deepEqual(wrapText('one two three four', 9), ['one two', 'three', 'four']);
});

test('every kind of test a step names is in tests/layers.json (or, until it lands, the copy the layer tests use)', async () => {
  const { loadLayers, layersPath } = await import('../lib/layers.mjs');
  const L = loadLayers(layersPath(REPO)) || loadLayers(join(REPO, 'tests', 'unit', 'fixtures', 'hq-layers.json'));
  const ids = new Set(L.layers.map(l => l.id));
  for (const s of allSteps(pipeline)) for (const id of s.layers || []) assert.ok(ids.has(id), `${s.title} names ${id}`);
});
