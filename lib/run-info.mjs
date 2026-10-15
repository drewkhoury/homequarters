// `hq run-info <kind>`: the one line a recorded run starts with, `=== run {json}`, saying what ran so the run history can
// tell runs apart: the kind, where (laptop, container or ci), who (a person, an agent, or ci), the branch and commit, whether
// the tree was dirty, the lanes, and what the machine was doing (lib/machine.mjs). devpipe keeps the timing and the log, but
// not the commit, the branch or who ran it, so this line carries them. HQ reads it back with lib/run-line.mjs.
// Environment, with HQ_ names and the QK_ names QuestKeep's Makefile already sets:
//   HQ_KIND / QK_KIND        the kind, over the argument (a deploy's container gate says 'deploy', a soak 'soak')
//   HQ_WHERE / QK_WHERE      laptop, container or ci, when the kind alone cannot say
//   HQ_BRANCH / QK_BRANCH    the branch, for a run in a detached copy that has none
//   HQ_COMMIT / QK_COMMIT    the commit on CI, where a pull request's checkout is a merge commit
//   HQ_LANES / QK_LANES      how many tests run side by side
//   HQ_OUT / QK_OUT          the run's folder of test files, which HQ opens a failed test's log from
//   HQ_AGENT / QK_AGENT      an agent started by another agent names itself (the slot's identity)
//   HQ_PARTIAL / QK_PARTIAL  1 when the run named its own tests, so it ran part of a set and not the set
// On GitHub Actions the event, run, attempt and runner are added from the workflow's own variables.
// --extra '<json>' adds a project's own facts to the line (QuestKeep's: where its browsers got the Firebase SDK). They
// never replace HQ's fields; one that is not a JSON object is left out, with a warning on stderr.
// Usage: hq run-info <kind> [--json <file>] [--extra '<json>'] [--repo <dir>]     prints the line, or writes the JSON to a file beside CI's results
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hostInfo } from './machine.mjs';

const pick = (env, name) => env[`HQ_${name}`] ?? env[`QK_${name}`] ?? '';
const gitOut = (cmd, cwd) => { try { return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };

// The run's facts, pure: hand in the environment, the arguments, a git runner and a machine reader.
export function runInfo({ env = process.env, args = [], cwd = process.cwd(), git = cmd => gitOut(cmd, cwd), machine = hostInfo, now = () => new Date() } = {}) {
  const jsonAt = args.indexOf('--json'), extraAt = args.indexOf('--extra');
  const isValue = i => (jsonAt >= 0 && i === jsonAt + 1) || (extraAt >= 0 && i === extraAt + 1);
  const kind = pick(env, 'KIND') || args.find((a, i) => !a.startsWith('--') && !isValue(i)) || 'test';
  const warnings = [];
  let extra = {};
  if (extraAt >= 0) {
    try {
      const j = JSON.parse(args[extraAt + 1] ?? '');
      if (j && typeof j === 'object' && !Array.isArray(j)) extra = j; else warnings.push('--extra should be a JSON object; left out');
    } catch { warnings.push('--extra is not JSON; left out'); }
  }
  const ci = !!env.GITHUB_ACTIONS;
  const where = pick(env, 'WHERE') || (ci ? 'ci' : /^docker|^deploy|^soak/.test(kind) ? 'container' : 'laptop');
  const lanes = pick(env, 'LANES') || (/(?:^|\s)LANES=(\d+)/.exec(`${env.MAKEFLAGS || ''} ${env.TEST_ARGS || ''}`) || [])[1] || '';
  const partial = pick(env, 'PARTIAL') === '1' || /\b(GATE|AFTER)=/.test(`${env.MAKEFLAGS || ''} ${env.TEST_ARGS || ''}`);
  const info = {
    ...extra,
    v: RUN_V,
    kind, where,
    who: ci ? 'ci' : env.CLAUDECODE ? 'agent' : 'person', // Claude Code sets CLAUDECODE in its sessions
    ...(!ci && env.CLAUDE_CODE_SESSION_ID ? { session: env.CLAUDE_CODE_SESSION_ID, ...(pick(env, 'AGENT') ? { agent: pick(env, 'AGENT') } : {}) } : {}),
    branch: ci ? (env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || '') : pick(env, 'BRANCH') || git('git rev-parse --abbrev-ref HEAD'),
    commit: ci ? (pick(env, 'COMMIT') || env.GITHUB_SHA || '').slice(0, 7) : git('git rev-parse --short HEAD'),
    dirty: !ci && !!git('git status --porcelain'),
    ...(lanes ? { lanes: +lanes || lanes } : {}),
    ...(partial ? { partial: true } : {}),
    ...(pick(env, 'OUT') ? { out: pick(env, 'OUT') } : {}),
    machine: machine(),
  };
  if (ci) Object.assign(info, { event: env.GITHUB_EVENT_NAME, run: env.GITHUB_RUN_ID, attempt: +env.GITHUB_RUN_ATTEMPT || 1, at: now().toISOString(),
    runner: env.RUNNER_ENVIRONMENT === 'self-hosted' ? 'self-hosted' : 'github', tree: git('git rev-parse HEAD^{tree}') || null });
  return { info, json: jsonAt >= 0 ? args[jsonAt + 1] || null : null, warnings };
}

// The shape of the line; a reader takes a line without v as v 0.
export const RUN_V = 1;
export const runLine = info => `=== run ${JSON.stringify(info)}`;

// The command: print the line, or write the JSON file.
export function main(args) {
  const at = args.indexOf('--repo'), cwd = at >= 0 && args[at + 1] ? args[at + 1] : process.cwd();
  const { info, json, warnings } = runInfo({ args: args.filter((a, i) => i !== at && i !== at + 1), cwd });
  for (const w of warnings) console.error(`hq run-info: ${w}`);
  if (json) { mkdirSync(dirname(json), { recursive: true }); writeFileSync(json, JSON.stringify(info, null, 2) + '\n'); }
  else console.log(runLine(info));
}
