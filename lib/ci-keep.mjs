// Keeps a self-hosted runner job's test results in this machine's CI store as the job ends, hq ci-keep: the files of
// <results> copied into the repo's ci store (hq.json names it; <cache>/ci when it does not; HQ_CI_DIR points
// elsewhere) under <name>, the folder a later download of the same artifact would land in, so HQ and
// the problem register read a CI red the day it happens. It never overwrites a folder already kept, keeps only names HQ
// reads (junit-<run>-<attempt>-<set>), and keeps nothing without the run.json that hq run-info --json writes.
// It says what it did and always exits 0: keeping results never fails a job.
// Usage: hq ci-keep <results folder> <name> [--repo DIR]
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadManifest } from './manifest.mjs';

const NAME = /^junit-\d+-\d+-[a-z][a-z0-9-]*(_[a-z0-9]+)?$/;

// Answers { kept: folder } or { skipped: why }.
export function keep(from, name, ciDir) {
  if (!NAME.test(name)) return { skipped: `${name} is not a name HQ reads (junit-<run>-<attempt>-<set>, the set a lower-case slug)` };
  if (!existsSync(from)) return { skipped: `no results at ${from}` };
  if (!readdirSync(from).includes('run.json')) return { skipped: `no run.json in ${from}, which HQ reads a CI run by` };
  const into = join(ciDir, name);
  if (existsSync(into)) return { skipped: `${name} is already kept` };
  cpSync(from, into, { recursive: true });
  return { kept: into };
}

function repoOf(argv, env) {
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (env.HQ_REPO) return env.HQ_REPO;
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.cwd(); }
}

export function main(argv, env = process.env) {
  const i = argv.indexOf('--repo'), [from, name] = i >= 0 ? [...argv.slice(0, i), ...argv.slice(i + 2)] : argv;
  if (!from || !name) { console.log('Usage: hq ci-keep <results folder> <name> [--repo DIR]'); return 0; }
  try {
    const { m } = loadManifest(repoOf(argv, env));
    const dir = env.HQ_CI_DIR !== undefined ? env.HQ_CI_DIR : (m.store('ci') || join(m.cache, 'ci'));
    const r = keep(from, name, dir);
    console.log(r.kept ? `Kept the results on this machine in ${r.kept}.` : `Kept nothing: ${r.skipped}.`);
  } catch (e) { console.log(`Kept nothing: ${e.message}`); }
  return 0;
}
