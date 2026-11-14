// Proves: a project that installs the package can import the plugin API from `homequarters`, the test helpers from
// `homequarters/testing`, the unpromised helpers from `homequarters/unstable`, and `homequarters/package.json`, and is
// refused any other path into the package: `homequarters/lib/...`, and from 0.3.0 `homequarters/internal/...` too.
// Why: what a project may import is what the package promises, or says it does not; a deep path that still resolved
// would let a project lean on a file the package may rename in any release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PKG = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));

// A project folder with the package linked in as node_modules/homequarters, as `npm install` lays it out.
function project(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-exports-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(PKG, join(dir, 'node_modules', 'homequarters'), 'dir');
  return dir;
}

// Resolves a specifier the way an ES module in that project would, in a node of its own.
function resolveFrom(dir, specifier) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `try { console.log(JSON.stringify({ path: new URL(import.meta.resolve(${JSON.stringify(specifier)})).pathname })); }
     catch (e) { console.log(JSON.stringify({ code: e.code })); }`], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const allowed = {
  homequarters: 'lib/ui-api.mjs',
  'homequarters/testing': 'testing.mjs',
  'homequarters/unstable': 'unstable.mjs',
  'homequarters/package.json': 'package.json',
};

for (const [specifier, file] of Object.entries(allowed)) {
  test(`${specifier} resolves to the package's ${file}`, t => {
    const r = resolveFrom(project(t), specifier);
    assert.equal(r.code, undefined, `refused with ${r.code}`);
    assert.equal(realpathSync(r.path), join(PKG, file));
    assert.ok(existsSync(r.path));
  });
}

test('a deep import is refused as not exported, internal/ included from 0.3.0', t => {
  const dir = project(t);
  for (const deep of ['homequarters/lib/backlog.mjs', 'homequarters/internal/lib/backlog.mjs', 'homequarters/internal/server.mjs']) {
    assert.deepEqual(resolveFrom(dir, deep), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, deep);
  }
});
