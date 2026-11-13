// hq dora: fetches what is new from GitHub (dora-fetch.mjs, and CI's test results with lib/ci-fetch.mjs), works out the
// figures (lib/dora.mjs), prints them as a table, and writes dora/dora.json in the manifest's cache with a dated copy in
// dora/daily/. A day with no copy since the last one gets one written now, marked writtenLate, so a night the laptop
// slept leaves no hole. The Delivery page reads dora.json and runs this with --no-fetch-git when it is old.
// Usage: hq dora [--no-fetch] [--no-fetch-git] [--no-daily] [--quiet] [--repo DIR]
//   --no-fetch      use only what the cache holds (no gh)
//   --no-fetch-git  skip `git fetch origin main` (HQ never fetches on its own)
//   --no-daily      write dora.json only, not the dated copies: HQ's refresh, which has not fetched main, may hold
//                   deploys git cannot judge, and the dated copies are what the meta-analysis study compares
//   --quiet         write the files, print one line
// HQ_CACHE (QK_CACHE for one release) points at another cache folder; the default is the manifest's.
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compute, summarise, sourcesOf, lateDays, PLAYER_PATHS, TZ, dayKey, dayStart, addDays, configureDelivery } from './lib/dora.mjs';
import { allRuns } from './lib/runs.mjs';
import { loadManifest } from './lib/manifest.mjs';

// the project's figures block: project since version 4, questkeep in files written before
const proj = w => w.project || w.questkeep;
const argv = process.argv.slice(2), args = new Set(argv);
const HERE = dirname(fileURLToPath(import.meta.url));
// the repo: --repo, HQ_REPO, else the checkout this runs in; the cache and what reaches users come from its manifest
const repo = (() => {
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (process.env.HQ_REPO) return process.env.HQ_REPO;
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.cwd(); }
})();
const { m } = loadManifest(repo);
configureDelivery({ ...m.delivery, decisionsDir: (m.decisions && m.decisions.dir) || join(repo, 'docs', 'decisions') });
const cache = process.env.HQ_CACHE || process.env.QK_CACHE || m.cache;
const raw = join(cache, 'ci', 'actions'), out = join(cache, 'dora');
const say = (...a) => { if (!args.has('--quiet')) console.log(...a); };

if (!args.has('--no-fetch')) {
  for (const [script, dir] of [[join(HERE, 'dora-fetch.mjs'), raw], [join(HERE, 'lib', 'ci-fetch.mjs'), m.store('ci') || join(cache, 'ci')]]) {
    const r = spawnSync(process.execPath, [script, dir, '--repo', repo], { cwd: repo, encoding: 'utf8' });
    // printed even with --quiet: the nightly's log is where a fetch that stopped working shows
    console.log((r.stdout || '').trim() || (r.stderr || '').trim());
    if (r.status && process.env.CI) process.exit(r.status);
  }
}
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
if (!args.has('--no-fetch') && !args.has('--no-fetch-git')) { try { git('fetch', '-q', 'origin', 'main'); } catch { say('Could not fetch origin/main; using the copy this checkout has.'); } }

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } };
const runs = readJson(join(raw, 'runs.json'), null);
if (!runs) {
  let remote = false; try { remote = git('remote').trim().length > 0; } catch { /* not a repo */ }
  console.log(`No runs in ${raw} yet. ${remote ? 'Run hq dora with gh logged in to fetch them.' : 'This repo has no git remote, so there are no GitHub runs to fetch.'}`);
  process.exit(0);
}

