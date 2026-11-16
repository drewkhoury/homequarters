// Proves: the Repo page's worktree table takes every branch worktree's distance from main and its last commit from one
// git run, giving the counts and dates a run per worktree gave; only a detached worktree is asked on its own.
// Why: on QuestKeep the page ran git three times for each of 168 worktrees on every request, 510 processes and 1.9 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoHealth } from '../lib/git.mjs';

const BRANCHES = 5;
// main, mirrored to origin/main, with two commits after the branches start; wt-<i> holds i commits of its own, and
// one worktree is detached one commit before main's tip
function repoWithWorktrees() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hq-worktrees-'))), repo = join(root, 'main');
  let tick = 0;
  const git = (cwd, ...a) => { tick++; const at = `2026-10-01T10:${String(tick).padStart(2, '0')}:00Z`;
    return execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } }).trim(); };
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 't@example.com'); git(repo, 'config', 'user.name', 't'); git(repo, 'config', 'commit.gpgsign', 'false');
  const commit = (cwd, name) => { writeFileSync(join(cwd, `${name}.txt`), name); git(cwd, 'add', `${name}.txt`); git(cwd, 'commit', '-q', '-m', name); };
  commit(repo, 'start');
  const wts = [];
  for (let i = 1; i <= BRANCHES; i++) {
    const path = join(root, `wt-${i}`);
    git(repo, 'worktree', 'add', '-q', '-b', `wt-${i}`, path, 'main');
    for (let k = 0; k < i; k++) commit(path, `wt-${i}-${k}`);
    wts.push({ path, branch: `wt-${i}`, ahead: i, behind: 2, last: git(path, 'log', '-1', '--format=%cI') });
  }
  commit(repo, 'main-1'); commit(repo, 'main-2');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'main');
  const loose = join(root, 'loose');
  git(repo, 'worktree', 'add', '-q', '--detach', loose, 'main~1');
  wts.push({ path: loose, branch: '', ahead: 0, behind: 1, last: git(loose, 'log', '-1', '--format=%cI') });
  return { repo, wts, done: () => rmSync(root, { recursive: true, force: true }) };
}
function counting() {
  const ran = [];
  const git = (args, cwd) => new Promise(done => {
    ran.push(args[0]);
    const p = spawn('git', args, { cwd }), out = [];
    p.stdout.on('data', d => out.push(d)); p.on('close', code => done(code ? '' : Buffer.concat(out).toString('utf8')));
  });
  return { ran, git };
}

test('each worktree\'s distance from main and last commit come from one git run, only a detached one asked alone', async () => {
  const h = repoWithWorktrees();
  try {
    const { ran, git } = counting();
    const health = await repoHealth(h.repo, git);
    for (const want of h.wts) {
      const w = health.worktrees.find(x => x.path === want.path);
      assert.ok(w, `worktree ${want.path}`);
      assert.deepEqual([w.branch || '', w.ahead, w.behind, w.lastCommit && new Date(w.lastCommit).toISOString()],
        [want.branch, want.ahead, want.behind, new Date(want.last).toISOString()], want.path);
    }
    const asked = ran.filter(c => c === 'rev-list' || c === 'log').length;
    assert.ok(asked <= 3, `rev-list and log ran ${asked} times for ${h.wts.length} worktrees: ${ran.join(', ')}`);
  } finally { h.done(); }
});
