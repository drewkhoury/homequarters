// make dora's figures: how often changes reach players, how long a change takes to get there, what failed after it went
// live, and what testing costs, worked out from GitHub's raw answers that hq/dora-fetch.mjs keeps. Everything here
// is pure: hq/dora.mjs reads the files and asks git, then hands the data and two git questions in. The definitions,
// and why each one differs from DORA's where it does, are in docs/decisions/2026-10-06-make-dora-counts-delivery.md;
// dora.json's shape is there too, and tests/unit/dora.test.mjs holds the output to it.
//
// A figure never pretends: each one carries its n, the items behind it (each with a link to its run), and what it
// cannot see. A figure with no data is null with a reason, never 0, because "none" and "unknown" are different facts.
import { flakes } from './runs.mjs';

export const VERSION = 4; // 4, 15 October: the project's block is `project`, with `questkeep` beside it for one release
// The project's own, from the manifest's delivery key (configureDelivery): the zone its days are counted in, and the
// workflows that deploy and that run the tests. The zone defaults to this machine's; the workflows to GitHub's usual names.
export let TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export let DEPLOY_WORKFLOW = '.github/workflows/deploy.yml', TEST_WORKFLOW = '.github/workflows/test.yml';
// What players get: a deploy that changed none of these served the same app, whatever else changed
// The paths whose change reaches users (the manifest's delivery.userPaths); with none, every change counts as reaching them.
export let PLAYER_PATHS = [];
export function configureDelivery({ userPaths, tz, deployWorkflow, testWorkflow } = {}) {
  if (Array.isArray(userPaths)) PLAYER_PATHS = userPaths;
  if (typeof tz === 'string' && tz) TZ = tz;
  if (typeof deployWorkflow === 'string' && deployWorkflow) DEPLOY_WORKFLOW = deployWorkflow;
  if (typeof testWorkflow === 'string' && testWorkflow) TEST_WORKFLOW = testWorkflow;
}
export const WINDOWS = [1, 7, 30];
// The 90th percentile of fewer values is just the largest one
export const P90_FROM = 10;
// series.days: the 30-day window and the 30 days before it, one entry per Eastern day
export const SERIES_DAYS = 60;
// how many of a period's slowest changes it names
export const SLOWEST = 5;
// A period is compared with the one before only when each holds at least this many values
export const COMPARE_FROM = 5;
// Over 30 days, a day with fewer changes than this turns the lead time spread into weeks
export const BAND_DAILY_FROM = 3;

// Changes to how things are counted, so a reader sees the cause beside a shift in a figure. Only ones that move a
// figure here are listed; tests/unit/dora.test.mjs checks every decision file named still exists.
export const COUNTING_CHANGES = [
  { date: '2026-09-27', what: 'Deploys skip a tree live already serves and reuse a passed gate.', decision: null },
  { date: '2026-10-03', what: 'CI moved to the Laptop. Gate time and runner wait aren\'t comparable across this date.', decision: '2026-10-03-ci-on-the-laptop.md' },
  { date: '2026-10-03', what: 'CI can reuse a Laptop gate that passed on the same tree. Reused gates are left out of gate time.', decision: '2026-10-03-ci-reuses-a-laptop-gate.md' },
  { date: '2026-10-05', what: 'Pushes that don\'t change served files stop deploying. Deploys had already fallen on 3–4 Oct.', decision: '2026-10-05-deploy-only-when-served-files-change.md' },
  { date: '2026-10-05', what: 'Screen tests moved from the gate to the long set.', decision: '2026-10-05-screen-tests-run-nightly.md' },
  { date: '2026-10-05', what: 'Three sync tests moved from the gate to the long set.', decision: '2026-10-05-three-sync-tests-run-nightly.md' },
  { date: '2026-10-11', what: 'A red gate reruns its failing tests once. It can find flakes that went unseen, so the Flake rate may rise; the rate says how many the rerun found.', decision: '2026-10-11-rerun-once-on-a-gate-red.md' },
];

// ---- Days, in Eastern time: a day is midnight to midnight there, 23 or 25 hours when the clocks change ----

const FMT = new Map();
const partsOf = (ms, tz) => {
  if (!FMT.has(tz)) FMT.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  return Object.fromEntries(FMT.get(tz).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
};
// The day an instant falls on in tz, as yyyy-mm-dd
export const dayKey = (ms, tz = TZ) => { const p = partsOf(ms, tz); return `${p.year}-${p.month}-${p.day}`; };
// A calendar step: noon UTC never crosses a date line when a day is added or taken away
export const addDays = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// The instant a day starts in tz: guess midnight UTC, then correct by tz's offset at the guess, twice, since the
// offset at the guess and at the answer can differ on the day the clocks change
export function dayStart(key, tz = TZ) {
  const [y, m, d] = key.split('-').map(Number), midnight = Date.UTC(y, m - 1, d);
  let t = midnight;
  for (let i = 0; i < 2; i++) {
    const p = partsOf(t, tz);
    t = midnight - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t);
  }
  return t;
}

// The windows a figure is counted over: whole days that ended at the last midnight before asOf, each against the
// same number of days before it. The 1-day window is yesterday.
export function windowsAt(asOf, tz = TZ) {
  const today = dayKey(asOf, tz);
  return WINDOWS.map(n => ({
    id: `${n}d`, days: n, from: dayStart(addDays(today, -n), tz), to: dayStart(today, tz),
    prev: { from: dayStart(addDays(today, -2 * n), tz), to: dayStart(addDays(today, -n), tz) },
  }));
}

// The days since the newest daily copy before today that have none, oldest first, at most max of them: a night the
// laptop slept, filled in by the next run and marked writtenLate. With no copy before today there is no gap to fill.
export function lateDays(copies, today, max = 30) {
  const last = copies.filter(k => k < today).sort().at(-1), out = [];
  if (!last) return out;
  for (let k = addDays(last, 1); k < today && out.length < max; k = addDays(k, 1)) if (!copies.includes(k)) out.push(k);
  return out;
}

