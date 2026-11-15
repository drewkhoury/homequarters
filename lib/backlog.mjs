// The backlog: one markdown file per item in docs/backlog/<stage>/, and its history, rebuilt from git. Before the
// items were files they were lines in docs/BACKLOG.md, so that file's history is read too: each entry is followed from
// the commit that added it, through its edits and renames, to the commit that took it off. The pure functions here
// take text and answer data, so the unit tests can feed them; the git ones at the bottom read the repo.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { runGit, runGitIn } from './git.mjs';

export let DIR = 'docs/backlog';
export let MAP = 'hq/backlog-map.json';
// A commit "ships" an item when it changes something besides docs; the backlog's own bookkeeping (the map of old titles)
// counts as docs, so taking an item off together with a map entry is not a ship.
export const isDocs = f => f.startsWith('docs/') || f === MAP;
export let OLD_FILE = 'docs/BACKLOG.md';
export let STAGES = ['inbox', 'next', 'parked'];
// The manifest's backlog key, applied once when HQ starts (lib/manifest.mjs): where the items, the map of old titles and
// the earlier one-file backlog live, as paths from the repo root.
export function configureBacklog({ rel, mapRel, earlierRel, stages } = {}) {
  if (rel) DIR = rel; if (mapRel) MAP = mapRel; if (earlierRel) OLD_FILE = earlierRel; if (Array.isArray(stages) && stages.length) STAGES = stages;
}
export const TYPES = ['bug', 'feature', 'chore', 'question'];
export const MAX_WORDS = 150;
export const MAX_INBOX = 10;

