// What the machine was doing, in one small block: its load, cores, swap, free memory, memory pressure and paging,
// thermal and power state, and the three busiest programs. The test slot gives one test run, not a quiet laptop: the one load flake on record
// (smoke-typing, 30 September) ran at load 14 with the slot held alone, and a leftover emulator once sat at 500% CPU for
// 28 hours. scripts/lock.mjs logs this block when a run takes and gives back the slot, and tests/run-info.mjs puts it in
// each recorded run's first line and in CI's run.json, so a slow or flaky run can be explained afterwards. A reading
// whose command fails is left out (null), and nothing here throws: a run must never fail for want of a reading.
// Usage: node scripts/machine.mjs   prints the block as JSON
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg as osLoadavg, availableParallelism } from 'node:os';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const round2 = n => Math.round(n * 100) / 100;

// sysctl -n vm.swapusage: "total = 9216.00M  used = 8314.62M  free = 901.38M  (encrypted)"
export function parseSwap(text) {
  const t = /total = ([\d.]+)M/.exec(text || ''), u = /used = ([\d.]+)M/.exec(text || '');
  return t && u ? { usedMB: Math.round(+u[1]), totalMB: Math.round(+t[1]) } : null;
}

// vm_stat: swap and compressor traffic since boot, in megabytes, by the page size its first line gives. Swap in use says
// little, since idle pages stay in swap; traffic over a run says whether the Mac was paging while it ran (pagingRate).
export function parseVmStat(text) {
  const size = /page size of (\d+) bytes/.exec(text || '');
  const count = k => { const m = new RegExp(`^${k}:\\s+(\\d+)\\.?$`, 'm').exec(text || ''); return m ? +m[1] : null; };
  const c = { swapIn: count('Swapins'), swapOut: count('Swapouts'), compressed: count('Compressions'), decompressed: count('Decompressions') };
  if (!size || Object.values(c).some(v => v === null)) return null;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v * +size[1] / 1048576)]));
}

// The traffic between a run's take and its release, in megabytes a second. Counters that went down mean the Mac
// restarted between the two, which leaves nothing to compare.
export function pagingRate(take, release, secs) {
  if (!take || !release || !(secs > 0)) return null;
  const keys = Object.keys(release);
  if (keys.some(k => typeof take[k] !== 'number' || release[k] < take[k])) return null;
  return Object.fromEntries(keys.map(k => [k, Math.round((release[k] - take[k]) / secs * 10) / 10]));
}

// sysctl -n kern.memorystatus_vm_pressure_level: macOS's own reading, 1 normal, 2 warn, 4 critical
const PRESSURE = { 1: 'normal', 2: 'warn', 4: 'critical' };

// pmset -g therm: a note per kind when nothing has been recorded, "<Kind> Warning Level = n" when something has, and on
// Intel Macs CPU_Speed_Limit, the percentage of full speed allowed
export function parseTherm(text) {
  const num = re => { const m = re.exec(text || ''); return m ? +m[1] : null; };
  return { thermal: num(/Thermal Warning Level\s*=\s*(\d+)/i) ?? 0, performance: num(/Performance Warning Level\s*=\s*(\d+)/i) ?? 0, speedLimit: num(/CPU_Speed_Limit\s*=\s*(\d+)/) };
}

// pmset -g batt and pmset -g: on mains or battery, the charge, and Low Power Mode
export function parsePower(batt, settings) {
  const pct = /(\d+)%/.exec(batt || ''), low = /lowpowermode\s+(\d)/.exec(settings || '');
  return { source: /'Battery Power'/.test(batt || '') ? 'battery' : 'ac', percent: pct ? +pct[1] : null, lowPower: low ? low[1] === '1' : null };
}

// ps -Ao pid,pcpu,comm -r, busiest first: the first three not in exclude, each named by its program
export function topOutside(text, exclude = new Set()) {
  return String(text || '').split('\n').slice(1).map(l => /^\s*(\d+)\s+([\d.]+)\s+(.+)$/.exec(l)).filter(Boolean)
    .filter(([, pid]) => !exclude.has(+pid)).slice(0, 3).map(([, , cpu, comm]) => ({ cpu: +cpu, name: basename(comm.trim()) }));
}

// /proc/meminfo, on Linux: swap in use and the share of memory available
function fromMeminfo(text) {
  const kb = k => { const m = new RegExp(`^${k}:\\s+(\\d+) kB`, 'm').exec(text || ''); return m ? +m[1] : null; };
  const st = kb('SwapTotal'), sf = kb('SwapFree'), mt = kb('MemTotal'), ma = kb('MemAvailable');
  return { swap: st !== null && sf !== null ? { usedMB: Math.round((st - sf) / 1024), totalMB: Math.round(st / 1024) } : null,
    memFreePct: mt && ma !== null ? Math.round((ma / mt) * 100) : null };
}

const execRun = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });

export function hostInfo({ platform = process.platform, run = execRun, readFile = f => readFileSync(f, 'utf8'), loadavg = osLoadavg, cores = availableParallelism(), exclude = new Set([process.pid]) } = {}) {
  const tryRun = (cmd, ...args) => { try { const out = run(cmd, args); return typeof out === 'string' ? out : null; } catch { return null; } };
  const [l1, l5] = loadavg();
  const info = { load1: round2(l1), load5: round2(l5), cores, swap: null, memFreePct: null, pressure: null, paged: null, therm: null, power: null, top: [] };
  if (platform === 'darwin') {
    info.swap = parseSwap(tryRun('sysctl', '-n', 'vm.swapusage'));
    const level = tryRun('sysctl', '-n', 'kern.memorystatus_level');
    info.memFreePct = level && /^\d+/.test(level.trim()) ? +level.trim() : null;
    info.pressure = PRESSURE[(tryRun('sysctl', '-n', 'kern.memorystatus_vm_pressure_level') || '').trim()] || null;
    info.paged = parseVmStat(tryRun('vm_stat'));
    const therm = tryRun('pmset', '-g', 'therm');
    info.therm = therm === null ? null : parseTherm(therm);
    const batt = tryRun('pmset', '-g', 'batt');
    info.power = batt === null ? null : parsePower(batt, tryRun('pmset', '-g'));
  } else if (platform === 'linux') {
    let text = null;
    try { text = readFile('/proc/meminfo'); } catch { /* no /proc */ }
    if (text) Object.assign(info, fromMeminfo(text));
  }
  // -r sorts by CPU on macOS, and means only running processes on Linux, whose ps sorts with --sort
  info.top = topOutside(platform === 'darwin' ? tryRun('ps', '-Ao', 'pid,pcpu,comm', '-r') : tryRun('ps', '-eo', 'pid,pcpu,comm', '--sort=-pcpu'), exclude);
  return info;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(hostInfo()));