// ---- Small helpers ----

const ms = iso => (iso ? Date.parse(iso) : NaN);
const secs = (a, b) => { const d = (ms(b) - ms(a)) / 1000; return Number.isFinite(d) ? Math.round(d) : null; };
const inRange = (iso, r) => { const t = ms(iso); return t >= r.from && t < r.to; };
export const runnerOf = job => ((job && job.labels) || []).includes('self-hosted') ? 'laptop' : 'hosted';
const isDeployRun = r => r.path === DEPLOY_WORKFLOW;
const isTestRun = r => r.path === TEST_WORKFLOW;
const GATE_JOB = /^(test|test \([ab]\)|laptop)$/;
// The step that sends the site to Hosting, by every name it has had
const DEPLOY_STEP = /^(Deploy to production|Run make deploy)/;
const REUSE_STEP = /^Reuse a gate that passed/;
const runLink = (r, attempt) => `${r.html_url}${attempt > 1 ? `/attempts/${attempt}` : ''}`;

// n, median, the 90th percentile (from P90_FROM values; nearest rank), the smallest and the largest, or null for none
export function stats(values) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = p => v[Math.min(v.length - 1, Math.ceil(p * v.length) - 1)];
  const median = v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
  return { n: v.length, median, p90: v.length >= P90_FROM ? rank(0.9) : null, min: v[0], max: v.at(-1) };
}

// ---- Reading the runs ----

// decide's row from its job log: the line "Row N: action. reason"
export function rowFromLog(text) {
  const m = /Row (\d+): (\w+)\.\*{0,2} ?(.*)$/m.exec(String(text || ''));
  return m ? { row: Number(m[1]), action: m[2], reason: m[3].trim() } : null;
}

// Every production deploy CI made: a Deploy run's deploy job whose deploy step passed, even when the job was cancelled
// after it (that release is live all the same). Each attempt counts, since a re-run can deploy. playerFacing says
// whether it changed what players get against the deploy before it: null when git could not tell (a commit not fetched
// yet), and true for the first one GitHub has, which brought the app to players.
// jobsOf(runId, attempt) gives that attempt's jobs; rows is a Map of run id to decide's row; changed(a, b) says whether
// any of PLAYER_PATHS differ between two commits.
export function deploysOf({ runs, jobsOf, rows = new Map(), changed }) {
  const out = [];
  for (const r of runs.filter(r => isDeployRun(r) && r.status === 'completed')) {
    for (let a = 1; a <= (r.run_attempt || 1); a++) {
      const js = jobsOf(r.id, a) || [], d = js.find(j => j.name === 'deploy');
      const step = d && (d.steps || []).find(s => DEPLOY_STEP.test(s.name) && s.conclusion === 'success');
      if (!step) continue;
      const smoke = js.find(j => j.name === 'smoke');
      out.push({ run: r.id, attempt: a, sha: r.head_sha, liveAt: step.completed_at, runner: runnerOf(d), row: rows.get(r.id)?.row ?? null,
        smoke: smoke ? smoke.conclusion : null, smokeAt: smoke ? smoke.completed_at : null, url: runLink(r, a) });
    }
  }
  out.sort((x, y) => ms(x.liveAt) - ms(y.liveAt));
  out.forEach((d, i) => { d.playerFacing = i === 0 ? true : d.sha === out[i - 1].sha ? false : changed(out[i - 1].sha, d.sha); });
  return out;
}

// What went wrong after a deploy. A failed deploy is DORA's: a release that went live and then needed fixing, which
// here is a red production smoke test after the deploy, or a deploy job that went red after its deploy step passed.
// A deploy job that went red before releasing anything is a pipeline cost, listed apart (released: false).
export function failuresOf({ runs, jobsOf }) {
  const out = [];
  for (const r of runs.filter(r => isDeployRun(r) && r.status === 'completed')) {
    for (let a = 1; a <= (r.run_attempt || 1); a++) {
      const js = jobsOf(r.id, a) || [], d = js.find(j => j.name === 'deploy'), smoke = js.find(j => j.name === 'smoke');
      if (!d) continue;
      const step = (d.steps || []).find(s => DEPLOY_STEP.test(s.name));
      const released = !!step && step.conclusion === 'success';
      const base = { run: r.id, attempt: a, sha: r.head_sha, url: runLink(r, a) };
      if (released && smoke && smoke.conclusion === 'failure') out.push({ ...base, kind: 'smoke', released, liveAt: step.completed_at, at: smoke.completed_at });
      else if (d.conclusion === 'failure') out.push({ ...base, kind: 'deploy-job', released, liveAt: released ? step.completed_at : null, at: d.completed_at });
    }
  }
  return out.sort((x, y) => ms(x.at) - ms(y.at));
}

// For each failed release, the next deploy after it whose smoke test passed (not one skipped or cancelled), or a re-run
// of the same release whose smoke test passed, whichever came first: DORA's failed deployment recovery
// time runs from the bad release going live to that one going live. One with no good deploy after it yet is open.
export function recoveriesOf(failures, deploys) {
  return failures.filter(f => f.released).map(f => {
    // a re-run of the same release whose smoke test passed: the release was fine all along, green again when it passed
    const recheck = deploys.find(d => d.run === f.run && d.attempt > f.attempt && d.smoke === 'success' && d.smokeAt);
    const next = deploys.find(d => ms(d.liveAt) > ms(f.liveAt) && d.smoke === 'success');
    const ends = [recheck && { run: recheck.run, at: recheck.smokeAt }, next && { run: next.run, at: next.liveAt }].filter(Boolean)
      .sort((a, b) => ms(a.at) - ms(b.at));
    const end = ends[0] || null;
    return { failedRun: f.run, sha: f.sha, liveAt: f.liveAt, restoredRun: end ? end.run : null, restoredAt: end ? end.at : null, sec: end ? secs(f.liveAt, end.at) : null, url: f.url };
  });
}