const words = s => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’`._/-]*/gu) || []);

// One item's file: the frontmatter's fields, the title from its first heading, and the rest as the body.
export function parseItem(text, { slug, stage } = {}) {
  const src = String(text).replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  const fields = {};
  if (m) for (const line of m[1].split('\n')) { const f = /^([\w-]+):\s*(.*)$/.exec(line); if (f) fields[f[1]] = f[2].trim(); }
  const rest = m ? src.slice(m[0].length) : src;
  const t = /^#\s+(.+)$/m.exec(rest);
  const body = t ? rest.slice(t.index + t[0].length).trim() : rest.trim();
  const asked = /^(.*?),\s*(\d{1,2} \w{3})$/.exec(fields.asked || '');
  return {
    slug, stage, fields, title: t ? t[1].trim() : '', body,
    type: fields.type || '', asked: fields.asked || '', askedBy: asked ? asked[1] : fields.asked || '', askedOn: asked ? asked[2] : '',
    blockedBy: (fields['blocked-by'] || '').split(',').map(s => s.trim()).filter(Boolean),
    plan: fields.plan || '', words: words(body).length, hasFrontmatter: !!m,
    doneWhen: /^Done when:\s*(.+)$/m.exec(body)?.[1] || '', hurts: /^Hurts today:\s*(.+)$/m.exec(body)?.[1] || '',
  };
}

// Every item on disk, each stage's files in name order.
export function loadItems(repo) {
  const out = [];
  for (const stage of STAGES) {
    const dir = join(repo, DIR, stage);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
      out.push({ ...parseItem(readFileSync(join(dir, f), 'utf8'), { slug: f.slice(0, -3), stage }), path: `${DIR}/${stage}/${f}` });
    }
  }
  return out;
}

// What the README promises every item keeps to. Answers one line per problem, naming the file.
export function check(items) {
  const problems = [], slugs = new Map();
  for (const it of items) {
    const where = it.path || `${it.stage}/${it.slug}`;
    if (slugs.has(it.slug)) problems.push(`${where}: the same name as ${slugs.get(it.slug)}`);
    slugs.set(it.slug, where);
    if (!it.hasFrontmatter) problems.push(`${where}: no frontmatter`);
    if (!TYPES.includes(it.type)) problems.push(`${where}: type is "${it.type}", not one of ${TYPES.join(', ')}`);
    if (!it.asked) problems.push(`${where}: no asked (who, when)`);
    if (!it.title) problems.push(`${where}: no title`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(it.slug)) problems.push(`${where}: the file name is not lower-case words joined by hyphens`);
    if (it.words > MAX_WORDS) problems.push(`${where}: ${it.words} words, over ${MAX_WORDS}; the detail belongs in docs/plans/`);
  }
  for (const it of items) for (const b of it.blockedBy) if (!slugs.has(b)) problems.push(`${it.path || it.slug}: blocked by ${b}, which is not an item`);
  const inbox = items.filter(i => i.stage === 'inbox').length;
  if (inbox > MAX_INBOX) problems.push(`${DIR}/inbox: ${inbox} items, over ${MAX_INBOX}; sort some into next or parked`);
  return problems;
}

// An item is ready when nothing still on the list blocks it.
export const openBlockers = (item, items) => item.blockedBy.filter(b => items.some(i => i.slug === b));

// "feat(rules)!: ..." → 'feat'. Only the Conventional Commits types count: the first days' subjects began with words
// like "Backlog:" or "Docs:".
export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'ci', 'chore', 'perf', 'build', 'revert'];
export const commitType = subject => { const t = /^([a-z]+)(?:\([^)]*\))?!?:/.exec(String(subject))?.[1] || ''; return COMMIT_TYPES.includes(t) ? t : ''; };

// ---- The old file, docs/BACKLOG.md ----

// Its entries: a list line that opens with a bold title, "- **Title.** body" or "12. **Title.** body".
export function parseOldEntries(text) {
  const out = [];
  let section = '';
  for (const line of String(text).split('\n')) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    const m = /^(?:- |(\d+)\.\s+)\*\*(.+?)\*\*(.*)$/.exec(line);
    if (m) out.push({ title: m[2].replace(/[.:]\s*$/, '').trim(), body: m[3].trim(), section, n: m[1] ?? null });
  }
  return out;
}

export const normTitle = t => String(t).toLowerCase().replace(/[`*_"“”]/g, '').replace(/[.:,!?]+$/, '').replace(/\s+/g, ' ').trim();
const bag = s => new Set(words(String(s).toLowerCase()).filter(w => w.length > 3));
// How alike two entries are, 0 to 1, by the words they share. The ranked lists kept an entry's number while its
// words changed, so the same number in the same section counts for a lot; but a number was also given to a new entry
// the moment the old one shipped, so it still needs some words in common.
function likeness(a, b) {
  const x = bag(`${a.title} ${a.body}`), y = bag(`${b.title} ${b.body}`);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  const j = both / (x.size + y.size - both);
  return a.n != null && a.n === b.n && a.section === b.section && j >= 0.12 ? Math.max(j, 0.9) : j;
}

