// The free-space check before a test run, hq space: the disks a run fills, measured before the run starts. The project
// keeps every run's data (its runs store, the test image, its volumes), and nothing here deletes any of it. Below 20 GB
// free on the tighter disk a run warns and goes ahead; below 5 GB it is not started. Either way the message gives each
// disk's free space, the size of the cache, and what would make room when the person chooses to. A disk that cannot be
// measured reads "unknown" and never stops a run. HQ_SPACE_WARN_GB and HQ_SPACE_FAIL_GB move the two lines.
//
// The disks: this computer's own, holding the cache and the checkout; on WSL, the WSL disk and the Windows drive C:
// under it, since the WSL disk is a file on C: and its free space is only what C: can still give it. A container run
// also fills the Docker VM's disk, which is likewise a file on this computer's disk, so it is read from inside the
// container, as the container's first step, with the host's figures handed in. The VM is measured there rather than
// with another docker call before the run: `docker system df` takes seconds and reports what could be reclaimed, not
// what is free. Sizes come from statfs, as df's do.
//
// Usage, as a Makefile runs it:
//   hq space host      on the host, before a run; exits 1 to stop the run
//   hq space figures   on the host, the host's figures as one line of JSON for the container
//   hq space vm        inside the container, first; reads HQ_SPACE_HOST, the figures; exits 1 to stop
// It stands aside on GitHub-hosted runners, whose disks are fresh for each job and gone after it, and the host check
// stands aside inside a test container (HQ_IN_CONTAINER=1), where the container's first step has already checked.
import { statfsSync, statSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { loadManifest } from './manifest.mjs';

const E = (env, name) => env[name];

const GB = 1e9;
const DEFAULTS = { warnGb: 20, failGb: 5 };
const RANK = { ok: 0, warn: 1, fail: 2 };

const number = v => (v === undefined || v === null || String(v).trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0) ? null : Number(v);

export function thresholds(env) {
  return { warnGb: number(E(env, 'HQ_SPACE_WARN_GB')) ?? DEFAULTS.warnGb, failGb: number(E(env, 'HQ_SPACE_FAIL_GB')) ?? DEFAULTS.failGb };
}

export function standsAside(env, where) {
  if (env.RUNNER_ENVIRONMENT === 'github-hosted') return true;
  return where === 'host' && E(env, 'HQ_IN_CONTAINER') === '1';
}

// disks: [{ label, free }], free in bytes or null when it could not be measured. The tighter disk decides.
export function decide(disks, { warnGb, failGb }) {
  const known = disks.filter(d => typeof d.free === 'number');
  const tightest = known.reduce((a, d) => (a && a.free <= d.free ? a : d), null);
  const level = !tightest ? 'ok' : tightest.free < failGb * GB ? 'fail' : tightest.free < warnGb * GB ? 'warn' : 'ok';
  return { level, tightest, disks };
}

// What the container's check adds to the host's: nothing when the host's disks alone already gave as bad a verdict,
// since docker-build said so before the container started. Otherwise the verdict over the VM and the host together.
export function vmNews(vm, hostDisks, th) {
  const all = decide([vm, ...hostDisks], th);
  return RANK[all.level] > RANK[decide(hostDisks, th).level] ? all : null;
}

const gb = bytes => `${(bytes / GB).toFixed(1)} GB`;
const sentence = s => s.charAt(0).toUpperCase() + s.slice(1);

// hints: what would make room, as the project says it (a Makefile's targets); without them the runs folder is named.
export function report(d, { warnGb, failGb }, { cache, cacheBytes, hints } = {}) {
  const t = d.tightest;
  const head = d.level === 'fail'
    ? `Free space: the test run was not started. ${sentence(t.label)} has ${gb(t.free)} free, under the ${failGb} GB a run needs (HQ_SPACE_FAIL_GB).`
    : `Free space is low: ${t.label} has ${gb(t.free)} free, under ${warnGb} GB (HQ_SPACE_WARN_GB). The run goes ahead; below ${failGb} GB the next one will not start.`;
  const lines = [head];
  for (const disk of d.disks) lines.push(`  ${disk.label}: ${typeof disk.free === 'number' ? `${gb(disk.free)} free` : 'unknown'}`);
  if (cache && typeof cacheBytes === 'number') lines.push(`  ${cache} holds ${gb(cacheBytes)}: the recorded runs and the other test data kept on this computer`);
  if (t.vm) lines.push(`${sentence(t.label)} holds the test image and its volumes; docker system df shows what they take.`);
  lines.push('Nothing was deleted. To make room, choose what to move or remove:');
  for (const h of hints && hints.length ? hints : [`  the recorded runs under ${cache || 'the cache'}/runs: archive or remove the old ones`]) lines.push(h);
  return lines.join('\n');
}

// Where to measure on the host. Several places can share one disk; oneEach keeps the first name for each.
export function hostPlaces({ platform: os, procVersion = '', cache, checkout }) {
  if (/microsoft/i.test(procVersion)) {
    return [
      { label: 'the WSL disk', path: '/' },
      { label: 'the Windows drive C:', path: '/mnt/c' },
      { label: `the disk holding ${cache}`, path: cache },
      { label: `the disk holding ${checkout}`, path: checkout },
    ];
  }
  return [
    { label: os === 'darwin' ? "this Mac's disk" : "this computer's disk", path: cache },
    { label: `the disk holding ${checkout}`, path: checkout },
  ];
}

export function oneEach(measured) {
  const seen = new Set();
  return measured.filter(m => {
    const key = m.dev ?? `unknown:${m.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(({ label, free }) => ({ label, free }));
}

export function dockerVmLabel({ context = '', dockerHost = '' }) {
  if (/colima/i.test(context) || /colima/i.test(dockerHost)) return 'the Docker VM (Colima)';
  if (/orbstack/i.test(context) || /orbstack/i.test(dockerHost)) return 'the Docker VM (OrbStack)';
  if (/desktop/i.test(context) || /docker\.raw\.sock|\.docker\/run/.test(dockerHost)) return 'the Docker VM (Docker Desktop)';
  return "Docker's disk";
}

// --- measuring: everything below touches the machine ---

// the nearest folder that exists, so a runs folder not made yet is measured on the disk it will be made on
const existing = p => { let q = p; while (!existsSync(q) && dirname(q) !== q) q = dirname(q); return q; };

function measure({ label, path }) {
  try {
    const at = existing(path), s = statfsSync(at);
    return { label, path, dev: statSync(at).dev, free: s.bavail * s.bsize };
  } catch {
    return { label, path, dev: null, free: null };
  }
}

// set by main from the repo's manifest
let CACHE = join(homedir(), '.cache', 'hq');

function hostDisks() {
  let procVersion = '';
  try { procVersion = readFileSync('/proc/version', 'utf8'); } catch { /* not Linux */ }
  return oneEach(hostPlaces({ platform: platform(), procVersion, cache: CACHE, checkout: process.cwd() }).map(measure));
}

function dockerContext() {
  if (process.env.DOCKER_CONTEXT) return process.env.DOCKER_CONTEXT;
  try { return JSON.parse(readFileSync(join(homedir(), '.docker', 'config.json'), 'utf8')).currentContext || ''; } catch { return ''; }
}

// du takes about a second on the laptop's runs, so it runs only when there is something to report
function cacheBytes() {
  const r = spawnSync('du', ['-sk', CACHE], { encoding: 'utf8', timeout: 30000 });
  const kb = Number((r.stdout || '').split(/\s/)[0]);
  return r.status === 0 && Number.isFinite(kb) ? kb * 1024 : null;
}

const unknownNote = disks => disks.filter(d => d.free === null).map(d => `Free space: ${d.label}: unknown. The run goes ahead.`);

// The repo: --repo, else HQ_REPO, else the git checkout the current folder is in, else the folder.
function repoOf(argv, env) {
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (env.HQ_REPO) return env.HQ_REPO;
  try { return spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() || process.cwd(); } catch { return process.cwd(); }
}

// hq space <mode>: answers the exit status.
export function main(argv, env = process.env) {
  const i = argv.indexOf('--repo'), [mode] = i >= 0 ? [...argv.slice(0, i), ...argv.slice(i + 2)] : argv;
  CACHE = loadManifest(repoOf(argv, env)).m.cache;
  if (mode === 'figures') {
    const aside = standsAside(env, 'host');
    const th = thresholds(env);
    process.stdout.write(JSON.stringify(aside ? { aside } : { vm: dockerVmLabel({ context: dockerContext(), dockerHost: env.DOCKER_HOST || '' }), disks: hostDisks(), ...th }) + '\n');
    return 0;
  }
  if (mode === 'host') {
    if (standsAside(env, 'host')) return 0;
    const th = thresholds(env), d = decide(hostDisks(), th);
    if (d.level === 'ok') { for (const l of unknownNote(d.disks)) console.error(l); return 0; }
    console.error(report(d, th, { cache: CACHE.replace(homedir(), '~'), cacheBytes: cacheBytes() }));
    return d.level === 'fail' ? 1 : 0;
  }
  if (mode === 'vm') {
    let host = {};
    try { host = JSON.parse(E(env, 'HQ_SPACE_HOST') || '{}') || {}; } catch { /* no figures: the VM alone */ }
    if (host.aside || standsAside(env, 'vm')) return 0;
    const th = thresholds({ HQ_SPACE_WARN_GB: host.warnGb, HQ_SPACE_FAIL_GB: host.failGb, ...Object.fromEntries(['HQ_SPACE_WARN_GB', 'HQ_SPACE_FAIL_GB'].filter(k => env[k] !== undefined).map(k => [k, env[k]])) });
    const vm = { ...measure({ label: host.vm || "Docker's disk", path: '/' }), vm: true };
    delete vm.path; delete vm.dev;
    const news = vmNews(vm, Array.isArray(host.disks) ? host.disks : [], th);
    if (!news) { for (const l of unknownNote([vm])) console.error(l); return 0; }
    console.error(report(news, th));
    return news.level === 'fail' ? 1 : 0;
  }
  console.error('Usage: hq space host | figures | vm [--repo DIR]');
  return 2;
}
