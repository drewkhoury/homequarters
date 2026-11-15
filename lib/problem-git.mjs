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
// ancestors once, into a bitset, so a pair costs one lookup. contains.add(text) takes in more of the graph in the same
// form, such as the commits only a deleted branch reached; contains.knows(name) says whether a name is in it.
export function graphContains(text) {
  const index = new Map(), list = [], parents = [], byPrefix = new Map();
  const add = more => {
    const lines = String(more || '').split('\n').filter(Boolean).map(l => l.split(' ')).filter(([sha]) => !index.has(sha));
    for (const [sha] of lines) {
      index.set(sha, list.length); list.push(sha); parents.push([]);
      const k = sha.slice(0, 7); if (!byPrefix.has(k)) byPrefix.set(k, []); byPrefix.get(k).push(sha);
    }
    // a commit taken in later is never an ancestor of one already in, so the bitsets already made stay true
    for (const [sha, ...ps] of lines) parents[index.get(sha)] = ps.map(p => index.get(p)).filter(i => i != null);
  };
  add(text);
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
  const contains = (fix, commit) => {
    const a = resolve(fix), b = resolve(commit);
    if (a == null || b == null) return null;
    return Boolean(ancestors(b)[a >> 3] & (1 << (a & 7)));
  };
  return Object.assign(contains, { add, knows: name => resolve(name) != null });
}

// show(rev, path) for gitEntries, every file it will ask for read in one cat-file --batch: the backlog files the
// commits deleted, each at its commit's parent. A file git cannot give reads as null.
const BACKLOG = f => f.startsWith('docs/backlog/') && f.endsWith('.md') && !f.endsWith('README.md');
export function shown(commits, gitIn) {
  const asks = commits.flatMap(c => c.deleted.filter(BACKLOG).map(f => `${c.sha}^:${f}`));
  const text = new Map();
  if (asks.length) {
    const out = Buffer.from(gitIn(asks.join('\n') + '\n', 'cat-file', '--batch') || '', 'utf8');
    let at = 0;
    for (const ask of asks) {
      const nl = out.indexOf(10, at);
      if (nl < 0) break;
      const head = out.subarray(at, nl).toString('utf8').split(' ');
      at = nl + 1;
      if (head[1] === 'missing' || head.length < 3) continue;
      const size = Number(head[2]);
      text.set(ask, out.subarray(at, at + size).toString('utf8'));
      at += size + 1;
    }
  }
  return (rev, path) => text.get(`${rev}:${path}`) ?? null;
}

// What git said, kept per checkout while the refs print the same.
const KEPT = new Map();

// What git says on this checkout since a day: the entries, and contains(fix, commit) for the reader: true, false, or
// null when git cannot place a commit. repo: the checkout; since: yyyy-mm-dd; rev: what to read (origin/main);
// exec: how git is run, execFileSync's shape; tests hand in one that counts.
export function loadGit({ repo, since = '2026-09-24', rev = 'origin/main', exec = execFileSync }) {
  const git = (...a) => { try { return exec('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
  // git with lines on its standard input, as cat-file --batch reads them
  const gitIn = (input, ...a) => { try { return exec('git', a, { cwd: repo, input, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['pipe', 'pipe', 'ignore'] }); } catch { return null; } };
  const refs = git('rev-parse', rev, 'HEAD', '--all'), key = `${repo}\n${since}\n${rev}`;
  const kept = KEPT.get(key);
  if (refs != null && kept && kept.refs === refs) return kept.out;
  const commits = parseLog(git('log', rev, `--since=${since}`, `--format=${LOG_FORMAT}`, '--name-status') || '');
  const entries = gitEntries(commits, shown(commits, gitIn));
  const graph = graphContains(git('log', '--all', '--format=%H %P'));
  // main's first-parent line, newest first, with each commit's time
  const line = (git('log', '--first-parent', '--format=%H %ct', rev) || '').split('\n').filter(Boolean).map(l => l.split(' '));
  const made = new Map(line.map(([sha, t]) => [sha.slice(0, 7), Number(t) * 1000]));
  const fixTime = fix => made.get(String(fix).slice(0, 7)) ?? null;
  // a commit no ref reaches, such as one on a branch since deleted, brings in the history only it reaches, once; one
  // git does not have stays unknown, and is asked about once
  // learn(names) looks up every name not yet tried together: cat-file says which git has, then one log takes in
  // what only they reach. contains.learn is it, for a reader that knows its names before it asks about pairs.
  const tried = new Set();
  const learn = names => {
    const fresh = [...new Set(names.map(n => String(n || '')))].filter(s => /^[0-9a-f]{7,40}$/.test(s) && !tried.has(s) && !graph.knows(s));
    if (!fresh.length) return;
    fresh.forEach(s => tried.add(s));
    // one name needs no cat-file: a log of a name git lacks fails, and that name stays unknown
    if (fresh.length === 1) { graph.add(git('log', '--format=%H %P', fresh[0], '--not', '--all')); return; }
    const have = (gitIn(fresh.map(s => `${s}^{commit}`).join('\n') + '\n', 'cat-file', '--batch-check') || '').split('\n')
      .map(l => l.split(' ')).filter(p => p[1] === 'commit').map(p => p[0]);
    if (have.length) graph.add(git('log', '--format=%H %P', ...have, '--not', '--all'));
  };
  const contains = lineContains(line.map(([sha]) => sha), (fix, commit) => {
    const known = graph(fix, commit);
    if (known != null) return known;
    learn([fix, commit]);
    return graph(fix, commit);
  });
  contains.learn = names => learn(names);
  const out = { entries, contains, fixTime, commits: commits.length };
  if (refs != null) KEPT.set(key, { refs, out });
  return out;
}