// Follows every entry through the file's versions, oldest first. Each version is { sha, date, subject, author,
// shipped, text }, shipped meaning the commit changed something besides docs. An entry whose title vanishes in the
// same commit that a new title with much the same words appears is taken as renamed, so it keeps its history.
// Answers one lineage per entry ever listed: its titles, the events (added, edited, renamed, closed) and whether it
// is still there at the last version.
export function followOld(versions, { rename = 0.35 } = {}) {
  const lineages = [];
  let live = new Map(); // normalised title → { lineage, entry }
  const gone = new Map(); // normalised title → a lineage taken off earlier, so an entry put back keeps its history
  for (const v of versions) {
    const ev = kind => ({ kind, sha: v.sha, date: v.date, subject: v.subject, type: commitType(v.subject), shipped: !!v.shipped });
    const now = parseOldEntries(v.text), next = new Map();
    const fresh = [];
    for (const e of now) {
      const k = normTitle(e.title), was = live.get(k);
      if (was && !next.has(k)) {
        if (was.entry.body !== e.body) was.lineage.events.push(ev('edited'));
        next.set(k, { lineage: was.lineage, entry: e });
      } else if (!next.has(k)) fresh.push(e);
    }
    const left = [...live].filter(([k]) => !next.has(k)).map(([, x]) => x);
    // pair each new title with the most alike of the titles that went in this commit
    const pairs = [];
    for (const e of fresh) for (const g of left) { const s = likeness(e, g.entry); if (s >= rename) pairs.push({ e, g, s }); }
    pairs.sort((a, b) => b.s - a.s);
    const usedE = new Set(), usedG = new Set();
    for (const { e, g } of pairs) {
      if (usedE.has(e) || usedG.has(g)) continue;
      usedE.add(e); usedG.add(g);
      g.lineage.titles.push(e.title);
      g.lineage.events.push({ ...ev('renamed'), from: g.entry.title, to: e.title });
      next.set(normTitle(e.title), { lineage: g.lineage, entry: e });
    }
    for (const e of fresh.filter(e => !usedE.has(e))) {
      const back = gone.get(normTitle(e.title));
      if (back) { gone.delete(normTitle(e.title)); back.events.push(ev('reopened')); back.open = true; next.set(normTitle(e.title), { lineage: back, entry: e }); continue; }
      const lineage = { titles: [e.title], section: e.section, events: [ev('added')], open: true, body: e.body };
      lineages.push(lineage);
      next.set(normTitle(e.title), { lineage, entry: e });
    }
    for (const g of left.filter(g => !usedG.has(g))) {
      g.lineage.events.push(ev('closed')); g.lineage.open = false;
      for (const t of g.lineage.titles) gone.set(normTitle(t), g.lineage);
    }
    for (const x of next.values()) { x.lineage.body = x.entry.body; x.lineage.section = x.entry.section; }
    live = next;
  }
  return lineages;
}

// ---- Since the move to files ----

// `git log --name-status` over docs/backlog, oldest first, as { sha, date, subject, files: [{ status, path, from }] }.
export function parseNameStatusLog(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('\x01')) {
      const [sha, date, author, ...subject] = line.slice(1).split('\t');
      cur = { sha, date, author, subject: subject.join('\t'), files: [] }; out.push(cur);
    } else if (cur && line.trim()) {
      const [status, a, b] = line.split('\t');
      if (status.startsWith('R')) cur.files.push({ status: 'R', path: b, from: a });
      else cur.files.push({ status: status[0], path: a });
    }
  }
  return out.reverse();
}

// docs/backlog/next/some-item.md → { stage: 'next', slug: 'some-item' }, anything else → null.
export function itemPath(p) {
  const m = /^docs\/backlog\/([a-z]+)\/([^/]+)\.md$/.exec(String(p || ''));
  return m && STAGES.includes(m[1]) ? { stage: m[1], slug: m[2] } : null;
}

// The events each item's file saw, by slug. A file added in the commit that removed the old file came across from
// it, so that is "moved to a file", not a new item. A file moved between stages keeps its slug.
export function followFiles(commits, { oldFile = OLD_FILE } = {}) {
  const bySlug = new Map();
  const add = (slug, e) => { if (!bySlug.has(slug)) bySlug.set(slug, []); bySlug.get(slug).push(e); };
  for (const c of commits) {
    const migration = c.files.some(f => f.path === oldFile && f.status === 'D');
    const shipped = c.files.some(f => !isDocs(f.path));
    const base = { sha: c.sha, date: c.date, subject: c.subject, type: commitType(c.subject), shipped };
    for (const f of c.files) {
      const to = itemPath(f.path);
      if (!to) continue;
      if (f.status === 'A') add(to.slug, { ...base, kind: migration ? 'migrated' : 'added', stage: to.stage });
      else if (f.status === 'M') add(to.slug, { ...base, kind: 'edited', stage: to.stage });
      else if (f.status === 'D') add(to.slug, { ...base, kind: 'closed', stage: to.stage });
      else if (f.status === 'R') {
        const from = itemPath(f.from);
        add(to.slug, { ...base, kind: from && from.slug === to.slug ? 'moved' : 'renamed', stage: to.stage, fromStage: from?.stage });
      }
    }
  }
  return bySlug;
}

