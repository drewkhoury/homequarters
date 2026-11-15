// Proves: reading the register's git costs a few git runs however many backlog items were deleted or commits no ref
// reaches: the deleted items are read together, and the commits asked about are looked up together before any pair.
// Why: on QuestKeep a cold read ran git 143 times for deleted backlog items and 62 times for commits on deleted
// branches, a process each, about 2.5 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGit } from '../lib/problem-git.mjs';

const BUGS = 6, GONE = 5;
// main: six bug files added, each deleted by its own commit (three by fixes), and five branches of one commit each,
// all deleted, so no ref reaches them. Answers { repo, gone: [their shas], main: [main's shas], done }.
function history() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'hq-batch-')));
  let tick = 0;
  const git = (...a) => { tick++; const at = `2026-10-01T10:${String(tick).padStart(2, '0')}:00Z`;
    return execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } }).trim(); };
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(repo, 'docs', 'backlog'), { recursive: true });
  for (let i = 0; i < BUGS; i++) writeFileSync(join(repo, 'docs', 'backlog', `bug-${i}.md`), `---\ntype: bug\nasked: Noor\n---\n# The board loses quest ${i}\n`);
  git('add', 'docs'); git('commit', '-q', '-m', 'docs: six bugs');
  const main = [], gone = [];
  for (let i = 0; i < BUGS; i++) {
    git('rm', '-q', `docs/backlog/bug-${i}.md`);
    git('commit', '-q', '-m', i % 2 ? `chore: drop bug ${i}` : `fix: the board keeps quest ${i}`);
    main.push(git('rev-parse', 'HEAD'));
  }
  for (let i = 0; i < GONE; i++) {
    git('checkout', '-q', '-b', `gone-${i}`); writeFileSync(join(repo, `g${i}.txt`), String(i)); git('add', `g${i}.txt`); git('commit', '-q', '-m', `feat: g${i}`);
    gone.push(git('rev-parse', 'HEAD')); git('checkout', '-q', 'main'); git('branch', '-q', '-D', `gone-${i}`);
  }
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { repo, gone, main, done: () => rmSync(repo, { recursive: true, force: true }) };
}
const counting = () => {
  const ran = [];
  return { ran, exec: (cmd, args, opts) => { ran.push(args.join(' ')); return execFileSync(cmd, args, opts); } };
};

test('the backlog items deleted on main are read in one git run, however many there are', () => {
  const h = history();
  try {
    const { ran, exec } = counting();
    const { entries } = loadGit({ repo: h.repo, exec });
    assert.deepEqual(entries.map(e => e.title).sort(), [...Array(BUGS).keys()].map(i => `The board loses quest ${i}`).sort());
    assert.ok(entries.every(e => e.foundBy.length), 'who asked comes from each file');
    assert.ok(ran.length <= 6, `git ran ${ran.length} times: ${ran.map(r => r.split(' ')[0]).join(', ')}`);
  } finally { h.done(); }
});

test('the commits no ref reaches are looked up together, and their pairs then ask git nothing', () => {
  const h = history();
  try {
    const { ran, exec } = counting();
    const { contains } = loadGit({ repo: h.repo, exec });
    const missing = 'feedfacefeedfacefeedfacefeedfacefeedface';
    const before = ran.length;
    contains.learn([...h.gone, missing, ...h.main]);
    assert.ok(ran.length - before <= 2, `learning took ${ran.length - before} git runs`);
    const after = ran.length;
    for (const g of h.gone) {
      assert.equal(contains(h.main[0], g), true, 'a branch made after the first delete holds it');
      assert.equal(contains(g, h.main.at(-1)), false);
      assert.equal(contains(missing, g), null);
    }
    assert.equal(ran.length, after, `asked git again: ${ran.slice(after).join(' | ')}`);
  } finally { h.done(); }
});
