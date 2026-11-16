// The repo's git health, read with git itself (no shell): this checkout, where it stands against the remote as of the
// last fetch, every worktree, stashes, and branches already merged into main. HQ only reads these. The one thing it
// does to git is fetch, and only when asked (server.mjs, /git/fetch).
import { execFile, spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// git with its arguments in a folder; answers what it printed, or '' when it failed.
export const runGit = (args, cwd) => new Promise(done => {
  execFile('git', args, { cwd, timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => done(err ? '' : String(stdout)));
});

// the same, with `input` written to git's stdin, for the commands that read their questions there (--stdin, --batch)
export const runGitIn = (input, args, cwd) => new Promise(done => {
  const p = spawn('git', args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }), out = [];
  const timer = setTimeout(() => p.kill(), 15000);
  p.stdout.on('data', d => out.push(d));
  p.on('error', () => { clearTimeout(timer); done(''); });
  p.on('close', code => { clearTimeout(timer); done(code ? '' : Buffer.concat(out).toString('utf8')); });
  p.stdin.on('error', () => { /* git ended before reading it all; close answers */ });
  p.stdin.end(input);
});

// `git status --porcelain=2 --branch`: the branch, its upstream and how far apart they are, and the changed,
// untracked and conflicted file counts.
export function parseStatus(text) {
  const out = { branch: '', upstream: '', ahead: null, behind: null, changed: 0, untracked: 0, conflicted: 0 };
  for (const line of String(text).split('\n')) {
    if (line.startsWith('# branch.head ')) out.branch = line.slice(14);
    else if (line.startsWith('# branch.upstream ')) out.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(line); if (m) { out.ahead = +m[1]; out.behind = +m[2]; } }
    else if (line.startsWith('1 ') || line.startsWith('2 ')) out.changed++;
    else if (line.startsWith('u ')) out.conflicted++;
    else if (line.startsWith('? ')) out.untracked++;
  }
  if (out.branch === '(detached)') out.branch = '';
  return out;
}

// `git worktree list --porcelain`: one entry per worktree, the main checkout first.
export function parseWorktrees(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), head: '', branch: '', detached: false, bare: false, prunable: false }; out.push(cur); }
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'bare') cur.bare = true;
    else if (line.startsWith('prunable')) cur.prunable = true;
  }
  return out;
}

// `git rev-list --left-right --count A...B` prints "<only in A>\t<only in B>".
export const parseCounts = text => { const m = /^(\d+)\s+(\d+)/.exec(String(text).trim()); return m ? [+m[1], +m[2]] : [null, null]; };

// When the last fetch happened, from the newest FETCH_HEAD in the repo's git folder and any worktree's.
export function lastFetch(commonDir) {
  const heads = [join(commonDir, 'FETCH_HEAD')];
  try { for (const w of readdirSync(join(commonDir, 'worktrees'))) heads.push(join(commonDir, 'worktrees', w, 'FETCH_HEAD')); } catch { /* no worktrees */ }
  let newest = 0;
  for (const h of heads) { try { newest = Math.max(newest, statSync(h).mtimeMs); } catch { /* never fetched there */ } }
  return newest ? new Date(newest).toISOString() : null;
}

const lines = text => String(text).split('\n').map(l => l.trim()).filter(Boolean);

// This checkout and where it stands against the remote: the Repo card on Home.
export async function checkoutHealth(repo, git = runGit) {
  const [status, common, remotes] = await Promise.all([
    git(['status', '--porcelain=2', '--branch'], repo),
    git(['rev-parse', '--git-common-dir'], repo),
    git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], repo),
  ]);
  const s = parseStatus(status), remoteRefs = lines(remotes);
  const main = remoteRefs.includes('origin/main') ? 'origin/main' : remoteRefs.includes('origin/master') ? 'origin/master' : '';
  const remote = { against: '', pushed: false, toPush: null, toPull: null };
  if (s.upstream && s.ahead != null) Object.assign(remote, { against: s.upstream, pushed: true, toPush: s.ahead, toPull: s.behind });
  else if (s.branch && remoteRefs.includes(`origin/${s.branch}`)) {
    const [pull, push] = parseCounts(await git(['rev-list', '--left-right', '--count', `origin/${s.branch}...HEAD`], repo));
    Object.assign(remote, { against: `origin/${s.branch}`, pushed: true, toPush: push, toPull: pull });
  } else if (main) {
    // never pushed: how far it is from main on the remote instead
    const [pull, push] = parseCounts(await git(['rev-list', '--left-right', '--count', `${main}...HEAD`], repo));
    Object.assign(remote, { against: main, pushed: false, toPush: push, toPull: pull });
  }
  const commonDir = common.trim() ? resolve(repo, common.trim()) : join(repo, '.git');
  return { branch: s.branch, changed: s.changed, untracked: s.untracked, conflicted: s.conflicted, clean: !s.changed && !s.untracked && !s.conflicted,
    remote, main, lastFetch: lastFetch(commonDir), hasRemote: remoteRefs.length > 0 };
}

