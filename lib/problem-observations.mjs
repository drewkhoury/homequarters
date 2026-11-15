// The problem register's first layer (docs/plans/problem-register.md, Layer 1): observations, worked out from the stores
// each time HQ asks, never typed in, never stored and never closed. Reds come from the run store (hq/lib/runs.mjs's
// allRuns), waits for the test slot from the lock log (scripts/lock.mjs's log.jsonl). Entries (hq/lib/problems.mjs)
// add judgement to them; an observation group no entry explains shows as unexplained.

import { fileForCase, planted } from './runs.mjs';
import { kept } from './kept.mjs';

const RERUN = 'rerun'; // a red container gate's rerun of its failing tests (the Makefile's _rerun), a task of the same run
const kindOf = r => `${r.source === 'ci' ? 'ci-' : ''}${r.info.kind || '?'}`;
const gateTasks = r => r.tasks.filter(t => t.id !== RERUN);

// How a red names its test, the way a fix commit's signature does (hq/lib/problem-trailers.mjs): a browser test by its
// name, which is its file's, and a unit or rules test by its file's path, found by its title in HQ's catalogue of test
// files (hq/lib/catalogue.mjs). A title no file has any more keeps its title. With no task, any file with the title.
// One keyer per list of files, kept against the list, so its answers are kept across pages too.
export const testKeyer = kept(files => {
  // asked once per test result, about a hundred thousand times over the run store, so each answer is kept
  const known = new Map();
  return (taskId, name) => {
    const k = `${taskId}\t${name}`;
    if (!known.has(k)) known.set(k, keyFor(taskId, name));
    return known.get(k);
  };
  function keyFor(taskId, name) {
    const f = taskId ? fileForCase(taskId, name, files) : files.find(x => x.name === name) || files.find(x => (x.titles || []).includes(name));
    if (!f) return name;
    if (f.set === 'gate' || f.set === 'after' || f.set === 'helper') return f.name;
    return (f.titles || []).includes(name) ? f.path : name;
  }
});

// Every red in the runs, one per failed test (or per failed task with no test result), each sorted by what else the
// stores saw of that test on that commit:
//   flaky         the same test passed on the same clean commit in the same kind of run (the rule flakes() uses)
//   passed-alone  only its rerun passed: alone, on fresh emulators, so it shows the test passes when run alone
//   red-twice     its rerun failed too
//   never-rerun   nothing else seen of it on that commit
//   resource      its page or process was killed from outside, as a container out of memory does; the rerun and other runs say nothing
//   infra         a task failed and named no test
//   dirty         the tree had uncommitted changes, so it says nothing about a commit
//   planted       the run was on a probe/ or exp/ branch, a red made on purpose
// Each carries its run, so minutes are summed over distinct runs, its own run's minutes (the gate's tasks, not the
// rerun's), whether the run was partial, and whether it started starved (memory pressure warn).
// Each also carries its cause, the error line its run gave that test (scripts/error-line.mjs, as the facts line printed
// it), and whether that line is generic, a bare timeout: causeOf(run, task, name) answers { line, generic } or null.
// Answers [{ type: 'red', sig, class, run, when, commit, branch, kind, source, task, minutes, partial, starved, cause, causeGeneric }].
// Sorted once per runs list and keyer, as the run store answers the same list until a run changes; the causes, which
// come from the logs, are asked each read, and each read gets objects of its own.
const byName = (task, name) => name;
export function observeReds(runs, { keyOf = byName, causeOf = () => null } = {}) {
  return sorted(runs, keyOf).map(({ red, r, task, name }) => {
    if (name == null) return { ...red };
    const why = causeOf(r, task, name);
    return { ...red, cause: (why && why.line) || null, causeGeneric: !!(why && why.generic) };
  });
}
const sorted = kept((runs, keyOf) => {
  // commit, kind and test of every pass in a full run's own tasks, looked for only where that commit and kind has a
  // failed test: the other runs, most of them, hold nothing a red is checked against
  const failing = new Map();
  for (const r of runs) {
    if (!r.info.commit) continue;
    for (const t of gateTasks(r)) for (const c of t.cases) if (c.status === 'fail' && c.name) {
      const k = `${r.info.commit}\t${kindOf(r)}`;
      (failing.get(k) || failing.set(k, new Set()).get(k)).add(c.name);
    }
  }
  const passed = new Set();
  for (const r of runs) {
    if (!r.info.commit || r.info.dirty || planted(r)) continue;
    const k = `${r.info.commit}\t${kindOf(r)}`, names = failing.get(k);
    if (!names) continue;
    for (const t of gateTasks(r)) for (const c of t.cases) if (c.status === 'pass' && names.has(c.name)) passed.add(`${k}\t${c.name}`);
  }
  const out = [];
  for (const r of runs) {
    const tasks = gateTasks(r), rerun = r.tasks.find(t => t.id === RERUN);
    const minutes = Math.round(tasks.reduce((n, t) => n + (t.seconds || 0), 0) / 6) / 10;
    const base = { type: 'red', run: r.id, when: r.when, commit: r.info.commit || null, branch: r.info.branch || null, kind: kindOf(r), source: r.source,
      minutes, partial: !!r.info.partial, starved: (r.info.machine && r.info.machine.pressure) === 'warn' };
    for (const t of tasks) {
      // a failed result with no name says no more than a task that failed naming no test
      const failed = t.cases.filter(c => c.status === 'fail' && c.name), nameless = t.cases.some(c => c.status === 'fail' && !c.name);
      if ((!failed.length && t.status === 'fail') || nameless) out.push({ red: { ...base, sig: `task:${t.id}`, class: planted(r) ? 'planted' : 'infra', task: t.id } });
      if (!failed.length) continue;
      for (const c of failed) {
        const again = rerun && rerun.cases.find(x => x.name === c.name);
        const cls = planted(r) ? 'planted' : r.info.dirty ? 'dirty'
          : c.crashed ? 'resource'
          : r.info.commit && passed.has(`${r.info.commit}\t${kindOf(r)}\t${c.name}`) ? 'flaky'
          : again ? (again.status === 'pass' ? 'passed-alone' : 'red-twice')
          : 'never-rerun';
        out.push({ red: { ...base, sig: keyOf(t.id, c.name), class: cls, task: t.id }, r, task: t.id, name: c.name });
      }
    }
  }
  return out;
});

