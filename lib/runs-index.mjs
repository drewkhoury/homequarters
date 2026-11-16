// The run store saved to disk, so a restarted HQ starts from the runs it had read: <cache>/hq/runs-index.json holds
// each run folder's stamp and what was read from it, and a folder whose stamp still stands is not read again.
// It is HQ's own file, written whole to a .tmp beside it and renamed, so a half-written index never reads back. It is
// kept by the code key of lib/runs.mjs (lib/code-key.mjs): an index written by other code that reads runs is passed
// over, and one from another HQ version whose reading code is the same is used.
//
// A test result is held as [name, status, seconds] or [name, status, seconds, { log, crashed }], its name a number in
// the index's one list of names: QuestKeep's 2.8 million results name a few thousand tests.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { codeKey } from './code-key.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const FORMAT = 1;
// the code that reads a run folder into what the index holds, worked out once per process
let readers = null;
const READERS = () => (readers ??= codeKey(new URL('./runs.mjs', import.meta.url)));
export const indexFile = cacheRoot => join(cacheRoot, 'hq', 'runs-index.json');
const STATUS = ['pass', 'fail', 'skip'];

// Each map is id -> { stamp, value }, as the run store keeps its folders.
export function saveIndex(file, maps) {
  const names = [], at = new Map();
  const nameNo = s => { if (!at.has(s)) { at.set(s, names.length); names.push(s); } return at.get(s); };
  const pack = c => {
    const { name, status, seconds, ...rest } = c;
    const s = STATUS.indexOf(status);
    if (typeof name !== 'string' || s < 0) return [-1, -1, 0, c]; // not the usual shape: kept whole
    return Object.keys(rest).length ? [nameNo(name), s, seconds, rest] : [nameNo(name), s, seconds];
  };
  const packRun = v => (v && Array.isArray(v.tasks) ? { ...v, tasks: v.tasks.map(t => (Array.isArray(t.cases) ? { ...t, cases: t.cases.map(pack) } : t)) } : v);
  const out = {};
  for (const [k, m] of Object.entries(maps)) out[k] = [...m].map(([id, { stamp, value }]) => [id, stamp, packRun(value)]);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file + '.tmp', JSON.stringify({ hq: VERSION, readers: READERS(), format: FORMAT, names, ...out }));
    renameSync(file + '.tmp', file);
  } catch { /* an index that cannot be written only means a slower next start */ }
}

// Answers { [map]: Map(id -> { stamp, value }) }, or null for no index, other reading code's or a damaged one.
// own(name) answers the run store's one copy of a name.
export function loadIndex(file, keys, own = s => s) {
  let saved;
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  if (!saved || saved.readers !== READERS() || saved.format !== FORMAT || !Array.isArray(saved.names) || !keys.every(k => Array.isArray(saved[k]))) return null;
  const names = saved.names.map(own);
  const unpack = c => (c[0] < 0 ? c[3] : c.length > 3 ? { name: names[c[0]], status: STATUS[c[1]], seconds: c[2], ...c[3] } : { name: names[c[0]], status: STATUS[c[1]], seconds: c[2] });
  const unpackRun = v => (v && Array.isArray(v.tasks) ? (v.tasks = v.tasks.map(t => (Array.isArray(t.cases) ? (t.cases = t.cases.map(unpack), t) : t)), v) : v);
  const out = {};
  for (const k of keys) out[k] = new Map(saved[k].map(([id, stamp, value]) => [id, { stamp, value: unpackRun(value) }]));
  return out;
}
