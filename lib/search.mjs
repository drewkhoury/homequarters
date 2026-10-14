// Search across the code, the docs and the run logs, done in node: plain text, any case, no regular expressions, so
// what you type is what is found and nothing needs escaping.
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { walk, isText } from './files.mjs';

export const MAX_FILE = 512 * 1024; // bigger files are vendored or generated; they are listed but not searched
const PER_FILE = 30, TOTAL = 400;

// The lines of text that contain q in any case: [{ line, text, at }], at most `limit`. `at` is where the match starts
// in text, which is cut to about 240 characters around it when the line is long.
export function findInText(text, q, limit = PER_FILE) {
  const needle = q.toLowerCase(), out = [];
  if (!needle) return out;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const line = lines[i].replace(/\r$/, ''), at = line.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    if (line.length <= 240) { out.push({ line: i + 1, text: line, at }); continue; }
    const from = Math.max(0, at - 100), cut = line.slice(from, from + 240);
    out.push({ line: i + 1, text: (from ? '…' : '') + cut + (from + 240 < line.length ? '…' : ''), at: at - from + (from ? 1 : 0) });
  }
  return out;
}

function readSmall(path) {
  try {
    if (statSync(path).size > MAX_FILE) return null;
    const buf = readFileSync(path);
    return isText(buf) ? buf.toString('utf8') : null;
  } catch { return null; }
}

// { code: [...], docs: [...], logs: [...], truncated }, each entry { path, hits } (logs carry run and task too).
export function searchAll({ repo, cache, q, scopes = ['code', 'docs', 'logs'] }) {
  const out = { code: [], docs: [], logs: [], truncated: false };
  let total = 0;
  const take = (list, entry, text) => {
    if (total >= TOTAL) { out.truncated = true; return; }
    const hits = findInText(text, q, Math.min(PER_FILE, TOTAL - total));
    if (hits.length) { list.push({ ...entry, hits }); total += hits.length; }
  };
  if (q.trim().length < 2) return out;
  if (scopes.includes('code') || scopes.includes('docs')) {
    for (const p of walk(repo)) {
      const isDoc = /\.md$/i.test(p);
      if (!scopes.includes(isDoc ? 'docs' : 'code')) continue;
      const text = readSmall(join(repo, p));
      if (text !== null) take(isDoc ? out.docs : out.code, { path: p }, text);
    }
  }
  if (scopes.includes('logs')) {
    const runsDir = join(cache, 'runs', 'runs');
    let ids = [];
    try { ids = readdirSync(runsDir).sort().reverse(); } catch { /* no runs yet */ }
    for (const id of ids) {
      let logs = [];
      try { logs = readdirSync(join(runsDir, id, 'logs')).filter(f => f.endsWith('.log')).sort(); } catch { continue; }
      for (const f of logs) {
        const text = readSmall(join(runsDir, id, 'logs', f));
        if (text !== null) take(out.logs, { path: `${id}/${f}`, run: id, task: basename(f, '.log') }, text);
      }
    }
  }
  return out;
}
