// Proves: hq.json is read as the brief says: a missing file gives the baseline, every key is optional, unknown keys and a
// newer schema warn and are left alone, lists take strings or objects, paths resolve from the repo or the home folder, and
// the name and cache follow their rules. Why: HQ cannot know which version of the manifest a project is on, so the reader
// has to be forgiving in exactly these ways and no others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveManifest, pagesFor, SCHEMA, DEFAULTS, defaultCache, nameFrom, loadManifest } from '../lib/manifest.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const repo = '/r/My Project', home = '/h', env = {};
const read = raw => resolveManifest(raw, { repo, home, env });

test('no manifest: the folder name made safe, a cache under ~/.cache/hq, and only the baseline pages', () => {
  const { m, warnings } = read(null);
  assert.equal(m.present, false);
  assert.equal(m.name, 'my-project');
  assert.equal(m.cache, '/h/.cache/hq/my-project');
  assert.deepEqual(Object.values(m.features), [false, false, false, false, false, false, false]);
  assert.deepEqual(pagesFor(m).map(p => p[0]), ['home', 'repo', 'machine', 'conversations', 'github', 'export']);
  assert.deepEqual(warnings, []);
});

test('XDG_CACHE_HOME moves the default cache', () => {
  assert.equal(defaultCache('x', { home, env: { XDG_CACHE_HOME: '/data/cache' } }), '/data/cache/hq/x');
  assert.equal(nameFrom('Quest Keep_2'), 'quest-keep-2');
});

test('every key is optional, and each one turns its page on', () => {
  const { m } = read({ schemaVersion: 1, name: 'app', backlog: { dir: 'docs/backlog' }, decisions: { dir: 'docs/decisions' }, stores: ['runs', 'dora', 'problems'], deploy: [{ provider: 'firebase-hosting', url: 'https://x' }] });
  assert.deepEqual(m.features, { backlog: true, decisions: true, testing: true, delivery: true, problems: true, deploys: true, info: false });
  assert.deepEqual(pagesFor(m).map(p => p[0]), ['home', 'repo', 'machine', 'testing', 'backlog', 'decisions', 'conversations', 'github', 'delivery', 'problems', 'export']);
  assert.equal(pagesFor(m).find(p => p[0] === 'github')[1], 'GitHub & Deploys');
});

test('paths resolve from the repo, from ~/, or as given when absolute', () => {
  const { m } = read({ schemaVersion: 1, name: 'app', cache: '~/.cache/app', decisions: { dir: 'docs/decisions', earlier: '/elsewhere/D.md' }, demo: 'hq/demo.json' });
  assert.equal(m.cache, '/h/.cache/app');
  assert.equal(m.decisions.dir, '/r/My Project/docs/decisions');
  assert.equal(m.decisions.earlier, '/elsewhere/D.md');
  assert.equal(m.demo, '/r/My Project/hq/demo.json');
  assert.equal(m.store('runs'), null, 'a store not named is off');
});

test('unknown keys, a newer schema and a bad name warn and are left alone; $schema is for editors', () => {
  const { m, warnings } = read({ $schema: 'https://x/1.json', schemaVersion: SCHEMA + 1, name: 'Bad Name', futureKey: 1 });
  assert.equal(m.schemaVersion, SCHEMA + 1);
  assert.equal(m.name, 'my-project');
  assert.ok(warnings.some(w => w.includes('newer than this HQ')));
  assert.ok(warnings.some(w => w.includes('"futureKey" is not a key')));
  assert.ok(warnings.some(w => w.includes('name "Bad Name" should match')));
  assert.ok(!warnings.some(w => w.includes('$schema')));
});

test('a manifest with no schemaVersion, or a wrong one, is read as the current schema with a warning', () => {
  assert.ok(read({ name: 'app' }).warnings.some(w => w.includes('no schemaVersion')));
  assert.ok(read({ schemaVersion: '1', name: 'app' }).warnings.some(w => w.includes('not a whole number')));
  assert.equal(read({ schemaVersion: 0, name: 'app' }).m.schemaVersion, SCHEMA);
});

