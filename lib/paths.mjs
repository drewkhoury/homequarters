// Where HQ may read from. Every file it serves or shows goes through safePath, which answers null for anything outside
// the repo and the cache folder: a ../ in the request, an absolute path, or a symlink inside the repo that points out.
// Some folders inside the repo are refused as well, since they hold secrets or local data rather than the project.
// scripts/serve.mjs, the local server for the app, uses the same check.
import { realpathSync } from 'node:fs';
import { resolve, sep, isAbsolute } from 'node:path';

// never served, whichever root they are under: git's own store, installed packages, local accounts, env files
const REFUSED = [/^\.git$/iu, /^node_modules$/iu, /^emulator-data$/iu, /^\.env(\..*)?$/iu];

// A name is compared the way macOS and Windows open it, since that is where the servers run: in any letter case, with
// Unicode's folding (the u flag), as APFS opens node_moduleſ as node_modules, and without the dots and spaces Windows
// drops from the end of a name, as it opens .git. as .git. The same rule holds everywhere, so Linux's tests check it.
export const refusedName = name => REFUSED.some(r => r.test(name) || r.test(name.replace(/[. ]+$/, '')));

const fold = p => (process.platform === 'win32' ? p.toLowerCase() : p);
const inside = (child, parent) => fold(child) === fold(parent) || fold(child).startsWith(fold(parent.endsWith(sep) ? parent : parent + sep));

// rel is the path from the URL, already decoded, with / between parts. Answers the real path on disk, or null.
export function safePath(root, rel) {
  if (typeof rel !== 'string' || rel.includes('\0')) return null;
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.some(p => p === '..' || refusedName(p))) return null;
  if (isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  let rootReal, real;
  try { rootReal = realpathSync(root); } catch { return null; }
  try { real = realpathSync(resolve(rootReal, ...parts)); } catch { return null; }
  if (!inside(real, rootReal)) return null;
  // a symlink can land somewhere refused inside the root too, as in a link to .git
  const under = real.slice(rootReal.length).split(/[\\/]+/).filter(Boolean);
  return under.some(refusedName) ? null : real;
}
