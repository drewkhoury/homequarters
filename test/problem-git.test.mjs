// The problem register's entries from git (hq/lib/problem-git.mjs): each fix: commit is a closed entry fixed by itself,
// with the files of its failing-test commit for its signature, and a bug file in docs/backlog/ that a commit deleted
// says what the problem was and who asked (the plan's Backfill, step 1: "inferring nothing beyond what they say").
// These tests read git's output as the loader asks for it, so they need no repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLog, LOG_FORMAT, gitEntries, backlogBug, lineContains } from '../lib/problem-git.mjs';

// one commit as `git log --format=LOG_FORMAT --name-status` prints it
const commit = (sha, at, subject, body, files) => `\x1e${sha}\x1f${at}\x1f${subject}\x1f${body}\x1f\n\n${files.map(([s, f]) => `${s}\t${f}`).join('\n')}\n`;
const LOG = [
  commit('bbbbbbbb2222', '2026-10-10T09:05:00Z', 'fix: walk-roll taps a side of Moss checked clear', 'Seeded the deal.\n\nPlayer-facing: no\nFound-by: review (Juno)\nKind: flaky-test\nFound-at: nightly',
    [['M', 'web/neighbours.js'], ['D', 'docs/backlog/next/walk-roll-tap-flakes.md']]),
  commit('aaaaaaaa1111', '2026-10-10T09:00:00Z', 'test: walk-roll taps a side of Moss checked clear', 'Red until the next commit.', [['M', 'tests/walk-roll.js'], ['M', 'tests/walk-helpers.js']]),
  commit('cccccccc3333', '2026-10-09T12:00:00Z', 'docs: the sky flicker was the GPU driver', 'Nothing to fix here.', [['D', 'docs/backlog/next/sky-flicker.md']]),
  commit('dddddddd4444', '2026-10-09T11:00:00Z', 'feat: the board folds past three quests', 'A feature.', [['D', 'docs/backlog/next/board-folds.md']]),
].join('');
// each deleted file as it was in the deleting commit's parent (git show <sha>^:<path>)
const FILES = {
  'cccccccc3333^:docs/backlog/next/sky-flicker.md': '---\ntype: bug\nasked: Drew, 8 Oct\n---\n# The sky flickers on an old Mac\n',
  'dddddddd4444^:docs/backlog/next/board-folds.md': '---\ntype: feature\n---\n# The board folds past three quests\n',
  'bbbbbbbb2222^:docs/backlog/next/walk-roll-tap-flakes.md': '---\ntype: bug\nasked: review, 10 Oct\n---\n# A tap on Moss in walk-roll sometimes makes him stand, not roll\n\nSeen: 1 of 3 runs.\n',
};
const show = (sha, path) => FILES[`${sha}:${path}`] ?? null;

test("git's log reads as commits with their files, as LOG_FORMAT asks for them", () => {
  assert.match(LOG_FORMAT, /%H/);
  const cs = parseLog(LOG);
  assert.deepEqual(cs.map(c => [c.sha, c.subject]), [['bbbbbbbb2222', 'fix: walk-roll taps a side of Moss checked clear'], ['aaaaaaaa1111', 'test: walk-roll taps a side of Moss checked clear'],
    ['cccccccc3333', 'docs: the sky flicker was the GPU driver'], ['dddddddd4444', 'feat: the board folds past three quests']]);
  assert.deepEqual(cs[0].files, ['web/neighbours.js', 'docs/backlog/next/walk-roll-tap-flakes.md']);
  assert.deepEqual(cs[0].deleted, ['docs/backlog/next/walk-roll-tap-flakes.md']);
  assert.match(cs[0].body, /^Seeded the deal\./);
});

test("a fix's signature comes from its failing-test commit's files too, helpers left out", () => {
  const [fix] = gitEntries(parseLog(LOG), show);
  assert.equal(fix.id, 'F-bbbbbbbb');
  assert.equal(fix.signature, 'walk-roll');
  assert.equal(fix.guard, 'aaaaaaaa1111', 'the failing-test commit is its guard');
});

test('a bug file the fix deleted gives the entry its title and the file, and who asked when Found-by is missing', () => {
  const [fix] = gitEntries(parseLog(LOG), show);
  assert.equal(fix.title, 'A tap on Moss in walk-roll sometimes makes him stand, not roll');
  assert.equal(fix.backlog, 'docs/backlog/next/walk-roll-tap-flakes.md');
  assert.deepEqual(fix.foundBy, ['juno'], 'its own Found-by first');
  const noTrailer = parseLog(LOG.replace('Found-by: review (Juno)\n', ''));
  assert.deepEqual(gitEntries(noTrailer, show)[0].foundBy, ['reviewer'], "else the bug file's asked line");
});

test('a bug file deleted by a commit that is not a fix is a closed entry with no fix, and anything else deleted is none', () => {
  const es = gitEntries(parseLog(LOG), show);
  const sky = es.find(e => e.backlog === 'docs/backlog/next/sky-flicker.md');
  assert.deepEqual([sky.id, sky.title, sky.status, sky.disposition, sky.fix, sky.closedAt, sky.foundBy], ['B-sky-flicker', 'The sky flickers on an old Mac', 'closed', null, null, '2026-10-09T12:00:00Z', ['you']]);
  assert.equal(es.length, 2, 'the feature is not a problem');
});

test("a bug file reads as its type, title and who asked", () => {
  assert.deepEqual(backlogBug('---\ntype: bug\nasked: Drew, 8 Oct\n---\n# The sky flickers\n'), { title: 'The sky flickers', asked: 'Drew, 8 Oct' });
  assert.equal(backlogBug('---\ntype: feature\n---\n# A feature\n'), null);
  assert.equal(backlogBug(null), null);
});

// The reader asks whether a run's commit holds a fix tens of thousands of times, and a git process each made the first
// read of HQ's Problems page take 11 s. main is a straight line (pull requests land by rebase or squash), so for two
// commits on its first-parent list "a holds b" is "b is no newer than a", as make dora answers it; git is asked only for
// the rest. Runs name commits by seven characters, fixes by more.
test('a commit on main holds a fix when the fix is no newer on main, and git is asked only off it', () => {
  const line = ['ccccccc3333', 'bbbbbbb2222', 'aaaaaaa1111']; // newest first, as git rev-list --first-parent prints it
  const asked = [], contains = lineContains(line, (a, b) => { asked.push([a, b]); return null; });
  assert.equal(contains('bbbbbbb2222', 'ccccccc'), true, 'a newer commit holds an older fix');
  assert.equal(contains('bbbbbbb', 'aaaaaaa'), false, 'an older commit does not');
  assert.equal(contains('bbbbbbb2222', 'bbbbbbb'), true, 'the fix holds itself');
  assert.deepEqual(asked, []);
  assert.equal(contains('bbbbbbb2222', 'ddddddd'), null, 'off main, git is asked');
  assert.deepEqual(asked, [['bbbbbbb2222', 'ddddddd']]);
});
