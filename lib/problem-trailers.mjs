// What a fix commit tells the problem register (docs/plans/problem-register.md, "Where entries come from"). A fix:
// commit's body ends with trailers: Player-facing and Found-by, which make dora already counts, and Kind, Found-at and,
// when its tests don't name one test, Signature. The register reads each fix commit as a closed entry fixed by itself;
// nothing is written to the events file for it.
import { basename } from 'node:path';
import { KIND, isStage, canonStage, REVIEWERS, FINDERS } from './problems.mjs';

// Found-by's fixed values are hq/lib/problems.mjs's FINDERS, kept as a list, since several reviewers often find one
// problem together.
export { FINDERS };

// How the free-text spellings before the fixed values read (77 on main by 11 October), each pattern with the value it
// gives. Who appears earlier in the text comes first.
const ALIASES = [
  [new RegExp(`\\b(${REVIEWERS.join('|')})\\b`, 'g'), m => m[1]],
  [/\bdrew\b|\bthe person you work with\b|^you$/g, () => 'you'],
  [/^someone-else$/g, () => 'someone-else'],
  [/\b(laptop gate|pr gate|the gate|^gate$)/g, () => 'gate'],
  [/^(nightly|prod-smoke|players)$/g, m => m[1]],
  [/\bfm-[\w-]+|\bconsent-fixer\b|\bclaude code\b|\bthe lead\b|\blead's\b|\bsdk-local\b|^builder$/g, () => 'builder'],
];
// a named test at the start, as `smoke-link (trace)` or the fixed `test:smoke-link`
const TEST_FIRST = /^(?:test:)?((?:smoke|walk|load|screen|viz)-[\w-]+|[\w-]+\.test\.m?js)\b/;

export function findersOf(text) {
  const t = String(text || '').trim().toLowerCase(), found = [];
  const named = TEST_FIRST.exec(t);
  if (named) found.push([0, `test:${named[1]}`]);
  for (const [re, value] of ALIASES) for (const m of t.matchAll(re)) found.push([m.index + 1, value(m)]);
  // anyone else named by a first name alone, as a part of the list ("..., cold review, <name>"): no names are kept here,
  // since HQ's demo keeps people's names off every page, this file's included
  let at = 0;
  for (const part of String(text || '').split(/,| and /)) {
    const word = part.trim();
    if (/^[A-Z][a-z]+$/.test(word) && !REVIEWERS.includes(word.toLowerCase()) && word.toLowerCase() !== 'drew') found.push([String(text).indexOf(word, at) + 1, 'someone-else']);
    at += part.length + 1;
  }
  // an unnamed review, as "review (testing team)", when nothing else says who
  if (!found.length && /\breview(er)?\b/.test(t)) found.push([0, 'reviewer']);
  return [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, v]) => v))];
}

const trailer = (body, key) => { const m = new RegExp(`^${key}:[ \\t]*(.+)$`, 'mi').exec(body || ''); return m ? m[1].trim() : null; };

// A commit body's trailers as the register's values: { playerFacing, finders, kind, foundAt, signature, problems }, a
// value the register does not have left null and named in problems.
export function trailersOf(body) {
  const problems = [], pf = trailer(body, 'Player-facing'), kind = trailer(body, 'Kind'), foundAt = trailer(body, 'Found-at');
  if (kind && !Object.hasOwn(KIND, kind)) problems.push(`Kind: ${kind} is not a kind (HQ's eight kinds)`);
  if (foundAt && !isStage(foundAt)) problems.push(`Found-at: ${foundAt} is not a stage (the pipeline file's stages, or HQ's own five)`);
  const by = trailer(body, 'Found-by');
  return {
    playerFacing: pf && /^yes\b/i.test(pf) ? true : pf && /^no\b/i.test(pf) ? false : null,
    finders: by ? findersOf(by) : [],
    kind: kind && Object.hasOwn(KIND, kind) ? kind : null,
    foundAt: foundAt && isStage(foundAt) ? canonStage(foundAt) : null,
    signature: trailer(body, 'Signature'),
    problems,
  };
}

// The test a change is about: a browser test (tests/<name>.js) by its name, a unit or rules test by its path. Helpers
// are not tests, nor is anything in a folder below (fixtures and the like), which the patterns never reach.
function testOf(file) {
  if (/(^|\/)helpers\.js$|-helpers\.js$/.test(file)) return null;
  if (/^tests\/unit\/[\w.-]+\.test\.mjs$/.test(file) || /^tests\/[\w.-]+\.test\.js$/.test(file)) return file;
  if (/^tests\/[\w-]+\.js$/.test(file)) return basename(file, '.js');
  return null;
}

// A fix's signature: its Signature trailer, else the one test the fix or its failing-test commit changed, else null.
export function signatureOf({ files = [], trailer: given = null }) {
  if (given) return given;
  const tests = [...new Set(files.map(testOf).filter(Boolean))];
  return tests.length === 1 ? tests[0] : null;
}

// A fix commit as a closed entry, fixed by itself. files: what it and its failing-test commit changed.
export function fixEntry({ sha, at, subject, body, files = [] }) {
  const t = trailersOf(body);
  return {
    id: `F-${String(sha).slice(0, 8)}`, source: 'git', title: subject, kind: t.kind, signature: signatureOf({ files, trailer: t.signature }), foundAt: t.foundAt,
    foundBy: t.finders, playerFacing: t.playerFacing, fix: sha, openedAt: at, closedAt: at, status: 'closed', disposition: 'fixed', record: 'live', problems: t.problems, events: [],
  };
}
