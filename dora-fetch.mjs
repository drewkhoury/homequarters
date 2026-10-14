// Fetches what make dora counts from, and keeps GitHub's raw answers so any later definition can be recomputed over all
// of history: every Actions run, each attempt's jobs and steps with their timings, the decide job's log from each Deploy
// run (the only place its "Row N" sentence lives, and job logs expire after 90 days), the production deployments,
// which never expire, and the pull requests, closed and open. It saves raw responses and never figures. Each pass fetches only what it does not have yet: runs
// created since a little before the newest finished one it holds, then the jobs and logs of finished runs it has not
// saved. Read-only on GitHub. Uses the gh CLI and its login; says so and stops cleanly without them.
// Usage: node hq/dora-fetch.mjs <folder>     (make dora passes ~/.cache/questkeep/ci/actions)
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
if (!dir) { console.error('usage: node hq/dora-fetch.mjs <folder>'); process.exit(2); }
// run from the repo, so gh reads {owner}/{repo} from its remote wherever the script is called from
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const gh = args => new Promise((resolve, reject) => execFile('gh', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
const first = e => String(e.stderr || e.message).trim().split('\n')[0];
const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } };
// written whole or not at all, so a pass stopped half way never leaves a file another pass would trust
const save = (f, text) => { writeFileSync(f + '.part', text); renameSync(f + '.part', f); };
// a few calls at once: about 900 runs take a couple of minutes instead of fifteen
const pool = async (items, n, work) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await work(items[i++]); })); };

// On a laptop a missing gh or login ends cleanly, so make dora works from the cache. In CI (the nightly) it fails, or
// the job would stay green while the dated copies were worked out from a cache that had stopped growing.
const stop = () => process.exit(process.env.CI ? 1 : 0);
try { await gh(['--version']); } catch { console.log('The gh CLI is not installed or not on the path, so nothing was fetched.'); stop(); }
for (const d of ['jobs', 'logs']) mkdirSync(join(dir, d), { recursive: true });

// Runs. Once the folder holds some, ask only for runs created since two days before the newest finished one, and since
// the oldest one still unfinished, so a queued or running run is asked about again until it ends.
const runsFile = join(dir, 'runs.json');
const held = new Map(readJson(runsFile, []).map(r => [r.id, r]));
const open = [...held.values()].filter(r => r.status !== 'completed').map(r => r.created_at);
const done = [...held.values()].filter(r => r.status === 'completed').map(r => r.created_at).sort();
const since = [...open, done.length ? new Date(Date.parse(done.at(-1)) - 2 * 86400e3).toISOString() : null].filter(Boolean).sort()[0];
let fresh;
try {
  const q = `repos/{owner}/{repo}/actions/runs?per_page=100${since ? `&created=%3E%3D${since.slice(0, 19)}Z` : ''}`;
  fresh = JSON.parse(await gh(['api', '--paginate', '--slurp', q])).flatMap(p => p.workflow_runs);
} catch (e) { console.log(`Could not list Actions runs (is gh logged in? \`gh auth status\`): ${first(e)}`); stop(); }
for (const r of fresh) held.set(r.id, r);
const runs = [...held.values()].sort((a, b) => a.id - b.id);
save(runsFile, JSON.stringify(runs));

// Jobs: one file per attempt of a finished run, with every step's start and end
const want = runs.filter(r => r.status === 'completed')
  .flatMap(r => Array.from({ length: r.run_attempt || 1 }, (_, i) => ({ run: r.id, attempt: i + 1 })))
  .filter(a => !existsSync(join(dir, 'jobs', `${a.run}-${a.attempt}.json`)));
let jobs = 0, misses = [];
await pool(want, 8, async a => {
  try { save(join(dir, 'jobs', `${a.run}-${a.attempt}.json`), await gh(['api', `repos/{owner}/{repo}/actions/runs/${a.run}/attempts/${a.attempt}/jobs?per_page=100`])); jobs++; }
  catch (e) { misses.push(`jobs of ${a.run}.${a.attempt}: ${first(e)}`); }
});

// Logs: the decide job of each Deploy run, whose last word is decide's row
const deployRuns = new Set(runs.filter(r => r.path === '.github/workflows/deploy.yml' && r.status === 'completed').map(r => r.id));
const decides = [...deployRuns].flatMap(run => {
  const j = readJson(join(dir, 'jobs', `${run}-${held.get(run).run_attempt || 1}.json`), { jobs: [] }).jobs.find(j => j.name === 'decide');
  return j && j.conclusion && !existsSync(join(dir, 'logs', `${run}-decide.txt`)) ? [{ run, job: j.id }] : [];
});
let logs = 0, gone = 0;
await pool(decides, 8, async d => {
  try { save(join(dir, 'logs', `${d.run}-decide.txt`), await gh(['api', `repos/{owner}/{repo}/actions/jobs/${d.job}/logs`])); logs++; }
  catch (e) { if (/HTTP 410|HTTP 404/.test(first(e))) gone++; else misses.push(`decide log of ${d.run}: ${first(e)}`); }
});

// Production deployments: GitHub keeps these after the logs go, so they are the lasting list of what went live
let deployments = 0;
try {
  const all = JSON.parse(await gh(['api', '--paginate', '--slurp', 'repos/{owner}/{repo}/deployments?environment=production&per_page=100'])).flat();
  save(join(dir, 'deployments.json'), JSON.stringify(all)); deployments = all.length;
} catch (e) { misses.push(`deployments: ${first(e)}`); }

// Closed pull requests: their merge commit says which push to main was which pull request, and their head commit
// which runs were its last push
let pulls = 0;
try {
  const all = JSON.parse(await gh(['api', '--paginate', '--slurp', 'repos/{owner}/{repo}/pulls?state=closed&per_page=100'])).flat();
  save(join(dir, 'pulls.json'), JSON.stringify(all)); pulls = all.length;
} catch (e) { misses.push(`pull requests: ${first(e)}`); }

// Open pull requests: what is waiting for someone to merge it, as it stands now, so the file is replaced each pass
let openPulls = 0;
try {
  const all = JSON.parse(await gh(['api', '--paginate', '--slurp', 'repos/{owner}/{repo}/pulls?state=open&per_page=100'])).flat();
  save(join(dir, 'pulls-open.json'), JSON.stringify(all)); openPulls = all.length;
} catch (e) { misses.push(`open pull requests: ${first(e)}`); }

console.log(`Runs: ${runs.length} held, ${fresh.length} asked about. New: ${jobs} job lists, ${logs} decide logs` + (gone ? ` (${gone} logs had expired)` : '') + `. Deployments: ${deployments}. Closed pull requests: ${pulls}. Open pull requests: ${openPulls}.`);
for (const m of misses.slice(0, 5)) console.log(`Could not fetch ${m}`);
if (misses.length > 5) console.log(`...and ${misses.length - 5} more; the next pass asks again.`);
