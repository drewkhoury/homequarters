// The problem register's reader, where its two layers meet (docs/plans/problem-register.md, "What the reader works
// out"): each entry (hq/lib/problems.mjs's fold) gets the observations it explains (hq/lib/problem-observations.mjs),
// what they cost, whether its fix held, and whether it came back; observations no entry explains are grouped as
// unexplained. Nothing here is stored: HQ works it out each time it asks.
import { machineMinutes } from './problem-observations.mjs';
import { kept } from './kept.mjs';
import { STAGE, canonStage, lateFinder } from './problems.mjs';

const DAY = 86400000;
export const LEAD_DAYS = 7; // an entry owns observations from this long before it opened, the ones that led to it
export const ALIVE_DAYS = 7; // a group seen within this long is alive, otherwise quiet
export const RULE_OF_THREE = 3; // a fix holds after this many times its runs per red, clean
export const HELD_DAYS = 2; // over at least this many days on which the test ran
const GATE_KINDS = new Set(['gate', 'docker-gate']); // a fix is held against full gate runs, not soak or deploy runs

// Which observations each kind of entry owns. A flake owns only flaky reds; a real break of the same test is a test
// failure's. Agent mistakes and proof churn leave nothing in the stores, so they own none and their costs are not
// measured.
const OWNS = {
  'flaky-test': o => o.type === 'red' && o.class === 'flaky',
  'test-failure': o => o.type === 'red' && (o.class === 'never-rerun' || o.class === 'red-twice'),
  'product-bug': o => o.type === 'red' && (o.class === 'never-rerun' || o.class === 'red-twice'),
  'tooling-breakage': o => o.type === 'red' && (o.class === 'infra' || o.class === 'resource'),
  'slot-contention': o => o.type === 'wait' && o.behind === 'other',
  'pr-pileup': o => o.type === 'pr-wait',
};
export const NOT_MEASURED = new Set(['agent-mistake', 'proof-churn']);

const timeOf = o => Date.parse(o.when || o.at);
const sigOf = o => (o.type === 'red' ? o.sig : o.type === 'pr-wait' ? 'pr' : 'slot');
// What the stores saw, for grouping what no entry owns; null for what is left out on purpose: a red on a dirty tree says
// nothing about a commit, and a wait behind the waiter's own session is the queue working.
const FAMILY = { flaky: 'flaky', 'passed-alone': 'passed-alone', 'never-rerun': 'real', 'red-twice': 'real', infra: 'infra', resource: 'resource' };
const familyOf = o => (o.type === 'red' ? FAMILY[o.class] || null : o.type === 'wait' ? (o.behind === 'own' ? null : 'wait') : o.type);

