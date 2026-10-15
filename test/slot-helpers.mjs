// The pieces the slot's test files share: the fixed clock and the two sessions the decision tests reason about, and the
// ways of running `hq slot` for real against a throwaway lock folder. Not a test file: the glob in `npm test` skips it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideTake } from '../lib/slot.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HQ = [join(root, 'bin/hq.mjs'), 'slot'];
export const NOW = Date.parse('2026-09-27T06:00:00Z'), MIN = 60000;
export const at = mins => new Date(NOW - mins * MIN).toISOString();
export const me = { session: 'aaaa1111', pid: 100, claudePid: 10, worktree: 'questkeep-deploy', branch: 'ci/pr-reuse', target: 'docker-test' };
export const them = { session: 'bbbb2222', pid: 200, claudePid: 20, worktree: 'questkeep-core', branch: 'feat/quest-core', target: 'docker-test', since: at(3) };
export const living = (...pids) => pid => pids.includes(pid);
export const take = over => decideTake({ run: null, claim: null, me, now: NOW, alive: living(10, 20, 200), containers: [], ...over });

// The script itself, against a throwaway lock folder: the part that must be right when two sessions race.
export function lockCli(t, dir, args, env = {}) {
  const p = spawn(process.execPath, [...HQ, ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, HQ_SLOT_DIR: dir, HQ_SLOT_POLL_MS: '20', HQ_NO_DOCKER: '1', ...env },
  });
  let text = ''; p.stdout.on('data', d => { text += d; }); p.stderr.on('data', d => { text += d; });
  return new Promise(done => p.on('close', code => done({ code, text })));
}
export const scratch = t => { const d = mkdtempSync(join(tmpdir(), 'hq-slot-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

// A stand-in for a run's shell: alive until the test ends, so its process number can stand for a holder or a waiter.
export function shell(t) { const p = spawn('sleep', ['300'], { stdio: 'ignore' }); t.after(() => p.kill()); return p; }
// A take that waits, as its own process the test can stop; resolves with its exit code and output.
export function waiter(t, dir, target, env) {
  const p = spawn(process.execPath, [...HQ, 'take', target], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, HQ_SLOT_DIR: dir, HQ_SLOT_POLL_MS: '20', HQ_NO_DOCKER: '1', ...env },
  });
  t.after(() => p.kill('SIGKILL'));
  let text = ''; p.stdout.on('data', d => { text += d; }); p.stderr.on('data', d => { text += d; });
  return { p, done: new Promise(r => p.on('close', code => r({ code, text }))) };
}
export const eventCount = (dir, event) => (existsSync(join(dir, 'log.jsonl')) ? (readFileSync(join(dir, 'log.jsonl'), 'utf8').match(new RegExp(`"event":"${event}"`, 'g')) || []).length : 0);
export async function until(cond, what) {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise(r => setTimeout(r, 20)); // cap: 10 s, polling the lock's files
  assert.ok(cond(), what);
}
export const holderTarget = dir => { try { return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).target; } catch { return null; } };

export const logOf = dir => readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

// Every agent a Claude Code session starts runs its commands with the session's CLAUDE_CODE_SESSION_ID, and nothing else
// in their environment or process tree tells them apart. HQ_AGENT, which an agent puts on its commands, does.
export const sibling = name => ({ CLAUDE_CODE_SESSION_ID: 'shared', CLAUDE_PID: String(process.pid), HQ_AGENT: name });

// A stand-in for docker on PATH: answers 'ps' with the rows given for the labelled query and for the image query, after a
// random pause of up to maxMs, which is what makes a race between two takers show up if there is one.
export function dockerStub(t, { labelled = '', byImage = '', maxMs = 0 } = {}) {
  const dir = scratch(t);
  writeFileSync(join(dir, 'labelled'), labelled); writeFileSync(join(dir, 'byImage'), byImage);
  writeFileSync(join(dir, 'docker'), `#!/bin/sh
sleep $(awk 'BEGIN{srand(); printf "%.3f", rand()*${maxMs}/1000}')
case "$*" in *label=hq.test*) cat "${dir}/labelled";; *label=qk.test*) ;; *ancestor=*) cat "${dir}/byImage";; esac
`);
  chmodSync(join(dir, 'docker'), 0o755);
  return { PATH: `${dir}:${process.env.PATH}`, HQ_NO_DOCKER: '', HQ_TEST_IMAGE: 'questkeep-test:pw1.63.0' };
}

// ---- the adversary's survivors, 15 October: the fallbacks nothing exercised ----
// A take by a process whose environment names the folder the QuestKeep way, and names its agent and process the same way.
export const rawCli = (t, args, env) => {
  const p = spawn(process.execPath, [...HQ, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, HQ_SLOT_POLL_MS: '20', ...env } });
  let text = ''; p.stdout.on('data', d => { text += d; }); p.stderr.on('data', d => { text += d; });
  return new Promise(done => p.on('close', code => done({ code, text })));
};
