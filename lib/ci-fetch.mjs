// hq ci-fetch: downloads the test results CI kept (a workflow uploads junit-<run>-<attempt>-<kind> on every run, pass or
// fail) into the ci store, one folder per artifact, skipping any already there, so the Testing page and `hq dora` read
// CI's runs beside the laptop's. Uses the gh CLI and its login, run in the repo so gh reads {owner}/{repo} from its remote;
// says so and stops cleanly if gh is missing.
// Usage: hq ci-fetch [<folder>] [--repo DIR]     the folder is the manifest's ci store unless given
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, renameSync } from 'node:fs';
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
  try { if (!execFileSync('git', ['-C', repo, 'remote'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) return 'This repo has no git remote, so there are no CI results to fetch.'; } catch { /* not a repo: gh will say */ }
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
    // into a folder of its own first, moved into place whole: HQ reads a folder as soon as it is there, and a fetch
    // skips one already there, so a half-written folder would be read short and never fetched again
    const part = join(dir, `.${a.name}.part`);
    rmSync(part, { recursive: true, force: true });
    try { gh(['run', 'download', String(a.workflow_run.id), '--name', a.name, '--dir', part]); renameSync(part, into); got++; }
    catch (e) { lines.push(`Could not download ${a.name}: ${String(e.stderr || e.message).trim().split('\n')[0]}`); }
    rmSync(part, { recursive: true, force: true });
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