test('lists take strings or objects: a string is the id, the path or the glob', () => {
  const { m, warnings } = read({ schemaVersion: 1, name: 'app',
    backlog: { dir: 'docs/backlog', stages: ['inbox', { id: 'next', title: 'Ready' }] },
    stores: ['runs', { id: 'ci', path: 'ci-results' }, 'nope', 7],
    plugins: ['./a.mjs', { path: './b.mjs', with: { checkout: '~/x' } }],
    tests: { headers: ['tests/*.js', { glob: 'spec/*.mjs', layer: 'unit' }] },
    info: true });
  assert.deepEqual(m.backlog.stages, ['inbox', 'next']);
  assert.equal(m.store('runs'), '/h/.cache/hq/app/runs');
  assert.equal(m.store('ci'), '/h/.cache/hq/app/ci-results', 'a store may say where it sits under the cache');
  assert.deepEqual(m.stores, ['runs', 'ci']);
  assert.ok(warnings.some(w => w.includes('store "nope"')));
  assert.ok(warnings.some(w => w.includes('"stores" item 4')));
  assert.deepEqual(m.plugins, [{ path: '/r/My Project/a.mjs', with: {} }, { path: '/r/My Project/b.mjs', with: { checkout: '~/x' } }]);
  assert.deepEqual(m.tests.headers, [{ glob: 'tests/*.js' }, { glob: 'spec/*.mjs', layer: 'unit' }]);
  assert.equal(m.info.file, '/r/My Project/.git/project-info.json');
});

test('deploy entries are keyed by env like project-info, with the provider\'s own fields under with', () => {
  const { m, warnings } = read({ schemaVersion: 1, name: 'app', deploy: [{ provider: 'firebase-hosting', site: 'https://a' }, { env: 'stg', provider: 'firebase-hosting', url: 'https://b', with: { project: 'p' } }, { url: 'https://c' }] });
  assert.deepEqual(m.deploy, [{ env: 'prod', provider: 'firebase-hosting', url: 'https://a', with: {} }, { env: 'stg', provider: 'firebase-hosting', url: 'https://b', with: { project: 'p' } }]);
  assert.ok(warnings.some(w => w.includes('deploy item 3 names no provider')));
});

test('a key of the wrong type is ignored with a warning, never a crash', () => {
  const { m, warnings } = read({ schemaVersion: 1, name: 'app', backlog: 'docs/backlog', stores: 'runs', delivery: { userPaths: 'web' } });
  assert.equal(m.backlog, null);
  assert.deepEqual(m.stores, []);
  assert.deepEqual(m.delivery.userPaths, []);
  assert.equal(warnings.filter(w => w.includes('should be')).length, 2);
});

test('the delivery key takes the deploy and test workflows and a time zone, and refuses a zone Intl does not know', () => {
  const { m, warnings } = read({ schemaVersion: 1, name: 'app', delivery: { userPaths: ['web'], deployWorkflow: '.github/workflows/ship.yml', testWorkflow: '.github/workflows/check.yml', tz: 'Australia/Melbourne' } });
  assert.deepEqual(m.delivery, { userPaths: ['web'], deployWorkflow: '.github/workflows/ship.yml', testWorkflow: '.github/workflows/check.yml', tz: 'Australia/Melbourne', gateJobs: null, deployJob: null, smokeJob: null, deploySteps: null, reuseSteps: null, testSteps: null });
  assert.deepEqual(warnings, []);
  const bad = read({ schemaVersion: 1, name: 'app', delivery: { tz: 'Mars/Olympus' } });
  assert.equal(bad.m.delivery.tz, null);
  assert.ok(bad.warnings.some(w => /delivery\.tz/.test(w)));
  assert.deepEqual(read({ schemaVersion: 1, name: 'app' }).m.delivery, DEFAULTS[SCHEMA].delivery, 'absent means the schema\'s defaults');
});

