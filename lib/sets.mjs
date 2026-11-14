// The test sets: which test files make up each set a run can be (gate, after, and whatever else a project names), so the
// Testing page can say what a run of a set covered and the live-run page can count what is still to come. They come from
// the file hq.json names under tests.sets, `{ "schema": 1, "sets": { "gate": ["smoke-sync", ...], "after": [...] } }`,
// each name a test file's name without its folder or extension. A project with no such file but a Makefile at its root
// with `GATE := ...` and `AFTER := ...` lines is read that way for one release, since that is where QuestKeep kept them;
// hq setup proposes the file from those lines.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SETS_V = 1;
let FILE = null;
// The manifest's tests.sets, applied once when HQ or a writer starts.
export function configureSets({ file } = {}) { FILE = file || null; }

// The sets a file's text gives: { sets, warnings }. A set that is not a list of names is left out with a warning.
export function parseSets(text, from = 'tests.sets') {
  const warnings = [], sets = {};
  let j;
  try { j = JSON.parse(text); } catch { return { sets, warnings: [`${from}: not JSON`] }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { sets, warnings: [`${from}: should be an object with a sets key`] };
  if (Number.isInteger(j.schema) && j.schema > SETS_V) warnings.push(`${from}: schema ${j.schema} is newer than this HQ (${SETS_V}); reading what it knows`);
  const raw = j.sets && typeof j.sets === 'object' && !Array.isArray(j.sets) ? j.sets : null;
  if (!raw) { warnings.push(`${from}: no sets key`); return { sets, warnings }; }
  for (const [name, list] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) { warnings.push(`${from}: set ${JSON.stringify(name)} should be a short lower-case word`); continue; }
    if (!Array.isArray(list) || !list.every(t => typeof t === 'string' && /^[\w.-]+$/.test(t))) { warnings.push(`${from}: set "${name}" should be a list of test names`); continue; }
    sets[name] = [...new Set(list)];
  }
  return { sets, warnings };
}

// The browser test sets a Makefile's GATE := and AFTER := lines name (QuestKeep's convention, read for one release).
export function makeSets(makefile) {
  const sets = {};
  for (const [, name, list] of makefile.matchAll(/^(GATE|AFTER)\s*:=\s*(.*)$/gm)) sets[name.toLowerCase()] = list.trim().split(/\s+/).filter(Boolean);
  return sets;
}

// The sets for a repo: the configured file's, else the Makefile's, else none.
export function testSets(repo) {
  if (FILE) { try { return parseSets(readFileSync(FILE, 'utf8')).sets; } catch { return {}; } }
  const mk = join(repo, 'Makefile');
  if (existsSync(mk)) { try { return makeSets(readFileSync(mk, 'utf8')); } catch { return {}; } }
  return {};
}

// The file the sets come from, configured or the Makefile, for a reader that keeps what it worked out from them.
export const setsSource = repo => FILE || join(repo, 'Makefile');

// The tests/sets.json hq setup proposes from a Makefile's lines, or null when it has none.
export function proposeSets(makefile) {
  const sets = makeSets(makefile);
  return Object.keys(sets).length ? { schema: SETS_V, sets } : null;
}