// The test slot's log for the laptop runner: how long a gate job waited for the slot (from its wait to its take) and
// the machine's state when it let go. Lines that carry the run (ciRun, ciAttempt, from 6 October 2026) are matched by it;
// older ones by time, which holds because the runner runs one job at a time, so the take inside a job's span is its own.
export function slotOf(lock, job, run = null, attempt = 1) {
  const from = ms(job.started_at), to = ms(job.completed_at);
  const byRun = run ? lock.filter(e => e.ciRun === run && (e.ciAttempt || 1) === attempt) : [];
  const mine = byRun.length ? byRun : lock.filter(e => /laptop runner/.test(e.person || '') && e.ciRun == null && ms(e.at) >= from && ms(e.at) <= to + 5000);
  const take = mine.find(e => e.event === 'take');
  if (!take) return null;
  const wait = lock.find(e => e.event === 'wait' && e.pid === take.pid && ms(e.at) <= ms(take.at) && ms(e.at) >= from);
  const release = mine.find(e => e.event === 'release' && e.pid === take.pid);
  const m = (release || take).machine || {};
  return { waitSec: wait ? secs(wait.at, take.at) : 0, load: { pressure: m.pressure ?? null, load1: m.load1 ?? null, pagingMBps: m.pagingMBps ?? null } };
}

// The gate jobs of a test.yml attempt and their span
function gateOf(r, attempt, jobsOf, lock) {
  // a skipped job carries a start later than its end, so only jobs that ran count
  const js = (jobsOf(r.id, attempt) || []).filter(j => GATE_JOB.test(j.name) && j.conclusion !== 'skipped' && j.started_at && j.completed_at);
  if (!js.length) return null;
  const start = js.map(j => j.started_at).sort()[0], end = js.map(j => j.completed_at).sort().at(-1);
  const laptop = js.find(j => runnerOf(j) === 'laptop');
  const slot = laptop ? slotOf(lock, laptop, r.id, attempt) : null;
  // the reuse step passes whether or not it found a gate to reuse; the tests being skipped says it did
  const step = name => laptop && (laptop.steps || []).find(s => name.test(s.name));
  const reused = !!laptop && step(REUSE_STEP)?.conclusion === 'success' && step(/^Run the tests$/)?.conclusion === 'skipped';
  // runner wait is per job, from queued to started, so the time a red attempt and its re-run took is not called waiting
  const queued = js.map(j => j.created_at).filter(Boolean).sort()[0];
  return { start, end, runner: laptop ? 'laptop' : 'hosted', reused, ok: js.every(j => j.conclusion === 'success'), slot,
    runnerWaitSec: queued ? secs(queued, start) : null, slotWaitSec: laptop ? (slot ? slot.waitSec : null) : 0, gateSec: secs(start, end) };
}

// What a change or a gate's time went on, in the order it happens
const PARTS = ['runnerWaitSec', 'slotWaitSec', 'gateSec', 'greenToMergeSec', 'mergeToLiveSec', 'otherSec'];

// Lead time, per change that reached players. A change is a push to main: a merged pull request, or a direct push.
// It starts at the pull request's last push (the first run GitHub made for its final head commit) or at the direct
// push, and ends when the first deploy that contains it went live. Its parts: waiting for a runner, waiting for the
// test slot, the gate, green to merged (people), and merged to live. A change that touched none of PLAYER_PATHS is
// left out; one with no deploy yet is pending. contains(a, b) says whether commit a contains commit b. Its title is the
// pull request's, or for a direct push its commit's subject, from commits ({ sha, subject }), or null.
export function changesOf({ runs, jobsOf, pulls = [], deploys, lock = [], commits = [], changed, contains }) {
  const pushes = [], seen = new Set();
  // two pushes can land in the same second; GitHub numbers runs in the order it saw them
  for (const r of runs.filter(r => isDeployRun(r) && r.event === 'push' && r.head_branch === 'main').sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id - b.id)) {
    if (!seen.has(r.head_sha)) { seen.add(r.head_sha); pushes.push(r); }
  }
  const byMerge = new Map(pulls.filter(p => p.merged_at && p.merge_commit_sha).map(p => [p.merge_commit_sha, p]));
  const subject = new Map(commits.map(c => [c.sha, c.subject]));
  const out = [];
  pushes.forEach((push, i) => {
    // the first push has nothing before it to say what it changed; null (git could not tell) keeps the change
    if (i === 0 || changed(pushes[i - 1].head_sha, push.head_sha) === false) return;
    const live = deploys.find(d => ms(d.liveAt) >= ms(push.created_at) && contains(d.sha, push.head_sha));
    const pr = byMerge.get(push.head_sha);
    const item = { sha: push.head_sha, push: push.id, path: pr ? 'pr' : 'push', pr: pr ? pr.number : null, title: pr ? pr.title ?? null : subject.get(push.head_sha) ?? null, startAt: null, mergedAt: pr ? pr.merged_at : push.created_at,
      liveAt: live ? live.liveAt : null, deployRun: live ? live.run : null, totalSec: null, split: null, runner: null, url: pr ? pr.html_url : runLink(push, 1) };
    if (pr) {
      const prRuns = runs.filter(r => r.event === 'pull_request' && r.head_sha === pr.head.sha).sort((a, b) => ms(a.created_at) - ms(b.created_at));
      item.startAt = prRuns.length ? prRuns[0].created_at : null;
      const t = prRuns.filter(isTestRun).at(-1), g = t ? gateOf(t, t.run_attempt || 1, jobsOf, lock) : null;
      if (g) {
        item.runner = g.runner;
        item.split = { runnerWaitSec: g.runnerWaitSec, slotWaitSec: g.slotWaitSec, gateSec: g.slotWaitSec != null ? g.gateSec - g.slotWaitSec : g.gateSec,
          greenToMergeSec: secs(g.end, pr.merged_at), mergeToLiveSec: live ? secs(pr.merged_at, live.liveAt) : null, reused: g.reused };
      }
    } else item.startAt = push.created_at;
    if (item.startAt && live) item.totalSec = secs(item.startAt, live.liveAt);
    // what the parts leave out: gate attempts that went red and their re-runs, and time before the last gate was queued
    if (item.split && item.totalSec != null) {
      const s = item.split, parts = PARTS.slice(0, -1).map(k => s[k]);
      s.otherSec = parts.every(v => v != null) ? item.totalSec - parts.reduce((a, b) => a + b, 0) : null;
    }
    out.push(item);
  });
  return out;
}

