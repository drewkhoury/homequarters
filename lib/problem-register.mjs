// The problem register as HQ reads it: the events file's entries (hq/lib/problems.mjs) and git's (hq/lib/problem-git.mjs),
// joined to the observations worked out from the run store and the lock log (hq/lib/problem-observations.mjs) by
// hq/lib/problem-derive.mjs. Nothing is stored; HQ's Problems page and its JSON export call this each time. Each source
// can be passed in, as the tests do, and is read from the laptop's stores when it is not.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { allRuns } from './runs.mjs';
import { fold } from './problems.mjs';
import { observeReds, observeSlot, observePulls } from './problem-observations.mjs';
import { derive, testResults } from './problem-derive.mjs';
import { loadGit } from './problem-git.mjs';
import { catalogue } from './catalogue.mjs';
import { testKeyer } from './problem-observations.mjs';
import { causesOfFolder, recentPassingLines } from './facts.mjs';
import { jsonLines } from './json-lines.mjs';

// A red's cause, the error line the facts line gave its test (scripts/facts.mjs): read once per run, from the run's own
// folder, a laptop run's results folder (info.out) or a CI run's kept artifact folders. A unit test's line is named
// "unit: <its title>" there.
// What each folder's logs say is saved to <cache>/hq/causes-index.json, so a restart reads only the folders that changed.
// stamps: folderStamps' answer for the folders, taken a moment before (causeFolders says which), so none is stat'd here.
const foldersOf = (r, cache) => (r.source === 'ci' ? (r.parts || []).map(p => join(cache, 'ci', p.id)) : [r.info && r.info.out].filter(Boolean));
function causeFinder(cache, stamps = null) {
  const index = join(cache, 'hq', 'causes-index.json');
  const byRun = new Map(), also = recentPassingLines(cache, { index });
  return (r, task, name) => {
    if (!byRun.has(r.id)) {
      const m = new Map();
      for (const f of foldersOf(r, cache)) for (const [k, v] of causesOfFolder(f, also, { index, stamps })) if (!m.has(k)) m.set(k, v);
      byRun.set(r.id, m);
    }
    const m = byRun.get(r.id);
    return m.get(name) || m.get(`unit: ${name}`) || null;
  };
}

// The folders whose causes a read of the register looks in: those of each run with a red that names its test.
export function causeFolders(runs, { cache, files = [] }) {
  const named = new Set(observeReds(runs, { keyOf: testKeyer(files) }).filter(o => o.task && !o.sig.startsWith('task:')).map(o => o.run));
  return runs.filter(r => named.has(r.id)).flatMap(r => foldersOf(r, cache));
}

const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const lines = jsonLines;
// the day the register's history starts: the run store, the lock log and git are read from here (Backfill step 1)
export const START = Date.parse('2026-09-24T00:00:00Z');
export const problemsDir = (env = process.env, cache = join(homedir(), '.cache', 'hq')) => env.HQ_PROBLEMS_DIR || join(cache, 'problems');

// The tests whose results the register reads: each fixed flaky test, whose fix it checks has held. extra: more a
// caller reads from the same records, so testResults(runs, { keyOf, keep: resultKeysOf(reg.entries, extra) }) answers
// the register's own.
export const resultKeysOf = (entries, extra = []) => [...entries.filter(p => p.kind === 'flaky-test' && p.disposition === 'fixed').map(p => p.signature), ...extra];

// resultKeys: tests whose results a caller reads too (resultKeysOf).
// { entries, unexplained, leftOut, notPlaced, observations: { reds, slot, prs }, changes, start, readAt, sources }. repo: the checkout git is read in; cache: ~/.cache/questkeep.
export function readRegister({ repo, cache = join(homedir(), '.cache', 'hq'), now = Date.now(),
  runs = allRuns(cache), lock = lines(join(cache, 'lock', 'log.jsonl')), events = lines(join(problemsDir(process.env, cache), 'events.jsonl')),
  git = loadGit({ repo, since: new Date(START).toISOString().slice(0, 10) }), files = repo ? catalogue(repo) : [], changes, resultKeys = [], stamps = null } = {}) {
  // make dora's figures, or none read yet: an absent file is not a week with no pull requests waiting
  const dora = changes ? { changes } : readJson(join(cache, 'dora', 'changes.json'));
  changes = (dora && dora.changes) || [];
  const keyOf = testKeyer(files);
  const ledger = fold(events);
  const reds = observeReds(runs, { keyOf, causeOf: causeFinder(cache, stamps) }), slot = observeSlot(lock), prs = observePulls(changes, (dora && dora.merges) || null);
  const all = [...ledger.entries, ...git.entries];
  const results = testResults(runs, { keyOf, keep: resultKeysOf(all, resultKeys) });
  // every commit derive will ask about, looked up together first: a git run or two, not one per commit
  if (git.contains && git.contains.learn) git.contains.learn([...all.map(p => p.fix), ...reds.map(o => o.commit), ...Object.values(results).flatMap(rs => rs.map(r => r.commit))]);
  const { entries, unexplained, leftOut } = derive(all, { reds, slot, prs, results, contains: git.contains, fixTime: git.fixTime, now });
  return { entries, unexplained, leftOut, notPlaced: ledger.notPlaced, observations: { reds, slot, prs }, changes, start: START, readAt: now,
    sources: { runs: runs.length, lockLines: lock.length, events: events.length, gitEntries: git.entries.length, reds: reds.length, waits: slot.filter(o => o.type === 'wait').length, prWaits: prs.length, prRead: !!dora } };
}