// Each attempt's jobs, read when first asked for
const jobCache = new Map();
const jobsOf = (id, attempt) => {
  const k = `${id}-${attempt}`;
  if (!jobCache.has(k)) jobCache.set(k, readJson(join(raw, 'jobs', `${k}.json`), { jobs: null }).jobs);
  return jobCache.get(k);
};
const logs = new Map();
for (const f of existsSync(join(raw, 'logs')) ? readdirSync(join(raw, 'logs')) : []) {
  const m = /^(\d+)-decide\.txt$/.exec(f);
  if (m) logs.set(Number(m[1]), readFileSync(join(raw, 'logs', f), 'utf8'));
}
const pulls = readJson(join(raw, 'pulls.json'), []);
const openPulls = readJson(join(raw, 'pulls-open.json'), null);
const deployments = readJson(join(raw, 'deployments.json'), null);
const lockFile = join(cache, 'lock', 'log.jsonl');
const lock = existsSync(lockFile) ? readFileSync(lockFile, 'utf8').split('\n').flatMap(l => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } }) : [];

// main is a straight line (pull requests land by rebase or squash), so "a contains b" is "b is no newer than a" on
// main's first-parent list; merge-base answers for anything not on it
const ref = (() => { try { git('rev-parse', '--verify', '-q', 'origin/main'); return 'origin/main'; } catch { return 'HEAD'; } })();
const line = git('rev-list', '--first-parent', ref).trim().split('\n');
const age = new Map(line.map((sha, i) => [sha, i]));
const contains = (a, b) => {
  if (a === b) return true;
  if (age.has(a) && age.has(b)) return age.get(b) >= age.get(a);
  return spawnSync('git', ['merge-base', '--is-ancestor', b, a], { cwd: repo }).status === 0;
};
const diffs = new Map();
const changed = (a, b) => {
  const k = `${a} ${b}`;
  if (!diffs.has(k)) {
    const s = spawnSync('git', ['diff', '--quiet', a, b, '--', ...PLAYER_PATHS], { cwd: repo }).status;
    diffs.set(k, s === 1 ? true : s === 0 ? false : null);
  }
  return diffs.get(k);
};
// commits on main since the first run, with their bodies for the fix: trailers and the paths each changed for rework
const first = runs.map(r => r.created_at).sort()[0];
const commits = git('log', ref, `--since=${first}`, '--name-only', '--format=%x1e%H%x1f%cI%x1f%s%x1f%b%x1f').split('\x1e').filter(s => s.trim())
  .map(s => { const [sha, at, subject, body, files = ''] = s.split('\x1f'); return { sha, at, subject, body: body.trim(), paths: files.split('\n').map(f => f.trim()).filter(Boolean) }; });
const testRuns = allRuns(cache);

const d = compute({ runs, jobsOf, logs, pulls, openPulls: openPulls || [], lock, commits, testRuns, git: { changed, contains } });

const sources = sourcesOf({ d, runs, logs, deployments, pulls, openPulls, lock, testRuns, ref });
const repoSlug = (() => { try { return /github\.com[:/](.+?)(\.git)?$/.exec(git('remote', 'get-url', 'origin').trim())[1]; } catch { return null; } })();

const now = Date.now();
const file = summarise(d, { asOf: now, repo: repoSlug, sources });
const save = (f, obj) => { writeFileSync(f + '.part', JSON.stringify(obj, null, 1)); renameSync(f + '.part', f); };
mkdirSync(join(out, 'daily'), { recursive: true });
save(join(out, 'dora.json'), file);
// each change's own figures and every merge's wait for the person, which the problem register reads, so it never works
// them out a second time (hq/lib/problem-observations.mjs observePulls)
save(join(out, 'changes.json'), { generatedAt: new Date(Date.now()).toISOString(), changes: d.changes, merges: d.merges });
const today = dayKey(now, TZ), daily = !args.has('--no-daily');
if (daily) save(join(out, 'daily', `${today}.json`), file);
// Fill the days since the last copy, each as of its day's end in the figures' zone; at most 30. QuestKeep's own script
// fills them as of its nightly's time, 07:07 New York since 9 November 2026 (08:07 before), so a late copy written here
// counts up to 17 hours more of its day than QuestKeep's did; a daily time of the project's own waits on a manifest
// delivery key.
const copies = readdirSync(join(out, 'daily')).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10));
const late = daily ? lateDays(copies, today) : [];
for (const k of late) save(join(out, 'daily', `${k}.json`), { ...summarise(d, { asOf: dayStart(addDays(k, 1), TZ) - 1, repo: repoSlug, sources }), writtenLate: true });

