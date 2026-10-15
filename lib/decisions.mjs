// The decisions: the lines of docs/DECISIONS.md, which stop at 2 October 2026 and are kept as written, and from then on
// one file each in docs/decisions/, named <yyyy-mm-dd>-<slug>.md, so two branches that each add one never touch the
// same file. The pure functions take text and answer data, so the unit tests can feed them; loadDecisions reads the
// two places from disk. Nothing here runs git, so the page and its tests need none.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export let OLD_FILE = 'docs/DECISIONS.md';
export let DIR = 'docs/decisions';
// The manifest's decisions key, applied once when HQ starts: the folder of dated files and the earlier one-line file.
export function configureDecisions({ rel, earlierRel } = {}) { if (rel) DIR = rel; if (earlierRel) OLD_FILE = earlierRel; }
export const NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TITLE_DATE = new RegExp(`\\s*\\((\\d{1,2}) (${MONTHS.join('|')})\\)$`);

const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

// The old file's decisions: each line "- **Title.** body", under "## <Month> <year>" headings. A title that ends in a
// date, as "(30 September)", gives the line that date in its heading's year, and the date leaves the title. Any other
// line has no date: the file did not say when, and none is made up.
export function parseFrozen(text) {
  const out = [];
  let year = '';
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const h = /^##\s+\S+\s+(\d{4})\s*$/.exec(line);
    if (h) { year = h[1]; continue; }
    const m = /^- \*\*(.+?)\*\*\s*(.*)$/.exec(line);
    if (!m) continue;
    let title = m[1].trim().replace(/\.$/, ''), date = '';
    const d = TITLE_DATE.exec(title);
    if (d && year) {
      date = `${year}-${String(MONTHS.indexOf(d[2]) + 1).padStart(2, '0')}-${d[1].padStart(2, '0')}`;
      title = title.slice(0, d.index);
    }
    out.push({ title, date, body: m[2].trim() });
  }
  return out;
}

// One file: its frontmatter's date and superseded-by, the title from its first heading, and the rest as the body.
export function parseDecision(text, name) {
  const src = String(text).replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n?---\n?/.exec(src);
  const fields = {};
  if (m) for (const line of m[1].split('\n')) { const f = /^([\w-]+):\s*(.*)$/.exec(line); if (f) fields[f[1]] = f[2].trim(); }
  const rest = m ? src.slice(m[0].length) : src;
  const t = /^#\s+(.+)$/m.exec(rest);
  return {
    name, path: `${DIR}/${name}`, date: fields.date || '', supersededBy: fields['superseded-by'] || '',
    title: t ? t[1].trim() : '', body: (t ? rest.slice(t.index + t[0].length) : rest).trim(),
  };
}

// Newest first; files from the same day by name.
const newestFirst = (a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name);

// Both places as they are on disk: { files, frozen }, the files newest first and the frozen lines in the old file's
// order. A repo with neither answers two empty lists.
export function loadDecisions(repo) {
  const dir = join(repo, DIR), old = join(repo, OLD_FILE);
  const files = existsSync(dir) ? readdirSync(dir).sort().map(f => parseDecision(readFileSync(join(dir, f), 'utf8'), f)) : [];
  return { files: files.sort(newestFirst), frozen: existsSync(old) ? parseFrozen(readFileSync(old, 'utf8')) : [] };
}

// What every file keeps to, as docs/DECISIONS.md describes. Answers one line per problem, naming the file.
export function check(files) {
  const problems = [], byName = new Map(files.map(f => [f.name, f]));
  for (const f of files) {
    const named = NAME.exec(f.name);
    if (!named) problems.push(`${f.path}: the name is not <yyyy-mm-dd>-<slug>.md, the slug lower-case words joined by hyphens`);
    if (!f.date) problems.push(`${f.path}: no date in its frontmatter`);
    else if (!isDay(f.date)) problems.push(`${f.path}: ${f.date} is not a date`);
    else if (named && f.date !== named[1]) problems.push(`${f.path}: date is ${f.date}, but the name says ${named[1]}`);
    if (!f.title) problems.push(`${f.path}: no # title`);
    if (f.supersededBy) {
      const by = byName.get(f.supersededBy);
      if (f.supersededBy === f.name) problems.push(`${f.path}: superseded by itself`);
      else if (!by) problems.push(`${f.path}: superseded by ${f.supersededBy}, which is not a file in ${DIR}`);
      else if (by.date < f.date) problems.push(`${f.path}: superseded by ${f.supersededBy}, which is dated earlier`);
    }
  }
  return problems;
}

// The text's first sentence, for a list: up to the first full stop that ends a sentence, or the first line.
export function firstSentence(body) {
  const line = String(body).split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  const m = /^.+?[.!?](?=\s+[A-Z`"(]|$)/.exec(line);
  return m ? m[0] : line;
}
