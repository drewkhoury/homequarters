// Proves: hq setup proposes exactly the manifest a repo's files call for, nothing for a bare repo but its name and cache,
// and the make lines; and a cache folder HQ itself made does not become a store the repo never asked for. Why: the
// extraction notes claimed "exactly the manifest QuestKeep needs and nothing a bare repo does not have" with no test
// behind it (Hollis), and Nell found hq slot's own lock folder proposed as a store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanRepo, proposeManifest } from '../lib/scan.mjs';

const put = (dir, rel, text = '') => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text); };

test('a bare repo proposes its name and cache and nothing else', () => {
  const home = mkdtempSync(join(tmpdir(), 'hq-setup-home-')), dir = join(home, 'repos', 'My Hello');
  put(dir, 'index.js', '');
  const scan = scanRepo(dir, { home });
  assert.deepEqual(scan.found, []);
  assert.equal(scan.manifest, false);
  const m = proposeManifest(scan);
  assert.deepEqual(Object.keys(m), ['schemaVersion', 'name', 'cache']);
  assert.equal(m.name, 'my-hello', 'the folder name as a slug');
  assert.match(m.cache, /\/hq\/my-hello$/);
  rmSync(home, { recursive: true, force: true });
});

test('a repo with the conventions proposes each key its files call for, and no store its cache does not hold', () => {
  const home = mkdtempSync(join(tmpdir(), 'hq-setup-home-')), dir = join(home, 'repos', 'doors');
  put(dir, 'README.md', '# d'); put(dir, 'docs/backlog/next/x.md', '---\ntype: bug\n---\n# x\n'); put(dir, 'docs/decisions/2026-10-01-a.md', '---\ndate: 2026-10-01\n---\n# a\n');
  put(dir, 'tests/layers.json', '{}'); put(dir, 'hq/pipeline.json', '{}'); put(dir, 'hq/groups.json', '{}'); put(dir, 'Makefile', 'test:\n\ttrue\n'); put(dir, 'devpipe.toml', '');
  for (const st of ['runs', 'problems']) put(join(home, '.cache', 'doors'), `${st}/something.json`, '{}'); // stores the repo has written to
  mkdirSync(join(home, '.cache', 'doors', 'ci'), { recursive: true }); // and one it has not
  const m = proposeManifest(scanRepo(dir, { home }));
  assert.deepEqual(m, { schemaVersion: 1, name: 'doors', cache: join(home, '.cache', 'doors'), docs: { home: 'README.md', groups: 'hq/groups.json' },
    backlog: { dir: 'docs/backlog', stages: ['inbox', 'next', 'parked'] }, decisions: { dir: 'docs/decisions' },
    tests: { layers: 'tests/layers.json', pipeline: 'hq/pipeline.json' }, stores: ['runs', 'problems'] });
  rmSync(home, { recursive: true, force: true });
});

test('an empty lock folder, as hq slot who leaves one, is not a store the repo asked for', () => {
  const home = mkdtempSync(join(tmpdir(), 'hq-setup-home-')), dir = join(home, 'repos', 'doors');
  put(dir, 'README.md', '# d');
  mkdirSync(join(home, '.cache', 'hq', 'doors', 'lock'), { recursive: true });
  const m = proposeManifest(scanRepo(dir, { home }));
  assert.equal(m.stores, undefined, 'the slot made the folder; the repo did not name it');
  rmSync(home, { recursive: true, force: true });
});

// A first install on a clean machine found this: with XDG_CACHE_HOME set, setup proposed
// ~/.cache/hq/hello because another repo of that name had left one, and everything then written went to the real home.
test('setup honours XDG_CACHE_HOME and never adopts a cache HQ made for another repo of the same name', () => {
  const home = mkdtempSync(join(tmpdir(), 'hq-setup-home-')), xdg = join(home, 'xdg'), dir = join(home, 'repos', 'hello');
  put(dir, 'index.js', '');
  mkdirSync(join(home, '.cache', 'hq', 'hello', 'lock'), { recursive: true }); writeFileSync(join(home, '.cache', 'hq', 'hello', 'lock', 'log.jsonl'), '{}\n');
  const m = proposeManifest(scanRepo(dir, { home, env: { XDG_CACHE_HOME: xdg } }));
  assert.equal(m.cache, join(xdg, 'hq', 'hello'));
  assert.equal(m.stores, undefined, 'the other repo\'s lock is not this repo\'s store');
  rmSync(home, { recursive: true, force: true });
});

test('a project\'s own earlier cache, ~/.cache/<name> with runs in it, is still proposed; one holding only a lock is not', () => {
  const home = mkdtempSync(join(tmpdir(), 'hq-setup-home-')), dir = join(home, 'repos', 'doors');
  put(dir, 'index.js', '');
  mkdirSync(join(home, '.cache', 'doors', 'lock'), { recursive: true }); writeFileSync(join(home, '.cache', 'doors', 'lock', 'log.jsonl'), '{}\n');
  assert.match(proposeManifest(scanRepo(dir, { home, env: {} })).cache, /\/\.cache\/hq\/doors$/, 'a lock alone is what hq slot who leaves on any repo');
  mkdirSync(join(home, '.cache', 'doors', 'runs'), { recursive: true }); writeFileSync(join(home, '.cache', 'doors', 'runs', 'r1.json'), '{}');
  const m = proposeManifest(scanRepo(dir, { home, env: {} }));
  assert.equal(m.cache, join(home, '.cache', 'doors'));
  assert.deepEqual(m.stores, ['runs', 'lock']);
  rmSync(home, { recursive: true, force: true });
});