// Ties the two histories together into one record per item ever listed, open or closed. `map` is
// hq/backlog-map.json: which file each of the old file's entries became.
export function joinHistory({ items, lineages, fileEvents, map = [] }) {
  const slugOf = new Map(map.map(m => [normTitle(m.old), m.slug]));
  const records = new Map();
  const rec = slug => { if (!records.has(slug)) records.set(slug, { slug, titles: [], events: [], item: null }); return records.get(slug); };
  let n = 0;
  for (const l of lineages) {
    const slug = l.titles.map(t => slugOf.get(normTitle(t))).find(Boolean) || `old-${++n}`;
    const r = rec(slug);
    r.titles.push(...l.titles);
    r.events.push(...l.events.map(e => ({ ...e, era: 'file' })));
    if (!r.section) r.section = l.section;
    if (!r.oldBody) r.oldBody = l.body;
  }
  for (const [slug, evs] of fileEvents) rec(slug).events.push(...evs.map(e => ({ ...e, era: 'item' })));
  for (const it of items) { const r = rec(it.slug); r.item = it; if (!r.titles.includes(it.title)) r.titles.push(it.title); }
  for (const r of records.values()) {
    // a merged entry's close in the old file is not the item closing: the item still exists
    r.events.sort((a, b) => a.date.localeCompare(b.date));
    const first = r.events.find(e => e.kind === 'added') || r.events[0];
    r.added = first ? first.date : null;
    r.open = !!r.item;
    const lastClose = [...r.events].reverse().find(e => e.kind === 'closed' || e.kind === 'reopened');
    r.closed = r.open || lastClose?.kind !== 'closed' ? null : lastClose;
    r.title = r.item?.title || r.titles[r.titles.length - 1] || r.slug;
    r.type = r.item?.type || guessType(r);
  }
  return [...records.values()];
}

// A closed entry from before the files has no type field, so it takes the type of the commit that closed it.
function guessType(r) {
  const t = r.closed?.type;
  return t === 'fix' ? 'bug' : t === 'feat' ? 'feature' : t && r.closed?.shipped ? 'chore' : '';
}

// Per day: how many items were added and closed, and how many were open at the day's end.
export function trend(records) {
  const days = new Map();
  const day = d => String(d).slice(0, 10);
  const bump = (d, k) => { const x = days.get(d) || { day: d, added: 0, closed: 0, shipped: 0 }; x[k]++; days.set(d, x); };
  for (const r of records) {
    if (r.added) bump(day(r.added), 'added');
    if (r.closed) { bump(day(r.closed.date), 'closed'); if (r.closed.shipped) bump(day(r.closed.date), 'shipped'); }
  }
  let open = 0;
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map(d => ({ ...d, open: (open += d.added - d.closed) }));
}

// The backlog's size in words at each day's end: the whole old file while there was one, then every item's title and
// body, for today. Answers [{ day, words }].
export function wordsOverTime(versions, items, today = new Date().toISOString()) {
  const byDay = new Map();
  for (const v of versions) byDay.set(String(v.date).slice(0, 10), words(v.text).length);
  if (items.length) byDay.set(today.slice(0, 10), items.reduce((n, i) => n + words(i.title).length + i.words, 0));
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, words: n }));
}

// For each open item, how many other open items finishing it would free, counting chains: if C waits on B and B on A,
// A frees two. Answers [{ slug, frees: [slugs] }], most first.
export function unblocks(items) {
  const open = new Set(items.map(i => i.slug));
  const waitsOn = new Map(items.map(i => [i.slug, i.blockedBy.filter(b => open.has(b))]));
  const freedBy = slug => {
    const out = new Set(), todo = [slug];
    while (todo.length) { const s = todo.pop(); for (const [x, bs] of waitsOn) if (bs.includes(s) && !out.has(x)) { out.add(x); todo.push(x); } }
    return [...out];
  };
  return items.map(i => ({ slug: i.slug, frees: freedBy(i.slug) })).filter(x => x.frees.length).sort((a, b) => b.frees.length - a.frees.length || a.slug.localeCompare(b.slug));
}