if (args.has('--quiet')) { console.log(`dora: wrote ${join(out, 'dora.json')}${late.length ? ` and ${late.length} late daily copies` : ''}.`); process.exit(0); }
console.log(table(file) + `\nWrote ${join(out, 'dora.json')} ${daily ? ` and daily/${today}.json` : ''}${late.length ? `, plus ${late.length} late daily copies (${late.join(', ')})` : ''}.`);

function table(f) {
  const dur = s => s == null ? '–' : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
  const st = (s, fmt = dur) => !s || !s.n ? '–' : `${fmt(s.median)}${s.p90 != null ? ` (p90 ${fmt(s.p90)})` : ''} n=${s.n}`;
  const cell = (w, get) => { const now = get(w), was = get(w.prev); return was == null || was === now ? String(now) : `${now} ← ${was}`; };
  // a machine figure over both runners is given per runner, since a median across them measures neither
  const mixed = (w, all, per) => proj(w).leadSplit.mixed && per ? Object.entries(proj(w).leadSplit.byRunner).map(([k, v]) => `${k} ${dur(v[per]?.median)}`).join(', ') : all;
  const rows = [
    ['Player-facing deploys', w => `${w.portable.deploys.n}`],
    ['  per day', w => w.portable.deploys.perDay],
    ['  unknown (git could not read)', w => w.portable.deploys.unknown],
    ['  identical redeploys', w => proj(w).identicalRedeploys],
    ['  decide rows 5/6/7', w => `${proj(w).rows[5]}/${proj(w).rows[6]}/${proj(w).rows[7]}`],
    ['Lead time, median', w => st(w.portable.leadTime)],
    ['  runner wait', w => proj(w).leadSplit.reason || mixed(w, dur(proj(w).leadSplit.runnerWaitSec?.median), 'runnerWaitSec')],
    ['  slot wait', w => proj(w).leadSplit.reason || mixed(w, dur(proj(w).leadSplit.slotWaitSec?.median), 'slotWaitSec')],
    ['  gate', w => proj(w).leadSplit.reason || mixed(w, dur(proj(w).leadSplit.gateSec?.median), 'gateSec')],
    ['  green to merged', w => proj(w).leadSplit.reason || dur(proj(w).leadSplit.greenToMergeSec?.median)],
    ['  merged to live', w => proj(w).leadSplit.reason || dur(proj(w).leadSplit.mergeToLiveSec?.median)],
    ['  other (reds, re-runs)', w => proj(w).leadSplit.reason || dur(proj(w).leadSplit.otherSec?.median)],
    ['Typical change', w => { const t = proj(w).typical; return t ? `${t.pr ? `#${t.pr}` : t.sha.slice(0, 7)} ${dur(t.totalSec)}` : '–'; }],
    ['Failed deploys (of player-facing)', w => `${w.portable.failedDeploys.n} of ${w.portable.failedDeploys.of}`],
    ['Recovery', w => w.portable.recovery.n ? w.portable.recovery.items.map(r => dur(r.sec)).join(', ') : '–'],
    ['Rework (deploys that shipped a fix)', w => `${w.portable.rework.fixDeploys} of ${w.portable.rework.of}, ${w.portable.rework.playerFixes} fixes${w.portable.rework.proxy ? ' (proxy)' : ''}`],
    ['fix: commits', w => `${w.portable.rework.fixes}: ${w.portable.rework.tagged} tagged, ${w.portable.rework.n} player-facing`],
    ['Gate seconds, median', w => proj(w).cost.reason || (proj(w).cost.gateSecByRunner ? Object.entries(proj(w).cost.gateSecByRunner).map(([k, v]) => `${k} ${st(v, s => `${s}s`)}`).join('; ') : st(proj(w).cost.gateSec, s => `${s}s`))],
    ['  gates reused', w => proj(w).cost.reason || proj(w).cost.gateReused],
    ['PR gate reds', w => proj(w).cost.reason || `${proj(w).cost.prReds.n} of ${proj(w).cost.prReds.of}` + (proj(w).cost.prReds.n ? ` (${Object.entries(proj(w).cost.prReds.cause).map(([k, v]) => `${k} ${v}`).join(', ')})` : '')],
    ['Flakes per 100 runs', w => proj(w).cost.reason || (proj(w).cost.flakesPer100 == null ? '–' : `${proj(w).cost.flakesPer100}${proj(w).cost.flakesByRerun ? ` (${proj(w).cost.flakesByRerun} by the rerun)` : ''}`)],
    ['Laptop gates that waited for the slot', w => proj(w).cost.reason || `${proj(w).cost.slotWait.waited} of ${proj(w).cost.slotWait.gates}` + (proj(w).cost.slotWait.sec ? ` (median ${dur(proj(w).cost.slotWait.sec.median)})` : '')],
  ];
  const ws = f.windows, head = ['', ...ws.map(w => `${w.id} (now ← before)`)];
  const body = rows.map(([label, get]) => [label, ...ws.map(w => cell(w, get))]);
  const widths = head.map((_, i) => Math.max(...[head, ...body].map(r => String(r[i]).length)));
  const fmt = r => '| ' + r.map((c, i) => String(c).padEnd(widths[i])).join(' | ') + ' |';
  const week = ws.find(w => w.id === '7d');
  const parts = s => !s ? '' : ` (${[['runner', s.runnerWaitSec], ['slot', s.slotWaitSec], ['gate', s.gateSec], ['to merge', s.greenToMergeSec], ['to live', s.mergeToLiveSec], ['other', s.otherSec]].filter(([, v]) => v).map(([k, v]) => `${k} ${dur(v)}`).join(', ')})`;
  const slowest = proj(week).slowest.map(c => `  ${dur(c.totalSec).padStart(5)}  ${c.pr ? `#${c.pr}` : 'push'} ${c.title || ''}${parts(c.split)}`);
  const failed = f.items.failures.filter(x => x.released && Date.parse(x.at) >= Date.parse(ws.at(-1).prev.from))
    .map(x => `  ${x.at.slice(0, 16)} ${x.sha.slice(0, 7)} run ${x.run}: ${x.explainedBy ? `explained by ${x.explainedBy.sha.slice(0, 7)}: ${x.explainedBy.subject}` : 'no commit names this run yet'}`);
  const shifts = f.countingChanges.filter(c => c.date >= ws.at(-1).prev.from.slice(0, 10)).map(c => `  ${c.date}: ${c.what}`);
  return [`Delivery through ${dayKey(Date.parse(ws[0].to) - 1, f.tz)} (days in ${f.tz}). Lead time starts at a pull request's last push.`, '',
    fmt(head), fmt(widths.map(w => '-'.repeat(w))), ...body.map(fmt), '',
    `Today so far: ${f.today.deploys.filter(x => x.playerFacing !== false).length} player-facing deploys, ${f.today.failures.length} failures.`,
    ...(slowest.length ? ['', 'Slowest changes, 7 days:', ...slowest] : []),
    '', `Stage shares, 7 days: ${week.stageShare.map(x => `${x.stage} ${x.share == null ? '–' : `${Math.round(x.share * 100)}%`}`).join(', ')}`,
    '', f.waiting.length ? 'Waiting on you:' : 'Nothing waiting on you.',
    ...f.waiting.map(x => `  #${x.pr} ${dur(x.ageSec).padStart(5)} ${x.checks.padEnd(7)} ${x.title}${x.stale ? `  (probably stale: #${x.stale.pr} merged)` : ''}`),
    ...(failed.length ? ['', 'Failed deploys, 60 days:', ...failed] : []),
    ...(shifts.length ? ['', 'Changes to how things are counted in this span:', ...shifts] : []),
    '', 'Not counted:', ...f.blindSpots.map(b => `  ${b}`)].join('\n');
}
