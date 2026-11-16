// A fingerprint of a module's code and every module it imports by a relative path, however deep: HQ's saved indexes are
// kept by it, so an index is started again when the code that worked it out changes, and survives an upgrade that
// leaves that code alone. Static imports and re-exports are followed; a dynamic import() is not, and nothing a reader
// loads that way is part of its key. Package imports (node:fs, marked) are left out: the lock file pins them.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { relative, dirname } from 'node:path';

const FROM = /(?:^|[;\n])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|(?:^|[;\n])\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/g;

// Answers 40 hex characters. entry is the module's file: URL; a query on it (a test's ?restart=1) is left off.
export function codeKey(entry) {
  const start = new URL(entry); start.search = ''; start.hash = '';
  const root = dirname(fileURLToPath(start)), texts = new Map(), todo = [start];
  while (todo.length) {
    const url = todo.pop(), path = fileURLToPath(url);
    if (texts.has(path)) continue;
    let text = '';
    try { text = readFileSync(path, 'utf8'); } catch { /* a module that is not there keys as empty */ }
    texts.set(path, text);
    for (const m of text.matchAll(FROM)) todo.push(new URL(m[1] || m[2], url));
  }
  const hash = createHash('sha1');
  for (const path of [...texts.keys()].sort()) hash.update(`${relative(root, path)}\0${texts.get(path)}\0`);
  return hash.digest('hex');
}
