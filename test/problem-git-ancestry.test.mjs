// Proves: the register's "does this run's commit hold that fix" answers as git merge-base --is-ancestor does, for
// commits on main, on branches, on a branch that merged main back in, and on a commit no ref reaches, and asks git a
// few times a read rather than once a pair. A second read while origin/main has not moved reads no log again.
// Why: one Problems read asked git about two thousand pairs on QuestKeep's runs, a process each, about 27 seconds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGit } from '../lib/problem-git.mjs';

// A repository: main m1..m6 (origin/main at m6), branch b off m2 (b1, b2, then b3 merging m4 in), branch c off m5,
// and u off m3 that no ref reaches. Answers { repo, sha: name -> full sha, done }.
function history() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'hq-ancestry-')));
  let tick = 0;
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_DATE: `2026-10-01T10:${String(tick).padStart(2, '0')}:00Z`, GIT_COMMITTER_DATE: `2026-10-01T10:${String(tick).padStart(2, '0')}:00Z` } }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
  const sha = {};
  const make = name => { tick++; writeFileSync(join(repo, `${name}.txt`), name); git('add', `${name}.txt`); git('commit', '-q', '-m', `feat: ${name}`); sha[name] = git('rev-parse', 'HEAD'); };
  for (const m of ['m1', 'm2']) make(m);
  git('checkout', '-q', '-b', 'b'); make('b1'); make('b2');
  git('checkout', '-q', 'main'); make('m3');
  git('checkout', '-q', '-b', 'u'); make('u'); git('checkout', '-q', 'main'); git('branch', '-q', '-D', 'u');
  make('m4');
  git('checkout', '-q', 'b'); tick++; git('merge', '-q', '--no-edit', 'main'); sha.b3 = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main'); make('m5');
  git('checkout', '-q', '-b', 'c'); make('c1');
  git('checkout', '-q', 'main'); make('m6');
  git('update-ref', 'refs/remotes/origin/main', sha.m6);
  return { repo, sha, done: () => rmSync(repo, { recursive: true, force: true }) };
}

// git as loadGit runs it, counting each process by its first word
const counting = () => {
  const ran = [];
  const exec = (cmd, args, opts) => { ran.push(args[0] === 'log' && args.includes('--name-status') ? 'log --name-status' : args[0]); return execFileSync(cmd, args, opts); };
  return { ran, exec };
};
const truth = (repo, a, b) => { try { execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: repo, stdio: 'ignore' }); return true; } catch (e) { return e.status === 1 ? false : null; } };

test('whether a commit holds a fix answers as git merge-base does, on main, on branches, after a merge and off every ref', () => {
  const h = history();
  try {
    const { contains } = loadGit({ repo: h.repo });
    const names = Object.keys(h.sha);
    for (const f of names) for (const c of names) {
      assert.equal(contains(h.sha[f], h.sha[c]), truth(h.repo, h.sha[f], h.sha[c]), `${f} in ${c}`);
      assert.equal(contains(h.sha[f].slice(0, 7), h.sha[c].slice(0, 9)), truth(h.repo, h.sha[f], h.sha[c]), `${f} in ${c}, short names`);
    }
    assert.equal(contains(h.sha.m1, 'feedfacefeedfacefeedfacefeedfacefeedface'), null, 'a commit git has never seen');
  } finally { h.done(); }
});

test('one read asks git a few times whatever the number of pairs, and a commit no ref reaches only once a pair', () => {
  const h = history();
  try {
    const { ran, exec } = counting();
    const { contains } = loadGit({ repo: h.repo, exec });
    const names = Object.keys(h.sha);
    for (let round = 0; round < 3; round++) for (const f of names) for (const c of names) contains(h.sha[f], h.sha[c]);
    assert.ok(ran.filter(w => w !== 'show').length <= 5, `git runs: ${ran.join(', ')}`);
  } finally { h.done(); }
});

test('a second read while origin/main has not moved reads no log again, and asks nothing git already answered', () => {
  const h = history();
  try {
    loadGit({ repo: h.repo }).contains(h.sha.m1, h.sha.u);
    const { ran, exec } = counting();
    const { contains } = loadGit({ repo: h.repo, exec });
    contains(h.sha.m1, h.sha.u); contains(h.sha.b1, h.sha.c1);
    assert.ok(!ran.includes('log --name-status') && !ran.includes('show'), `ran: ${ran.join(', ')}`);
    assert.ok(!ran.includes('merge-base'), `ran: ${ran.join(', ')}`);
    assert.ok(ran.length <= 3, `ran: ${ran.join(', ')}`);
  } finally { h.done(); }
});

test('a commit no ref reaches, or one git does not have, costs one git run however often it is asked', () => {
  const h = history();
  try {
    const { ran, exec } = counting();
    const { contains } = loadGit({ repo: h.repo, exec });
    const before = ran.length, gone = 'feedfacefeedfacefeedfacefeedfacefeedface';
    for (let round = 0; round < 3; round++) for (const f of Object.keys(h.sha)) {
      contains(h.sha[f], h.sha.u); contains(h.sha.u, h.sha[f]); contains(h.sha[f], gone); contains(gone, h.sha[f]);
    }
    assert.ok(ran.length - before <= 2, `asked git ${ran.length - before} more times: ${ran.slice(before).join(', ')}`);
    assert.equal(contains(h.sha.m3, h.sha.u.slice(0, 8)), true);
    assert.equal(contains(h.sha.m4, h.sha.u), false);
    assert.equal(contains(gone, h.sha.m6), null);
  } finally { h.done(); }
});
