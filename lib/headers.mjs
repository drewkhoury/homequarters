// The test catalogue: every test file, what it says it proves, and which set it runs in. HQ reads it, and so do
// tests/tests-doc.mjs and tests/unit/test-headers.test.mjs. The description is the file's opening comment; every browser
// and rules test file also carries these fields in it (backlog 29):
//   // Proves: ...
//   // Why it exists: ...
//   // Runs in: gate
//   // Takes: 20 s
//   // Run it when: ...
// A field runs on over the lines after it until the next field or a blank comment line.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const FIELDS = { 'proves': 'proves', 'why it exists': 'why', 'runs in': 'runsIn', 'takes': 'takes', 'run it when': 'runWhen' };
const FIELD = /^[*_]*(proves|why it exists|runs in|takes|run it when)[*_]*\s*:[*_]*\s*(.*)$/i;
// lines allowed before the opening comment: a shebang, 'use strict', and the file's requires and imports
const PREAMBLE = /^(#!|['"]use strict['"]|(const|let|var)\s.*=\s*require\(|import\s)/;

// The opening comment's lines, without their comment marks.
export function openingComment(source) {
  const lines = source.split(/\r?\n/), out = [];
  let i = 0;
  while (i < lines.length && (!lines[i].trim() || PREAMBLE.test(lines[i].trim()))) i++;
  const first = (lines[i] || '').trim();
  if (first.startsWith('/*')) {
    for (; i < lines.length; i++) {
      const end = lines[i].includes('*/');
      out.push(lines[i].replace(/^\s*\/\*+\s?/, '').replace(/\s*\*+\/.*$/, '').replace(/^\s*\*\s?/, ''));
      if (end) break;
    }
  } else {
    for (; i < lines.length && lines[i].trim().startsWith('//'); i++) out.push(lines[i].trim().replace(/^\/\/+\s?/, ''));
  }
  return out;
}

// { description, fields }: fields is null when the file has no header field at all.
export function parseHeader(source) {
  const desc = [], fields = {};
  let current = null;
  for (const line of openingComment(source)) {
    const m = FIELD.exec(line.trim());
    if (m) { current = FIELDS[m[1].toLowerCase()]; fields[current] = m[2].trim(); continue; }
    if (!line.trim()) { current = null; continue; }
    if (current) fields[current] = (fields[current] + ' ' + line.trim()).trim();
    else desc.push(line.trim());
  }
  return { description: desc.join(' ').trim(), fields: Object.keys(fields).length ? fields : null };
}

// The browser test sets from the Makefile: GATE and AFTER, each a list of names under tests/.
export function makeSets(makefile) {
  const sets = {};
  for (const [, name, list] of makefile.matchAll(/^(GATE|AFTER)\s*:=\s*(.*)$/gm)) sets[name.toLowerCase()] = list.trim().split(/\s+/);
  return sets;
}

// The titles of the node tests in a file: test('title', ...) and it('title', ...). A title built with ${} is left out.
export function testTitles(source) {
  const titles = [];
  for (const m of source.matchAll(/\b(?:test|it)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    if (m[1] === '`' && m[2].includes('${')) continue;
    titles.push(m[2].replace(/\\(.)/g, '$1'));
  }
  return titles;
}

// Screenshot names a test writes, from the .png names in its source.
export const shotNames = source => [...new Set([...source.matchAll(/([\w.-]+\.png)['"`]/g)].map(m => m[1]))];

// Every test file in the repo with its set, description, header fields, node test titles and screenshot names.
export function catalogue(repo) {
  const read = p => readFileSync(join(repo, p), 'utf8');
  const sets = existsSync(join(repo, 'Makefile')) ? makeSets(read('Makefile')) : {};
  const setOf = name => (sets.gate || []).includes(name) ? 'gate' : (sets.after || []).includes(name) ? 'after' : null;
  const files = [];
  const add = (path, set) => {
    const source = read(path);
    const name = path.split('/').pop().replace(/\.test\.m?js$|\.m?js$/, '');
    files.push({ path, name, set, ...parseHeader(source), titles: set === 'unit' || set === 'rules' ? testTitles(source) : [], shots: shotNames(source) });
  };
  const dir = p => (existsSync(join(repo, p)) ? readdirSync(join(repo, p)).sort() : []);
  for (const f of dir('tests')) {
    if (f.endsWith('.test.js')) add('tests/' + f, 'rules');
    else if (f.endsWith('.js')) add('tests/' + f, setOf(f.slice(0, -3)) || 'helper');
  }
  for (const f of dir('tests/unit')) if (f.endsWith('.test.mjs')) add('tests/unit/' + f, 'unit');
  const order = { gate: 0, after: 1, unit: 2, rules: 3, helper: 4 };
  return files.sort((a, b) => order[a.set] - order[b.set] || a.name.localeCompare(b.name));
}

// A gate test's time budget on CI, in seconds, from its Takes line ("... budget 30 s on CI"); null when it names none.
// Only a budget said to be on CI counts, so a container budget earlier on the line is not taken for it.
// No gate test may budget more than GATE_BUDGET_MAX: past that it is split, or it moves to the long set (fast-deploy S4).
export const GATE_BUDGET_MAX = 45;
export const budgetOf = takes => { const m = /\bbudget (\d+) s on CI\b/i.exec(takes || ''); return m ? +m[1] : null; };
// { name: seconds } for every gate test whose header names a budget, for tests/junit-summary.mjs.
export const gateBudgets = repo => Object.fromEntries(catalogue(repo)
  .filter(f => f.set === 'gate' && budgetOf(f.fields && f.fields.takes) !== null).map(f => [f.name, budgetOf(f.fields.takes)]));

// What is wrong with a file's header, as short messages; none for a file that is fine. Runs in must name the set the
// Makefile puts the file in, so the header cannot say gate for a walkthrough.
const RUNS_IN = { gate: [/\bgate\b/i, 'the gate'], after: [/after\.yml/i, 'after.yml'], rules: [/test-rules/i, 'make test-rules'] };
export function headerProblems({ set, fields }) {
  if (!fields) return ['no header'];
  const out = Object.entries(FIELDS).filter(([, key]) => !fields[key]).map(([label]) => `no "${label[0].toUpperCase() + label.slice(1)}:"`);
  const want = RUNS_IN[set];
  if (want && fields.runsIn && !want[0].test(fields.runsIn)) out.push(`"Runs in:" should say ${want[1]}, as the Makefile does`);
  const budget = budgetOf(fields.takes);
  if (set === 'gate' && fields.takes && budget === null) out.push('"Takes:" names no budget ("budget N s on CI")');
  if (set === 'gate' && budget > GATE_BUDGET_MAX) out.push(`"Takes:" budgets ${budget} s, over the gate's ${GATE_BUDGET_MAX} s: split it or move it to the long set`);
  // a budget below the test's own slowest recorded CI run would mark ordinary passes as over it
  const range = /\bon CI \((\d+) to (\d+)\)/i.exec(fields.takes || '');
  if (set === 'gate' && budget !== null && range && +range[2] > budget) out.push(`"Takes:" records up to ${range[2]} s on CI, over its ${budget} s budget: split it, or give it a budget its times fit`);
  return out;
}