// Pull request gate runs that went red, each with its cause: infra when a failed job never ran a step (the runner
// or the minutes were missing), experiment for a throwaway exp/ branch, filing when only the job that files a passed
// gate failed, and test for the rest. The machine's state sits beside a laptop red as context, never as its cause: a
// race that shows only under load is still a bug.
export function prRedsOf({ runs, jobsOf, lock = [] }) {
  const tests = runs.filter(r => isTestRun(r) && r.event === 'pull_request');
  const redOf = (r, attempt, earlier) => {
    const js = jobsOf(r.id, attempt) || [], failed = js.filter(j => j.conclusion === 'failure');
    const neverRan = j => !(j.steps || []).length;
    const cause = /^exp\//.test(r.head_branch || '') ? 'experiment'
      : failed.length && failed.every(neverRan) ? 'infra'
      : failed.length && failed.every(j => j.name === 'filed') ? 'filing' : 'test';
    const laptop = failed.find(j => runnerOf(j) === 'laptop') || js.find(j => runnerOf(j) === 'laptop' && GATE_JOB.test(j.name));
    const slot = laptop ? slotOf(lock, laptop, r.id, attempt) : null;
    return { run: r.id, attempt, ...(earlier ? { earlier: true } : {}), at: r.created_at, branch: r.head_branch, cause, jobs: failed.map(j => j.name), runner: laptop ? 'laptop' : 'hosted', load: slot ? slot.load : null,
      slotWaitSec: slot ? slot.waitSec : null, url: runLink(r, attempt) };
  };
  // A run keeps the conclusion of its last attempt, so an attempt that went red and was re-run is found in its own job
  // files; an attempt with none cached, or with no failed job, is not counted.
  const earlierReds = r => Array.from({ length: (r.run_attempt || 1) - 1 }, (_, i) => i + 1)
    .filter(a => (jobsOf(r.id, a) || []).some(j => j.conclusion === 'failure')).map(a => redOf(r, a, true));
  return tests.flatMap(r => [...earlierReds(r), ...(r.conclusion === 'failure' ? [redOf(r, r.run_attempt || 1, false)] : [])]);
}

// Every merged pull request whose last gate ran green, with the time from that gate going green to the merge. changesOf
// leaves out a push that changed no served file, so these are the pull requests waiting on the person that it drops too.
// Answers [{ pr, mergedAt, greenToMergeSec }].
export function mergesOf({ runs, jobsOf, pulls, lock = [] }) {
  return pulls.filter(p => p.merged_at && p.head && p.head.sha).flatMap(p => {
    const t = runs.filter(r => isTestRun(r) && r.event === 'pull_request' && r.head_sha === p.head.sha).sort((a, b) => ms(a.created_at) - ms(b.created_at)).at(-1);
    const g = t ? gateOf(t, t.run_attempt || 1, jobsOf, lock) : null;
    const wait = g && g.ok ? secs(g.end, p.merged_at) : null;
    return wait != null && wait >= 0 ? [{ pr: p.number, mergedAt: p.merged_at, greenToMergeSec: wait }] : [];
  });
}

// Gate seconds for each pull request gate run that passed, from its first gate job's start to its last one's end, less
// any wait for the test slot, which each carries apart (null on the laptop when the lock has no line for it). A run that
// reused a laptop gate is counted apart, since it ran no tests.
export function gatesOf({ runs, jobsOf, lock = [] }) {
  return runs.filter(r => isTestRun(r) && r.event === 'pull_request' && r.conclusion === 'success').flatMap(r => {
    const g = gateOf(r, r.run_attempt || 1, jobsOf, lock);
    return g ? [{ run: r.id, at: r.created_at, runner: g.runner, reused: g.reused, sec: g.slotWaitSec ? g.gateSec - g.slotWaitSec : g.gateSec,
      slotWaitSec: g.runner === 'laptop' ? g.slotWaitSec : null, url: runLink(r, r.run_attempt || 1) }] : [];
  });
}

// fix: commits, with the trailers that say whether a player saw the bug and who found it. The trailer is optional,
// so the figure says how many fixes carry it. playerFix says whether the fix changed what players get, from the
// commit's changed paths (paths), or null when they were not given.
// with no userPaths declared every path reaches users, as changed() does when it diffs no particular paths
const servesPlayers = path => !PLAYER_PATHS.length || PLAYER_PATHS.some(p => path === p || path.startsWith(`${p}/`));
export function fixesOf(commits) {
  return commits.filter(c => /^fix(\([^)]*\))?!?:/.test(c.subject)).map(c => {
    const pf = /^Player-facing:\s*(yes|no)\b/mi.exec(c.body || ''), by = /^Found-by:\s*(.+)$/mi.exec(c.body || '');
    return { sha: c.sha, at: c.at, subject: c.subject, playerFacing: pf ? pf[1].toLowerCase() === 'yes' : null, foundBy: by ? by[1].trim() : null,
      playerFix: Array.isArray(c.paths) ? c.paths.some(servesPlayers) : null };
  });
}