// How many entries each commit added, oldest first, from the records' 'added' events. Answers [{ sha, date, subject, n }].
export function arrivals(records) {
  const by = new Map();
  for (const r of records) {
    const e = r.events.find(x => x.kind === 'added');
    if (!e) continue;
    const a = by.get(e.sha) || { sha: e.sha, date: e.date, subject: e.subject, n: 0 };
    a.n++; by.set(e.sha, a);
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Per day since the move to files, how many items sat in each stage at the day's end. Answers [{ day, inbox, next, parked }].
export function stagesOverTime(records) {
  const days = new Map(), where = new Map();
  const evs = records.flatMap(r => r.events.filter(e => e.era === 'item').map(e => ({ ...e, slug: r.slug }))).sort((a, b) => a.date.localeCompare(b.date));
  for (const e of evs) {
    if (e.kind === 'closed') where.delete(e.slug); else if (e.stage) where.set(e.slug, e.stage);
    const d = { day: String(e.date).slice(0, 10), inbox: 0, next: 0, parked: 0 };
    for (const st of where.values()) d[st]++;
    days.set(d.day, d);
  }
  return [...days.values()];
}

// ---- Branches ----

// Which items a branch touches, from `git diff --name-status base...branch`: deleting an item's file is shipping it,
// changing it is working on it. Old-file changes on a branch that has not moved to files yet are named by title.
export function branchTouches(diffText) {
  const out = [];
  for (const line of String(diffText).split('\n')) {
    const [status, a, b] = line.split('\t');
    if (!status) continue;
    const p = itemPath(status.startsWith('R') ? b : a);
    if (!p) continue;
    out.push({ slug: p.slug, how: status[0] === 'D' ? 'shipping' : status[0] === 'A' ? 'adding' : status[0] === 'R' ? 'moving' : 'editing', stage: p.stage });
  }
  return out;
}

// ---- Reading git ----

// Many blobs in one git process: `git cat-file --batch` with one "<rev>:<path>" per line.
function catFiles(repo, specs) {
  return new Promise(resolve => {
    const p = spawn('git', ['cat-file', '--batch'], { cwd: repo, windowsHide: true });
    const chunks = [];
    p.stdout.on('data', d => chunks.push(d));
    p.on('error', () => resolve(specs.map(() => '')));
    p.on('close', () => {
      const buf = Buffer.concat(chunks), out = [];
      let at = 0;
      for (let i = 0; i < specs.length; i++) {
        const nl = buf.indexOf(10, at);
        if (nl < 0) { out.push(''); continue; }
        const head = buf.slice(at, nl).toString();
        const size = /^\S+ blob (\d+)$/.exec(head)?.[1];
        if (!size) { out.push(''); at = nl + 1; continue; }
        out.push(buf.slice(nl + 1, nl + 1 + +size).toString('utf8'));
        at = nl + 1 + +size + 1;
      }
      resolve(out);
    });
    p.stdin.end(specs.join('\n') + '\n');
  });
}

const SEP = '%x01%H%x09%cI%x09%an%x09%s';

// Every version the old file had, oldest first, with whether each commit changed more than docs.
export async function oldVersions(repo, git = runGit) {
  // --full-history: at a merge that keeps the old file deleted (a branch that moved to files, bringing main in), git's
  // usual simplification would skip every version main's side wrote, and the entries it added or took off with them
  const log = await git(['log', '--reverse', '--full-history', '--full-diff', '--name-only', `--format=${SEP}`, '--', OLD_FILE], repo);
  const commits = [];
  for (const line of log.split('\n')) {
    if (line.startsWith('\x01')) { const [sha, date, author, ...s] = line.slice(1).split('\t'); commits.push({ sha, date, author, subject: s.join('\t'), files: [] }); }
    else if (line.trim() && commits.length) commits.at(-1).files.push(line.trim());
  }
  const texts = await catFiles(repo, commits.map(c => `${c.sha}:${OLD_FILE}`));
  return commits.map((c, i) => ({ ...c, text: texts[i], shipped: c.files.some(f => !isDocs(f)) }))
    // the commit that deletes the old file has no version of it; its entries moved to files, which followFiles covers
    .filter(v => v.text);
}

export async function fileCommits(repo, git = runGit) {
  const log = await git(['log', '--full-diff', '--name-status', '-M', `--format=${SEP}`, '--', DIR, OLD_FILE], repo);
  const all = parseNameStatusLog(log);
  // keep the commit's files that are items, plus the old file's delete, which marks the migration
  return all.map(c => ({ ...c, shipped: c.files.some(f => !isDocs(f.path)), files: c.files }))
    .filter(c => c.files.some(f => itemPath(f.path) || itemPath(f.from) || f.path === OLD_FILE));
}

// The whole picture, kept until the repo's HEAD or any branch moves.
let memo = null;
export async function backlogHistory(repo, git = runGit) {
  const key = await git(['for-each-ref', '--format=%(objectname)', 'refs/heads', 'refs/remotes'], repo) + (await git(['rev-parse', 'HEAD'], repo));
  const items = loadItems(repo);
  const itemsKey = JSON.stringify(items.map(i => [i.slug, i.stage, i.words, i.type, i.blockedBy]));
  if (memo && memo.repo === repo && memo.key === key && memo.itemsKey === itemsKey) return memo.value;
  const [versions, commits] = await Promise.all([oldVersions(repo, git), fileCommits(repo, git)]);
  let map = [];
  try { map = JSON.parse(readFileSync(join(repo, MAP), 'utf8')); } catch { /* none yet */ }
  const records = joinHistory({ items, lineages: followOld(versions), fileEvents: followFiles(commits), map });
  const value = { items, records, trend: trend(records), problems: check(items), words: wordsOverTime(versions, items) };
  memo = { repo, key, itemsKey, value };
  return value;
}

// What a branch still on the old file does to its entries: the base's entries against the branch's. An entry it
// takes off is being shipped; one whose words it changes is being worked on. Answers [{ title, how }].
export function oldTouches(baseText, tipText) {
  const base = parseOldEntries(baseText), tip = new Map(parseOldEntries(tipText).map(e => [normTitle(e.title), e]));
  const out = [];
  for (const e of base) {
    const t = tip.get(normTitle(e.title));
    if (!t) {
      // renamed rather than removed when the branch has a new entry much like it
      const like = [...tip.values()].find(x => !base.some(b => normTitle(b.title) === normTitle(x.title)) && likeness(x, e) >= 0.35);
      out.push({ title: e.title, how: like ? 'editing' : 'shipping' });
    } else if (t.body !== e.body) out.push({ title: e.title, how: 'editing' });
  }
  return out;
}

// Each tip's merge base with the base, from `git rev-list --parents` over the base and the tips: the commits the base
// reaches that a walk from the tip meets first, less any that another of them reaches. Answers a sha per tip, or null
// where git should decide (no common history, or more than one best base, where git picks).
export function mergeBases(revList, baseSha, tips) {
  const parents = new Map();
  for (const line of String(revList).split('\n')) { if (!line) continue; const [c, ...p] = line.split(' '); parents.set(c, p); }
  const walk = (from, stop) => {
    const seen = new Set(), met = new Set(), todo = [...from];
    while (todo.length) {
      const c = todo.pop();
      if (seen.has(c)) continue;
      seen.add(c);
      if (stop && stop.has(c)) { met.add(c); continue; }
      for (const p of parents.get(c) || []) todo.push(p);
    }
    return stop ? met : seen;
  };
  const inBase = walk([baseSha]);
  return tips.map(tip => {
    const met = [...walk([tip], inBase)];
    if (met.length <= 1) return met[0] || null;
    const best = met.filter(c => !met.some(o => o !== c && walk(parents.get(o) || []).has(c)));
    return best.length === 1 ? best[0] : null;
  });
}

// `git diff-tree --stdin --always` output, one header line of "<tip> <base>" before each pair's changes: by tip.
const SHAS = /^[0-9a-f]{40,64}( [0-9a-f]{40,64})*$/;
function byTip(text) {
  const out = new Map();
  let tip = null;
  for (const line of String(text).split('\n')) {
    if (SHAS.test(line)) { tip = line.split(' ')[0]; out.set(tip, ''); } else if (line && tip) out.set(tip, out.get(tip) + line + '\n');
  }
  return out;
}

// Which branches touch which items, by slug: every local branch and every branch on origin not merged into base.
// `map` turns the old file's titles into slugs, for branches that are still on the old file. Each branch is diffed
// from its merge base, as `git diff base...branch` does, with every merge base worked out from one read of the commit
// graph and every diff in one diff-tree; a branch whose merge base git has to choose is diffed on its own.
export async function branchWork(repo, base, { map = [], git = runGit, gitIn = runGitIn } = {}) {
  const slugOf = new Map(map.map(m => [normTitle(m.old), m.slug]));
  const refs = (await git(['for-each-ref', '--format=%(refname:short) %(objectname)', '--no-merged', base, 'refs/heads', 'refs/remotes/origin'], repo))
    .split('\n').map(s => s.trim().split(' ')).filter(([r, sha]) => r && sha && r !== 'origin/HEAD' && r !== 'origin');
  const local = new Set(refs.map(([r]) => r).filter(r => !r.startsWith('origin/')));
  // a pushed branch that is also local is shown once, by its local name
  const list = refs.filter(([r]) => !(r.startsWith('origin/') && local.has(r.slice(7)))).map(([ref, tip]) => ({ ref, tip, mb: null }));
  const out = new Map();
  const put = (slug, ref, how) => {
    if (!out.has(slug)) out.set(slug, []);
    const branch = ref.replace(/^origin\//, '');
    if (!out.get(slug).some(w => w.branch === branch)) out.get(slug).push({ branch, remoteOnly: ref.startsWith('origin/'), how });
  };
  if (!list.length) return out;
  const baseSha = (await git(['rev-parse', '--verify', '-q', `${base}^{commit}`], repo)).trim();
  if (baseSha) {
    const graph = await gitIn([baseSha, ...list.map(b => b.tip)].join('\n') + '\n', ['rev-list', '--parents', '--stdin'], repo);
    mergeBases(graph, baseSha, list.map(b => b.tip)).forEach((mb, i) => { list[i].mb = mb; });
  }
  const known = list.filter(b => b.mb);
  const diffs = known.length ? byTip(await gitIn(known.map(b => `${b.tip} ${b.mb}`).join('\n') + '\n', ['diff-tree', '--stdin', '--always', '-r', '--name-status', '-M', '--', DIR, OLD_FILE], repo)) : new Map();
  await Promise.all(list.map(async ({ ref, tip, mb }) => {
    const diff = mb ? diffs.get(tip) ?? '' : await git(['diff', '--name-status', '-M', `${base}...${ref}`, '--', DIR, OLD_FILE], repo);
    for (const t of branchTouches(diff)) put(t.slug, ref, t.how);
    if (/\tdocs\/BACKLOG\.md$/m.test(diff) && !/^D\tdocs\/BACKLOG\.md$/m.test(diff)) {
      const from = mb || (await git(['merge-base', base, ref], repo)).trim();
      const [was, now] = await catFiles(repo, [`${from}:${OLD_FILE}`, `${ref}:${OLD_FILE}`]);
      for (const t of oldTouches(was, now)) { const slug = slugOf.get(normTitle(t.title)); if (slug) put(slug, ref, t.how); }
    }
  }));
  return out;
}
