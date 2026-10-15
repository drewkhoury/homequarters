// Proves: the kinds of test (lib/layers.mjs) read from a layers file: which files each kind takes, a file named
// outright beating a pattern, and the kinds left out when the file is missing, on a copy of a real layers file in
// fixtures/hq-layers.json.
// Why: the Testing page's cards are one per kind; a file in the wrong kind is counted against the wrong promise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLayers, globMatch, layerOf, layersOf, filesOf, isPlanned } from '../lib/layers.mjs';
import { catalogue } from '../lib/catalogue.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = join(HERE, '..', '..');
const L = loadLayers(join(HERE, 'fixtures', 'hq-layers.json'));
const files = catalogue(REPO);

test('the file reads as layers and places, and a missing or broken file as nothing', () => {
  assert.deepEqual(L.layers.map(l => l.id), ['unit', 'rules', 'browser', 'walkthroughs', 'prod-smoke']);
  assert.deepEqual(L.places.map(p => p.id), ['laptop', 'container', 'ci']);
  assert.equal(loadLayers(join(HERE, 'fixtures', 'no-such-file.json')), null);
  assert.equal(loadLayers(join(REPO, 'package.json')), null, 'JSON with no layers');
});

test('a * stands for part of one name, never a folder', () => {
  assert.equal(globMatch('tests/smoke-*.js', 'tests/smoke-sync.js'), true);
  assert.equal(globMatch('tests/smoke-*.js', 'tests/unit/smoke-x.js'), false);
  assert.equal(globMatch('tests/unit/*.test.mjs', 'tests/unit/contract.test.mjs'), true);
  assert.equal(globMatch('tests/load-check.js', 'tests/load-checkXjs'), false, 'a dot is a dot');
});

test('each test file lands in its kind, and a file named outright beats a pattern', () => {
  const kind = p => (layerOf(L.layers, p) || {}).id;
  assert.equal(kind('tests/smoke-sync.js'), 'browser');
  assert.equal(kind('tests/load-check.js'), 'browser');
  assert.equal(kind('tests/walk-world.js'), 'walkthroughs');
  assert.equal(kind('tests/unit/world-walker.test.mjs'), 'unit');
  assert.equal(kind('tests/rules.test.js'), 'rules');
  assert.deepEqual(layersOf(L.layers, 'tests/unit/contract.test.mjs').map(l => l.id), ['unit', 'rules']);
  assert.equal(kind('tests/unit/contract.test.mjs'), 'rules');
  assert.equal(layerOf(L.layers, 'tests/helpers.js'), null);
});

test("every test the Makefile runs has a kind, and a planned kind has no files", () => {
  // the repo's own tests against the repo's own layers file, which has landed; the fixture is older than some tests
  const live = loadLayers(join(REPO, 'tests', 'layers.json'));
  for (const f of files.filter(x => x.set !== 'helper')) assert.ok(layerOf(live.layers, f.path), f.path);
  const smoke = L.layers.find(l => l.id === 'prod-smoke');
  assert.equal(isPlanned(smoke), true);
  assert.deepEqual(filesOf(smoke, files), []);
  assert.equal(isPlanned(L.layers[0]), false);
});