// The open pull requests, oldest first, each with when its last push was (the first run GitHub made for its head), its
// head's latest gate run as checks, and stale: a merged pull request with the same title, which usually means this one
// was done again elsewhere and left open. open is GitHub's pulls?state=open answer, pulls the closed ones.
const checksOf = r => !r ? 'none' : r.status !== 'completed' ? 'pending' : r.conclusion === 'success' ? 'pass'
  : ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion) ? 'fail' : 'none';
export function waitingOf({ open = [], pulls = [], runs = [] }) {
  const title = t => String(t || '').trim().toLowerCase(), merged = pulls.filter(p => p.merged_at);
  return open.map(p => {
    const mine = runs.filter(r => r.head_sha === p.head.sha).sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id - b.id);
    const twin = merged.filter(q => q.number !== p.number && title(q.title) === title(p.title)).sort((a, b) => ms(b.merged_at) - ms(a.merged_at))[0];
    return { pr: p.number, title: p.title, url: p.html_url, openedAt: p.created_at, lastPushAt: mine.length ? mine[0].created_at : null,
      checks: checksOf(mine.filter(isTestRun).at(-1)), stale: twin ? { pr: twin.number, title: twin.title } : null };
  }).sort((a, b) => ms(a.openedAt) - ms(b.openedAt) || a.pr - b.pr);
}

// For each failure, the first commit on main whose message names its run: the person reads its subject to learn what it
// was. The code never judges a failure from the words. A message can only name a run that already exists, so the oldest
// one that does is the first after it; commit dates move later on a rebase, never earlier.
export function explainedByOf(failures, commits) {
  const oldest = [...commits].sort((a, b) => ms(a.at) - ms(b.at));
  return failures.map(f => {
    const id = new RegExp(`\\b${f.run}\\b`), c = oldest.find(c => id.test(c.subject) || id.test(c.body || ''));
    return { ...f, explainedBy: c ? { sha: c.sha, subject: c.subject } : null };
  });
}

// ---- One window ----

const within = (list, r, key) => list.filter(x => inRange(x[key], r));
const leadOf = items => {
  const done = items.filter(c => c.totalSec != null), s = stats(done.map(c => c.totalSec));
  const paths = {}; for (const c of items) paths[c.path] = (paths[c.path] || 0) + 1;
  return s ? { start: 'lastPush', ...s, paths, noStart: items.filter(c => !c.startAt).length, pending: items.filter(c => !c.liveAt).length }
    : { start: 'lastPush', n: 0, paths, noStart: items.filter(c => !c.startAt).length, pending: items.filter(c => !c.liveAt).length, reason: 'No change that reached players went live in this window.' };
};
const median = (items, k) => stats(items.map(c => c.split && c.split[k]).filter(v => v != null));
// Changes with a total and every part, the only ones whose parts add up to the whole
const whole = items => items.filter(c => c.totalSec != null && c.split && PARTS.every(k => c.split[k] != null));
const brief = c => ({ pr: c.pr, title: c.title, totalSec: c.totalSec, split: c.split, url: c.url });
// The typical change: the one at the median total (the lower middle one when there is an even number), with its own
// parts. Adding up each part's median would describe a change that never happened.
const typicalOf = items => {
  const w = whole(items).sort((a, b) => a.totalSec - b.totalSec || ms(a.liveAt) - ms(b.liveAt));
  return w.length ? { ...brief(w[(w.length - 1) >> 1]), sha: w[(w.length - 1) >> 1].sha, of: w.length } : null;
};
// Each part summed over the period's whole changes: where the hours went
const hoursOf = items => {
  const w = whole(items);
  return { n: w.length, totalSec: w.reduce((a, c) => a + c.totalSec, 0), ...Object.fromEntries(PARTS.map(k => [k, w.reduce((a, c) => a + c.split[k], 0)])) };
};
const slowestOf = items => items.filter(c => c.totalSec != null).sort((a, b) => b.totalSec - a.totalSec).slice(0, SLOWEST).map(brief);
// How many of a list ran on each runner, or null when they all ran on one. A median across GitHub's machines and the
// laptop measures neither, so a mixed figure is given per runner as well.
const mixOf = items => { const n = {}; for (const x of items) if (x.runner) n[x.runner] = (n[x.runner] || 0) + 1; return Object.keys(n).length > 1 ? n : null; };
const perRunner = (items, of) => Object.fromEntries([...new Set(items.map(x => x.runner).filter(Boolean))].sort().map(k => [k, of(items.filter(x => x.runner === k))]));
const MACHINE = ['runnerWaitSec', 'slotWaitSec', 'gateSec'];
// Machine figures are compared only when both periods ran on the same runners: null when they can be, or the reason
const whyNotComparable = (a, b) => {
  const r = l => [...new Set(l.map(x => x.runner))].sort().join();
  return !b.length ? 'nothing in the period before' : !a.length ? null : r(a) === r(b) ? null : 'different runner';
};

// Where a range's record starts: the later of its start and the day of the first run, or null when it ends before that
const recordOf = (d, r) => d.recordFrom == null || d.recordFrom >= r.to ? null : Math.max(r.from, d.recordFrom);
// whole days, since a day the clocks change is 23 or 25 hours long
const recordedDays = (d, r) => { const f = recordOf(d, r); return f == null ? 0 : Math.round((r.to - f) / 86400e3); };

// A tile's comparison with the period before: ok only when that period has a record and each period holds at least
// COMPARE_FROM values. now and before are the figures to compare, reason says why not, in the page's words.
const compareOf = (now, before, nNow, nBefore, hasRecord) =>
  !hasRecord ? { ok: false, now, before: null, reason: 'No earlier data' }
    : nNow < COMPARE_FROM || nBefore < COMPARE_FROM ? { ok: false, now, before, reason: 'Too few to compare' }
      : { ok: true, now, before, reason: null };
