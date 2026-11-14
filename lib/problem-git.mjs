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

// Whether fix is in commit, from the commit graph as `git log --all --format='%H %P'` prints it: true or false, or
// null when the graph lacks either or a short name fits more than one commit. Each commit asked about walks its
// ancestors once, into a bitset, so a pair costs one lookup.
export function graphContains(text) {
  const index = new Map(), list = [];
  const lines = String(text || '').split('\n').filter(Boolean).map(l => l.split(' '));
  for (const [sha] of lines) if (!index.has(sha)) { index.set(sha, list.length); list.push(sha); }
  const parents = new Array(list.length).fill(null).map(() => []);
  for (const [sha, ...ps] of lines) parents[index.get(sha)] = ps.map(p => index.get(p)).filter(i => i != null);
  const byPrefix = new Map();
  for (const sha of list) { const k = sha.slice(0, 7); if (!byPrefix.has(k)) byPrefix.set(k, []); byPrefix.get(k).push(sha); }
  const resolve = name => {
    const s = String(name || '');
    if (index.has(s)) return index.get(s);
    if (s.length < 7) return null;
    const fits = (byPrefix.get(s.slice(0, 7)) || []).filter(x => x.startsWith(s));
    return fits.length === 1 ? index.get(fits[0]) : null;
  };
  const reach = new Map();
  const ancestors = i => {
    if (reach.has(i)) return reach.get(i);
    const bits = new Uint8Array((list.length >> 3) + 1), stack = [i];
    while (stack.length) {
      const n = stack.pop();
      if (bits[n >> 3] & (1 << (n & 7))) continue;
      bits[n >> 3] |= 1 << (n & 7);
      for (const p of parents[n]) stack.push(p);
    }
    reach.set(i, bits);
    return bits;
  };
  return (fix, commit) => {
    const a = resolve(fix), b = resolve(commit);
    if (a == null || b == null) return null;
    return Boolean(ancestors(b)[a >> 3] & (1 << (a & 7)));
  };
}

// What git said, kept per checkout while the refs print the same (KEPT), and merge-base's answers, which never change
// once git has given one (ASKED). A commit no ref reaches, such as a soak copy's, is the only one merge-base is asked.
const KEPT = new Map(), ASKED = new Map();

// What git says on this checkout since a day: the entries, and contains(fix, commit) for the reader: true, false, or
// null when git cannot place a commit. repo: the checkout; since: yyyy-mm-dd; rev: what to read (origin/main);
// exec: how git is run, execFileSync's shape; tests hand in one that counts.
export function loadGit({ repo, since = '2026-09-24', rev = 'origin/main', exec = execFileSync }) {
  const git = (...a) => { try { return exec('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
  const refs = git('rev-parse', rev, 'HEAD', '--all'), key = `${repo}\n${since}\n${rev}`;
  const kept = KEPT.get(key);
  if (refs != null && kept && kept.refs === refs) return kept.out;
  // merge-base --is-ancestor exits 0 when the fix is in the commit, 1 when it is not, and otherwise when git cannot say
  const ancestor = (a, b) => {
    const k = `${repo}\n${a} ${b}`;
    if (ASKED.has(k)) return ASKED.get(k);
    let answer;
    try { exec('git', ['merge-base', '--is-ancestor', a, b], { cwd: repo, stdio: 'ignore' }); answer = true; } catch (e) { answer = e.status === 1 ? false : null; }
    if (answer !== null) ASKED.set(k, answer);
    return answer;
  };
  const commits = parseLog(git('log', rev, `--since=${since}`, `--format=${LOG_FORMAT}`, '--name-status') || '');
  const entries = gitEntries(commits, (r, path) => git('show', `${r}:${path}`));
  const graph = graphContains(git('log', '--all', '--format=%H %P'));
  // main's first-parent line, newest first, with each commit's time
  const line = (git('log', '--first-parent', '--format=%H %ct', rev) || '').split('\n').filter(Boolean).map(l => l.split(' '));
  const made = new Map(line.map(([sha, t]) => [sha.slice(0, 7), Number(t) * 1000]));
  const fixTime = fix => made.get(String(fix).slice(0, 7)) ?? null;
  const contains = lineContains(line.map(([sha]) => sha), (fix, commit) => graph(fix, commit) ?? ancestor(fix, commit));
  const out = { entries, contains, fixTime, commits: commits.length };
  if (refs != null) KEPT.set(key, { refs, out });
  return out;
}
