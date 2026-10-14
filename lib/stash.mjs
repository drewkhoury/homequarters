// Answers from GitHub and Firebase, kept in memory and on disk (~/.cache/questkeep/hq, one JSON file per question
// with the time it was answered), so HQ shows the last answer at once, even straight after a restart, and asks again
// in the background when the answer is old. The freshness rules are here so they can be tested on their own.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// How old an answer may be before HQ asks again: billing changes every few hours, so 10 minutes; the rest 30 s.
export const MAX_AGE = { actions: 10 * 60000, firebase: 5 * 60000, default: 30000 };
export const maxAge = name => MAX_AGE[name] ?? MAX_AGE.default;

// 'missing' (nothing kept: ask and wait), 'stale' (show it, ask again behind it), or 'fresh' (show it, done).
// force (the Refresh button) makes anything kept stale.
export function freshness(entry, name, now, force = false) {
  if (!entry || entry.at == null) return 'missing';
  if (force) return 'stale';
  return now - entry.at > maxAge(name) ? 'stale' : 'fresh';
}

// A short, safe file name for a question about a repo.
export const fileFor = (dir, name, repo) => join(dir, `${name.replace(/[^\w-]/g, '_')}-${createHash('sha1').update(String(repo)).digest('hex').slice(0, 10)}.json`);

export function readEntry(file) {
  try { const e = JSON.parse(readFileSync(file, 'utf8')); return e && typeof e.at === 'number' ? e : null; } catch { return null; }
}
export function writeEntry(file, entry) {
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file + '.tmp', JSON.stringify(entry));
    renameSync(file + '.tmp', file); // whole or not at all, so a half-written file never reads back
  } catch { /* a cache that cannot be written only means a slower next start */ }
}

// One kept answer per question. get() answers what is kept and, when it is old, asks again behind it:
//   { at, data } or { at, problem }, with refreshing: true while a new answer is on its way
//   wait: true waits for that new answer instead; force: true asks again whatever the age
// ask() is the question itself, answering { data } or { problem }. A failed answer is never kept over a good one:
// the good one stays, marked with the problem.
export function makeStash({ dir = null, now: clock = () => Date.now() } = {}) {
  const mem = new Map(), inflight = new Map();
  const load = (name, repo) => {
    const file = fileFor(dir || '', name, repo);
    if (!mem.has(file)) { const e = dir ? readEntry(file) : null; if (e) mem.set(file, e); }
    return [file, mem.get(file) || null];
  };
  const refresh = (file, ask, at) => {
    if (inflight.has(file)) return inflight.get(file);
    const job = (async () => {
      let got;
      try { got = await ask(); } catch (e) { got = { problem: { kind: 'error', message: e.message || String(e), fix: '' } }; }
      const old = mem.get(file);
      if (got.problem) {
        if (old && old.data !== undefined) { const kept = { ...old, problem: got.problem, failedAt: at }; mem.set(file, kept); return kept; }
        return { at, problem: got.problem }; // nothing good to keep; not written, so the next look asks again
      }
      const entry = { at, data: got.data };
      mem.set(file, entry);
      if (dir) writeEntry(file, entry);
      return entry;
    })();
    inflight.set(file, job);
    job.then(() => inflight.delete(file));
    return job;
  };
  return {
    async get(name, repo, ask, { force = false, wait = false, now = clock() } = {}) {
      const [file, entry] = load(name, repo);
      const state = freshness(entry, name, now, force);
      if (state === 'missing' || force || (state === 'stale' && wait)) return refresh(file, ask, now);
      if (state === 'stale') { refresh(file, ask, now); return { ...entry, refreshing: true }; }
      return entry;
    },
    forget() { mem.clear(); }, // as after a restart: the next get reads the disk
  };
}
