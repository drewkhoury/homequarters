// A JSON-lines log (the lock log, the problem events), parsed once while it stays the same size and age: the Problems
// page reads both on every read of the register, and they grow by a line at a time. The same array is answered until
// the file changes, so no caller may change it. A line that is not JSON is passed over, and a file that is gone is [].
import { readFileSync, statSync } from 'node:fs';

const KEPT = new Map();
export function jsonLines(file) {
  let stamp;
  try { const s = statSync(file); stamp = `${s.size}:${s.mtimeMs}`; } catch { KEPT.delete(file); return []; }
  const had = KEPT.get(file);
  if (had && had.stamp === stamp) return had.lines;
  let lines = [];
  try { lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* gone since the stat */ }
  KEPT.set(file, { stamp, lines });
  return lines;
}