const rate = (n, of) => (of ? Math.round((n / of) * 1000) / 1000 : null);
function compareAll(now, before, hasRecord) {
  const [a, b] = [now.portable, before.portable];
  a.deploys.compare = compareOf(a.deploys.perDay, b.deploys.perDay, a.deploys.n, b.deploys.n, hasRecord);
  a.leadTime.compare = compareOf(a.leadTime.median ?? null, b.leadTime.median ?? null, a.leadTime.n, b.leadTime.n, hasRecord);
  // a rate of events needs the events themselves in each period: one failure against none is no trend
  a.failedDeploys.compare = compareOf(rate(a.failedDeploys.n, a.failedDeploys.of), rate(b.failedDeploys.n, b.failedDeploys.of), a.failedDeploys.n, b.failedDeploys.n, hasRecord);
  a.rework.compare = compareOf(rate(a.rework.fixDeploys, a.rework.of), rate(b.rework.fixDeploys, b.rework.of), a.rework.fixDeploys, b.rework.fixDeploys, hasRecord);
}

// Lead time's spread for the chart: each recorded day's median and 90th percentile (from P90_FROM changes) of the
// changes that went live that day. Over 30 days, once a recorded day has fewer than BAND_DAILY_FROM, it is given by
// weeks counted back from the last day, the first one cut at the record's start.
function leadBandOf(d, w, tz) {
  const from = recordOf(d, w);
  if (from == null) return [];
  const first = dayKey(from, tz), last = dayKey(w.to - 1, tz), keys = [];
  for (let k = first; k <= last; k = addDays(k, 1)) keys.push(k);
  const totals = (a, b) => within(d.changes, { from: dayStart(a, tz), to: dayStart(addDays(b, 1), tz) }, 'liveAt').map(c => c.totalSec).filter(v => v != null);
  const weekly = w.days >= 30 && keys.some(k => totals(k, k).length < BAND_DAILY_FROM);
  const buckets = [];
  if (!weekly) for (const k of keys) buckets.push([k, k]);
  else for (let i = keys.length - 1; i >= 0; i -= 7) buckets.unshift([keys[Math.max(0, i - 6)], keys[i]]);
  return buckets.map(([a, b]) => {
    const s = stats(totals(a, b));
    return { day: a, days: keys.indexOf(b) - keys.indexOf(a) + 1, n: s ? s.n : 0, median: s ? s.median : null, p90: s ? s.p90 : null };
  });
}

// The period's hours by stage, in the order a change meets them: red gates and their re-runs come before the last
// gate is queued. share is of the summed total.
const STAGES = [['reruns', 'otherSec'], ['queue', 'runnerWaitSec'], ['slot', 'slotWaitSec'], ['gate', 'gateSec'], ['mergeWait', 'greenToMergeSec'], ['toLive', 'mergeToLiveSec']];
const stageShareOf = h => STAGES.map(([stage, k]) => ({ stage, sec: h[k], share: h.totalSec ? Math.round((h[k] / h.totalSec) * 1000) / 1000 : null }));

const slotWaitOf = list => {
  const known = list.filter(x => x.runner === 'laptop' && x.slotWaitSec != null), waited = known.filter(x => x.slotWaitSec > 0);
  return { gates: known.length, waited: waited.length, sec: stats(waited.map(x => x.slotWaitSec)) };
};

// One Eastern day's figures for series.days. era says which runners its pull request gates ran on: hosted, laptop or
// mixed, and null on a day with no gate.
function dayOf(d, key, tz) {
  const r = { from: dayStart(key, tz), to: dayStart(addDays(key, 1), tz) };
  const deploys = within(d.deploys, r, 'liveAt'), changes = within(d.changes, r, 'liveAt');
  const gates = within(d.gates, r, 'at'), reds = within(d.prReds, r, 'at');
  const runners = [...new Set([...gates, ...reds].map(x => x.runner))];
  const red = { test: 0, infra: 0, experiment: 0, filing: 0 }; for (const x of reds) red[x.cause]++;
  const ran = gates.filter(g => !g.reused);
  const testRuns = d.testRuns.filter(t => inRange(t.when, r));
  return {
    day: key, era: runners.length > 1 ? 'mixed' : runners[0] || null,
    deploys: { player: deploys.filter(x => x.playerFacing === true).length, same: deploys.filter(x => x.playerFacing === false).length, unknown: deploys.filter(x => x.playerFacing == null).length },
    failed: within(d.failures, r, 'at').filter(f => f.released && f.playerFacing === true).length,
    changes: changes.length, leadSec: { median: stats(changes.map(c => c.totalSec))?.median ?? null },
    gates: { passed: gates.length, red, secMedian: Object.fromEntries([...new Set(ran.map(g => g.runner))].sort().map(k => [k, stats(ran.filter(g => g.runner === k).map(g => g.sec)).median])) },
    testRuns: testRuns.length, flakes: testRuns.length ? flakes(testRuns).length : 0,
  };
}

