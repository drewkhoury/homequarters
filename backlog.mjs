// hq backlog: the items in the backlog folder hq.json names, in the terminal. What is ready to pick up (oldest ask first),
// what is blocked and on what, what a branch is working on, and how full the inbox is. The Backlog page shows the same.
// Usage: hq backlog [--repo DIR]      the repo is the checkout you are in unless --repo or HQ_REPO says otherwise
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadItems, check, openBlockers, branchWork, MAX_INBOX, configureBacklog } from './lib/backlog.mjs';
import { runGit } from './lib/git.mjs';
import { loadManifest } from './lib/manifest.mjs';

export function repoOf(argv, env) {
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (env.HQ_REPO) return env.HQ_REPO;
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.cwd(); }
}

// The board as text, for a repo whose manifest names a backlog; without one, a sentence saying which key would.
export async function board(repo, { m = loadManifest(repo).m, git = runGit } = {}) {
  if (!m.backlog) return 'hq.json names no backlog, so there is nothing to list. Add a backlog key with the items\' folder (hq setup proposes one).';
  configureBacklog({ rel: m.backlog.rel, mapRel: m.backlog.map ? m.backlog.map.slice(repo.length + 1) : null, earlierRel: m.backlog.earlierRel, stages: m.backlog.stages });
  const items = loadItems(repo);
  let map = [];
  if (m.backlog.map) { try { map = JSON.parse(readFileSync(m.backlog.map, 'utf8')); } catch { /* none */ } }
  const base = (await git(['rev-parse', '--verify', '-q', 'origin/main'], repo)).trim() ? 'origin/main' : 'main';
  const work = await branchWork(repo, base, { map, git });
  const doing = s => (work.get(s) || []).filter(w => w.how !== 'adding');
  const line = it => `  ${it.type.padEnd(8)} ${it.slug}${doing(it.slug).length ? `  (${doing(it.slug).map(w => `${w.branch} ${w.how === 'shipping' ? 'ships it' : 'works on it'}`).join('; ')})` : ''}`;
  const [inboxStage, nextStage, parkedStage] = m.backlog.stages;
  const next = items.filter(i => i.stage === nextStage);
  const ready = next.filter(i => !openBlockers(i, items).length && !doing(i.slug).length);
  const blocked = next.filter(i => openBlockers(i, items).length && !doing(i.slug).length);
  const inProgress = items.filter(i => doing(i.slug).length);
  const inbox = items.filter(i => i.stage === inboxStage), parked = items.filter(i => i.stage === parkedStage);
  const out = [];
  out.push(`Ready (${ready.length}), nothing blocks them:`, ready.map(line).join('\n') || '  none');
  if (inProgress.length) out.push(`\nIn progress on a branch (${inProgress.length}):\n${inProgress.map(line).join('\n')}`);
  out.push(`\nBlocked (${blocked.length}):`, blocked.map(i => `${line(i)}  ← ${openBlockers(i, items).join(', ')}`).join('\n') || '  none');
  out.push(`\nInbox: ${inbox.length} of ${MAX_INBOX}${inbox.length ? ', sort these first:' : ''}`);
  if (inbox.length) out.push(inbox.map(line).join('\n'));
  if (parked.length) out.push(`\nParked (${parked.length}): ${parked.map(i => i.slug).join(', ')}`);
  const problems = check(items);
  if (problems.length) out.push(`\nProblems (${problems.length}):\n${problems.map(p => `  ${p}`).join('\n')}`);
  return out.join('\n');
}

export async function main(argv, env = process.env) {
  console.log(await board(repoOf(argv, env)));
}
