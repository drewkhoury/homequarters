// CI runs as they happen, read from GitHub through gh with the developer's own login, read-only: which runs are going,
// their jobs and steps with how long each took or has been running, and for the step that runs the tests an estimate of
// which test it is on. GitHub hands over a job's log only once the job has ended, so the test CI is on cannot be read
// live; the estimate walks the tests in the order CI runs them, with their times from the last few CI runs that
// `make ci-history` downloaded, scaled to how long that step usually takes. The pure functions come first, then the
// reading, which keeps answers briefly so a page that refreshes does not ask GitHub every time.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { storedCiRuns } from './runs.mjs';

// ---- pure ----

// The name of the step that runs the tests: the one whose run: block calls make "$TARGET" in test.yml.
export function testStepName(workflowYaml) {
  const steps = String(workflowYaml).split(/\n\s*- (?=name:|uses:|run:)/);
  for (const s of steps) {
    const name = /^name:\s*(.+)$/m.exec(s);
    if (name && /make\s+"\$TARGET"/.test(s)) return name[1].trim().replace(/^["']|["']$/g, '');
  }
  return 'Run the tests';
}

// GitHub writes a time it does not have yet as the year 1.
export const timeOf = iso => (!iso || /^0001-/.test(iso) ? null : Date.parse(iso));

// How long, in words: 45 s, 3 min 10 s, 1 h 4 min.
export function span(seconds) {
  if (seconds == null || !(seconds >= 0)) return '';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

// A job's steps as the page draws them: done (with how long it took and how it ended), running (with how long it has
// run), queued, or skipped. GitHub's own "Post …" clean-up steps are left out while the job runs, since they have not
// started and say nothing about progress.
export function stepTimeline(job, now = Date.now()) {
  const steps = (job.steps || []).map(s => {
    const start = timeOf(s.startedAt), end = timeOf(s.completedAt);
    if (s.status === 'completed') {
      const skipped = s.conclusion === 'skipped';
      return { name: s.name, number: s.number, state: skipped ? 'skipped' : 'done', conclusion: s.conclusion, seconds: skipped || start == null || end == null ? null : (end - start) / 1000 };
    }
    if (s.status === 'in_progress') return { name: s.name, number: s.number, state: 'running', seconds: start == null ? null : (now - start) / 1000 };
    return { name: s.name, number: s.number, state: 'queued', seconds: null };
  });
  return job.status === 'completed' ? steps : steps.filter(s => !(s.state === 'queued' && /^Post /.test(s.name)));
}

const median = xs => { const s = xs.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

// What the test step does, in order, with how long each part usually takes: the unit tests and the rules tests as one
// item each, then every browser test in the order the newest run ran them, each at its median time over the runs given.
// history: newest first, [{ cases: { unit: [...], rules: [...], gate: [...] } (or after: [...]), stepSeconds }]. scale is
// how much longer the step takes than its tests add up to (starting the emulators, the server, the browser): the median
// ratio over the runs whose step time is known, else 1.
export function testPlan(history, { set = 'gate' } = {}) {
  const runs = history.filter(h => h.cases && (h.cases[set] || []).length);
  if (!runs.length) return null;
  const sum = cs => (cs || []).reduce((n, c) => n + (c.seconds || 0), 0);
  const items = [];
  if (set === 'gate') {
    const unit = median(runs.map(r => sum(r.cases.unit))), rules = median(runs.map(r => sum(r.cases.rules)));
    if (unit) items.push({ name: 'unit tests', seconds: unit, group: true });
    if (rules) items.push({ name: 'rules tests', seconds: rules, group: true });
  }
  for (const c of runs[0].cases[set]) items.push({ name: c.name, seconds: median(runs.map(r => (r.cases[set].find(x => x.name === c.name) || {}).seconds)) || 0 });
  const total = items.reduce((n, i) => n + i.seconds, 0);
  const ratios = runs.filter(r => r.stepSeconds > 0).map(r => {
    const own = sum(r.cases[set]) + (set === 'gate' ? sum(r.cases.unit) + sum(r.cases.rules) : 0);
    return own > 0 ? r.stepSeconds / own : null;
  });
  const scale = median(ratios) || 1;
  return { items, scale: Math.max(1, scale), expected: total * Math.max(1, scale), runs: runs.length, set };
}

// Which item of the plan the step is probably on, `elapsed` seconds in: walk the items, each stretched by the plan's
// scale, until the time runs out. Past the end, it says the step is running longer than it usually takes.
export function estimateAt(plan, elapsed) {
  if (!plan || !plan.items.length || !(elapsed >= 0)) return null;
  let at = 0;
  for (let i = 0; i < plan.items.length; i++) {
    const len = plan.items[i].seconds * plan.scale;
    if (elapsed < at + len) return { name: plan.items[i].name, group: !!plan.items[i].group, index: i, of: plan.items.length, into: elapsed - at, expected: plan.expected, over: false, runs: plan.runs };
    at += len;
  }
  const last = plan.items[plan.items.length - 1];
  return { name: last.name, group: !!last.group, index: plan.items.length - 1, of: plan.items.length, into: elapsed - at, expected: plan.expected, over: true, runs: plan.runs };
}

// The CI runs make ci-history keeps, as history for testPlan: newest first, each run once at its newest attempt, its
// cases by task, and the run's id so its step time can be looked up. With part (gate_a, gate_b), the cases are that
// part's alone, from the runs that have it: each half of the gate runs its own test step.
export function historyFrom(ciRuns, { set = 'gate', part = null, limit = 5 } = {}) {
  const newest = new Map();
  for (const r of ciRuns) {
    if (r.info.kind !== set || !r.info.run) continue;
    const was = newest.get(String(r.info.run));
    if (!was || (r.info.attempt || 1) > (was.info.attempt || 1)) newest.set(String(r.info.run), r);
  }
  return [...newest.values()]
    .map(r => ({ r, tasks: part ? ((r.parts || []).find(p => p.part === part) || {}).tasks : r.tasks }))
    .filter(x => x.tasks)
    .sort((a, b) => String(b.r.when).localeCompare(String(a.r.when))).slice(0, limit)
    .map(({ r, tasks }) => ({ run: String(r.info.run), attempt: r.info.attempt, when: r.when, cases: Object.fromEntries(tasks.map(t => [t.id, t.cases])) }));
}

// Which part of the set a job runs, from the name GitHub gives a matrix job: "test (a)" runs gate_a. null for a job
// with no matrix value, which runs the whole set.
export const partOf = (jobName, set) => { const m = /\(([a-z0-9]+)\)\s*$/.exec(jobName || ''); return m ? `${set}_${m[1]}` : null; };

// Which set a workflow run runs: the long set for the walkthroughs' workflow, else the gate.
export const setOf = workflowName => (/after|long|walk/i.test(workflowName || '') ? 'after' : 'gate');

// ---- reading GitHub, kept briefly ----

const RUN_FIELDS = 'databaseId,displayTitle,workflowName,status,conclusion,headBranch,headSha,event,createdAt,startedAt,updatedAt,url,attempt,number';
const VIEW_FIELDS = `${RUN_FIELDS},jobs`;
export const LIVE_MS = 10000; // how old a running run's answer may be
export const RECENT_MS = 15 * 60000; // how long a finished run stays under "just finished"

// Answers kept in memory: a running run's for LIVE_MS, a finished one's for good (it cannot change), with one question
// at a time per key. Kept per process, which is enough: HQ is one process.
const kept = new Map(), asking = new Map();
async function keep(key, maxAge, ask, now = Date.now()) {
  const k = kept.get(key);
  if (k && (maxAge === Infinity || now - k.at < maxAge)) return k.value;
  if (asking.has(key)) return asking.get(key);
  const job = (async () => {
    try { const value = await ask(); kept.set(key, { at: Date.now(), value }); return value; } finally { asking.delete(key); }
  })();
  asking.set(key, job);
  return job;
}
export const forgetKept = () => { kept.clear(); asking.clear(); };

const parse = text => { try { return JSON.parse(text); } catch { return null; } };

// The last runs of every workflow, newest first.
export async function recentRuns({ repo, gh, now = Date.now() }) {
  return keep(`list:${repo}`, LIVE_MS, async () => parse(await gh(['run', 'list', '--limit', '20', '--json', RUN_FIELDS], repo)) || [], now);
}

// One run with its jobs and steps; kept for good once it has finished.
export async function runWithJobs({ repo, gh, id, now = Date.now() }) {
  const key = `run:${repo}:${id}`, k = kept.get(key);
  const done = k && k.value && k.value.status === 'completed';
  return keep(key, done ? Infinity : LIVE_MS, async () => parse(await gh(['run', 'view', String(id), '--json', VIEW_FIELDS], repo)), now);
}

// How long the test step took in a finished run, from its jobs; null when the run or the step cannot be found.
export async function stepSecondsOf({ repo, gh, id, step }) {
  try {
    const r = await runWithJobs({ repo, gh, id });
    for (const j of (r && r.jobs) || []) {
      const s = (j.steps || []).find(x => x.name === step && x.status === 'completed');
      const a = s && timeOf(s.startedAt), b = s && timeOf(s.completedAt);
      if (a != null && b != null) return (b - a) / 1000;
    }
  } catch { /* not known: the plan goes unscaled */ }
  return null;
}

// The plan for a set, or one part of it, from the CI runs make ci-history kept, with each run's step time looked up
// (finished runs, asked once and kept). null when there is no history.
export async function planFor({ repo, cache, gh, set = 'gate', part = null, step }) {
  const history = historyFrom(storedCiRuns(cache), { set, part });
  if (!history.length) return null;
  for (const h of history) h.stepSeconds = await stepSecondsOf({ repo, gh, id: h.run, step });
  return testPlan(history, { set });
}

// The test step's name, read from the repo's test.yml.
export function stepName(repo) {
  try { return testStepName(readFileSync(join(repo, '.github', 'workflows', 'test.yml'), 'utf8')); } catch { return 'Run the tests'; }
}

// Everything the CI part shows: runs going now with their jobs and steps and an estimate for the test step, and runs
// that finished in the last RECENT_MS.
export async function ciNow({ repo, cache, gh, now = Date.now() }) {
  const runs = await recentRuns({ repo, gh, now });
  const step = stepName(repo);
  const active = runs.filter(r => r.status !== 'completed');
  const recent = runs.filter(r => r.status === 'completed' && now - (timeOf(r.updatedAt) || 0) < RECENT_MS);
  const plans = {};
  const going = await Promise.all(active.map(async r => {
    const full = (await runWithJobs({ repo, gh, id: r.databaseId, now })) || { ...r, jobs: [] };
    return describeRun(full, { now, step, plan: async (set, part) => (plans[`${set} ${part}`] ??= await planFor({ repo, cache, gh, set, part, step })) });
  }));
  return { at: now, step, going, recent: recent.map(r => ({ ...r, finished: timeOf(r.updatedAt) })) };
}

// One run as the page needs it: its jobs' step timelines, and for a job whose test step is running, the estimate.
export async function describeRun(run, { now = Date.now(), step, plan = async () => null } = {}) {
  const started = timeOf(run.startedAt) || timeOf(run.createdAt);
  const jobs = await Promise.all((run.jobs || []).map(async j => {
    const steps = stepTimeline(j, now);
    const testing = steps.find(s => s.name === step && s.state === 'running');
    const p = testing ? await plan(setOf(run.workflowName), partOf(j.name, setOf(run.workflowName))) : null;
    return { name: j.name, status: j.status, conclusion: j.conclusion, url: j.url, steps, estimate: testing ? { ...(estimateAt(p, testing.seconds) || {}), known: !!p, set: setOf(run.workflowName), elapsed: testing.seconds } : null };
  }));
  return { ...run, elapsed: started == null ? null : ((run.status === 'completed' ? timeOf(run.updatedAt) || now : now) - started) / 1000, jobs };
}
