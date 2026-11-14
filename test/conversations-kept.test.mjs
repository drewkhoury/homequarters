// Proves: the Conversations page's list keeps each session's mentions of backlog items and its commits by its last
// activity: a session that moves is read again and shows what it now says, and the sessions that did not keep theirs.
// Why: an open Claude session writes its transcript all the time, so the list moves every few seconds; HQ reads only
// the sessions that moved, and must never show an old answer for one that did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { escapePath, resolveCommits } from '../lib/conversations.mjs';
import { conversationsAbout } from '../pages/conversations.mjs';

const A = '11111111-aaaa-4aaa-8aaa-111111111111', B = '22222222-bbbb-4bbb-8bbb-222222222222';
const said = (id, cwd, at, text) => `${JSON.stringify({ type: 'user', sessionId: id, cwd, gitBranch: 'main', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: text } })}\n`;

function world() {
  // the real path: git names the checkout by it (macOS's /var is /private/var), and so does Claude Code's folder name
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hq-conv-kept-'))), repo = join(root, 'repo'), projects = join(root, 'projects'), cache = join(root, 'cache');
  mkdirSync(join(repo, 'docs', 'backlog', 'next'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'backlog', 'next', 'which-day-counts.md'), '# Which day a thing counts on\n\nThe day a thing counts on.\n');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'start']);
  const folder = join(projects, escapePath(repo));
  mkdirSync(folder, { recursive: true });
  const file = id => join(folder, `${id}.jsonl`);
  writeFileSync(file(A), said(A, repo, '2026-11-14T09:00:00Z', 'Start on which-day-counts today.'));
  writeFileSync(file(B), said(B, repo, '2026-11-14T09:30:00Z', 'Look at the sync tests.'));
  return { ctx: { repo, cache, projectsDir: projects }, file, repo, done: () => rmSync(root, { recursive: true, force: true }) };
}
const mentioning = async w => (await conversationsAbout(w.ctx, { slug: 'which-day-counts' })).map(s => s.id).sort();

test('a session that moves is read again for what it mentions, and the others keep theirs', async () => {
  const w = world();
  try {
    assert.deepEqual(await mentioning(w), [A]);
    appendFileSync(w.file(B), said(B, w.repo, '2026-11-14T10:00:00Z', 'Now which-day-counts as well.'));
    assert.deepEqual(await mentioning(w), [A, B], 'B moved, and is read again');
    appendFileSync(w.file(A), said(A, w.repo, '2026-11-14T10:05:00Z', 'Something else entirely.'));
    assert.deepEqual(await mentioning(w), [A, B], "A moved too, and still mentions it from what it said first");
  } finally { w.done(); }
});

test("a few sessions matched as part of a longer list read git's log from the list's earliest start", async () => {
  const asked = [];
  const log = async args => (asked.push(args.find(a => a.startsWith('--since='))), '');
  const s = { id: B, started: '2026-11-14T09:30:00Z', commits: [], subjects: [] };
  await resolveCommits('/r', [s], log, { since: '2026-11-01T00:00:00Z' });
  await resolveCommits('/r', [s], log);
  assert.deepEqual(asked, ['--since=2026-10-31T00:00:00.000Z', '--since=2026-11-13T09:30:00.000Z']);
});
