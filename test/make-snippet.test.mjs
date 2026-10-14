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

// The slot line is the one guard in the snippet: it must hold the slot as the recipe's own shell, pass a failing command's
// status through, never run the command when the slot is busy, and stop the run with the install line when hq is missing.
import { mkdirSync as mkd, readFileSync, existsSync, writeFileSync as wf } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HQ_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs');
function slotMake(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-make-slot-')), bin = join(dir, 'bin'), lock = join(dir, 'lock');
  mkd(bin); mkd(lock);
  wf(join(bin, 'hq'), `#!/bin/sh\nexec ${process.execPath} ${HQ_BIN} "$@"\n`); chmodSync(join(bin, 'hq'), 0o755);
  const held = `touch ran && pid=$$(${process.execPath} -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.HQ_SLOT_DIR + "/run.json")).pid)') && test "$$pid" = "$$$$"`;
  // a function replacer: a replacement string would read the shell's $$ as one $
  wf(join(dir, 'Makefile'), MAKE_SNIPPET.replace('<your test command>', 'true').replace('<your browser test command>', () => held) + 'fail:\n\t@$(call hq-slot,fail,exit 7)\n');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const make = (target, env = {}, path = `${bin}:/usr/bin:/bin`) => { try { return { status: 0, out: execFileSync('make', ['-s', '-C', dir, target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: path, HOME: process.env.HOME, HQ_SLOT_DIR: lock, HQ_NO_DOCKER: '1', HQ_SLOT_POLL_MS: '20', ...env } }) }; } catch (e) { return { status: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; } };
  return { dir, lock, make };
}

test('the slot line holds the slot as the recipe\'s own shell, and gives it back', t => {
  const m = slotMake(t);
  const r = m.make('browser-test');
  assert.equal(r.status, 0, r.out); assert.ok(existsSync(join(m.dir, 'ran')));
  assert.equal(existsSync(join(m.lock, 'run.json')), false, 'released');
  const log = readFileSync(join(m.lock, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(log.map(e => e.event), ['take', 'release']);
});

test('the slot line passes a failing command\'s status through unchanged, and the release logs it', t => {
  const m = slotMake(t);
  assert.notEqual(m.make('fail').status, 0, 'make reports the failure (its own exit code is 2 for any failed recipe)');
  const log = readFileSync(join(m.lock, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(log.at(-1).event, 'release'); assert.equal(log.at(-1).status, 7);
});

test('the slot line never runs the command when it cannot get the slot', t => {
  const m = slotMake(t);
  writeFileSync(join(m.lock, 'run.json'), JSON.stringify({ session: 'other', pid: process.pid, worktree: 'elsewhere', target: 'gate', since: new Date().toISOString() }));
  const r = m.make('browser-test', { LOCK_WAIT: '0' });
  assert.notEqual(r.status, 0); assert.equal(existsSync(join(m.dir, 'ran')), false); assert.match(r.out, /busy/);
});

test('with no hq on the PATH, the slot line stops the run and says how to install hq', t => {
  const m = slotMake(t);
  const r = m.make('browser-test', {}, '/usr/bin:/bin');
  assert.notEqual(r.status, 0); assert.equal(existsSync(join(m.dir, 'ran')), false);
  assert.match(r.out, /hq is not installed, and slot take browser-test guards this run: npm install -g homequarters/);
});
