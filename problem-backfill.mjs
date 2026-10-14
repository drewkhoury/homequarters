// Backfill step 1 of the problem register (docs/plans/problem-register.md, Backfill): imports another session's sort of
// red gate runs, ~/.cache/questkeep/problems/backfill/red-gates.jsonl, one line per red gate run with its verdict, kind,
// mode, factors, confidence, evidence and fix. Reds of one test and kind become one entry, with its commonest mode, its
// latest fix and the runs it was judged from (it owns its reds in them), written through
// hq/problem.mjs's eventFor as record backfill, so every field meets the writer's checks, and closed as fixed when
// a fix commit is named and the close is allowed. Lines that are not problems (dirty, red-first, planted) open nothing.
// Importing again reconciles (reconcile below): an entry already in the register with the same kind and signature gets
// only what changed, and one the sort no longer makes is merged into the entry that took its runs, so importing twice
// adds nothing.
// Usage: node hq/problem-backfill.mjs red-gates [<file>] [--write]   (without --write it says what it would write)
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KINDS, FACTORS, fold, stageOfResult } from './lib/problems.mjs';
import { privacyContext } from './lib/problem-privacy.mjs';
import { eventFor } from './problem.mjs';

const KIND_BY_LABEL = Object.fromEntries(KINDS.map(([k, label]) => [label.toLowerCase(), k]));
const FACTOR_BY_LABEL = Object.fromEntries(FACTORS.flatMap(([k, label]) => [[label.toLowerCase(), k], [k, k]]));
const PROBLEMS = new Set(['code', 'flaky', 'infra']);

// The entries a sort's lines make: [{ key, note, close }], note the fields of the opened event and close those of the
// closed one, or null. infraSig(run): the signature of a run's infra red (hq/lib/problem-observations.mjs), or null;
// keyOf: testKeyer's naming of a test.
export function entriesFromRedGates(lines, { infraSig = () => null, keyOf = (task, name) => name } = {}) {
  const groups = new Map();
  for (const l of lines) {
    if (!PROBLEMS.has(l.verdict)) continue;
    const kind = KIND_BY_LABEL[String(l.kind || '').toLowerCase()];
    if (!kind) continue;
    // each test named as reds and fix commits name it (testKeyer): the sort names unit tests by their titles
    const sigs = l.tests && l.tests.length ? l.tests.map(t => keyOf(null, t)) : [infraSig(l.run) || `task:${l.runKind}`];
    for (const signature of sigs) {
      const key = [kind, signature].join('|');
      const g = groups.get(key) || { kind, signature, lines: [] };
      g.lines.push(l);
      groups.set(key, g);
    }
  }
  return [...groups.entries()].map(([key, g]) => {
    const byTime = [...g.lines].sort((a, b) => Date.parse(a.when) - Date.parse(b.when)), first = byTime[0];
    const modes = {}; for (const l of g.lines) if (l.mode) modes[l.mode] = (modes[l.mode] || 0) + 1;
    g.mode = Object.keys(modes).sort((a, b) => modes[b] - modes[a] || (a === 'unknown') - (b === 'unknown'))[0] || null;
    g.fix = [...byTime].reverse().find(l => l.fix)?.fix || null;
    const runs = [...new Set(byTime.map(l => l.run))];
    const factors = [...new Set(g.lines.flatMap(l => l.factors || []).map(f => FACTOR_BY_LABEL[String(f).toLowerCase()]).filter(Boolean))].slice(0, 3);
    const label = KINDS.find(([k]) => k === g.kind)[1];
    // the stage the pipeline file gives a gate run from that place (a CI gate is the PR gate), when every red is from one
    const stages = new Set(g.lines.map(l => stageOfResult(l.source, l.runKind)));
    const foundAt = stages.size === 1 && [...stages][0] ? [...stages][0] : undefined;
    const note = {
      title: `${label} in ${g.signature}${g.mode && g.mode !== 'unknown' ? ` (${g.mode})` : ''}`, kind: g.kind, ...(g.mode ? { mode: g.mode } : {}), signature: g.signature,
      ...(factors.length ? { factors } : {}), ...(foundAt ? { foundAt } : {}),
      confidence: g.lines.some(l => l.confidence === 'confirmed') ? 'confirmed' : 'suspected',
      evidence: `${g.lines.length} red gate run${g.lines.length === 1 ? '' : 's'}, the first ${first.run}`, seenFrom: first.when, record: 'backfill', ...(g.fix ? { fix: g.fix } : {}), runs,
    };
    return { key: createHash('sha1').update(key).digest('hex').slice(0, 6), note, close: g.fix ? { disposition: 'fixed', fix: g.fix } : null };
  });
}