// Pull requests waiting on the person, from make dora's own figures (dora/changes.json, which make dora writes beside
// dora.json), so the register never works them out a second time: every merge make dora found a green gate for, from
// that gate going green to the merge (merges). A file written before merges existed has changes only, which leave out
// the pull requests that changed no served file, so those are read instead.
// Answers [{ type: 'pr-wait', sig: 'pr', pr, at: merged, greenAt, minutes }].
export function observePulls(changes = [], merges = null) {
  if (merges) return merges.filter(m => m.pr != null && Number.isFinite(m.greenToMergeSec)).map(m => ({
    type: 'pr-wait', sig: 'pr', pr: m.pr, at: m.mergedAt, greenAt: new Date(Date.parse(m.mergedAt) - m.greenToMergeSec * 1000).toISOString(), minutes: Math.round(m.greenToMergeSec / 60),
  }));
  return changes.filter(c => c.path === 'pr' && c.pr != null && c.split && Number.isFinite(c.split.greenToMergeSec)).map(c => ({
    type: 'pr-wait', sig: 'pr', pr: c.pr, at: c.mergedAt, greenAt: new Date(Date.parse(c.mergedAt) - c.split.greenToMergeSec * 1000).toISOString(), minutes: Math.round(c.split.greenToMergeSec / 60),
  }));
}

// Machine minutes over observations, each run counted once however many of its reds are among them.
export function machineMinutes(obs) {
  const runs = new Map();
  for (const o of obs) if (o.run && !runs.has(o.run)) runs.set(o.run, o.minutes || 0);
  return Math.round([...runs.values()].reduce((a, b) => a + b, 0) * 10) / 10;
}

const MIN = 60000;
// Whose run a line is: the same agent in the same worktree, since a lead's builders all share its Claude session
const ownerOf = l => `${l.session ? `session ${l.session}` : `person ${l.person || '?'}`} agent ${l.agent || '-'} in ${l.worktree || '?'}`;

// The test slot from the lock log: each wait, with whose run or claim it waited behind: other, own (the same agent's in
// the same worktree), or, when the slot looked free as it began to wait, whoever took it while it waited, else unknown
// (behind other waiters or a container); how it ended (took, gave-up, left,
// unknown when the waiter was killed and left no line) and its minutes; and each refusal and take-over.
// Answers [{ type: 'wait'|'refused'|'takeover', at, session, agent, person, target, behind?, outcome?, minutes? }].
export function observeSlot(lines) {
  const sorted = lines.map((l, i) => ({ l, i, t: Date.parse(l.at) })).filter(x => Number.isFinite(x.t)).sort((a, b) => (a.t - b.t) || (a.i - b.i));
  let holder = null, claim = null;
  const out = [], open = new Map(); // pid -> the wait observation still waiting
  const who = l => ({ at: l.at, session: l.session || null, agent: l.agent || null, person: l.person || null, worktree: l.worktree || null, target: l.target || null });
  const owners = new Map(); // a wait's observation -> its line's owner
  const end = (l, outcome) => {
    const w = open.get(l.pid);
    if (!w) return;
    open.delete(l.pid);
    Object.assign(w, { outcome, minutes: Math.round((Date.parse(l.at) - Date.parse(w.at)) / MIN) });
  };
  for (const { l } of sorted) {
    if (l.event === 'take') {
      end(l, 'took');
      // a wait that found the slot free goes by whoever took it while it waited
      for (const w of open.values()) if (w.behind === 'unknown') w.behind = ownerOf(l) === owners.get(w) ? 'own' : 'other';
      holder = l;
    }
    else if (l.event === 'release') { if (holder && holder.pid === l.pid) holder = null; }
    else if (l.event === 'takeover') { holder = null; out.push({ type: 'takeover', ...who(l), by: l.by || null }); }
    else if (l.event === 'claim') claim = l;
    else if (l.event === 'unclaim' || l.event === 'claim-ended') claim = null;
    else if (l.event === 'wait') {
      const ahead = holder || claim;
      const w = { type: 'wait', ...who(l), behind: !ahead ? 'unknown' : ownerOf(ahead) === ownerOf(l) ? 'own' : 'other', outcome: 'unknown', minutes: null };
      out.push(w); open.set(l.pid, w); owners.set(w, ownerOf(l));
    } else if (l.event === 'gave-up') end(l, 'gave-up');
    else if (l.event === 'left') end(l, 'left');
    else if (l.event === 'refused') out.push({ type: 'refused', ...who(l) });
  }
  return out;
}
