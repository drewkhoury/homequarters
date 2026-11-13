// Proves: lib/machine.mjs reads swap, paging, memory pressure, thermal and power state and the busiest programs from the
// text sysctl, vm_stat, pmset, ps and /proc/meminfo print, works out the paging rate over a run, and leaves out a
// reading whose command fails without throwing.
// Why: this block goes into every slot take and release and every run line, so a slow or flaky run can be explained
// afterwards; the one load flake on record (smoke-typing, 30 September) ran at load 14 with the slot held alone, and a
// leftover emulator once sat at 500% CPU for 28 hours. Ported from QuestKeep's tests/unit/machine.test.mjs, so the
// assertions stay when QuestKeep deletes its copy. Everything here reads fixed text in place of the commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSwap, parseTherm, parsePower, parseVmStat, pagingRate, topOutside, hostInfo } from '../lib/machine.mjs';

test('swap in use and its total are read from sysctl, in megabytes', () => {
  assert.deepEqual(parseSwap('total = 9216.00M  used = 8314.62M  free = 901.38M  (encrypted)'), { usedMB: 8315, totalMB: 9216 });
  assert.equal(parseSwap(''), null);
});

// On 5 October the Mac had 7 GB of swap in use, which says little: idle pages stay in swap. What slowed the gates was
// the paging itself, measured by hand at about 50 MB/s each way to swap and 830 MB/s through the compressor during a
// test, with macOS's memory pressure at "warn".
const VM_STAT = ['Mach Virtual Memory Statistics: (page size of 16384 bytes)', 'Pages free:                               25010.',
  'Decompressions:                              64000.', 'Compressions:                                128000.', 'Pageins:                                    999999.',
  'Swapins:                                      6400.', 'Swapouts:                                     12800.'].join('\n');

test('swap and compressor traffic since boot are read from vm_stat, in megabytes, by its page size', () => {
  assert.deepEqual(parseVmStat(VM_STAT), { swapIn: 100, swapOut: 200, compressed: 2000, decompressed: 1000 });
  assert.deepEqual(parseVmStat(VM_STAT.replace('16384', '4096')), { swapIn: 25, swapOut: 50, compressed: 500, decompressed: 250 });
  assert.equal(parseVmStat(''), null);
});

test('the paging during a run is the traffic between its take and its release, per second', () => {
  const take = { swapIn: 100, swapOut: 200, compressed: 2000, decompressed: 1000 };
  const release = { swapIn: 400, swapOut: 350, compressed: 26000, decompressed: 25000 };
  assert.deepEqual(pagingRate(take, release, 60), { swapIn: 5, swapOut: 2.5, compressed: 400, decompressed: 400 });
  assert.equal(pagingRate(null, release, 60), null, 'no reading at the take');
  assert.equal(pagingRate(take, null, 60), null, 'no reading at the release');
  assert.equal(pagingRate(take, release, 0), null, 'no time to divide by');
  assert.equal(pagingRate(release, take, 60), null, 'counters that went down mean the Mac restarted');
});

test('a Mac with no thermal note reads as no warning, and a recorded level or speed limit is kept', () => {
  assert.deepEqual(parseTherm('Note: No thermal warning level has been recorded\nNote: No performance warning level has been recorded\nNote: No CPU power status has been recorded'),
    { thermal: 0, performance: 0, speedLimit: null });
  assert.deepEqual(parseTherm('Thermal Warning Level = 2\nPerformance Warning Level = 1\nCPU_Speed_Limit \t= 70'), { thermal: 2, performance: 1, speedLimit: 70 });
});

test('mains or battery, the charge and Low Power Mode are read from pmset', () => {
  const batt = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=26869859)\t64%; discharging; 3:10 remaining present: true";
  assert.deepEqual(parsePower(batt, ' lowpowermode         1\n sleep 1'), { source: 'battery', percent: 64, lowPower: true });
  assert.deepEqual(parsePower("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged", ' lowpowermode         0'), { source: 'ac', percent: 100, lowPower: false });
});

test('the busiest three processes outside the run are named by program, busiest first', () => {
  const ps = ['  PID  %CPU COMM',
    '66946  35.9 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
    '  469  29.7 /System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer',
    '  777  25.0 node',
    '54312  15.3 claude',
    '  900   3.0 java'].join('\n');
  assert.deepEqual(topOutside(ps, new Set([777])), [{ cpu: 35.9, name: 'Google Chrome Helper' }, { cpu: 29.7, name: 'WindowServer' }, { cpu: 15.3, name: 'claude' }]);
});

test('a reading whose command fails is left out, and nothing throws', () => {
  const info = hostInfo({ platform: 'darwin', run: () => { throw new Error('no such command'); }, loadavg: () => [7.5, 4.25, 3], cores: 12 });
  assert.deepEqual(info, { load1: 7.5, load5: 4.25, cores: 12, swap: null, memFreePct: null, pressure: null, paged: null, therm: null, power: null, top: [] });
});

test('on a Mac every reading is gathered into one block', () => {
  const out = {
    'sysctl -n vm.swapusage': 'total = 2048.00M  used = 1024.00M  free = 1024.00M',
    'sysctl -n kern.memorystatus_level': '34',
    'sysctl -n kern.memorystatus_vm_pressure_level': '2',
    vm_stat: VM_STAT,
    'pmset -g therm': 'Note: No thermal warning level has been recorded',
    'pmset -g batt': "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged",
    'pmset -g': ' lowpowermode         0',
    'ps -Ao pid,pcpu,comm -r': '  PID  %CPU COMM\n  10  50.0 /usr/bin/ffmpeg',
  };
  const info = hostInfo({ platform: 'darwin', run: (cmd, args) => out[[cmd, ...args].join(' ')], loadavg: () => [1, 2, 3], cores: 8 });
  assert.deepEqual(info, { load1: 1, load5: 2, cores: 8, swap: { usedMB: 1024, totalMB: 2048 }, memFreePct: 34, pressure: 'warn',
    paged: { swapIn: 100, swapOut: 200, compressed: 2000, decompressed: 1000 },
    therm: { thermal: 0, performance: 0, speedLimit: null }, power: { source: 'ac', percent: 100, lowPower: false }, top: [{ cpu: 50, name: 'ffmpeg' }] });
});

test('on Linux the swap and free memory come from /proc/meminfo, and there is no pmset', () => {
  const meminfo = 'MemTotal:       16000000 kB\nMemAvailable:    4000000 kB\nSwapTotal:       2097152 kB\nSwapFree:        1048576 kB\n';
  const info = hostInfo({ platform: 'linux', run: (cmd, args) => (cmd === 'ps' ? '  PID  %CPU COMM\n 5 12.5 chrome' : (() => { throw new Error(); })()), readFile: () => meminfo, loadavg: () => [2, 1, 0.5], cores: 4 });
  assert.deepEqual(info, { load1: 2, load5: 1, cores: 4, swap: { usedMB: 1024, totalMB: 2048 }, memFreePct: 25, pressure: null, paged: null, therm: null, power: null, top: [{ cpu: 12.5, name: 'chrome' }] });
});

test("macOS's memory pressure reads as normal, warn or critical, and anything else as unknown", () => {
  const at = level => hostInfo({ platform: 'darwin', run: (cmd, args) => { if (args.join(' ') === '-n kern.memorystatus_vm_pressure_level') return level; throw new Error(); }, loadavg: () => [0, 0, 0], cores: 1 }).pressure;
  assert.deepEqual(['1', '2', '4', '7', ''].map(at), ['normal', 'warn', 'critical', null, null]);
});
