// hq ci-fetch: downloads the test results CI kept (a workflow uploads junit-<run>-<attempt>-<kind> on every run, pass or
// fail) into the ci store, one folder per artifact, skipping any already there, so the Testing page and `hq dora` read
// CI's runs beside the laptop's. Uses the gh CLI and its login, run in the repo so gh reads {owner}/{repo} from its remote;
// says so and stops cleanly if gh is missing.
// Usage: hq ci-fetch [<folder>] [--repo DIR]     the folder is the manifest's ci store unless given
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keepFirstAttempt } from './runs.mjs';
import { loadManifest } from './manifest.mjs';

export function repoOf(argv, env) {
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (env.HQ_REPO) return env.HQ_REPO;
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.cwd(); }
}

export function fetchCi(dir, repo, { gh: ghRun } = {}) {
  const gh = ghRun || (args => execFileSync('gh', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  try { gh(['--version']); } catch { return 'The gh CLI is not installed or not on the path, so no CI results were fetched.'; }
  let artifacts;
  try {
    artifacts = JSON.parse(gh(['api', '--paginate', '--slurp', 'repos/{owner}/{repo}/actions/artifacts?per_page=100'])).flatMap(page => page.artifacts);
  } catch (e) { return 'Could not list CI artifacts (is gh logged in? `gh auth status`): ' + String(e.stderr || e.message).trim().split('\n')[0]; }
  mkdirSync(dir, { recursive: true });
  let got = 0, gone = 0;
  const lines = [];
  for (const a of artifacts.filter(a => /^junit-\d+-\d+-\w+$/.test(a.name))) {
    const into = join(dir, a.name);
    if (existsSync(into)) continue;
    if (a.expired) { gone++; continue; }
    try { gh(['run', 'download', String(a.workflow_run.id), '--name', a.name, '--dir', into]); got++; }
    catch (e) { lines.push(`Could not download ${a.name}: ${String(e.stderr || e.message).trim().split('\n')[0]}`); }
  }
  // A nightly's first attempt exists only inside the long-set artifact; keep it beside the last attempt's folder.
  let first = 0;
  for (const a of artifacts.filter(a => /^long-set-\d+-\d+$/.test(a.name) && !a.expired)) {
    const [, run, attempt] = /^long-set-(\d+)-(\d+)$/.exec(a.name), into = join(dir, `junit-${run}-${attempt}-after_first`), last = join(dir, `junit-${run}-${attempt}-after`);
    if (existsSync(into) || !existsSync(last)) continue;
    const tmp = join(dir, `.${a.name}`);
    try {
      gh(['run', 'download', String(a.workflow_run.id), '--name', a.name, '--dir', tmp]);
      const r = keepFirstAttempt(tmp, last, into);
      if (r.kept) first++;
      else if (/no first attempt/.test(r.skipped)) { mkdirSync(into); writeFileSync(join(into, 'none'), 'This night passed first time; nothing to keep.\n'); }
    } catch (e) { lines.push(`Could not download ${a.name}: ${String(e.stderr || e.message).trim().split('\n')[0]}`); }
    rmSync(tmp, { recursive: true, force: true });
  }
  lines.push(`Fetched ${got} new CI result${got === 1 ? '' : 's'}` + (first ? `; ${first} nightly first attempt${first === 1 ? '' : 's'} kept` : '') + (gone ? `; ${gone} had expired` : '') + '.');
  return lines.join('\n');
}

export function main(argv, env = process.env) {
  const i = argv.indexOf('--repo'), [given] = i >= 0 ? [...argv.slice(0, i), ...argv.slice(i + 2)] : argv;
  const repo = repoOf(argv, env), { m } = loadManifest(repo);
  const dir = given || m.store('ci') || join(m.cache, 'ci');
  console.log(fetchCi(dir, repo));
  return 0;
}

// Run as a script by hq dora: node lib/ci-fetch.mjs <folder> --repo <dir>
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) process.exitCode = main(process.argv.slice(2));
