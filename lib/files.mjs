// Walking the repo in node, so HQ needs no find or grep and runs the same on Windows.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { safePath, refusedName } from './paths.mjs';

// Folders that are output or someone else's code rather than the project. They stay readable by path; they are just
// not listed or searched.
const SKIP = new Set(['test-results', 'playwright-report', '.firebase', '.devpipe', '.shots', '.claude']);

// Every file under the repo as a path with / between parts, sorted, folders before files at each level.
export function walk(root, rel = '') {
  let entries;
  try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return []; }
  const dirs = [], files = [];
  for (const e of entries) {
    if (refusedName(e.name) || SKIP.has(e.name) || e.isSymbolicLink()) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) dirs.push(p); else if (e.isFile()) files.push(p);
  }
  const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  return [...dirs.sort(byName).flatMap(d => walk(root, d)), ...files.sort(byName)];
}

// 'file', 'dir' or null for a repo path, through the same check the server serves by.
export const kindIn = root => p => {
  const real = safePath(root, p);
  if (!real) return null;
  try { const s = statSync(real); return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null; } catch { return null; }
};

// A file that is text rather than an image or a font: no NUL in its first few kilobytes.
export const isText = buf => !buf.subarray(0, 8000).includes(0);
