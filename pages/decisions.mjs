// The Decisions page: every decision the repo records, in one of HQ's own tables. The files in docs/decisions/ come first,
// newest first, then the lines of docs/DECISIONS.md, which stop at 2 October 2026, in the order the file keeps them.
// A file that a later one replaced whole is dimmed and links to its replacement. It reads those files and nothing
// else, so it runs no git.
import { esc, urlPath, layout } from '../lib/page.mjs';
import { info, dataTable } from '../lib/ui.mjs';
import { loadDecisions, check, firstSentence, DIR, OLD_FILE } from '../lib/decisions.mjs';

// the text as written, with `code` drawn as code
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const day = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dateCell = iso => (iso ? { html: esc(day(iso)), v: iso } : { html: '<span class="hint">none</span>', v: '' });
const fileLink = f => `<a href="/code/${urlPath(f.path)}">${inline(f.title || f.name)}</a>`;

// which part of the log a row is in: a file from the day the old file stopped, or a line of the old file up to it
const FILES = 'From 2 Oct 2026', LINES = 'To 2 Oct 2026';
const COLUMNS = [
  { key: 'date', label: 'Date', w: 'md' },
  { key: 'part', label: 'Part', filter: 'chips', w: 'md' },
  { key: 'title', label: 'Decision', filter: 'text', wrap: true },
  // one element, so a narrow screen's card keeps it in one grid cell beside its label
  { key: 'text', label: 'Text', sort: false, cls: 'dc-text' },
];

// Every decision in one table, so one search and one count cover them all: the files newest first, then the frozen
// lines in the old file's order.
function table(files, frozen) {
  const byName = new Map(files.map(f => [f.name, f]));
  const rows = files.map(f => {
    const by = f.supersededBy && byName.get(f.supersededBy);
    return { attrs: by ? { class: 'dc-superseded' } : {}, cells: {
      date: dateCell(f.date),
      part: FILES,
      title: { html: fileLink(f), v: f.title, f: `${f.title} ${f.body}` },
      text: by ? `Superseded by ${fileLink(by)}` : inline(firstSentence(f.body)),
    } };
  }).concat(frozen.map(l => ({ cells: {
    date: dateCell(l.date),
    part: LINES,
    title: { html: `<a href="/code/${OLD_FILE}">${inline(l.title)}</a>`, v: l.title, f: `${l.title} ${l.body}` },
    text: inline(firstSentence(l.body)),
  } })));
  return dataTable({ id: 'decisions', columns: COLUMNS, rows, empty: 'No decisions recorded yet.' });
}

export function decisionsPage(ctx) {
  const { files, frozen } = loadDecisions(ctx.repo);
  const problems = check(files);
  const warn = problems.length ? `<div class="bl-problems card"><b>${problems.length} decision file${problems.length === 1 ? '' : 's'} break the rules</b>${info('The same checks tests/unit/decisions.test.mjs makes before a push.', 'Which checks')}<ul>${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : '';
  const earlier = frozen.length > 0;
  const body = `<div class="hq-pagehead"><h1>Decisions${info(`Why the repo is the way it is: each decision, its reason, and what would change it. One file each in ${DIR}/${earlier ? `, and before those one line each in ${OLD_FILE}` : ''}. A file replaced whole names its replacement in superseded-by and is dimmed here; one replaced in part, and any earlier line, says so in its own text. An earlier line has a date only when its title ends in one. HQ only shows them: to add one, add a file in a branch.`, 'About this page')}</h1>
      ${earlier ? `<a class="hint" href="/code/${OLD_FILE}">How decisions are written</a>` : ''}</div>
    ${warn}
    <p class="hint">${files.length ? `${files.length} file${files.length === 1 ? '' : 's'}, newest first` : 'No decision files yet'}${earlier ? `, then the ${frozen.length} earlier line${frozen.length === 1 ? '' : 's'} of ${OLD_FILE}, in the file's order` : ''}.</p>
    ${table(files, frozen)}`;
  return layout({ title: 'Decisions', active: 'decisions', body, wide: true });
}
