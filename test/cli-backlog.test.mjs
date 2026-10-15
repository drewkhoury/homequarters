// Proves: hq backlog prints the board for the backlog folder the manifest names, and says which key would turn it on
// when there is none. Why: make backlog read docs/backlog by a baked path from inside QuestKeep's hq/ folder; the
// command belongs to the package and has to find the items through hq.json wherever the repo keeps them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { board } from '../backlog.mjs';
import { loadManifest } from '../lib/manifest.mjs';

const ITEM = (type, title) => `---\ntype: ${type}\nasked: Jane, 27 Sep\n---\n# ${title}\n\nA sentence.\n\nDone when: it is done.\n`;
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });

test('the board lists ready, blocked and inbox items from the folder hq.json names, with its own stage names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-backlog-cli-'));
  for (const s of ['ideas', 'todo', 'later']) mkdirSync(join(dir, 'work', s), { recursive: true });
  writeFileSync(join(dir, 'work', 'todo', 'fix-the-door.md'), ITEM('bug', 'The door sticks'));
  writeFileSync(join(dir, 'work', 'todo', 'paint-the-door.md'), ITEM('feature', 'Paint the door').replace('asked:', 'blocked-by: fix-the-door\nasked:'));
  writeFileSync(join(dir, 'work', 'ideas', 'a-window.md'), ITEM('feature', 'A window'));
  writeFileSync(join(dir, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'doors', backlog: { dir: 'work', stages: ['ideas', 'todo', 'later'] } }));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'items');
  return board(dir).then(out => {
    assert.match(out, /Ready \(1\), nothing blocks them:\n  bug {6}fix-the-door/);
    assert.match(out, /Blocked \(1\):\n  feature {2}paint-the-door {2}← fix-the-door/);
    assert.match(out, /Inbox: 1 of 10, sort these first:\n  feature {2}a-window/);
    rmSync(dir, { recursive: true, force: true });
  });
});

test('without a backlog key the board is one sentence naming the key, and nothing is read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-backlog-none-'));
  const out = await board(dir, { m: loadManifest(dir).m });
  assert.match(out, /names no backlog/);
  assert.match(out, /backlog key/);
  rmSync(dir, { recursive: true, force: true });
});
