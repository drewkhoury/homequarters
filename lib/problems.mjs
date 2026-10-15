import { stagesFrom } from './stages.mjs';

// The problem register (docs/plans/problem-register.md): the fixed values every entry uses, and the ledger that turns
// the events file into entries. Each line of ~/.cache/questkeep/problems/events.jsonl is one event about one entry,
// appended whole by hq/problem.mjs and never rewritten, so an entry is its events read in order. The writer, the
// reader, HQ's Problems page and its JSON export all read the values here.

export const KINDS = [
  ['product-bug', 'Product bug', 'The app was wrong for a player.'],
  ['test-failure', 'Test failure', 'A test failed every time: a regression, a wrong test, or a test environment that broke it.'],
  ['flaky-test', 'Flaky test', 'A test that passed and failed on the same commit.'],
  ['slot-contention', 'Test slot', 'Time lost to the shared test slot: waiting behind another session, holding it too long, giving up.'],
  ['pr-pileup', 'PR pile-up', 'Pull requests waiting on the person, going stale, duplicated or superseded.'],
  ['proof-churn', 'Proof churn', 'Test evidence redone: reruns for a green, proof asked for again in review, proof that never ran.'],
  ['tooling-breakage', 'Tooling', 'A hook, make target, runner, emulator, VM, script or HQ broke.'],
  ['agent-mistake', 'Agent mistake', 'An agent did the wrong thing: a wrong claim, a skipped check, a weakened test, a rule ignored.'],
];
export const KIND = Object.fromEntries(KINDS.map(([k, label, about]) => [k, { label, about }]));

// A starved run (memory pressure warn) is a factor on a red's own entry, never a mode or an entry of its own.
export const MODES = {
  'product-bug': ['missing', 'wrong', 'extra'],
  'test-failure': ['regression', 'test-wrong', 'test-env', 'unknown'],
  'flaky-test': ['async-wait', 'shared-state', 'timeout', 'clock', 'concurrency', 'resource-leak', 'network', 'infra', 'unknown'],
  'slot-contention': ['queue-wait', 'held-too-long', 'gave-up-or-takeover', 'stray-process'],
  'pr-pileup': ['waiting-on-person', 'conflict-or-stale', 'duplicate', 'superseded', 'red-checks', 'no-checks-reported'],
  'proof-churn': ['rerun-for-green', 'redone-after-review', 'not-proven', 'slot-busy', 'docker-off', 'lost-log'],
  'tooling-breakage': ['hook', 'makefile', 'runner', 'emulator', 'container-vm', 'script-or-hq', 'dependency'],
  'agent-mistake': ['wrong-claim', 'skipped-check', 'weakened-test', 'stale-base', 'ignored-rule', 'scope-drift', 'duplicate-work', 'looping', 'left-running', 'data-leak'],
};

// The stages, earliest first, so "found later than it should have been" compares two positions. They come from the
// project's pipeline file with HQ's fixed five around them (lib/stages.mjs), applied once when HQ or the writer starts;
// until then, and for a project with no pipeline file, the shipped default. Importers read the live bindings.
export let STAGES = [], STAGE = {}, BEFORE_MERGE = new Set(), MERGE = null;
let ALIASES = {}, RESULT_STAGES = {};
export function configureStages(spec = stagesFrom(null)) {
  STAGES = spec.stages;
  STAGE = Object.fromEntries(STAGES.map(([k, label, about], i) => [k, { label, about, i }]));
  MERGE = spec.merge;
  BEFORE_MERGE = new Set(STAGES.slice(0, STAGE[MERGE].i).map(([k]) => k));
  ALIASES = spec.aliases || {}; RESULT_STAGES = spec.resultStages || {};
}
configureStages();
// a stage id as it is now: an old name a recorded line or a trailer carries reads as the stage it became
export const canonStage = v => (typeof v === 'string' && Object.hasOwn(ALIASES, v) ? ALIASES[v] : v);
export const isStage = v => Object.hasOwn(STAGE, canonStage(v));
export const afterMerge = k => isStage(k) && !BEFORE_MERGE.has(canonStage(k));
// a problem found this late, or by a reviewer or the person, is closed only with where it should have been caught
export const lateFinder = k => { const c = canonStage(k); return c === 'reviewer' || c === 'you' || afterMerge(c); };
// the stage a recorded result stands for (a red `gate` task from `ci` was found at the PR gate), or null
export const stageOfResult = (where, task) => RESULT_STAGES[`${where}/${task}`] || null;