function figures(d, r) {
  // a deploy git could not judge (its commit not fetched yet) is unknown, never counted as player-facing
  const deploys = within(d.deploys, r, 'liveAt'), player = deploys.filter(x => x.playerFacing === true);
  const changes = within(d.changes, r, 'liveAt'), failures = within(d.failures, r, 'at'), recoveries = within(d.recoveries, r, 'liveAt');
  const failed = failures.filter(f => f.released && f.playerFacing === true);
  const reds = within(d.prReds, r, 'at'), gates = within(d.gates, r, 'at'), fixes = within(d.fixes, r, 'at');
  const rows = { 5: 0, 6: 0, 7: 0 }; for (const x of within(d.rowRuns, r, 'at')) if (rows[x.row] != null) rows[x.row]++;
  // a rate a day over the days the record covers: a period that starts before the first run counts only from it
  const days = recordedDays(d, r);
  const cause = {}; for (const x of reds) cause[x.cause] = (cause[x.cause] || 0) + 1;
  const tagged = fixes.filter(f => f.playerFacing != null);
  const testRuns = d.testRuns.filter(t => inRange(t.when, r)), flaky = testRuns.length ? flakes(testRuns) : [];
  const ran = gates.filter(g => !g.reused);
  return {
    portable: {
      deploys: { n: player.length, perDay: days ? Math.round((player.length / days) * 10) / 10 : null, unknown: deploys.filter(x => x.playerFacing == null).length, items: player.map(x => x.run) },
      leadTime: leadOf(changes),
      // of the deploys players got, so it counts the same thing as deploy frequency; a release that changed nothing
      // players get, or that git could not judge, is counted apart
      failedDeploys: { n: failed.length, of: player.length, items: failed.map(f => f.run), apart: failures.filter(f => f.released).length - failed.length },
      recovery: { n: recoveries.length, items: recoveries },
      // DORA's deployment rework rate. n counts fixes whose trailer says players saw the bug; until every fix carries the
      // trailer, fixes that changed what players get stand in for it, so the figure is a proxy. playerFixes counts those
      // commits; a pull request landed by rebase brings several, so the rate is fixDeploys, the deploys that shipped one
      rework: { status: !fixes.length ? 'none' : !tagged.length ? 'untagged' : tagged.length < fixes.length ? 'partial' : 'tagged',
        n: tagged.filter(f => f.playerFacing).length, of: player.length, fixes: fixes.length, tagged: tagged.length,
        playerFixes: fixes.filter(f => f.playerFix === true).length, fixDeploys: player.filter(x => x.shipsFix).length,
        proxy: !fixes.length || tagged.length < fixes.length },
    },
    // the project's own figures (the lead time's parts, the gate's cost); written under questkeep too for one release
    project: {
      rows, identicalRedeploys: deploys.filter(x => x.playerFacing === false).length,
      leadSplit: { runnerWaitSec: median(changes, 'runnerWaitSec'), slotWaitSec: median(changes, 'slotWaitSec'), gateSec: median(changes, 'gateSec'),
        greenToMergeSec: median(changes, 'greenToMergeSec'), mergeToLiveSec: median(changes, 'mergeToLiveSec'), otherSec: median(changes, 'otherSec'), runners: [...new Set(changes.map(c => c.runner).filter(Boolean))],
        mixed: mixOf(changes), byRunner: mixOf(changes) ? perRunner(changes, l => Object.fromEntries(MACHINE.map(k => [k, median(l, k)]))) : null },
      typical: typicalOf(changes), hours: hoursOf(changes), slowest: slowestOf(changes),
      cost: {
        gateSec: stats(ran.map(g => g.sec)), gateReused: gates.length - ran.length, runners: [...new Set(gates.map(g => g.runner))],
        mixed: mixOf(ran), gateSecByRunner: mixOf(ran) ? perRunner(ran, l => stats(l.map(g => g.sec))) : null,
        prReds: { n: reds.length, of: reds.length + gates.length, cause },
        flakesPer100: testRuns.length ? Math.round((flaky.length / testRuns.length) * 1000) / 10 : null, flakes: flaky.length, flakesByRerun: flaky.filter(f => f.byRerun).length, testRuns: testRuns.length,
        pipelineReds: failures.filter(f => !f.released).length,
        // every laptop gate, passed or red, and how many of them waited for the test slot
        slotWait: slotWaitOf([...gates, ...reds]),
      },
    },
    lists: { deploys, changes, failures, reds },
  };
}

// ---- The sources ----

// What each source held, so a reader knows how far a figure can be trusted. label is shown as it is; reason is a short
// phrase. d is compute's answer; deployments and openPulls are null when not fetched yet.
export function sourcesOf({ d, runs, logs, deployments, pulls, openPulls, lock, testRuns, ref }) {
  const newest = l => [...l].sort().at(-1) || null;
  const laptopReds = d.prReds.filter(r => r.runner === 'laptop'), has = k => laptopReds.filter(r => r.load && r.load[k]).length;
  const paging = has('pagingMBps'), pressure = has('pressure');
  const unread = d.deploys.filter(x => x.playerFacing == null).length;
  return {
    git: unread ? { label: 'Git', status: 'read', reason: 'Some deploys\' commits not fetched yet', unreadDeploys: unread, ref } : { label: 'Git', status: 'read', ref },
    runs: { label: 'Actions runs', status: 'read', n: runs.length, through: newest(runs.map(r => r.created_at)) },
    logs: { label: 'Deploy decision logs', status: logs.size ? 'read' : 'missing', n: logs.size, of: runs.filter(r => isDeployRun(r) && r.status === 'completed').length,
      reason: 'None before 27 Sept, and logs expire after 90 days' },
    deployments: deployments ? { label: 'Production deployments', status: 'read', n: deployments.length, note: `${d.deploys.length} deploy jobs released` }
      : { label: 'Production deployments', status: 'missing', reason: 'Not fetched yet' },
    pulls: pulls.length ? { label: 'Pull requests', status: 'read', n: pulls.length } : { label: 'Pull requests', status: 'missing', reason: 'Not fetched yet, so every change counts as a direct push' },
    pullsOpen: openPulls ? { label: 'Open pull requests', status: 'read', n: openPulls.length } : { label: 'Open pull requests', status: 'missing', reason: 'Not fetched yet' },
    hostingReleases: { label: 'Hosting releases', status: 'unread', reason: 'Needs a Firebase login; the only record of laptop deploys and rollbacks' },
    lockLog: lock.length ? { label: 'Test slot log', status: 'read', through: newest(lock.map(e => e.at)), coverage: { pagingMBps: paging, pressure, of: laptopReds.length },
      coverageText: paging === pressure ? `Paging and pressure on ${paging} of ${laptopReds.length} Laptop reds` : `Paging on ${paging} and pressure on ${pressure} of ${laptopReds.length} Laptop reds` }
      : { label: 'Test slot log', status: 'missing', reason: 'No test slot log on this laptop' },
    testRuns: testRuns.length ? { label: 'Recorded test runs', status: 'read', n: testRuns.length } : { label: 'Recorded test runs', status: 'missing', n: 0, reason: 'None recorded' },
  };
}

