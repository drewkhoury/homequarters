// What HQ's Problems page shows, as data: the page draws it (hq/pages/problems.mjs) and its JSON export carries it, so
// an agent handed the export sees the same figures as the person on the page. The register comes from readRegister
// (hq/lib/problem-register.mjs). The rules the reviews set for these figures:
// - Costs are summed over every observation at once, each run counted once, and filtered by when they happened, so an
//   old entry owning a new red does not move the red out of the period (Juno).
// - The period before is offered only when it lies wholly after the register starts (Noor: a comparison against a
//   mostly empty period reads as a collapse).
// - Time waiting on the person is clock time during which at least one pull request waited, with how many waited
//   (Noor: waits added side by side read as "you cost 218 hours").
// - Every share carries its count.
// - The export checks every free-text field for privacy again, since entries from git never pass the writer (Theo).
import { KINDS, KIND, MODES, STAGES, STAGE, BEFORE_MERGE, FACTORS, DISPOSITIONS, GUARD_TYPES, EFFECTS, RECORDS, CONFIDENCE, FIELDS } from './problems.mjs';
import { machineMinutes } from './problem-observations.mjs';
import { planted } from './runs.mjs';
import { textProblems } from './problem-privacy.mjs';

const DAY = 86400000;
export const RANGES = [['7d', '7 days', 7], ['30d', '30 days', 30], ['all', 'Since the register began', null]];
const timeOf = o => Date.parse(o.when || o.at);
const AFTER_MERGE = new Set(STAGES.filter(([k]) => STAGE[k].i >= STAGE.merge.i).map(([k]) => k));
const GATE_KINDS = new Set(['gate', 'docker-gate']);
// the causes of a red gate run, worst first, and the cause each kind of entry gives the reds it was judged from
export const CAUSES = ['infra', 'code', 'unknown', 'flaky'];
const VERDICT = { 'flaky-test': 'flaky', 'tooling-breakage': 'infra', 'test-failure': 'code', 'product-bug': 'code' };

// The period a range names, ending now: { range, label, days, from, to, prev } where prev says whether the period of
// the same length before it lies wholly after the register's start.
export function windowOf(range, now, start) {
  const r = RANGES.find(([k]) => k === range) || RANGES[0];
  const days = r[2] ?? Math.max(1, Math.ceil((now - start) / DAY));
  const from = r[2] ? now - days * DAY : start;
  return { range: r[0], label: r[1], days, from, to: now, prev: r[2] != null && from - days * DAY >= start };
}
const before = w => ({ ...w, from: w.from - w.days * DAY, to: w.from, prev: false });
const within = (w, t) => t >= w.from && t <= w.to;

