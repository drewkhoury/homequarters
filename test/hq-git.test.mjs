// Proves: the Repo page's git health reads a small repo made here with real git: a bare origin, a checkout one commit
// ahead and one behind, a worktree on a branch with a commit and an edit, a changed and an untracked file, a stash,
// and a branch already merged into main.
// Why: the Repo page is where a person checks their bearings before a push; it must read every one of those states
// right, and never from this repo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseStatus, parseWorktrees, parseCounts, checkoutHealth, repoHealth } from '../lib/git.mjs';

let base, work, wt;
// git with a made-up identity and none of this machine's settings
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
  { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: base } }).toString();
const commit = (cwd, file, text, msg) => { writeFileSync(join(cwd, file), text); git(cwd, 'add', file); git(cwd, 'commit', '-q', '-m', msg); };

before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'hq-git-')));
  work = join(base, 'work'); wt = join(base, 'wt');
  git(base, 'init', '-q', '--bare', '-b', 'main', 'origin.git');
  git(base, 'init', '-q', '-b', 'main', 'work');
  commit(work, 'a.txt', 'a\n', 'first');
  git(work, 'remote', 'add', 'origin', join(base, 'origin.git'));
  git(work, 'push', '-q', '-u', 'origin', 'main');
  git(work, 'branch', 'merged-one');
  // someone else pushes a commit, which this checkout then fetches: one to pull
  git(base, 'clone', '-q', join(base, 'origin.git'), 'other');
  commit(join(base, 'other'), 'c.txt', 'c\n', 'theirs');
  git(join(base, 'other'), 'push', '-q', 'origin', 'main');
  git(work, 'fetch', '-q');
  // a commit here not pushed: one to push
  commit(work, 'b.txt', 'b\n', 'mine');
  // a worktree on its own branch with a commit and an edit
  git(work, 'worktree', 'add', '-q', '-b', 'feature', wt);
  commit(wt, 'd.txt', 'd\n', 'feature work');
  writeFileSync(join(wt, 'd.txt'), 'd changed\n');
  // a stash, then a changed file and an untracked one in the checkout
  writeFileSync(join(work, 'a.txt'), 'stashed\n'); git(work, 'stash', 'push', '-q', '-m', 'half done');
  writeFileSync(join(work, 'a.txt'), 'a changed\n');
  writeFileSync(join(work, 'new.txt'), 'new\n');
});
after(() => rmSync(base, { recursive: true, force: true }));

test("git's porcelain status reads as branch, upstream, counts and files", () => {
  const s = parseStatus('# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -3\n1 .M N... 100644 100644 100644 a a a.txt\n2 R. N... 100644 100644 100644 a a R100 b.txt\told.txt\nu UU N... 1 2 3 4 a b c x.txt\n? new.txt\n? other.txt\n');
  assert.deepEqual(s, { branch: 'main', upstream: 'origin/main', ahead: 2, behind: 3, changed: 2, untracked: 2, conflicted: 1 });
  assert.equal(parseStatus('# branch.head (detached)\n').branch, '');
});

test('worktree list and rev-list counts parse', () => {
  assert.deepEqual(parseWorktrees('worktree /a\nHEAD 1111\nbranch refs/heads/main\n\nworktree /b\nHEAD 2222\ndetached\n\nworktree /c\nHEAD 3333\nbranch refs/heads/x\nprunable gitdir file points to non-existent location\n'), [
    { path: '/a', head: '1111', branch: 'main', detached: false, bare: false, prunable: false },
    { path: '/b', head: '2222', branch: '', detached: true, bare: false, prunable: false },
    { path: '/c', head: '3333', branch: 'x', detached: false, bare: false, prunable: true },
  ]);
  assert.deepEqual(parseCounts('3\t5\n'), [3, 5]);
  assert.deepEqual(parseCounts(''), [null, null]);
});

test('the checkout: branch, changed and untracked files, one to push and one to pull, and when it last fetched', async () => {
  const h = await checkoutHealth(work);
  assert.deepEqual([h.branch, h.changed, h.untracked, h.clean], ['main', 1, 1, false]);
  assert.deepEqual(h.remote, { against: 'origin/main', pushed: true, toPush: 1, toPull: 1 });
  assert.ok(h.lastFetch && Date.now() - new Date(h.lastFetch) < 60000, 'fetched just now');
});

test('a branch never pushed is measured against main on the remote', async () => {
  const h = await checkoutHealth(wt);
  assert.equal(h.branch, 'feature');
  // feature holds "mine" and "feature work", neither on origin/main, and lacks "theirs"
  assert.deepEqual(h.remote, { against: 'origin/main', pushed: false, toPush: 2, toPull: 1 });
  assert.deepEqual([h.changed, h.untracked], [1, 0]);
});

test('every worktree with its state, the stash, and the branch already merged', async () => {
  const h = await repoHealth(work);
  assert.deepEqual(h.worktrees.map(w => [w.branch, w.clean, w.ahead, w.behind]), [['main', false, 1, 1], ['feature', false, 2, 1]]);
  assert.ok(h.worktrees.every(w => w.lastCommit), 'each has its last commit time');
  assert.deepEqual(h.stashes.map(s => s.message), ['On main: half done']);
  assert.deepEqual(h.merged, ['merged-one']);
});
