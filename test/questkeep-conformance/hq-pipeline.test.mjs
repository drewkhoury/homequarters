// QuestKeep's hq/pipeline.json is the one place the Pipeline page's picture is described. It must name only test sets
// and tests the Makefile and tests/ really have, or the page would quietly show a step with nothing in it. These read the
// real repo: its Makefile, its pipeline file, its backlog and its layers file. The pure tests of lib/pipeline.mjs and the
// drawing stay in test/hq-pipeline.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPipeline, allSteps } from '../../lib/pipeline.mjs';
import { makeSets, catalogue } from '../../lib/catalogue.mjs';
import { loadItems } from '../../lib/backlog.mjs';
import { loadLayers } from '../../lib/layers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pipeline = loadPipeline(join(REPO, 'hq', 'pipeline.json'));
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

test('every kind of test a step names is in tests/layers.json (or, until it lands, the copy the layer tests use)', () => {
  const L = loadLayers(join(REPO, 'tests', 'layers.json')) || loadLayers(join(REPO, 'tests', 'unit', 'fixtures', 'hq-layers.json'));
  const ids = new Set(L.layers.map(l => l.id));
  for (const s of allSteps(pipeline)) for (const id of s.layers || []) assert.ok(ids.has(id), `${s.title} names ${id}`);
});