// Every test's results, from each run's own tasks (a rerun's left out), each test named as its reds are (testKeyer):
// { test: [{ run, when, commit, status, full, kind, seconds }] },
// full when the run was whole and clean, which is what a fix is held against.
// Kept against the runs and the keyer (testKeyer keeps one per list of files), so the Problems page and the register
// it reads work it out once between them.
const byName = (task, name) => name;
// keep: the keys to make records for, or every key without it. A record is made per result, so only what is read is
// worth making: of QuestKeep's 2.8 million results, the register and the Tests tab read about 240,000.
export function testResults(runs, { keyOf = byName, keep = null } = {}) {
  return resultsOf(runs, keyOf, keep == null ? null : JSON.stringify([...new Set(keep)].filter(k => k != null).sort()));
}
const resultsOf = kept((runs, keyOf, keepKey) => {
  const out = {}, want = keepKey == null ? null : new Set(JSON.parse(keepKey));
  for (const r of runs) for (const t of r.tasks) {
    if (t.id === 'rerun') continue;
    for (const c of t.cases) {
      const k = keyOf(t.id, c.name);
      if (want && !want.has(k)) continue;
      (out[k] ||= []).push({ run: r.id, when: r.when, commit: r.info.commit || null, status: c.status, full: !r.info.partial && !r.info.dirty, kind: r.info.kind || null, seconds: c.seconds || 0 });
    }
  }
  // each time read once: about a hundred thousand results, sorted
  for (const k of Object.keys(out)) out[k] = out[k].map(r => [Date.parse(r.when), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  return out;
});

// entries: fold()'s; reds and slot: the observations; results: testResults(); contains(fix, commit): whether a commit
// holds the fix commit (git merge-base --is-ancestor), or null when git cannot say, which falls back to the close time;
// fixTime(fix): the fix commit's time on main in ms, or null; now: ms. Answers { entries, unexplained, leftOut }.
export function derive(entries, { reds = [], slot = [], prs = [], results = {}, contains = () => null, fixTime = () => null, now = Date.now() }) {
  const byId = new Map(entries.map(p => [p.id, p]));
  // a merged duplicate's signature counts for the entry it was merged into, so its observations go there
  const target = p => { let q = p; for (let i = 0; q && q.status === 'merged' && i < 10; i++) q = byId.get(q.mergedInto); return q || p; };
  const sigs = new Map(); // signature -> entries that own it, the merged ones' targets in their place
  for (const p of entries) if (p.signature) { const t = target(p); if (!sigs.has(p.signature)) sigs.set(p.signature, new Set()); sigs.get(p.signature).add(t); }
  // each entry's close and open, parsed once: asked of every pair of entries below
  const closes = new Map(), opens = new Map();
  const fixAt = p => { if (!closes.has(p)) closes.set(p, p.closedAt ? Date.parse(p.closedAt) : Infinity); return closes.get(p); };
  const openAt = p => { if (!opens.has(p)) opens.set(p, Date.parse(p.openedAt)); return opens.get(p); };
  // the entries that could say an entry came back: those with its signature, and those naming it as repeated
  const withSig = new Map(), repeating = new Map();
  for (const q of entries) {
    if (q.signature) (withSig.get(q.signature) || withSig.set(q.signature, []).get(q.signature)).push(q);
    if (q.repeatOf != null) (repeating.get(q.repeatOf) || repeating.set(q.repeatOf, []).get(q.repeatOf)).push(q);
  }
  // an entry written later than its problem was first seen (backfill) counts from then
  const startOf = p => Math.min(Date.parse(p.openedAt), p.seenFrom ? Date.parse(p.seenFrom) : Infinity);
  const afterFix = (p, o) => {
    // a run that began before its fix commit was made cannot hold it: the commit's time on main (fixTime), or an entry
    // from git's own open, which is its fix commit's time
    const made = p.fix ? fixTime(p.fix) ?? (p.source === 'git' ? Date.parse(p.openedAt) : null) : null;
    if (made != null && timeOf(o) < made) return false;
    const holds = p.fix && o.commit ? contains(p.fix, o.commit) : null;
    return holds === true || holds === false ? holds : timeOf(o) > fixAt(p);
  };
  const owned = new Map(entries.map(p => [p.id, []])), back = new Map();

  for (const o of [...reds, ...slot, ...prs]) {
    // an entry that lists the runs it was judged from (backfill) owns its reds in them, whatever the stores called them
    const judged = p => Array.isArray(p.runs) && o.type === 'red' && o.class !== 'dirty' && p.runs.includes(o.run);
    // an entry keyed by an error line owns every counted red with that line, whatever its class: a burst's reds were
    // rarely rerun, so by kind a tooling entry would own none of them (Juno)
    const byCause = p => o.type === 'red' && !!o.cause && p.signature === `cause:${o.cause}` && o.class !== 'dirty' && o.class !== 'planted';
    const pool = new Set([...(sigs.get(sigOf(o)) || []), ...(o.type === 'red' && o.cause ? sigs.get(`cause:${o.cause}`) || [] : [])]);
    const t = timeOf(o), cands = [...pool].filter(p => p.status !== 'merged' && ((OWNS[p.kind] && OWNS[p.kind](o)) || judged(p) || byCause(p)) && t >= startOf(p) - LEAD_DAYS * DAY);
    // the newest entry still explaining it: open, or closed and the red's code without its fix
    // the entry judged from this red's run first, then the newest
    // then one keyed by the red's error line, so a newer entry for one test does not split a burst (Juno)
    const live = cands.filter(p => !p.closedAt || !afterFix(p, o)).sort((a, b) => (judged(b) - judged(a)) || (byCause(b) - byCause(a)) || (Date.parse(b.openedAt) - Date.parse(a.openedAt)));
    if (live.length) { owned.get(live[0].id).push(o); continue; }
    const came = cands.filter(p => p.disposition !== 'wont-fix').sort((a, b) => fixAt(b) - fixAt(a))[0];
    if (came) { owned.get(came.id).push(o); if (!back.has(came.id)) back.set(came.id, o.when || o.at); }
  }

  const lines = new Set(reds.map(o => o.cause).filter(Boolean)); // every error line a red has, owned or not
  for (const p of entries) {
    const obs = owned.get(p.id).sort((a, b) => timeOf(a) - timeOf(b)), merged = p.status === 'merged';
    p.observations = obs;
    p.firstSeen = obs[0] ? obs[0].when || obs[0].at : null;
    p.lastSeen = obs.length ? obs.at(-1).when || obs.at(-1).at : null;
    p.notMeasured = NOT_MEASURED.has(p.kind);
    p.machineMinutes = p.notMeasured ? null : machineMinutes(obs.filter(o => o.type === 'red'));
    p.waitMinutes = p.notMeasured ? null : obs.filter(o => o.type === 'wait' || o.type === 'pr-wait').reduce((n, o) => n + (o.minutes || 0), 0);
    // came back: a red of its own after the fix, or a later entry with its signature or naming it as repeated
    // or a reopen, which keeps counting through a second close
    const near = merged || !p.closedAt ? [] : new Set([...(p.signature ? withSig.get(p.signature) || [] : []), ...(repeating.get(p.id) || [])]);
    const later = [...near].filter(q => q !== p && q.status !== 'merged' && openAt(q) > fixAt(p)
      && ((p.signature && q.signature === p.signature && q.kind === p.kind) || q.repeatOf === p.id)).map(q => q.openedAt).sort();
    p.cameBack = merged ? null : [back.get(p.id), later[0], p.reopenedAt].filter(Boolean).sort()[0] || null;
    p.fixHeld = null;
    if (!p.notMeasured && !merged && p.kind === 'flaky-test' && p.disposition === 'fixed') {
      if (p.cameBack) p.fixHeld = 'came-back';
      else { const h = held(p, results[p.signature] || [], afterFix, new Set(obs.map(o => o.run))); p.fixHeld = h.state; Object.assign(p, h.counts); }
    }
    const found = STAGE[canonStage(p.foundAt)], should = STAGE[canonStage(p.shouldHaveCaughtAt)];
    p.late = !!(found && should && found.i > should.i);
    // asked of an open entry too: a note never closes
    p.missing = !merged && lateFinder(p.foundAt) && !p.shouldHaveCaughtAt ? ['shouldHaveCaughtAt'] : [];
    // an entry keyed by an error line that no red has: the line's normalising may have changed since it was written (Juno)
    if (!merged && String(p.signature || '').startsWith('cause:') && !lines.has(p.signature.slice(6))) p.missing.push('signature');
  }

  // what no entry owns, grouped by signature and family; an observation is explained only by the entry that owns it, so
  // every one is owned, unexplained or left out on purpose, exactly once
  const ownedSet = new Set([...owned.values()].flat()), groups = new Map(), leftOut = [];
  // an error line that is not generic, shared by the unexplained reds of two or more tests, is one problem: its reds are
  // grouped by the line rather than by test, so a burst shows once (the burst proposal, 13 October)
  const testsOf = new Map();
  for (const o of reds) if (!ownedSet.has(o) && familyOf(o) && o.cause && !o.causeGeneric) (testsOf.get(o.cause) || testsOf.set(o.cause, new Set()).get(o.cause)).add(o.sig);
  const shared = o => o.type === 'red' && !!o.cause && !o.causeGeneric && testsOf.get(o.cause).size >= 2;
  for (const o of [...reds, ...slot, ...prs]) {
    if (ownedSet.has(o)) continue;
    const family = familyOf(o);
    if (!family) { leftOut.push(o); continue; }
    const [sig, fam] = shared(o) ? [`cause:${o.cause}`, 'shared-cause'] : [sigOf(o), family];
    const key = `${sig}\t${fam}`, at = o.when || o.at;
    const g = groups.get(key) || { sig, family: fam, type: o.type, count: 0, firstSeen: null, lastSeen: null, observations: [], ...(fam === 'shared-cause' ? { tests: [...testsOf.get(o.cause)].sort() } : {}) };
    g.count++; g.observations.push(o);
    if (!g.firstSeen || at < g.firstSeen) g.firstSeen = at;
    if (!g.lastSeen || at > g.lastSeen) g.lastSeen = at;
    groups.set(key, g);
  }
  const unexplained = [...groups.values()].map(g => ({ ...g, state: now - Date.parse(g.lastSeen) <= ALIVE_DAYS * DAY ? 'alive' : 'quiet',
    machineMinutes: g.type === 'red' ? machineMinutes(g.observations) : null, waitMinutes: g.type === 'wait' || g.type === 'pr-wait' ? g.observations.reduce((n, o) => n + (o.minutes || 0), 0) : null }))
    .sort((a, b) => (a.state === b.state ? 0 : a.state === 'alive' ? -1 : 1) || b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));
  return { entries, unexplained, leftOut };
}

// Whether a flake's fix has held: clean full runs of its test after the fix, from the first, numbering RULE_OF_THREE
// times the runs per red seen before it, over HELD_DAYS or more on which the test ran. Answers { state, counts }.
// Only a red the entry owns stops the count: a real break of the same test is another problem's.
function held(p, results, afterFix, ownRuns) {
  // a signature can name a file of many tests: a run counts once, red when any of them was
  const runs = new Map();
  for (const r of results) { const x = runs.get(r.run); if (!x) runs.set(r.run, { ...r }); else if (r.status === 'fail') x.status = 'fail'; }
  const full = [...runs.values()].filter(r => r.full && GATE_KINDS.has(r.kind)), before = full.filter(r => !afterFix(p, r));
  const after = full.filter(r => afterFix(p, r) && (r.status !== 'fail' || ownRuns.has(r.run)));
  const reds = before.filter(r => r.status === 'fail').length;
  const need = RULE_OF_THREE * (reds ? Math.ceil(before.length / reds) : 1);
  const firstRed = after.findIndex(r => r.status === 'fail'), clean = firstRed < 0 ? after : after.slice(0, firstRed);
  const days = new Set(clean.map(r => r.when.slice(0, 10))).size;
  return { state: clean.length >= need && days >= HELD_DAYS ? 'held' : 'checking', counts: { cleanRuns: clean.length, cleanNeeded: need, cleanDays: days } };
}
