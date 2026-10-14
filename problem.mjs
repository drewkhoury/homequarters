// The problem register's writer, and the only way into it (docs/plans/problem-register.md). Each command appends one
// event, as one whole line, to events.jsonl in QK_PROBLEMS_DIR (~/.cache/questkeep/problems when unset), the way the
// lock log is written, so many sessions can write at once and nothing is ever read, changed and written back. HQ's
// Problems page reads the file through hq/lib/problems.mjs.
// The writer stamps the time, takes only the fields the register defines with values from its vocabulary, puts every
// free-text field through hq/lib/problem-privacy.mjs, and refuses any event the reader would not place. Evidence is a
// pointer (a run id, a file and line, a commit, feedback/<id>), never copied text.
// Usage:
//   node hq/problem.mjs note --title <one line> --kind <kind> --evidence <pointer> [--signature, --mode, --factors a,b,
//        --found-at, --found-by, --should-have-caught-at, --player-facing yes|no, --effect, --guard-type, --guard,
//        --believed, --actual, --fix, --repeat-of, --confidence, --record]
//   node hq/problem.mjs set <id> [--status fixing] [the same fields]
//   node hq/problem.mjs close <id> --disposition <disposition> [the same fields]
//   node hq/problem.mjs reopen <id>
//   node hq/problem.mjs merge <id> --into <id>
//   node hq/problem.mjs redact <id> --fields <field,field>
// The kinds, modes, stages, factors and dispositions are in hq/lib/problems.mjs. A refusal writes nothing and exits 1.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FIELDS, fold, STAGE, KIND } from './lib/problems.mjs';
import { textProblems, privacyContext, pointsAt, citesReport } from './lib/problem-privacy.mjs';

const FIELD_NAMES = Object.keys(FIELDS);
const OPTIONS = {
  note: FIELD_NAMES,
  set: ['id', 'status', ...FIELD_NAMES],
  close: ['id', 'disposition', ...FIELD_NAMES],
  reopen: ['id'],
  merge: ['id', 'into'],
  redact: ['id', 'fields'],
};
const EV = { note: 'opened', set: 'set', close: 'closed', reopen: 'reopened', merge: 'merged-into', redact: 'redacted' };
// a problem found this late, or by a reviewer or the person, is closed only with where it should have been caught
const LATE_FINDERS = new Set(['reviewer', 'person', ...Object.keys(STAGE).filter(k => STAGE[k].i >= STAGE.merge.i)]);
const kebab = s => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// The command line as { cmd, opts }: an entry's id first where the command takes one, then --name value pairs, named
// as the register names its fields (--found-at is foundAt).
export function parseArgs(argv) {
  const [cmd, ...rest] = argv, opts = {};
  if (rest[0] && !rest[0].startsWith('--')) opts.id = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const name = camel(rest[i].slice(2));
    opts[name] = rest[i + 1] !== undefined && !rest[i + 1].startsWith('--') ? rest[++i] : '';
  }
  return { cmd, opts };
}

// An option's text as the field's value: a list for factors, true or false for player-facing.
function valueOf(name, v) {
  if (FIELDS[name].list) return String(v).split(',').map(s => s.trim()).filter(Boolean);
  if (name === 'playerFacing') return v === 'yes' ? true : v === 'no' ? false : v;
  return v;
}


