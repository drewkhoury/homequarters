// Proves: hq dora writes the counting notes the manifest lists (delivery.countingChanges) into dora.json: a note that
// names no decision file always, and one that names a file while the file is in the decisions folder.
// Why: a note from before a project kept decisions names no file, and dropping it took a line off the Delivery page;
// a note whose file has gone is the one hq check reports. From 0.3.0 the notes are the project's own, never the package's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HQ = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs');
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();

// Two made-up notes: one from before the project kept decisions, so it names no file, and one tied to a decision file
const EARLY_NOTE = { date: '2026-01-10', what: 'Deploys skip a tree already live.' };
const FILED_NOTE = { date: '2026-02-03', what: 'CI moved to the laptop.', decision: '2026-02-03-ci-on-the-laptop.md' };

// A repo whose manifest lists both notes, holding FILED_NOTE's decision file when asked. One deploy run is fetched, so
// hq dora has something to work out and writes dora.json.
function countingChanges({ filedFile }) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-dora-notes-')), cache = join(dir, 'cache'), raw = join(cache, 'ci', 'actions');
  writeFileSync(join(dir, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'doors', cache, stores: ['dora', 'ci'], decisions: { dir: 'docs/decisions' },
    delivery: { countingChanges: [EARLY_NOTE, FILED_NOTE] } }));
  mkdirSync(join(dir, 'docs', 'decisions'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'decisions', 'other.md'), '# Another decision\n');
  if (filedFile) writeFileSync(join(dir, 'docs', 'decisions', FILED_NOTE.decision), '# CI runs on the laptop\n');
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

test('a note with no decision file shows, and so does one whose file is in the folder', () => {
  assert.deepEqual(countingChanges({ filedFile: true }), [EARLY_NOTE.what, FILED_NOTE.what]);
});

test('a note whose decision file is not in the folder is left out, and the one with no file still shows', () => {
  assert.deepEqual(countingChanges({ filedFile: false }), [EARLY_NOTE.what]);
});