export const FACTORS = [
  ['shared-state', 'Shared state', 'Tests or tabs that share emulator, disk or browser state.'],
  ['clock', 'Clock', 'A pinned or skewed clock, a time zone, midnight or daylight saving.'],
  ['machine-load', 'Machine load', 'The laptop or VM was short of CPU or memory; a starved run (memory pressure warn) is one.'],
  ['slot-queue', 'Slot queue', 'Too many runs waiting for the one test slot.'],
  ['stale-base', 'Stale base', 'Work started from an old main.'],
  ['env-diff', 'Environment differs', 'The emulator, the VM or a hosted runner behaves unlike production or the laptop.'],
  ['missing-guard', 'No guard', 'No test, hook or rule covered it.'],
  ['instruction-gap', 'Instructions', 'CLAUDE.md, a skill or an agent file did not say, or said it unclearly.'],
  ['unverified-claim', 'Unchecked claim', 'Something was reported as true without a run or a command behind it.'],
  ['parallel-decision', 'Parallel decisions', 'Two agents decided the same thing differently at the same time.'],
  ['upstream', 'Upstream', 'A bug in a dependency: firebase-tools, the SDK, Playwright, Colima.'],
  ['person-queue', 'Waiting on you', 'The work was done and waited for the person.'],
  ['context-loss', 'Lost context', 'An agent lost what an earlier step or session knew.'],
];
export const FACTOR = Object.fromEntries(FACTORS.map(([k, label, about]) => [k, { label, about }]));

// Who found a problem, as Found-by names them: a reviewer, the person you work with, a stage that found it, the agent
// building, or a named test.
export const REVIEWERS = ['noor', 'mara', 'juno', 'theo', 'nell', 'mags', 'hollis'];
export const FINDERS = new RegExp(`^(${REVIEWERS.join('|')}|reviewer|you|someone-else|gate|nightly|prod-smoke|builder|players|users|test:[\\w.-]+)$`);

export const DISPOSITIONS = {
  fixed: 'Fixed', 'cause-unknown-stopped': 'Cause unknown, stopped', 'not-reproduced': 'Not reproduced',
  duplicate: 'Duplicate', upstream: 'Upstream', 'wont-fix': 'Won\'t fix',
};
export const GUARD_TYPES = { prevent: 'Prevents it', detect: 'Detects it', mitigate: 'Softens it', none: 'No guard' };
export const EFFECTS = { 'data-loss': 'Lost data', 'wrong-silent': 'Wrong, and says nothing', 'wrong-visible': 'Wrong, and visibly so', cosmetic: 'Looks wrong', none: 'None' };
export const RECORDS = { live: 'Written as it happened', backfill: 'Made later from history' };
export const CONFIDENCE = { confirmed: 'Confirmed', suspected: 'Suspected' };

