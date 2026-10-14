// The pipeline as hq/pipeline.json describes it, and the last result for a step from the run history.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The pipeline file the manifest names (tests.pipeline), or null when there is none or it cannot be read.
export function loadPipeline(file) { if (!file) return null; try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } }

// Every step and part, flat, for checking and for finding their tests.
export const allSteps = pipeline => pipeline.paths.flatMap(p => p.steps.flatMap(s => [s, ...(s.parts || [])]));

// The tasks that stand for a whole set of browser tests. A run marked partial ran only some of them, so it says nothing
// about the set (2 October: a container run of one test showed as the container gate passing).
const SETS = new Set(['gate', 'after', 'docker-gate', 'docker-after']);

// The newest run from `where` that ran `task`: { run, task } or null. runs are newest first.
export function lastResult(runs, { where, task }) {
  for (const r of runs) {
    if ((r.info.where || r.source) !== where) continue;
    if (r.info.partial && SETS.has(task)) continue;
    const t = r.tasks.find(x => x.id === task);
    if (t) return { run: r, task: t };
  }
  return null;
}
