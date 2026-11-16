// Proves: the Repo page's git picture is read once and kept: a page within 10 s of the read asks git nothing, a page
// after that answers from the read it has and queues the next read for after the response, and Refresh (fresh) reads
// at once. Why: every request read all 168 of QuestKeep's worktrees with git status again, 1.4 s however many ran at
// once, and Export read them again beside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoHealthKept, KEPT_MS } from '../lib/git.mjs';

test('the git picture is kept for 10 s, then answered from while the next read waits for the response', async t => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'hq-kept-')));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  let ran = 0;
  const git = (args, cwd) => new Promise(done => { ran++; execFile('git', args, { cwd }, (e, out) => done(e ? '' : out)); });
  const queued = [], later = fn => queued.push(fn);
  assert.equal(KEPT_MS, 10000);
  const first = await repoHealthKept(repo, { git, now: 0, later });
  assert.ok(ran > 0 && first.readAt === 0 && first.health.checkout, 'the first read happens at once');
  ran = 0;
  assert.equal((await repoHealthKept(repo, { git, now: 9000, later })).health, first.health);
  assert.equal(ran, 0, 'within 10 s git is not asked');
  const old = await repoHealthKept(repo, { git, now: 11000, later });
  assert.equal(old.health, first.health, 'after 10 s the page answers from the read it has');
  assert.equal(ran, 0, 'and asks git nothing before answering');
  assert.equal(queued.length, 1, 'one read waits for after the response');
  await repoHealthKept(repo, { git, now: 11500, later });
  assert.equal(queued.length, 1, 'a second page does not queue another');
  await queued.shift()();
  const next = await repoHealthKept(repo, { git, now: 12000, later });
  assert.notEqual(next.health, first.health, 'the next page has the new read');
  ran = 0;
  const fresh = await repoHealthKept(repo, { git, now: 12500, later, fresh: true });
  assert.ok(ran > 0 && fresh.readAt === 12500, 'Refresh reads at once');
});