// Minutes of the clock during which at least one wait was going: [{ greenAt, at }] merged where they overlap.
export function clockMinutes(waits) {
  const spans = waits.map(o => [Date.parse(o.greenAt), Date.parse(o.at)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, cur = null;
  for (const [a, b] of spans) {
    if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round(total / 60000);
}

// Who found a problem, in four groups an eye can follow week to week, earliest first
export const FINDER_GROUPS = [
  { key: 'checks', label: 'Tests, gates and the agent', test: f => f === 'gate' || f === 'builder' || f.startsWith('test:') },
  { key: 'reviewer', label: 'A reviewer agent', test: f => f === 'reviewer' || ['noor', 'mara', 'juno', 'theo', 'nell', 'mags', 'hollis'].includes(f) },
  { key: 'you', label: 'You', test: f => f === 'you' },
  { key: 'after', label: 'After the merge, or someone else', test: f => ['nightly', 'prod-smoke', 'players', 'someone-else'].includes(f) },
];
const groupOf = p => {
  const fs = p.foundBy || [];
  for (const g of FINDER_GROUPS) if (fs.some(g.test)) return g.key;
  if (p.foundAt) return AFTER_MERGE.has(p.foundAt) ? 'after' : p.foundAt === 'person' ? 'you' : p.foundAt === 'reviewer' ? 'reviewer' : 'checks';
  return null;
};

// reds that say something about the work: not on a dirty tree, and not planted on a probe/ or exp/ branch
const counted = o => o.class !== 'dirty' && o.class !== 'planted';
const redsIn = (reg, w) => reg.observations.reds.filter(o => counted(o) && within(w, timeOf(o)));
const costIn = (obs, w) => machineMinutes(obs.filter(o => o.type === 'red' && counted(o) && within(w, timeOf(o))));
const label = p => ({ id: p.id, title: p.title, kind: p.kind || null });

// The Overview of a period. live leaves backfilled entries out of what counts entries; costs stay the period's.
export function overview(reg, w, { live = false } = {}) {
  const pool = reg.entries.filter(p => p.status !== 'merged' && (!live || p.record !== 'backfill'));
  const figures = win => {
    const opened = pool.filter(p => within(win, Date.parse(p.openedAt)));
    const waits = reg.observations.slot.filter(o => o.type === 'wait' && o.behind === 'other' && within(win, timeOf(o)));
    const prs = reg.observations.prs.filter(o => within(win, timeOf(o)));
    const bugs = opened.filter(p => p.kind === 'product-bug' && p.foundAt);
    return {
      opened: opened.length, machineMinutes: machineMinutes(redsIn(reg, win)),
      slot: { minutes: waits.reduce((n, o) => n + (o.minutes || 0), 0), waits: waits.length },
      waitingOnYou: { minutes: clockMinutes(prs), prs: new Set(prs.map(o => o.pr)).size },
      caughtBeforeMerge: { caught: bugs.filter(p => BEFORE_MERGE.has(p.foundAt)).length, of: bugs.length },
      openedList: opened,
    };
  };
  const now = figures(w);
  const groups = reg.unexplained.filter(g => g.observations.some(o => within(w, timeOf(o))));
  // each group as the period saw it, machine time and waiting kept apart: they are different clocks
  const rows = groups.map(g => {
    const obs = g.observations.filter(o => within(w, timeOf(o))), waits = obs.filter(o => o.type === 'wait' || o.type === 'pr-wait');
    return { sig: g.sig, family: g.family, ...(g.tests ? { tests: g.tests } : {}), state: g.state, count: obs.length, lastSeen: g.lastSeen,
      machineMinutes: obs.some(o => o.type === 'red') ? costIn(obs, w) : null, waitMinutes: waits.length ? waits.reduce((n, o) => n + (o.minutes || 0), 0) : null };
  }).sort((a, b) => b.count - a.count);
  const costliest = [
    ...pool.map(p => ({ entry: label(p), minutes: costIn(p.observations || [], w), times: (p.observations || []).filter(o => within(w, timeOf(o))).length })),
    ...groups.map(g => ({ group: { sig: g.sig, family: g.family, ...(g.tests ? { tests: g.tests } : {}) }, minutes: costIn(g.observations, w), times: g.observations.filter(o => within(w, timeOf(o))).length })),
  ].filter(x => x.minutes > 0).sort((a, b) => b.minutes - a.minutes).slice(0, 10);
  const late = pool.filter(p => p.late && (within(w, Date.parse(p.openedAt)) || (p.closedAt && within(w, Date.parse(p.closedAt)))));
  const pairs = Object.values(late.reduce((m, p) => { const k = `${p.shouldHaveCaughtAt}>${p.foundAt}`; (m[k] ||= { shouldHaveCaughtAt: p.shouldHaveCaughtAt, foundAt: p.foundAt, entries: [] }).entries.push(label(p)); return m; }, {}))
    .sort((a, b) => b.entries.length - a.entries.length);
  // came back, the ones nobody filed again first: those are what the register would otherwise miss
  const back = pool.filter(p => p.cameBack && within(w, Date.parse(p.cameBack))).map(p => {
    const again = pool.find(q => q !== p && q.kind === p.kind && q.signature && q.signature === p.signature && Date.parse(q.openedAt) >= Date.parse(p.cameBack) - 7 * DAY);
    return { ...label(p), closedAt: p.closedAt, cameBack: p.cameBack, filedAgainAs: again ? again.id : null };
  }).sort((a, b) => !!a.filedAgainAs - !!b.filedAgainAs);
  const finders = FINDER_GROUPS.map(g => ({ key: g.key, label: g.label, n: now.openedList.filter(p => groupOf(p) === g.key).length }));
  const missing = pool.filter(p => p.missing && p.missing.length).map(p => ({ ...label(p), missing: p.missing }));
  const prev = w.prev ? figures(before(w)) : null;
  const strip = f => { const { openedList, ...rest } = f; return rest; };
  return {
    ...strip(now), before: prev ? strip(prev) : null,
    unexplained: { groups: groups.length, alive: groups.filter(g => g.state === 'alive').length, list: rows.slice(0, 12), more: Math.max(0, rows.length - 12) },
    costliest, escapes: pairs, cameBack: back, finders, findersKnown: finders.reduce((n, f) => n + f.n, 0), missing,
  };
}

// The whole register week by week, as rates of the work done: gate reds per 100 gate runs by cause, push to gate
// result, product bugs found after the merge per 10 merged pull requests, and who found problems.
export function trends(reg, { runs = [], now = Date.now() } = {}) {
  const start = reg.start, n = Math.max(1, Math.ceil((now - start) / (7 * DAY)));
  const weeks = Array.from({ length: n }, (_, i) => ({ from: start + i * 7 * DAY, to: start + (i + 1) * 7 * DAY }));
  const weekOf = t => Math.floor((t - start) / (7 * DAY));
  // runs made on purpose (probe/, exp/ and lab/ branches, the lab's own kind) and runs after now say nothing about the work
  const onPurpose = r => planted(r) || /^lab\//.test(r.info.branch || '') || r.info.kind === 'lab';
  const gate = runs.filter(r => GATE_KINDS.has(r.info.kind) && !r.info.partial && !r.info.dirty && !onPurpose(r) && Date.parse(r.when) <= now);
  const gateIds = new Set(gate.map(r => r.id));
  // a red's cause is the verdict of the entry judged from its run, where one was (backfill lists its runs); otherwise what
  // the stores saw: a red never rerun says nothing about the code, since before rerun-once (#282) almost none was rerun
  const judged = new Map(), redKey = o => `${o.run}\t${o.task || ''}\t${o.sig}`;
  for (const p of reg.entries) {
    const v = VERDICT[p.kind];
    if (v && Array.isArray(p.runs)) for (const o of p.observations || []) if (o.type === 'red' && p.runs.includes(o.run)) judged.set(redKey(o), v);
  }
  const causeOf = o => judged.get(redKey(o)) || (o.class === 'infra' || o.class === 'resource' ? 'infra' : o.class === 'red-twice' ? 'code' : o.class === 'never-rerun' ? 'unknown' : 'flaky');
  // each red gate run once, by its worst cause: infra, then code, then not known (it may be code), then flaky
  const worst = new Map();
  for (const o of reg.observations.reds) {
    if (!gateIds.has(o.run) || !counted(o)) continue;
    const c = causeOf(o), was = worst.get(o.run);
    if (!was || CAUSES.indexOf(c) < CAUSES.indexOf(was)) worst.set(o.run, c);
  }
  const changes = (reg.changes || []).filter(c => c.path === 'pr' && c.mergedAt);
  const pushSecs = c => (c.split && [c.split.runnerWaitSec, c.split.slotWaitSec, c.split.gateSec].every(Number.isFinite) ? c.split.runnerWaitSec + c.split.slotWaitSec + c.split.gateSec : null);
  const quant = (xs, q) => { const v = xs.filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : null; };
  const out = weeks.map(wk => {
    const inWk = t => t >= wk.from && t < wk.to;
    const runsHere = gate.filter(r => inWk(Date.parse(r.when)));
    const reds = Object.fromEntries(CAUSES.map(c => [c, 0]));
    for (const r of runsHere) { const c = worst.get(r.id); if (c) reds[c]++; }
    const merged = changes.filter(c => inWk(Date.parse(c.mergedAt)));
    const push = merged.map(pushSecs).filter(v => v != null).map(v => v / 60);
    const opened = reg.entries.filter(p => p.status !== 'merged' && inWk(Date.parse(p.openedAt)));
    const bugsAfter = opened.filter(p => p.kind === 'product-bug' && AFTER_MERGE.has(p.foundAt));
    const effects = Object.fromEntries(Object.keys(EFFECTS).map(e => [e, bugsAfter.filter(p => p.effect === e).length]));
    const finders = Object.fromEntries(FINDER_GROUPS.map(g => [g.key, opened.filter(p => groupOf(p) === g.key).length]));
    const known = Object.values(finders).reduce((a, b) => a + b, 0);
    return {
      weekOf: new Date(wk.from).toISOString().slice(0, 10), through: new Date(Math.min(wk.to - 1, now)).toISOString().slice(0, 10), gateRuns: runsHere.length, reds,
      per100: runsHere.length ? Object.fromEntries(Object.entries(reds).map(([k, v]) => [k, Math.round((v / runsHere.length) * 1000) / 10])) : null,
      mergedPRs: merged.length, pushToResultMin: { n: push.length, median: quant(push, 0.5), p90: push.length >= 10 ? quant(push, 0.9) : null },
      productBugsAfterMerge: { n: bugsAfter.length, per10PRs: merged.length ? Math.round((bugsAfter.length / merged.length) * 100) / 10 : null, byEffect: effects },
      finders, findersKnown: known,
      // shares, since the counts rise with the work
      finderShares: Object.fromEntries(Object.entries(finders).map(([k, n]) => [k, known ? Math.floor((n / known) * 1000) / 10 : null])),
    };
  });
  return { weeks: out };
}

// The test slot, day by day in the period: minutes waited behind another run, how many such waits, how many runs held
// or waited for it at once at the most, and the waits that gave up or left, the refusals and the take-overs.
export function slot(reg, { lock = [], now = Date.now(), w }) {
  const days = Array.from({ length: Math.ceil((w.to - w.from) / DAY) }, (_, i) => ({ from: w.from + i * DAY, to: Math.min(w.to, w.from + (i + 1) * DAY) }));
  // spans of holding (take to release by its process) and of waiting (wait to its end)
  const holds = [], open = new Map();
  for (const l of [...lock].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (l.event === 'take') open.set(l.pid, Date.parse(l.at));
    else if ((l.event === 'release' || l.event === 'takeover') && open.has(l.pid)) { holds.push([open.get(l.pid), Date.parse(l.at)]); open.delete(l.pid); }
  }
  const obs = reg.observations.slot;
  const waitSpans = obs.filter(o => o.type === 'wait').map(o => [timeOf(o), timeOf(o) + (o.minutes || 0) * 60000]);
  const atOnce = (a, b) => {
    const ev = [...holds, ...waitSpans].filter(([s, e]) => e > a && s < b).flatMap(([s, e]) => [[Math.max(s, a), 1], [Math.min(e, b), -1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let cur = 0, most = 0; for (const [, d] of ev) { cur += d; most = Math.max(most, cur); } return most;
  };
  return {
    days: days.map(d => {
      const here = obs.filter(o => { const t = timeOf(o); return t >= d.from && t < d.to; });
      const waits = here.filter(o => o.type === 'wait' && o.behind === 'other');
      return { day: new Date(d.from).toISOString().slice(0, 10), waitMinutes: waits.reduce((n, o) => n + (o.minutes || 0), 0), waits: waits.length,
        gaveUp: here.filter(o => o.type === 'wait' && o.outcome === 'gave-up').length, left: here.filter(o => o.type === 'wait' && o.outcome === 'left').length,
        refused: here.filter(o => o.type === 'refused').length, takeovers: here.filter(o => o.type === 'takeover').length, atOnce: atOnce(d.from, d.to) };
    }),
  };
}

// The Tests tab: one row per gate and long-set test (files: HQ's catalogue), with its runs and minutes in the period,
// what it caught, its flaky reds and its reds never rerun, and the Proves line it guards. A catch is the test red twice
// or more on a commit with no pass there, then green on a later commit, with the test file the same on the red commit,
// its parent and the green commit (fileSame(file, a, b), which git answers): the code broke and was fixed while the
// test stayed put, so the project's own red-first commits, which change the test, are never catches. Catches on dirty
// trees are not seen at all, so this is a lower bound.
export function testsView(reg, { files = [], results = {}, fileSame = () => false, w }) {
  const reds = reg.observations.reds.filter(o => within(w, timeOf(o)));
  return files.filter(f => f.set === 'gate' || f.set === 'after').map(f => {
    const all = (results[f.name] || []).filter(r => r.commit);
    const here = all.filter(r => within(w, Date.parse(r.when)));
    const byCommit = new Map();
    for (const r of all) {
      const c = byCommit.get(r.commit) || { commit: r.commit, at: r.when, fails: 0, passes: 0 };
      if (r.status === 'pass') c.passes++; else if (r.status === 'fail') c.fails++;
      if (r.when < c.at) c.at = r.when;
      byCommit.set(r.commit, c);
    }
    const catches = [];
    for (const c of [...byCommit.values()].filter(c => c.fails >= 2 && !c.passes).sort((a, b) => a.at.localeCompare(b.at))) {
      const green = all.find(r => r.status === 'pass' && r.full && r.commit !== c.commit && r.when > c.at);
      if (green && fileSame(f.path, `${c.commit}^`, c.commit) && fileSame(f.path, `${c.commit}^`, green.commit)) catches.push({ red: c.commit, green: green.commit, at: c.at });
    }
    const mine = reds.filter(o => o.sig === f.name);
    return { test: f.name, path: f.path, set: f.set, runs: here.length, minutes: Math.round(here.reduce((n, r) => n + (r.seconds || 0), 0) / 6) / 10,
      catches: catches.filter(c => within(w, Date.parse(c.at))), lastCatch: catches.length ? catches.at(-1).at : null,
      flakyReds: mine.filter(o => o.class === 'flaky').length, passedAlone: mine.filter(o => o.class === 'passed-alone').length, neverRerun: mine.filter(o => o.class === 'never-rerun').length,
      redTwice: mine.filter(o => o.class === 'red-twice').length, proves: (f.fields && f.fields.proves) || f.description || '' };
  });
}

// ---- The JSON export: everything the page shows, with the values it uses and what they mean ----

export const VOCABULARY = {
  kinds: KINDS.map(([key, label, about]) => ({ key, label, about, modes: MODES[key] })),
  stages: STAGES.map(([key, label, about]) => ({ key, label, about, order: STAGE[key].i, beforeMerge: BEFORE_MERGE.has(key) })),
  factors: FACTORS.map(([key, label, about]) => ({ key, label, about })),
  dispositions: DISPOSITIONS, guardTypes: GUARD_TYPES, effects: EFFECTS, records: RECORDS, confidence: CONFIDENCE,
  fields: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.about])),
  finderGroups: FINDER_GROUPS.map(({ key, label }) => ({ key, label })),
};

// A free-text value the privacy check refuses, replaced by why, never shown
const TEXT_KEYS = new Set(['title', ...Object.entries(FIELDS).filter(([, f]) => f.text).map(([k]) => k)]);
function guard(value, ctx) {
  if (Array.isArray(value)) return value.map(v => guard(v, ctx));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => {
    if (TEXT_KEYS.has(k) && typeof v === 'string') { const why = textProblems(v, ctx); return [k, why.length ? `[withheld: ${why.join('; ')}]` : v]; }
    return [k, guard(v, ctx)];
  }));
}

// One entry as the export carries it: its fields, what the reader worked out, and how many observations it owns
export function entryOut(p, { withObservations = false } = {}) {
  const { observations = [], events = [], ...rest } = p;
  return { ...rest, observationCount: observations.length, ...(withObservations ? { observations, events } : {}) };
}

export function exportJSON(reg, { w, ctx, now = Date.now(), live = false, runs = [], lock = [] }) {
  const out = {
    about: {
      what: "QuestKeep's problem register as HQ's Problems page shows it. Observations are worked out from the run store, the lock log and make dora each time; entries come from fix commits, notes and backfill and own the observations they explain.",
      generatedAt: new Date(now).toISOString(), register: { start: new Date(reg.start).toISOString(), sources: reg.sources },
      units: 'Times are ISO 8601 in UTC. Machine minutes count each run once. Waiting minutes are on their own clocks: the test slot (agents waiting) and pull requests (the person).',
    },
    view: { range: w.range, from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString(), entries: live ? 'live only' : 'all, backfill included', periodBefore: w.prev },
    vocabulary: VOCABULARY,
    overview: overview(reg, w, { live }),
    trends: trends(reg, { runs, now }).weeks,
    slot: slot(reg, { lock, now, w }).days,
    entries: reg.entries.filter(p => !live || p.record !== 'backfill').map(p => entryOut(p)),
    unexplained: reg.unexplained.map(({ observations, ...g }) => ({ ...g })),
    notPlaced: reg.notPlaced,
  };
  return guard(out, ctx);
}
export const guardText = guard;