// What importing the sort again writes, given the register's entries (fold's): [{ op: 'note', plan } | { op: 'set' or
// 'close', id, fields } | { op: 'merge', id, into } | { op: 'left', id, why }]. A planned entry is matched to the
// backfilled entry of its kind and test; only fields that changed are set, and it is closed when its fix is new to it. A
// backfilled entry the sort no longer makes is merged into the entry holding most of its runs: an id, or { key } for one
// this import opens. Live entries, and merged or dropped ones, are never touched.
const COMPARED = ['title', 'mode', 'factors', 'foundAt', 'confidence', 'evidence', 'seenFrom', 'fix', 'runs'];
const differs = (a, b) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
export function reconcile(planned, entries) {
  const mine = entries.filter(p => p.record === 'backfill' && p.status !== 'merged' && p.status !== 'dropped');
  const notes = [], changes = [], held = [];
  for (const e of planned) {
    const p = mine.find(x => x.kind === e.note.kind && x.signature === e.note.signature);
    held.push({ runs: new Set(e.note.runs), into: p ? p.id : { key: e.key }, matched: p });
    if (!p) { notes.push({ op: 'note', plan: e }); continue; }
    const fields = Object.fromEntries(COMPARED.filter(k => Object.hasOwn(e.note, k) && differs(e.note[k], p[k])).map(k => [k, e.note[k]]));
    if (Object.keys(fields).length) changes.push({ op: 'set', id: p.id, fields });
    if (e.close && p.status !== 'closed') changes.push({ op: 'close', id: p.id, fields: e.close });
  }
  const merges = [];
  for (const p of mine) {
    if (held.some(h => h.matched === p)) continue;
    const best = held.map(h => ({ h, n: (p.runs || []).filter(r => h.runs.has(r)).length })).filter(x => x.n).sort((a, b) => b.n - a.n)[0];
    merges.push(best ? { op: 'merge', id: p.id, into: best.h.into } : { op: 'left', id: p.id, why: 'no entry of the sort holds any of its runs' });
  }
  return [...notes, ...changes, ...merges];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { allRuns } = await import('./lib/runs.mjs');
  const { observeReds, testKeyer } = await import('./lib/problem-observations.mjs');
  const { catalogue } = await import('./lib/catalogue.mjs');
  const keyOf = testKeyer(catalogue(join(new URL('..', import.meta.url).pathname)));
  const [cmd, fileArg] = process.argv.slice(2).filter(a => !a.startsWith('--')), write = process.argv.includes('--write');
  if (cmd !== 'red-gates') { console.error('Usage: node hq/problem-backfill.mjs red-gates [<file>] [--write]'); process.exit(2); }
  const cache = join(homedir(), '.cache', 'questkeep'), dir = process.env.QK_PROBLEMS_DIR || join(cache, 'problems'), events = join(dir, 'events.jsonl');
  const file = fileArg || join(cache, 'problems', 'backfill', 'red-gates.jsonl');
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const infra = new Map(observeReds(allRuns(cache), { keyOf }).filter(o => o.class === 'infra').map(o => [o.run, o.sig]));
  const planned = entriesFromRedGates(lines, { infraSig: run => infra.get(run) || null, keyOf });
  let have = []; try { have = readFileSync(events, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* none yet */ }
  const ctx = privacyContext({ cache }), by = 'backfill', counts = { opened: 0, closed: 0, set: 0, merged: 0, left: 0, refused: 0, leftOpen: 0 };
  const put = out => { if (write) { mkdirSync(dir, { recursive: true }); for (const ev of out) appendFileSync(events, JSON.stringify(ev) + '\n'); } have.push(...out); };
  const acts = reconcile(planned, fold(have).entries), opened = new Map(); // a new entry's key, to its id
  for (const a of acts) {
    if (a.op === 'note') {
      const e = a.plan, note = eventFor('note', e.note, { events: have, now: new Date(), by, ctx, rand: () => e.key });
      if (note.refused) { counts.refused++; console.log(`Not written (${e.note.title}): ${note.refused.join('; ')}`); continue; }
      const out = [note.event];
      if (e.close) {
        const closed = eventFor('close', { id: note.event.id, ...e.close }, { events: [...have, note.event], now: new Date(), by, ctx });
        if (closed.event) out.push(closed.event); else { counts.leftOpen++; console.log(`Left open (${e.note.title}): ${closed.refused.join('; ')}`); }
      }
      put(out); opened.set(e.key, note.event.id);
      counts.opened++; if (out.length > 1) counts.closed++;
      continue;
    }
    if (a.op === 'left') { counts.left++; console.log(`Left as it is (${a.id}): ${a.why}`); continue; }
    const into = a.op === 'merge' && (typeof a.into === 'string' ? a.into : opened.get(a.into.key));
    if (a.op === 'merge' && !into) { counts.refused++; console.log(`Not merged (${a.id}): the entry it would merge into was not written`); continue; }
    // only a backfilled entry says when its problem was first seen
    const opts = a.op === 'merge' ? { id: a.id, into } : { id: a.id, ...a.fields, ...(a.fields.seenFrom ? { record: 'backfill' } : {}) };
    const r = eventFor(a.op, opts, { events: have, now: new Date(), by, ctx });
    if (r.refused) { counts.refused++; console.log(`Not written (${a.op} ${a.id}): ${r.refused.join('; ')}`); continue; }
    put([r.event]);
    counts[{ set: 'set', close: 'closed', merge: 'merged' }[a.op]]++;
  }
  const changed = new Set(acts.filter(a => a.op === 'set' || a.op === 'close').map(a => a.id)).size;
  console.log(`${write ? 'Wrote' : 'Would write'} ${counts.opened} new entries, ${counts.set} sets, ${counts.closed} closes as fixed (${counts.leftOpen} left open), ${counts.merged} merges; ${planned.length - counts.opened - counts.refused - changed} entries already as the sort says, ${counts.left} left as they are, ${counts.refused} refused, from ${lines.length} lines of ${file}${write ? ` to ${events}` : '; --write writes them'}.`);
}
