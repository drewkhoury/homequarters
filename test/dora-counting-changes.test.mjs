// Proves: hq dora's counting changes keep a note that has no decision file of its own when the manifest's
// decisions.earlier file exists in the repo, and leave it out when that file does not.
// Why: QuestKeep's 27 September note ("Deploys skip a tree live already serves...") predates its docs/decisions/ folder,
// so it names no decision file, and keeping only notes whose decision file exists dropped a line from make dora and the
// Delivery page that QuestKeep's main shows. Its decisions before that folder live in the earlier file
// (docs/DECISIONS.md), so a repo that has that file has that history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COUNTING_CHANGES } from '../lib/dora.mjs';

const HQ = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs');
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();

// the notes as lib/dora.mjs lists them: the one with no decision file, and one that has a file
const EARLY_NOTE = COUNTING_CHANGES.find(c => c.decision === null);
const FILED_NOTE = COUNTING_CHANGES.find(c => c.decision === '2026-10-03-ci-on-the-laptop.md');

// A repo whose manifest names docs/decisions and docs/DECISIONS.md, holding FILED_NOTE's decision file and, when asked,
// the earlier file. One deploy run is fetched, so hq dora has something to work out and writes dora.json.
function countingChanges({ earlierFile }) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-dora-notes-')), cache = join(dir, 'cache'), raw = join(cache, 'ci', 'actions');
  writeFileSync(join(dir, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'doors', cache, stores: ['dora', 'ci'], decisions: { dir: 'docs/decisions', earlier: 'docs/DECISIONS.md' } }));
  mkdirSync(join(dir, 'docs', 'decisions'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'decisions', FILED_NOTE.decision), '# CI runs on the laptop\n');
  if (earlierFile) writeFileSync(join(dir, 'docs', 'DECISIONS.md'), '# Decisions\n\n- 27 September: deploys skip a tree live already serves.\n');
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'm');
  const sha = git(dir, 'rev-parse', 'HEAD'), live = Date.now() - 86400000;
  mkdirSync(join(raw, 'jobs'), { recursive: true });
  writeFileSync(join(raw, 'jobs', '101-1.json'), JSON.stringify({ jobs: [{ name: 'deploy', conclusion: 'success', completed_at: new Date(live).toISOString(), labels: [] }] }));
  writeFileSync(join(raw, 'runs.json'), JSON.stringify([{ id: 101, path: '.github/workflows/deploy.yml', event: 'push', status: 'completed', conclusion: 'success', run_attempt: 1, head_sha: sha,
    created_at: new Date(live - 5 * 60000).toISOString(), html_url: 'https://github.com/o/doors/actions/runs/101' }]));
  const r = spawnSync(process.execPath, [HQ, 'dora', '--no-fetch', '--no-daily', '--quiet', '--repo', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(r.status, 0, r.stderr);
  const notes = JSON.parse(readFileSync(join(cache, 'dora', 'dora.json'), 'utf8')).countingChanges;
  rmSync(dir, { recursive: true, force: true });
  return notes.map(c => c.what);
}

test('a counting change with no decision file is kept when the manifest\'s earlier decisions file exists', () => {
  assert.deepEqual(countingChanges({ earlierFile: true }), [EARLY_NOTE.what, FILED_NOTE.what]);
});

test('a counting change with no decision file is left out when the earlier decisions file is not there', () => {
  assert.deepEqual(countingChanges({ earlierFile: false }), [FILED_NOTE.what]);
});
