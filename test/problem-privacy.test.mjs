// Proves: what the problem register refuses to write (lib/problem-privacy.mjs), one test per pattern: the writer
// refuses, and the export checks again.
// Why: the events file stays on the laptop but shows on HQ and leaves in every export, and a backfilled "line" can be
// a whole message holding someone's address or a path into private folders (Theo's review of the plan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { textProblems } from '../lib/problem-privacy.mjs';

// a laptop as the check sees it: its home, the repo and the cache the manifest names (privacyContext gives them), the
// email domains HQ's demo setting keeps, and the strings it lists as private (the demo lists the home folder's own name
// as private too, as this laptop's does)
const CTX = { home: '/Users/someone', repo: '/Users/someone/repos/questkeep', cache: '/Users/someone/.cache/questkeep',
  keepEmailDomains: ['example.com', 'github.com'], private: ['Hollowmere', 'Pip Bramble', 'someone'] };
const ok = text => assert.deepEqual(textProblems(text, CTX), [], text);
const refused = (text, why) => {
  const r = textProblems(text, CTX);
  assert.ok(r.some(x => why.test(x)), `${text} should be refused for ${why}, got ${JSON.stringify(r)}`);
  assert.ok(r.every(x => !x.includes(text)), 'the reason never repeats what it refused');
};

test('a plain pointer to evidence is written', () => {
  ok('run 2026-10-11T04-50-29Z_058624, tests/smoke-sync.js:120, fix 1e79f371');
  ok('~/.cache/questkeep/results/2026-10-11T04-50-29Z-EjtVdI/logs/smoke-nogl.log:12');
  ok('/Users/someone/repos/questkeep-problems/scripts/lock.mjs:246 and ~/repos/questkeep/Makefile:823');
  ok('feedback/8ZQ3k2 reported the board reset');
});

test('text is one line of at most 200 characters', () => {
  ok('x'.repeat(200));
  refused('x'.repeat(201), /200 characters/);
  refused('first line\nsecond line', /one line/);
});

test("an email address is refused unless its domain is one HQ's demo keeps", () => {
  refused('reported by a.player@gmail.com after sign-in', /email address/);
  refused('see someone@sub.mail.co.uk', /email address/);
  ok('mail went to noreply@example.com and git@github.com');
  ok('pushed as 41898282+ci-bot@users.noreply.github.com'); // a kept domain's subdomain
});

test('a token is refused, whatever kind', () => {
  refused('Authorization: Bearer abcdefgh12345678', /token/);
  refused('access ya29.a0AfH6SMBx-abc', /token/);
  refused('the push used ghp_0123456789abcdefghijABCDEFGHIJ', /token/);
  refused('cookie eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJl', /token/);
});

test('a path into the private folders is refused, written either way', () => {
  refused('copied from /Users/someone/notes/2026/october.md', /private folder/);
  refused('see ~/personal/taxes', /private folder/);
});

test('an absolute path outside the repo, its worktrees and the cache is refused', () => {
  refused('read /Users/someone/Documents/plan.pdf', /outside/);
  refused('left in /private/var/folders/tj/x/T/qk-1', /outside/);
  refused('~/Downloads/export.json', /outside/);
  ok('/Users/someone/.cache/questkeep/lock/log.jsonl');
});

test("an account id is refused, in a document path or alone", () => {
  refused('the write to users/Kq9mXz2LrT8vNw4bYc6dPf1sHj3a failed', /account id/);
  refused('uid Kq9mXz2LrT8vNw4bYc6dPf1sHj3a', /account id/);
  ok('commit 1e79f3713c5b9a1f2d0e4c6b8a7f9e0d1c2b3a4f'); // a hash is not an id
});

test("a string HQ's demo setting lists as private is refused, in any case", () => {
  refused('the world hollowmere lost its board', /private/);
  refused('Pip Bramble saw it', /private/);
  refused('asked by someone in review', /private/);
});

// HQ's demo shows the home folder as ~ before it looks for private strings, so a path in the cache or the repo is not
// refused for the home folder's name in it (on 11 October 203 of 226 backfill lines were, before this).
test('the home folder in an allowed path is not read as a private string', () => {
  ok('/Users/someone/.cache/questkeep/results/r1/logs/smoke-sync.log:40');
  ok('/Users/someone/repos/questkeep/Makefile:823');
});

test('anything but text is refused', () => {
  assert.deepEqual(textProblems(42, CTX), ['it is not text']);
});

// Theo's review of the build, finding 4: shapes this laptop really has that the check let through.
test('a file link and a path that climbs out of an allowed folder are checked as the path they name', () => {
  refused('see file:///Users/someone/personal/a.md', /private folder/);
  refused('file:///Users/someone/Documents/x.pdf', /outside/);
  refused('~/.cache/questkeep/../../notes/today.md', /private folder/);
  refused('/Users/someone/repos/questkeep/../secret/plan.md', /outside/);
  ok('file:///Users/someone/.cache/questkeep/results/r1/logs/smoke-sync.log');
});

test('the other secrets this laptop holds are refused', () => {
  refused('pushed with github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', /token/);
  refused('posted to https://discord.com/api/webhooks/1234567890/abcdefGHIJKL-mnop', /token/);
  refused('-----BEGIN OPENSSH PRIVATE KEY----- b3BlbnNzaC1rZXk', /token/);
  refused('key sk-ant-api03-abcdefghijklmnopqrstuvwx', /token/);
});

// Theo's review of the build, finding 5: backfill step 2 cites a transcript by file and line, as the plan's Privacy
// section says, and the check refused it. (QuestKeep's HQ also allowed a pointer into the meta-analysis repo beside it;
// the check now allows only the repo, its worktrees, the cache and the repo's transcripts, so that allowance is gone.)
test("a pointer into this project's transcripts is written, and one into another project's is not", () => {
  ok('~/.claude/projects/-Users-someone-repos-questkeep/3d143a95-6a0f-413e-aff8-88f937701c4b.jsonl:412');
  refused('~/.claude/projects/-Users-someone-repos-othergame/abc.jsonl:3', /outside/);
  refused('~/.claude/settings.json', /outside/);
});

test('with no repo and no cache given, only the private folders are refused, since nothing says where the project is', () => {
  const bare = { ...CTX, repo: null, cache: null };
  assert.deepEqual(textProblems('read /Users/someone/Documents/plan.pdf', bare), []);
  assert.ok(textProblems('see ~/personal/taxes', bare).some(x => /private folder/.test(x)));
});
