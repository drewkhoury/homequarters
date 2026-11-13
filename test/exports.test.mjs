// Proves: a project that installs the package can import the plugin API from `homequarters`, the test helpers from
// `homequarters/testing`, any file under `homequarters/internal/`, and `homequarters/package.json`, and is refused a
// deep import such as `homequarters/lib/backlog.mjs`. Why: QuestKeep's 40 deep imports move to one `internal/` prefix
// (decision 18), so 0.2.0 can drop that prefix in one place; a bare `lib/` path that still resolved would hide the
// imports the switch missed.
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
  'homequarters/internal/lib/backlog.mjs': 'lib/backlog.mjs',
  'homequarters/internal/server.mjs': 'server.mjs',
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

test('a deep import outside internal/ is refused as not exported', t => {
  assert.deepEqual(resolveFrom(project(t), 'homequarters/lib/backlog.mjs'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});
