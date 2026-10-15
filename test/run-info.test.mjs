// Proves: hq run-info's line says what ran, where and who, from the environment and git, and HQ reads the line back.
// Why: the line is the one place a recorded run's commit, branch and runner are kept; devpipe keeps none of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInfo, runLine } from '../lib/run-info.mjs';
import { runInfoLine } from '../lib/run-line.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const git = cmd => ({ 'git rev-parse --abbrev-ref HEAD': 'feat/thing', 'git rev-parse --short HEAD': 'abc1234', 'git status --porcelain': '' })[cmd] ?? '';
const machine = () => ({ load1: 1, cores: 8 });

test('on a laptop, a person running make test gets kind, where, who, branch and commit from git', () => {
  const { info } = runInfo({ env: {}, args: ['gate'], git, machine });
  assert.deepEqual(info, { v: 1, kind: 'gate', where: 'laptop', who: 'person', branch: 'feat/thing', commit: 'abc1234', dirty: false, machine: { load1: 1, cores: 8 } });
});

test('an agent in a Claude Code session is named, with its own name when it is one of several', () => {
  const { info } = runInfo({ env: { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's-1', HQ_AGENT: 'builder-2' }, args: ['unit'], git, machine });
  assert.equal(info.who, 'agent');
  assert.equal(info.session, 's-1');
  assert.equal(info.agent, 'builder-2');
});

test('the QK_ names QuestKeep sets still work, and HQ_ names win over them', () => {
  const a = runInfo({ env: { QK_KIND: 'soak', QK_LANES: '3' }, args: ['gate'], git, machine }).info;
  assert.equal(a.kind, 'soak'); assert.equal(a.where, 'container'); assert.equal(a.lanes, 3);
  const b = runInfo({ env: { QK_KIND: 'soak', HQ_KIND: 'deploy' }, args: [], git, machine }).info;
  assert.equal(b.kind, 'deploy');
});

test('on GitHub Actions the run, attempt, event and runner come from the workflow, and the commit from the head it tested', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'fix/x', GITHUB_SHA: 'merge00000', QK_COMMIT: 'headsha1234567', RUNNER_ENVIRONMENT: 'self-hosted' };
  const { info } = runInfo({ env, args: ['gate'], git: () => 'tree123', machine, now: () => new Date('2026-10-14T00:00:00Z') });
  assert.equal(info.where, 'ci'); assert.equal(info.who, 'ci'); assert.equal(info.branch, 'fix/x'); assert.equal(info.commit, 'headsha');
  assert.equal(info.run, '42'); assert.equal(info.attempt, 2); assert.equal(info.runner, 'self-hosted'); assert.equal(info.tree, 'tree123'); assert.equal(info.dirty, false);
});

test('--json names a file instead of the line, and a GATE= on make\'s line marks the run partial', () => {
  const r = runInfo({ env: { MAKEFLAGS: 'GATE=smoke-sync' }, args: ['gate', '--json', '/tmp/x/run.json'], git, machine });
  assert.equal(r.json, '/tmp/x/run.json'); assert.equal(r.info.partial, true); assert.equal(r.info.kind, 'gate');
});

test('the line HQ reads back is the line written', () => {
  const { info } = runInfo({ env: {}, args: ['after'], git, machine });
  assert.deepEqual(runInfoLine(`some output\n${runLine(info)}\nmore`), info);
});

test("--extra adds a project's own facts to the line, never over HQ's, and a malformed one is left out with a warning", () => {
  const r = runInfo({ env: {}, args: ['gate', '--extra', '{"sdk":"local","kind":"nope"}'], git, machine });
  assert.equal(r.info.sdk, 'local', 'the project\'s fact is on the line');
  assert.equal(r.info.kind, 'gate', 'a project fact never replaces one of HQ\'s');
  assert.deepEqual(r.warnings, []);
  const bad = runInfo({ env: {}, args: ['gate', '--extra', '{not json'], git, machine });
  assert.equal(bad.info.kind, 'gate');
  assert.equal(bad.warnings.length, 1);
  assert.match(bad.warnings[0], /--extra/);
  const list = runInfo({ env: {}, args: ['gate', '--extra', '[1]'], git, machine });
  assert.match(list.warnings[0], /JSON object/);
});

// The command itself, not only the pure function: `hq run-info gate` with no --repo records kind gate.
test('hq run-info <kind> with no --repo keeps the kind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-run-info-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  const out = execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs'), 'run-info', 'gate'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(runInfoLine(out).kind, 'gate');
  rmSync(dir, { recursive: true, force: true });
});

test('a dirty tree, the run folder, a given branch and a partial flag each reach the line', () => {
  const dirtyGit = cmd => (cmd === 'git status --porcelain' ? ' M web/app.js' : git(cmd));
  const { info } = runInfo({ env: { HQ_OUT: '/tmp/out/run-1', HQ_BRANCH: 'detached-copy', HQ_PARTIAL: '1' }, args: ['gate'], git: dirtyGit, machine });
  assert.equal(info.dirty, true); assert.equal(info.out, '/tmp/out/run-1'); assert.equal(info.branch, 'detached-copy'); assert.equal(info.partial, true);
  const clean = runInfo({ env: {}, args: ['gate'], git, machine }).info;
  assert.equal(clean.out, undefined); assert.equal(clean.partial, undefined);
});
