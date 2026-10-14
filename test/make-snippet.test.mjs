// Proves: the make lines hq setup proposes run the project's own command whether or not hq is installed, and call hq
// only when it is there. Why: HQ is the recorder, never a dependency of the tests; a Makefile that stops working when hq
// is missing would make HQ something every contributor has to install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { MAKE_SNIPPET } from '../lib/scan.mjs';

const makefile = MAKE_SNIPPET.replace('<your test command>', 'echo the-tests-ran');
const run = (dir, path) => execFileSync('make', ['-s', '-C', dir, 'test'], { encoding: 'utf8', env: { PATH: path, HOME: process.env.HOME } });

test('with no hq on the PATH, make test runs the tests and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-make-'));
  writeFileSync(join(dir, 'Makefile'), makefile);
  const out = run(dir, '/usr/bin:/bin');
  assert.equal(out.trim(), 'the-tests-ran');
  rmSync(dir, { recursive: true, force: true });
});

test('with hq on the PATH, make test calls hq run-info first, then the tests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-make-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'hq'), '#!/bin/sh\necho "hq called with: $*"\n');
  chmodSync(join(bin, 'hq'), 0o755);
  writeFileSync(join(dir, 'Makefile'), makefile);
  const out = run(dir, `${bin}:/usr/bin:/bin`);
  assert.deepEqual(out.trim().split('\n'), ['hq called with: run-info test', 'the-tests-ran']);
  rmSync(dir, { recursive: true, force: true });
});

test('when hq itself fails, the tests still run and the failure is not theirs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-make-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'hq'), '#!/bin/sh\necho "hq broke" >&2\nexit 1\n');
  chmodSync(join(bin, 'hq'), 0o755);
  writeFileSync(join(dir, 'Makefile'), makefile);
  let out = '', failed = false;
  try { out = run(dir, `${bin}:/usr/bin:/bin`); } catch (e) { failed = true; out = String(e.stdout || ''); }
  assert.equal(failed, false, 'a broken hq must not fail make test');
  assert.equal(out.trim(), 'the-tests-ran');
  rmSync(dir, { recursive: true, force: true });
});