// Everything: the checkout, every worktree, stashes, and local branches already merged into main.
export async function repoHealth(repo, git = runGit) {
  const checkout = await checkoutHealth(repo, git);
  const base = checkout.main || 'main';
  const [wtText, stashText, mergedText] = await Promise.all([
    git(['worktree', 'list', '--porcelain'], repo),
    git(['stash', 'list', '--format=%gd%x09%cI%x09%s'], repo),
    git(['branch', '--format=%(refname:short)', '--merged', base], repo),
  ]);
  // every branch's distance from base and last commit in one run (git 2.41's ahead-behind); a detached worktree, a
  // branch it does not list, or an older git that prints nothing, is asked on its own
  const tips = new Map();
  for (const line of lines(await git(['for-each-ref', `--format=%(refname)%09%(objectname)%09%(ahead-behind:${base})%09%(committerdate:iso-strict)`, 'refs/heads'], repo))) {
    const [ref, sha, ab, when] = line.split('\t'), m = /^(\d+) (\d+)$/.exec(ab || '');
    if (m && ref.startsWith('refs/heads/')) tips.set(ref.slice(11), { sha, ahead: +m[1], behind: +m[2], last: when || null });
  }
  const worktrees = await Promise.all(parseWorktrees(wtText).filter(w => !w.bare).map(async w => {
    if (w.prunable) return { ...w, missing: true };
    const tip = w.branch && tips.get(w.branch), known = tip && tip.sha === w.head;
    const [st, counts, last] = await Promise.all([
      git(['status', '--porcelain=2', '--branch'], w.path),
      known || !w.head ? '' : git(['rev-list', '--left-right', '--count', `${base}...${w.head}`], repo),
      known || !w.head ? '' : git(['log', '-1', '--format=%cI', w.head], repo),
    ]);
    const s = parseStatus(st), [behind, ahead] = known ? [tip.behind, tip.ahead] : parseCounts(counts);
    return { ...w, changed: s.changed, untracked: s.untracked, clean: !s.changed && !s.untracked && !s.conflicted, ahead, behind, lastCommit: (known ? tip.last : last.trim()) || null };
  }));
  const stashes = lines(stashText).map(l => { const [ref, when, ...msg] = l.split('\t'); return { ref, when, message: msg.join('\t') }; });
  const skip = new Set(['main', 'master', checkout.branch]);
  const merged = lines(mergedText).filter(b => !skip.has(b) && !b.startsWith('('));
  return { checkout, base, worktrees, stashes, merged };
}

// The whole picture kept: a page within KEPT_MS of the read asks git nothing; after that it answers from the read it
// has and queues one read with later(), which runs after the response is sent, as the Problems page does with its
// register. The first read and Refresh (fresh) read at once. Answers { health, readAt }.
export const KEPT_MS = 10000;
const KEPT = new Map();
export async function repoHealthKept(repo, { git = runGit, now = Date.now(), later = setImmediate, fresh = false } = {}) {
  const had = KEPT.get(repo);
  if (fresh || !had) {
    const read = { health: await repoHealth(repo, git), readAt: now, queued: false };
    KEPT.set(repo, read);
    return read;
  }
  if (now - had.readAt >= KEPT_MS && !had.queued) {
    had.queued = true;
    later(async () => {
      // a read that fails keeps the one the page has, and the next page queues another
      try { KEPT.set(repo, { health: await repoHealth(repo, git), readAt: Date.now(), queued: false }); } catch { had.queued = false; }
    });
  }
  return had;
}
// after a fetch the distances from main have moved: the next page reads again
export const forgetRepoHealth = () => KEPT.clear();