// The fields an entry may hold, and what each may be. Anything else on a line is dropped when it is read. Free text is
// checked by the writer before it is written (hq/lib/problem-privacy.mjs); status and disposition move only through
// their own events (opened, set to fixing, closed, reopened, merged-into).
const oneOf = values => v => Object.hasOwn(values, v);
// an entry's id: its date, its kind (or a word) and random hex digits, never words of its title
export const ENTRY_ID = /^P-\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,40}-[0-9a-f]{4,8}$/;
const isText = v => typeof v === 'string' && v.length > 0;
export const FIELDS = {
  title: { about: 'One line saying what went wrong.', valid: isText, text: true },
  kind: { about: 'Which kind of problem (KINDS).', valid: oneOf(KIND) },
  mode: { about: "How it went wrong, from its kind's modes (MODES).", valid: (v, p) => !!p.kind && MODES[p.kind].includes(v) },
  signature: { about: 'What groups its observations: a test file, a make target, a lock log pattern, a pull request.', valid: isText, text: true },
  factors: { about: 'Up to three contributing factors (FACTORS).', list: oneOf(FACTOR), max: 3 },
  foundAt: { about: 'The stage that found it (STAGES).', valid: isStage, norm: canonStage },
  foundBy: { about: 'Who found it, from the fixed finders (FINDERS), several at once.', list: v => typeof v === 'string' && FINDERS.test(v), max: 9 },
  shouldHaveCaughtAt: { about: 'The stage that should have caught it (STAGES).', valid: isStage, norm: canonStage },
  playerFacing: { about: 'Whether a player could see it.', valid: v => typeof v === 'boolean' },
  effect: { about: 'What it did to users (EFFECTS).', valid: oneOf(EFFECTS) },
  guardType: { about: 'What the guard added does (GUARD_TYPES).', valid: oneOf(GUARD_TYPES) },
  guard: { about: 'The guard: a test file, a hook, a rule or a commit.', valid: isText, text: true },
  believed: { about: 'What the agent believed.', valid: isText, text: true },
  actual: { about: 'What was actually so.', valid: isText, text: true },
  evidence: { about: 'A pointer to the evidence: a run id, a log path and line, a commit, feedback/<id>. Never copied text.', valid: isText, text: true },
  fix: { about: 'The fix commit.', valid: v => typeof v === 'string' && /^[0-9a-f]{7,40}$/.test(v) },
  repeatOf: { about: 'The earlier entry this one repeats.', valid: v => typeof v === 'string' && ENTRY_ID.test(v) },
  record: { about: 'How the entry was made (RECORDS).', valid: oneOf(RECORDS) },
  runs: { about: 'The runs it was judged from (a laptop run id, or CI junit-<run>-<attempt>-<set>), for a backfilled entry: it owns its reds in them.',
    list: v => typeof v === 'string' && (/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z_\d+$/.test(v) || /^junit-\d+-\d+-[\w-]+$/.test(v)), max: 200 },
  seenFrom: { about: 'When its problem was first seen, for an entry written later than that (backfill).', valid: v => typeof v === 'string' && Number.isFinite(Date.parse(v)) },
  confidence: { about: 'How sure its cause is (CONFIDENCE).', valid: oneOf(CONFIDENCE) },
};

// The fields of an event that the register keeps: defined ones whose values are valid, given what the entry holds
// (a mode is checked against the kind the same event sets, or the entry's). Answers [kept, dropped names].
function keep(fields, entry) {
  const out = {}, dropped = [];
  if (!fields || typeof fields !== 'object') return [out, dropped];
  const kind = Object.hasOwn(fields, 'kind') && FIELDS.kind.valid(fields.kind) ? fields.kind : entry.kind;
  for (const name of Object.keys(fields)) {
    const f = Object.hasOwn(FIELDS, name) ? FIELDS[name] : null, v = fields[name];
    if (!f) { dropped.push(name); continue; }
    if (f.list) {
      const items = Array.isArray(v) ? [...new Set(v.filter(f.list))].slice(0, f.max) : [];
      if (items.length) out[name] = items; else dropped.push(name);
    } else if (f.valid(v, { ...entry, kind })) out[name] = f.norm ? f.norm(v) : v;
    else dropped.push(name);
  }
  return [out, dropped];
}

const CLOSED = new Set(['closed', 'dropped', 'merged']);
export const EVENTS = ['opened', 'set', 'closed', 'reopened', 'merged-into', 'redacted'];
// The shape of an event line. The writer stamps every line with v; a reader takes a line without one as v 0, and reads
// a line from a newer writer for what it knows, counting it, so an old HQ never refuses what a new one wrote.
export const EVENT_V = 1;

