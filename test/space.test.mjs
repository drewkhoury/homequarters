// Proves: before a test run, hq space checks the free space on each disk the run fills: this computer's own disk (on
// WSL, the WSL disk and the Windows drive C: under it) and, for a container run, the Docker VM, whose disk is a file
// on this computer's disk and can only grow while that disk has room. The person you work with keeps every run's data,
// and nothing here deletes any: below 20 GB on the tighter disk the run warns, below 5 GB it stops before it starts,
// and both say how much each disk has and which commands make room. A disk it cannot measure reads "unknown" and never
// stops a run. These tests cover the pure decisions; the last ones run the command for real with the lines moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, thresholds, report, hostPlaces, oneEach, dockerVmLabel, standsAside, vmNews } from '../lib/space.mjs';

const GB = 1e9;
const DEFAULT = { warnGb: 20, failGb: 5 };
const mac = free => ({ label: "this Mac's disk", free });
const vm = free => ({ label: 'the Docker VM (Colima)', free });

test('a run goes ahead quietly with 20 GB or more free, warns below 20 GB and stops below 5 GB', () => {
  assert.equal(decide([mac(20 * GB)], DEFAULT).level, 'ok');
  assert.equal(decide([mac(20 * GB - 1)], DEFAULT).level, 'warn');
  assert.equal(decide([mac(5 * GB)], DEFAULT).level, 'warn');
  assert.equal(decide([mac(5 * GB - 1)], DEFAULT).level, 'fail');
});

test('the tighter disk decides, and the verdict names it', () => {
  const d = decide([mac(300 * GB), vm(3 * GB)], DEFAULT);
  assert.equal(d.level, 'fail');
  assert.equal(d.tightest.label, 'the Docker VM (Colima)');
  assert.equal(decide([mac(12 * GB), vm(80 * GB)], DEFAULT).tightest.label, "this Mac's disk");
});