// The event a command writes, or why it may not: { event } or { refused: [reasons] }. events: the file as it is; now,
// by and rand: the time, who writes, and four random hex digits for a new id; ctx: the privacy check's context.
export function eventFor(cmd, opts, { events = [], now = new Date(), by = 'someone', ctx, rand = () => randomBytes(3).toString('hex') }) {
  const allowed = OPTIONS[cmd];
  if (!allowed) return { refused: [`no command ${cmd}: ${Object.keys(OPTIONS).join(', ')}`] };
  const refused = Object.keys(opts).filter(k => !allowed.includes(k)).map(k => `no option --${kebab(k)} for ${cmd}`);
  if (cmd !== 'note' && !opts.id) refused.push(`${cmd} needs the entry's id`);
  const entry = opts.id ? fold(events).entries.find(p => p.id === opts.id) : null;
  if (cmd !== 'note' && opts.id && !entry) return { refused: [`${opts.id} was never opened`] };
  const fields = {};
  for (const name of FIELD_NAMES) {
    if (!Object.hasOwn(opts, name) || !allowed.includes(name)) continue;
    const f = FIELDS[name], v = valueOf(name, opts[name]);
    const kind = Object.hasOwn(opts, 'kind') ? opts.kind : entry && entry.kind;
    const fine = f.list ? Array.isArray(v) && v.length > 0 && v.length <= f.max && v.every(f.list) : f.valid(v, { kind });
    if (!fine) { refused.push(`${name}: ${JSON.stringify(opts[name]).slice(0, 40)} is not a value it takes (hq/lib/problems.mjs)`); continue; }
    if (name === 'seenFrom' && opts.record !== 'backfill') { refused.push('seenFrom: only a backfilled entry (--record backfill) says when its problem was first seen'); continue; }
    const leaks = f.text ? textProblems(v, ctx) : [];
    if (name === 'evidence' && !pointsAt(v)) leaks.push('it names no pointer: a run id, a file and line, a commit, feedback/<id> or a pull request');
    if (name === 'evidence' && (opts.foundAt || (entry && entry.foundAt)) === 'players' && !citesReport(v)) leaks.push('a problem players found cites their report, feedback/<id>, or the fix commit, never their words');
    if (leaks.length) { refused.push(`${name}: ${leaks.join('; ')}`); continue; }
    fields[name] = v;
  }
  // the writer's own name meets the same checks as any text
  if (typeof by !== 'string' || !/^[\w .:-]{1,40}$/.test(by)) refused.push('by: the writer is named in at most 40 letters, digits, spaces, dots, colons and dashes');
  else { const leaks = textProblems(by, ctx); if (leaks.length) refused.push(`by: ${leaks.join('; ')}`); }
  const base = { at: now.toISOString(), ev: EV[cmd] };
  let event;
  if (cmd === 'note') {
    for (const need of ['title', 'kind', 'evidence']) if (!Object.hasOwn(opts, need)) refused.push(`a note needs --${need}`);
    // never words of the title, which a redaction could not take back from every link and export
    event = { ...base, id: `P-${base.at.slice(0, 10)}-${Object.hasOwn(KIND, opts.kind) ? opts.kind : 'problem'}-${rand()}`, by, fields: { ...fields, record: fields.record || 'live' } };
  } else if (cmd === 'set') {
    event = { ...base, id: opts.id, by, fields: { ...fields, ...(Object.hasOwn(opts, 'status') ? { status: opts.status } : {}) } };
  } else if (cmd === 'close') {
    const foundAt = fields.foundAt || (entry && entry.foundAt);
    if (LATE_FINDERS.has(foundAt) && !fields.shouldHaveCaughtAt && !(entry && entry.shouldHaveCaughtAt)) {
      refused.push(`found at ${foundAt}, so closing it needs --should-have-caught-at (shouldHaveCaughtAt): the stage that should have caught it`);
    }
    event = { ...base, id: opts.id, by, fields: { ...(opts.disposition ? { disposition: opts.disposition } : {}), ...fields } };
  } else if (cmd === 'reopen') event = { ...base, id: opts.id, by };
  else if (cmd === 'merge') event = { ...base, id: opts.id, into: opts.into, by };
  else if (cmd === 'redact') {
    const names = String(opts.fields || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!names.length || names.some(n => !Object.hasOwn(FIELDS, n))) refused.push(`--fields names fields the register defines: ${FIELD_NAMES.join(', ')}`);
    event = { ...base, id: opts.id, by, fields: names };
  }
  if (refused.length) return { refused };
  // the new event is the newest, so a refusal of it is the last one the reader makes
  const before = fold(events).notPlaced.length, after = fold([...events, event]).notPlaced;
  return after.length > before ? { refused: [after.at(-1).why] } : { event };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env, dir = env.QK_PROBLEMS_DIR || join(homedir(), '.cache', 'questkeep', 'problems'), file = join(dir, 'events.jsonl');
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (!cmd || !OPTIONS[cmd]) { console.error('Usage: node hq/problem.mjs note|set|close|reopen|merge|redact ... (the file\'s header says more)'); process.exit(2); }
  let events = [];
  try { events = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* none yet */ }
  // who writes: the agent that names itself, else the Claude session, else the person at the terminal
  const by = env.QK_AGENT || (env.CLAUDE_CODE_SESSION_ID ? `session ${env.CLAUDE_CODE_SESSION_ID.slice(0, 8)}` : 'person');
  const r = eventFor(cmd, opts, { events, now: new Date(), by, ctx: privacyContext({ home: homedir() }) });
  if (r.refused) { console.error(`Not written:\n${r.refused.map(x => `  ${x}`).join('\n')}`); process.exit(1); }
  mkdirSync(dir, { recursive: true });
  appendFileSync(file, JSON.stringify(r.event) + '\n');
  console.log(`${{ opened: 'Noted', set: 'Set', closed: 'Closed', reopened: 'Reopened', 'merged-into': 'Merged', redacted: 'Redacted' }[r.event.ev]} ${r.event.id}`);
}