// ---- The whole file ----

// d: what hq/dora.mjs read and worked out (see compute's caller). Returns dora.json's object.
export function summarise(d, { asOf, tz = TZ, repo = null, sources = {} }) {
  const windows = windowsAt(asOf, tz).map(w => {
    const now = figures(d, w), before = figures(d, w.prev);
    // judged on the gates each period ran, which is where the machine shows
    const why = whyNotComparable(d.gates.filter(g => inRange(g.at, w)), d.gates.filter(g => inRange(g.at, w.prev)));
    const iso = t => (t == null ? null : new Date(t).toISOString()), recordFrom = recordOf(d, w), prevFrom = recordOf(d, w.prev);
    compareAll(now, before, prevFrom != null);
    const { lists, ...fig } = now, { lists: _, ...prev } = before;
    if (why) { prev.project.leadSplit = { reason: why }; prev.project.cost = { reason: why }; }
    fig.questkeep = fig.project; prev.questkeep = prev.project;
    return { id: w.id, days: w.days, from: iso(w.from), to: iso(w.to), recordFrom: iso(recordFrom),
      prev: { from: iso(w.prev.from), to: iso(w.prev.to), recordFrom: iso(prevFrom), ...prev }, ...fig,
      leadBand: leadBandOf(d, w, tz), stageShare: stageShareOf(fig.project.hours) };
  });
  const todayKey = dayKey(asOf, tz), todayFrom = dayStart(todayKey, tz), today = { from: todayFrom, to: asOf + 1 };
  const days = Array.from({ length: SERIES_DAYS }, (_, i) => dayOf(d, addDays(todayKey, i - SERIES_DAYS), tz));
  return {
    version: VERSION, generatedAt: new Date(asOf).toISOString(), repo, tz, level: 3, start: 'lastPush',
    sources, countingChanges: COUNTING_CHANGES,
    // what the figures cannot see, as the page lists it; the decision file has the longer form of each
    blindSpots: [
      'Laptop deploys (make deploy) and console rollbacks. None since 3 Oct.',
      'Bugs players find, until a fix: commit says Player-facing: yes.',
      'Rules or indexes sent by a deploy job that then went red.',
      'Deploys whose commit isn\'t fetched yet. Sources shows how many.',
    ],
    windows, series: { days },
    // what a later run of make dora would not see is never shown: a pull request opened after asOf is left out
    waiting: (d.waiting || []).filter(x => ms(x.openedAt) <= asOf).map(({ pr, title, url, openedAt, lastPushAt, checks, stale }) =>
      ({ pr, title, url, openedAt, lastPushAt, ageSec: Math.max(0, Math.round((asOf - ms(lastPushAt ?? openedAt)) / 1000)), checks, stale })),
    today: { deploys: within(d.deploys, today, 'liveAt').map(x => ({ run: x.run, sha: x.sha, liveAt: x.liveAt, playerFacing: x.playerFacing, url: x.url })),
      failures: within(d.failures, today, 'at') },
    items: {
      deploys: d.deploys.map(({ run, attempt, sha, liveAt, runner, row, smoke, playerFacing, url }) => ({ run, attempt, sha, liveAt, runner, row, smoke, playerFacing, url })),
      changes: d.changes, failures: d.failures, recoveries: d.recoveries, prReds: d.prReds,
    },
  };
}

// Everything at once from the raw data. git: { changed(a, b), contains(a, b) }; testRuns: hq/lib/runs.mjs's allRuns;
// commits: main's commits since the first run, { sha, at, subject, body, paths }; openPulls: GitHub's open pull requests.
// The record starts at the start of the day, in tz, of the first run GitHub has.
export function compute({ runs, jobsOf, logs = new Map(), pulls = [], openPulls = [], lock = [], commits = [], testRuns = [], git, tz = TZ }) {
  const firstRun = runs.map(r => r.created_at).sort()[0];
  const rows = new Map([...logs].map(([id, text]) => [id, rowFromLog(text)]).filter(([, v]) => v));
  const byId = new Map(runs.map(r => [r.id, r]));
  const deploys = deploysOf({ runs, jobsOf, rows, changed: git.changed });
  // a failure takes its release's playerFacing, so failed deploys count the same deploys as deploy frequency
  const released = new Map(deploys.map(x => [`${x.run}-${x.attempt}`, x.playerFacing]));
  const failures = explainedByOf(failuresOf({ runs, jobsOf }), commits).map(f => ({ ...f, playerFacing: f.released ? released.get(`${f.run}-${f.attempt}`) ?? null : null }));
  // each fix that changed what players get ships in the first deploy that contains it
  const fixes = fixesOf(commits);
  for (const f of fixes.filter(f => f.playerFix)) {
    const shipped = deploys.find(x => git.contains(x.sha, f.sha));
    if (shipped) shipped.shipsFix = true;
  }
  return {
    deploys, failures, recoveries: recoveriesOf(failures, deploys),
    changes: changesOf({ runs, jobsOf, pulls, deploys, lock, commits, changed: git.changed, contains: git.contains }),
    merges: mergesOf({ runs, jobsOf, pulls, lock }),
    prReds: prRedsOf({ runs, jobsOf, lock }), gates: gatesOf({ runs, jobsOf, lock }), fixes,
    rowRuns: [...rows].map(([id, v]) => ({ run: id, row: v.row, at: byId.get(id)?.created_at })).filter(x => x.at),
    testRuns: testRuns.map(t => ({ ...t, when: t.when instanceof Date ? t.when.toISOString() : t.when })),
    waiting: waitingOf({ open: openPulls, pulls, runs }), recordFrom: firstRun ? dayStart(dayKey(ms(firstRun), tz), tz) : null,
  };
}