test('a disk that could not be measured never stops a run, and the others still count', () => {
  const unknown = { label: "this Mac's disk", free: null };
  assert.equal(decide([unknown], DEFAULT).level, 'ok');
  assert.equal(decide([unknown, vm(2 * GB)], DEFAULT).level, 'fail');
  assert.match(report(decide([unknown, vm(2 * GB)], DEFAULT), DEFAULT, {}), /this Mac's disk: unknown/);
});

test('HQ_SPACE_WARN_GB and HQ_SPACE_FAIL_GB move the lines, anything that is not a number keeps the defaults, and the QK_ names are not read from 0.3.0', () => {
  assert.deepEqual(thresholds({}), DEFAULT);
  assert.deepEqual(thresholds({ HQ_SPACE_WARN_GB: '50', HQ_SPACE_FAIL_GB: '100000' }), { warnGb: 50, failGb: 100000 });
  assert.deepEqual(thresholds({ HQ_SPACE_WARN_GB: 'lots', HQ_SPACE_FAIL_GB: '' }), DEFAULT);
  assert.equal(decide([mac(500 * GB)], thresholds({ HQ_SPACE_FAIL_GB: '100000' })).level, 'fail');
  assert.deepEqual(thresholds({ QK_SPACE_WARN_GB: '50', QK_SPACE_FAIL_GB: '7' }), DEFAULT);
});

test('a stopped run says it started nothing and deleted nothing, gives each disk, the cache and what would make room', () => {
  const text = report(decide([mac(3.2 * GB), vm(40 * GB)], DEFAULT), DEFAULT, { cache: '~/.cache/questkeep', cacheBytes: 31.5 * GB, hints: ['  make runs-archive   archive the recorded runs', '  make prune-runs     remove old recorded runs'] });
  assert.match(text, /not started/i);
  assert.match(text, /this Mac's disk: 3\.2 GB free/);
  assert.match(text, /the Docker VM \(Colima\): 40\.0 GB free/);
  assert.match(text, /~\/\.cache\/questkeep holds 31\.5 GB/);
  assert.match(text, /make runs-archive/);
  assert.match(text, /make prune-runs/);
  assert.match(text, /nothing (has been|was) deleted/i);
});

test('a warning lets the run go ahead and gives the same figures; without a project\'s own hints it names the runs folder', () => {
  const text = report(decide([mac(14 * GB)], DEFAULT), DEFAULT, { cache: '~/.cache/questkeep', cacheBytes: 9 * GB });
  assert.doesNotMatch(text, /not started/i);
  assert.match(text, /this Mac's disk: 14\.0 GB free/);
  assert.match(text, /~\/\.cache\/questkeep\/runs: archive or remove/);
});

test("a Mac's checkout and runs folder share one disk, labelled as this Mac's", () => {
  const places = hostPlaces({ platform: 'darwin', procVersion: '', cache: '/Users/x/.cache/questkeep', checkout: '/Users/x/repos/q' });
  assert.equal(places[0].label, "this Mac's disk");
  const measured = places.map(p => ({ ...p, dev: 1, free: 100 * GB }));
  assert.deepEqual(oneEach(measured).map(d => d.label), ["this Mac's disk"]);
});

test('on WSL the WSL disk and the Windows drive C: under it are both measured, each by its own name', () => {
  const places = hostPlaces({ platform: 'linux', procVersion: 'Linux version 5.15.153.1-microsoft-standard-WSL2', cache: '/home/x/.cache/questkeep', checkout: '/home/x/q' });
  const byPath = Object.fromEntries(places.map(p => [p.path, p.label]));
  assert.equal(byPath['/'], 'the WSL disk');
  assert.equal(byPath['/mnt/c'], 'the Windows drive C:');
  const measured = places.map(p => ({ ...p, dev: p.path === '/mnt/c' ? 2 : 1, free: (p.path === '/mnt/c' ? 4 : 60) * GB }));
  const disks = oneEach(measured);
  assert.deepEqual(disks.map(d => d.label).sort(), ['the WSL disk', 'the Windows drive C:'].sort());
  assert.equal(decide(disks, DEFAULT).tightest.label, 'the Windows drive C:');
});

test('the Docker VM is named for what runs it', () => {
  assert.equal(dockerVmLabel({ context: 'colima-vz' }), 'the Docker VM (Colima)');
  assert.equal(dockerVmLabel({ context: 'default', dockerHost: 'unix:///Users/x/.colima/default/docker.sock' }), 'the Docker VM (Colima)');
  assert.equal(dockerVmLabel({ context: 'desktop-linux' }), 'the Docker VM (Docker Desktop)');
  assert.equal(dockerVmLabel({ context: 'orbstack' }), 'the Docker VM (OrbStack)');
  assert.equal(dockerVmLabel({ context: 'default', dockerHost: 'unix:///Users/x/.orbstack/run/docker.sock' }), 'the Docker VM (OrbStack)');
  assert.equal(dockerVmLabel({}), "Docker's disk");
});

test('the check stands aside on GitHub-hosted runners, and on the host side when already inside the test image', () => {
  assert.equal(standsAside({ RUNNER_ENVIRONMENT: 'github-hosted' }, 'host'), true);
  assert.equal(standsAside({ RUNNER_ENVIRONMENT: 'github-hosted' }, 'vm'), true);
  assert.equal(standsAside({ RUNNER_ENVIRONMENT: 'self-hosted', CI: 'true' }, 'host'), false, 'the laptop runner fills the same disks');
  assert.equal(standsAside({ HQ_IN_CONTAINER: '1' }, 'host'), true);
  assert.equal(standsAside({ HQ_IN_CONTAINER: '1' }, 'vm'), false);
  assert.equal(standsAside({ QK_IN_CONTAINER: '1' }, 'host'), false, 'the QK_ name is not read from 0.3.0');
  assert.equal(standsAside({}, 'host'), false);
});

test("the container's check reports only what the host's check did not, and then gives both disks", () => {
  assert.equal(vmNews(vm(200 * GB), [mac(300 * GB)], DEFAULT), null, 'both fine');
  assert.equal(vmNews(vm(200 * GB), [mac(12 * GB)], DEFAULT), null, 'the host check already warned');
  const news = vmNews(vm(3 * GB), [mac(300 * GB)], DEFAULT);
  assert.equal(news.level, 'fail');
  assert.deepEqual(news.disks.map(d => d.label), ['the Docker VM (Colima)', "this Mac's disk"]);
  assert.equal(vmNews(vm(15 * GB), [mac(18 * GB)], DEFAULT), null, 'one warning is enough when both are low');
  assert.equal(vmNews(vm(3 * GB), [mac(18 * GB)], DEFAULT).level, 'fail', 'but a stop is news after a warning');
});

// ---- the command for real, against this machine's disks, with the lines moved so each path is forced ----
const HQ = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs');
// a clean environment: none of the variables that make the check stand aside or move its lines
const run = (mode, env = {}) => {
  const r = spawnSync(process.execPath, [HQ, 'space', mode], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
  return { status: r.status, out: r.stdout + r.stderr };
};
// more free space than any disk has, so a host given it is never the tighter one
const HUGE = 2e14;

test('the host check stops a run below the fail line, before it starts, with each disk and the commands', () => {
  const r = run('host', { HQ_SPACE_FAIL_GB: '100000' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /not started/i);
  assert.match(r.out, /: \d+\.\d GB free/);
  assert.match(r.out, /runs: archive or remove/);
});

test('the host check warns below the warn line and lets the run go ahead', () => {
  const r = run('host', { HQ_SPACE_WARN_GB: '100000' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /: \d+\.\d GB free/);
  assert.doesNotMatch(r.out, /not started/i);
});

test('the host check prints nothing when there is room', () => {
  const r = run('host', { HQ_SPACE_WARN_GB: '0', HQ_SPACE_FAIL_GB: '0' });
  assert.deepEqual(r, { status: 0, out: '' });
});

test('the check stands aside on a GitHub-hosted runner, whatever the lines say', () => {
  assert.deepEqual(run('host', { HQ_SPACE_FAIL_GB: '100000', RUNNER_ENVIRONMENT: 'github-hosted' }), { status: 0, out: '' });
});

test("the container's check stops the run when the VM is short, and names both the VM and the host's disk", () => {
  const host = JSON.stringify({ vm: 'the Docker VM (Colima)', disks: [{ label: "this Mac's disk", free: HUGE }] });
  const r = run('vm', { HQ_SPACE_FAIL_GB: '100000', HQ_SPACE_HOST: host, HQ_IN_CONTAINER: '1' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /the Docker VM \(Colima\): \d+\.\d GB free/);
  assert.match(r.out, /this Mac's disk: 200000\.0 GB free/);
});

test('the figures the host hands the container name the VM and every host disk', () => {
  const r = spawnSync(process.execPath, [HQ, 'space', 'figures'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(r.status, 0, r.stderr);
  const f = JSON.parse(r.stdout);
  assert.match(f.vm, /Docker/);
  assert.ok(f.disks.length >= 1 && f.disks.every(d => d.label && (d.free === null || d.free > 0)), r.stdout);
});