// ---- the adversary's survivors, 15 October ----
test('the Testing page follows the tests key alone, and the backlog and pipeline paths are the ones named', () => {
  const { m } = read({ schemaVersion: 1, name: 'app', tests: { layers: 'tests/layers.json', pipeline: 'ci/pipeline.json' }, backlog: { dir: 'work/items', stages: ['ideas', 'todo'] } });
  assert.equal(m.features.testing, true, 'layers and a pipeline make a Testing page without any store');
  assert.equal(m.tests.pipeline, join(repo, 'ci', 'pipeline.json'));
  assert.equal(m.tests.layers, join(repo, 'tests', 'layers.json'));
  assert.equal(m.backlog.dir, join(repo, 'work', 'items')); assert.equal(m.backlog.rel, 'work/items');
  assert.deepEqual(m.backlog.stages, ['ideas', 'todo']);
  assert.deepEqual(read({ schemaVersion: 1, name: 'app', backlog: { dir: 'docs/backlog' } }).m.backlog.stages, ['inbox', 'next', 'parked'], 'the default stages');
});

test('the nav takes the plugins after the pages the manifest turns on', () => {
  const { m } = read({ schemaVersion: 1, name: 'app', decisions: { dir: 'docs/decisions' } });
  const nav = pagesFor(m, [{ id: 'launch', label: 'Launch', path: 'launch' }]);
  assert.deepEqual(nav.at(-2), ['launch', 'Launch', '/launch']);
  assert.deepEqual(nav.at(-1)[0], 'export');
  assert.ok(nav.some(([id]) => id === 'decisions'));
});

test('a manifest that is not JSON is an error at the top of the warnings, and the repo gets the defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-manifest-bad-'));
  writeFileSync(join(dir, 'hq.json'), '{ not json');
  const { m, warnings, present } = loadManifest(dir, { home, env });
  assert.equal(present, true);
  assert.match(warnings[0], /hq\.json is not valid JSON/);
  assert.equal(m.name, nameFrom(basename(dir)));
  assert.equal(m.features.backlog, false);
  rmSync(dir, { recursive: true, force: true });
});

// The stranger's install (finding 12): the README says name is required and nothing checked it, and a typo inside docs
// passed where one at the top level was caught.
test('a manifest with no name is warned and named after its folder; a typo inside a known key is caught like one at the top', () => {
  const r = read({ schemaVersion: 1, docs: { hoem: 'README.md' }, tests: { layers: 'tests/layers.json', pipelien: 'x' } });
  assert.ok(r.warnings.some(w => /names no name; using "my-project"/.test(w)), r.warnings.join('\n'));
  assert.ok(r.warnings.some(w => /"docs\.hoem" is not a key this HQ knows; left alone/.test(w)), r.warnings.join('\n'));
  assert.ok(r.warnings.some(w => /"tests\.pipelien" is not a key this HQ knows/.test(w)), r.warnings.join('\n'));
  assert.equal(r.m.tests.layers.endsWith('tests/layers.json'), true, 'the known key beside the typo is still read');
});

// The delivery key's job and step names (Nell's third review, finding 8): string lists and strings, each null when absent.
test('the delivery key names the gate jobs, the deploy and smoke jobs, and the deploy, reuse and test steps; a wrong shape is warned and left null', () => {
  const r = read({ schemaVersion: 1, name: 'app', delivery: { gateJobs: ['checks'], deployJob: 'ship', smokeJob: 'smoke', deploySteps: ['Push it'], reuseSteps: 7, testSteps: ['Run the tests'] } });
  assert.deepEqual([r.m.delivery.gateJobs, r.m.delivery.deployJob, r.m.delivery.smokeJob, r.m.delivery.deploySteps, r.m.delivery.reuseSteps, r.m.delivery.testSteps],
    [['checks'], 'ship', 'smoke', ['Push it'], null, ['Run the tests']]);
  assert.ok(r.warnings.some(w => /delivery\.reuseSteps.*should be a list of names/.test(w)), r.warnings.join('\n'));
  const none = read({ schemaVersion: 1, name: 'app' }).m.delivery;
  assert.deepEqual([none.gateJobs, none.deployJob, none.smokeJob, none.deploySteps, none.reuseSteps, none.testSteps], [null, null, null, null, null, null]);
});
