// Proves: hq check prints the HQ version it is, and notes (exit 0, not a problem) when the repo's package.json pins
// homequarters at another major version; a pin in the same major, no pin, or a pin that is not a version says nothing.
// Why: a project runs hq check from its own pin and from a global install (decision 4). When the two drift a major
// apart, the check that passed on one may not be the contract the other keeps; the line says which HQ checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pinNote } from '../lib/check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HQ = join(ROOT, 'bin', 'hq.mjs');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const MAJOR = +VERSION.split('.')[0];

// A repo with a manifest and, when given, a package.json; nothing else, so the check has no problems to report.
function repo(t, pkg) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-check-version-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'r', cache: join(dir, 'cache') }));
  if (pkg) writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}
const check = dir => spawnSync(process.execPath, [HQ, 'check', '--repo', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });

test('the first line is the HQ version that checked', t => {
  const r = check(repo(t));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.split('\n')[0], `HQ ${VERSION}`);
});

test('a pin a major apart is a note, and the check still exits 0', t => {
  const other = `^${MAJOR + 1}.0.0`;
  const r = check(repo(t, { devDependencies: { homequarters: other } }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /keeps its contract/);
  assert.ok(r.stdout.includes(`  note: package.json pins homequarters ${other}, major ${MAJOR + 1}; this is HQ ${VERSION}, major ${MAJOR}`), r.stdout);
});

test('which pins earn the note: another major in either dependency list, and nothing else', () => {
  const v = '0.1.0';
  assert.equal(pinNote({ dependencies: { homequarters: '1.2.3' } }, v), 'package.json pins homequarters 1.2.3, major 1; this is HQ 0.1.0, major 0');
  assert.match(pinNote({ devDependencies: { homequarters: '>=2' } }, '1.4.0'), /major 2; this is HQ 1\.4\.0, major 1/);
  assert.equal(pinNote({ devDependencies: { homequarters: '~0.1.0' } }, v), null, 'the same major');
  assert.equal(pinNote({ devDependencies: { homequarters: '0.3.0' } }, v), null, 'a 0.x minor is not a major');
  assert.equal(pinNote({ devDependencies: { other: '9.0.0' } }, v), null, 'no pin');
  assert.equal(pinNote(null, v), null, 'no package.json');
  for (const spec of ['file:../hq', 'github:someone/hq', 'latest', '*', 'link:../hq']) assert.equal(pinNote({ devDependencies: { homequarters: spec } }, v), null, spec);
});
