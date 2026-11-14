// The problem register's entries from git (docs/plans/problem-register.md, Backfill step 1). Each fix: commit is a closed
// entry fixed by itself (hq/lib/problem-trailers.mjs), its signature taking in the files of its failing-test commit,
// which is its guard. A bug file in docs/backlog/ that a commit deleted (the backlog ships an item by deleting its file)
// gives the entry its title and who asked; one deleted by a commit that is not a fix is a closed entry with no fix.
// Nothing beyond what the commits and files say is inferred. loadGit runs git; the rest reads its output.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { fixEntry, findersOf } from './problem-trailers.mjs';

// one commit: a record separator, then hash, author date, subject and body split by unit separators, then --name-status
export const LOG_FORMAT = '%x1e%H%x1f%aI%x1f%s%x1f%b%x1f';

export function parseLog(text) {
  return String(text || '').split('\x1e').filter(c => c.includes('\x1f')).map(chunk => {
    const [sha, at, subject, body, rest = ''] = chunk.split('\x1f');
    const changes = rest.split('\n').map(l => l.split('\t')).filter(p => p.length >= 2 && /^[A-Z]\d*$/.test(p[0]));
    return { sha: sha.trim(), at: at.trim(), subject: subject.trim(), body: body.trim(),
      files: changes.map(p => p[p.length - 1]), deleted: changes.filter(p => p[0] === 'D').map(p => p[1]) };
  });
}

const summary = subject => subject.replace(/^\w+(\([^)]*\))?!?:\s*/, '');
const isFix = c => /^fix(\([^)]*\))?!?:/.test(c.subject);

// A bug file's title and who asked, or null for any other kind of backlog file.
export function backlogBug(text) {
  if (!text) return null;
  const front = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!front || !/^type:\s*bug\s*$/m.test(front[1])) return null;
  const asked = /^asked:\s*(.+)$/m.exec(front[1]);
  const title = /^#\s+(.+)$/m.exec(text.slice(front[0].length));
  return { title: title ? title[1].trim() : null, asked: asked ? asked[1].trim() : null };
}

// The entries git gives. commits: parseLog's, newest first; show(rev, path): a file's text at a revision, or null.
export function gitEntries(commits, show) {
  const out = [];
  const bugsDeleted = c => c.deleted.filter(f => f.startsWith('docs/backlog/') && f.endsWith('.md') && !f.endsWith('README.md'))
    .map(f => ({ path: f, bug: backlogBug(show(`${c.sha}^`, f)) })).filter(x => x.bug);
  commits.forEach((c, i) => {
    if (isFix(c)) {
      // its failing-test commit: the nearest earlier test: commit with the same summary
      const red = commits.slice(i + 1).find(t => /^test(\([^)]*\))?:/.test(t.subject) && summary(t.subject) === summary(c.subject));
      const e = fixEntry({ sha: c.sha, at: c.at, subject: c.subject, body: c.body, files: [...c.files, ...(red ? red.files : [])] });
      if (red) e.guard = red.sha;
      const [first] = bugsDeleted(c);
      if (first) {
        e.backlog = first.path;
        if (first.bug.title) e.title = first.bug.title;
        if (!e.foundBy.length && first.bug.asked) e.foundBy = findersOf(first.bug.asked);
      }
      out.push(e);
      return;
    }
    for (const { path, bug } of bugsDeleted(c)) {
      out.push({ id: `B-${basename(path, '.md')}`, source: 'git', title: bug.title || basename(path, '.md'), kind: null, signature: null, foundAt: null,
        foundBy: bug.asked ? findersOf(bug.asked) : [], playerFacing: null, fix: null, openedAt: c.at, closedAt: c.at, closedBy: c.sha,
        status: 'closed', disposition: null, record: 'live', backlog: path, problems: [], events: [] });
    }
  });
  return out;
}

// Whether commit holds fix, from main's first-parent list (line, newest first): main is a straight line, since pull
// requests land by rebase or squash, so for two commits on it "commit holds fix" is "fix is no newer", as make dora
// answers it. Either may be named by seven characters or more. A commit off the line goes to ask(fix, commit), which
// answers true, false or null when git cannot say.
export function lineContains(line, ask) {
  const age = new Map();
  line.forEach((sha, i) => { if (!age.has(sha.slice(0, 7))) age.set(sha.slice(0, 7), i); });
  return (fix, commit) => {
    const a = age.get(String(fix).slice(0, 7)), b = age.get(String(commit).slice(0, 7));
    return a != null && b != null ? b <= a : ask(fix, commit);
  };
}

// What git says on this checkout since a day: the entries, and contains(fix, commit) for the reader, asked of git once
// per pair: true, false, or null when git cannot place a commit. repo: the checkout; since: yyyy-mm-dd; rev: what to read (origin/main).
// exec: how git is run, execFileSync's shape; tests hand in one that counts.
export function loadGit({ repo, since = '2026-09-24', rev = 'origin/main', exec = execFileSync }) {
  const git = (...a) => { try { return exec('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
  // merge-base --is-ancestor exits 0 when the fix is in the commit, 1 when it is not, and otherwise when git cannot say
  const ancestor = (a, b) => { try { exec('git', ['merge-base', '--is-ancestor', a, b], { cwd: repo, stdio: 'ignore' }); return true; } catch (e) { return e.status === 1 ? false : null; } };
  const commits = parseLog(git('log', rev, `--since=${since}`, `--format=${LOG_FORMAT}`, '--name-status') || '');
  const entries = gitEntries(commits, (r, path) => git('show', `${r}:${path}`));
  const seen = new Map();
  // main's first-parent line, newest first, with each commit's time
  const line = (git('log', '--first-parent', '--format=%H %ct', rev) || '').split('\n').filter(Boolean).map(l => l.split(' '));
  const made = new Map(line.map(([sha, t]) => [sha.slice(0, 7), Number(t) * 1000]));
  const fixTime = fix => made.get(String(fix).slice(0, 7)) ?? null;
  const contains = lineContains(line.map(([sha]) => sha), (fix, commit) => {
    const k = `${fix} ${commit}`;
    if (!seen.has(k)) seen.set(k, ancestor(fix, commit));
    return seen.get(k);
  });
  return { entries, contains, fixTime, commits: commits.length };
}