// Events in, entries out: { entries, notPlaced: [{ event, why }], newer }, newer being how many lines a newer writer
// (v above EVENT_V) wrote; they are read all the same. An event that would rewrite history (a second open,
// a second close, a set of a status other than fixing, a reopen of an open entry) or that names no entry is refused and
// reported, never guessed at. A redaction hides its fields everywhere: on the entry and in each of its events.
export function fold(events) {
  const byId = new Map(), notPlaced = [];
  const newer = events.filter(e => e && Number.isInteger(e.v) && e.v > EVENT_V).length;
  const order = events.map((e, i) => ({ e, i, t: Date.parse(e && e.at) })).sort((a, b) => (a.t - b.t) || (a.i - b.i));
  // what a refusal or an entry may repeat of a line: an id of the real shape, a writer named as the writer names them
  const idOf = v => (typeof v === 'string' && ENTRY_ID.test(v) ? v : 'an id that is not an entry id');
  const byOf = v => (typeof v === 'string' && /^[\w .:-]{1,40}$/.test(v) ? v : null);
  for (let { e, t } of order) {
    // a refusal says when, which entry and what kind of event, and why, never what the event held
    const refuse = why => notPlaced.push({ at: Number.isFinite(t) ? new Date(t).toISOString() : null, id: e && ENTRY_ID.test(e.id) ? e.id : null, ev: e && EVENTS.includes(e.ev) ? e.ev : null, why });
    if (!e || typeof e.id !== 'string' || !Number.isFinite(t)) { refuse('it has no entry id or no time'); continue; }
    const p = byId.get(e.id);
    if (e.ev === 'opened') {
      if (p) { refuse(`${idOf(e.id)} was opened already`); continue; }
      const [fields] = keep(e.fields, {});
      byId.set(e.id, { id: e.id, ...fields, openedAt: e.at, openedBy: byOf(e.by), status: 'open', events: [{ ...e, by: byOf(e.by), fields }], redacted: [] });
      continue;
    }
    if (!p) { refuse(`${idOf(e.id)} was never opened`); continue; }
    e = { ...e, by: byOf(e.by) };
    if (e.ev === 'set') {
      const status = e.fields && e.fields.status;
      if (status !== undefined && status !== 'fixing') { refuse("a set may move an entry's status to fixing and to nothing else"); continue; }
      if (status === 'fixing' && CLOSED.has(p.status)) { refuse(`${e.id} is ${p.status}; reopen it first`); continue; }
      const [fields] = keep(e.fields, p);
      Object.assign(p, fields, status ? { status } : {});
      e = { ...e, fields: { ...fields, ...(status ? { status } : {}) } };
      // a new kind keeps a mode only when the new kind has it
      if (fields.kind && p.mode && !MODES[p.kind].includes(p.mode)) delete p.mode;
    } else if (e.ev === 'closed') {
      if (CLOSED.has(p.status)) { refuse(`${e.id} is ${p.status} already`); continue; }
      const disposition = e.fields && e.fields.disposition;
      if (!Object.hasOwn(DISPOSITIONS, disposition || '')) { refuse(`a close needs a disposition (${Object.keys(DISPOSITIONS).join(', ')})`); continue; }
      const [fields] = keep(e.fields, p);
      Object.assign(p, fields, { disposition, closedAt: e.at, closedBy: e.by, status: disposition === 'wont-fix' ? 'dropped' : 'closed' });
      e = { ...e, fields: { ...fields, disposition } };
    } else if (e.ev === 'reopened') {
      if (!CLOSED.has(p.status) || p.status === 'merged') { refuse(`${e.id} is not closed`); continue; }
      delete p.disposition; delete p.closedAt; delete p.closedBy;
      Object.assign(p, { status: 'open', reopenedAt: e.at });
    } else if (e.ev === 'merged-into') {
      if (e.into === e.id) { refuse('an entry cannot be merged into itself'); continue; }
      if (!byId.has(e.into)) { refuse(ENTRY_ID.test(String(e.into)) ? `there is no entry ${e.into} to merge into` : 'a merge names no entry id to merge into'); continue; }
      if (p.status === 'merged') { refuse(`${e.id} is merged already`); continue; }
      let q = byId.get(e.into), hops = 0;
      while (q && q.status === 'merged' && q.id !== e.id && hops++ < 50) q = byId.get(q.mergedInto);
      if (q && q.id === e.id) { refuse(`a merge into ${e.into} leads back to ${e.id}`); continue; }
      Object.assign(p, { status: 'merged', mergedInto: e.into, closedAt: e.at });
    } else if (e.ev === 'redacted') {
      const names = Array.isArray(e.fields) ? e.fields.filter(n => Object.hasOwn(FIELDS, n)) : [];
      if (!names.length) { refuse('a redaction names the fields it hides'); continue; }
      p.redacted = [...new Set([...p.redacted, ...names])];
      e = { ...e, fields: names };
    } else { refuse('no such event; the events are opened, set, closed, reopened, merged-into and redacted'); continue; }
    p.events.push(e);
  }
  const entries = [...byId.values()].map(p => {
    for (const n of p.redacted) delete p[n];
    const hide = f => (f && typeof f === 'object' && !Array.isArray(f) ? Object.fromEntries(Object.entries(f).filter(([k]) => !p.redacted.includes(k))) : f);
    return { ...p, events: p.events.map(e => (e.ev === 'redacted' ? e : { ...e, fields: hide(e.fields) })) };
  });
  return { entries, notPlaced, newer };
}
