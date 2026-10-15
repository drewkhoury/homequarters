// The Export page: pick what goes in, see how big it is, and download one Markdown file with what HQ shows (or copy it,
// when it is small enough) to hand to Claude or keep. The sections are built once and kept for a minute, keyed by the
// commit, so ticking boxes (sized in the browser from numbers the page carries) and downloading are quick.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esc, layout } from '../lib/page.mjs';
import { info } from '../lib/ui.mjs';
import { runGit, repoHealth } from '../lib/git.mjs';
import { catalogue } from '../lib/catalogue.mjs';
import { allRuns, flakes } from '../lib/runs.mjs';
import { conversationsIndex, indexDir } from '../lib/conversations.mjs';
import { demoSession } from '../lib/demo.mjs';
import { gather, COLUMNS } from './backlog.mjs';
import { SECTIONS, sectionsFor, estimateTokens, pickSections, fileName, assemble, docsSection, trackedDocs, trackedSource, zipEntries, zipName, conversationFile, sourceSection, repoSection, testsSection, githubSection, conversationsSection } from '../lib/export.mjs';
import { zip } from '../lib/zip.mjs';

const KEEP_MS = 60000;
const PREVIEW_LINES = 60;
let kept = null;

const day = iso => String(iso || '').slice(0, 10);

// The Backlog section: the board by column, every open item's file, each item's history in brief, and the trend.
async function backlogSection(ctx) {
  const g = await gather(ctx, Date.now(), { askGithub: false });
  const line = r => {
    const it = r.item, bits = [r.type || 'no type', it ? `asked ${it.asked}` : null, r.blockers.length ? `blocked by ${r.blockers.join(', ')}` : null,
      r.branches.length ? `on ${r.branches.map(b => `\`${b.branch}\` (${b.how === 'shipping' ? 'ships it' : 'works on it'})`).join(', ')}` : null].filter(Boolean);
    return `- **${r.title}** (\`${r.slug}\`): ${bits.join('; ')}`;
  };
  const recent = g.records.filter(r => r.column === 'done').sort((a, b) => String(b.closed?.date).localeCompare(String(a.closed?.date))).slice(0, 20);
  const board = COLUMNS.map(([k, label]) => {
    const rs = k === 'done' ? recent : g.records.filter(r => r.column === k);
    return `#### ${label} (${rs.length}${k === 'done' ? ', the last 20' : ''})\n\n${rs.map(line).join('\n') || 'None.'}`;
  }).join('\n\n');
  const files = g.records.filter(r => r.item).map(r => {
    let text = '';
    try { text = readFileSync(join(ctx.repo, r.item.path), 'utf8'); } catch { /* moved while reading */ }
    return `#### ${r.item.path}\n\n\`\`\`\`markdown\n${text.replace(/\n$/, '')}\n\`\`\`\``;
  }).join('\n\n');
  const history = g.records.map(r => `- ${r.title}: listed ${day(r.added) || '?'}, ${r.events.length} commits${r.closed ? `, ${r.closed.shipped ? 'shipped' : 'taken off (docs only)'} ${day(r.closed.date)}${r.closed.type ? ` in a ${r.closed.type} commit` : ''}` : ', open'}`).join('\n');
  const trend = `| Day | Added | Taken off | Shipped | Open at the day's end |\n|---|---|---|---|---|\n${g.trend.map(d => `| ${d.day} | ${d.added} | ${d.closed} | ${d.shipped} | ${d.open} |`).join('\n')}`;
  const head = `## Backlog\n\nOne file per item in \`docs/backlog/\` (inbox, next, parked); the columns come from where the file is and from branches that change or delete it. History is rebuilt from git.`;
  const tail = `### Every item ever listed, in brief\n\n${history}\n\n### In and out per day\n\n${trend}`;
  const items = g.records.filter(r => r.item).map(r => { try { return { path: r.item.path, text: readFileSync(join(ctx.repo, r.item.path), 'utf8') }; } catch { return null; } }).filter(Boolean);
  return {
    full: `${head}\n\n### The board\n\n${board}\n\n### Open items in full\n\n${files}\n\n${tail}`,
    // in the zip the items are files of their own, under repo/docs/backlog/
    summary: `${head} The items themselves are under \`repo/docs/backlog/\`.\n\n### The board\n\n${board}\n\n${tail}`,
    items,
  };
}

// Every section, built once per commit and kept for a minute. Each is built on its own, so one failing leaves the rest.
export async function getSections(ctx, { git = runGit, now = Date.now() } = {}) {
  const sha = (await git(['rev-parse', 'HEAD'], ctx.repo)).trim(), branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], ctx.repo)).trim();
  if (kept && kept.repo === ctx.repo && kept.demo === ctx.demo && kept.sha === sha && now - kept.at < KEEP_MS) return kept;
  const started = Date.now(), sections = {}, times = {};
  const build = async (id, fn) => {
    const t = Date.now();
    try { sections[id] = await fn(); } catch (e) { sections[id] = `## ${SECTIONS.find(s => s.id === id)?.label || id}\n\nCould not be read: ${e.message}`; }
    times[id] = Date.now() - t;
  };
  let sessions = [];
  const files = { docs: [], plans: [], backlogItems: [], source: { files: [], skipped: {} } };
  let backlogSummary = '';
  await Promise.all([
    build('repo', async () => repoSection(await repoHealth(ctx.repo, git), await git(['log', '-30', '--format=%h %ad %s', '--date=short'], ctx.repo))),
    build('docs', async () => docsSection(files.docs = await trackedDocs(ctx.repo, git, 'docs'))),
    build('plans', async () => docsSection(files.plans = await trackedDocs(ctx.repo, git, 'plans'), 'plans')),
    build('backlog', async () => { const b = await backlogSection(ctx); files.backlogItems = b.items; backlogSummary = b.summary; return b.full; }),
    build('tests', () => { const runs = allRuns(ctx.cache); return testsSection(catalogue(ctx.repo), runs, flakes(runs)); }),
    build('github', () => githubSection(ctx.cache, ctx.repo, now)),
    build('conversations', async () => { sessions = (await conversationsIndex({ repo: ctx.repo, cache: ctx.cache, projectsDir: ctx.projectsDir, git })).sessions.map(x => demoSession(ctx.demo, x)); return conversationsSection(sessions); }),
    build('source', async () => sourceSection(files.source = await trackedSource(ctx.repo, git))),
  ]);
  // the same section with what people and Claude wrote, from the conversations index's text files
  const textOf = id => { if (sessions.find(x => x.id === id)?.demoClosed) return ''; try { return readFileSync(join(indexDir(ctx.cache), 'text', `${id}.txt`), 'utf8'); } catch { return ''; } };
  sections.conversationsWriting = conversationsSection(sessions, { writing: true, textOf });
  // one file per conversation, for the zip: its entry from the index, then what was written in it
  const talks = sessions.map(x => ({ file: conversationFile(x), text: `# ${x.title}\n\n${conversationsSection([x], { writing: true, textOf }).replace(/^## Conversations\n\n[^\n]*\n\n### [^\n]*\n\n/, '')}\n` }));
  kept = { repo: ctx.repo, demo: ctx.demo, sha, branch, at: now, sections, files, talks, backlogSummary, times, ms: Date.now() - started };
  return kept;
}

// The file for a request: the chosen sections, with Conversations' writing when asked for. preview=1 answers only the
// file's first lines, for the page's preview.
// The file for a request: the chosen sections, with Conversations' writing when asked for, as one Markdown file, or
// with format=zip as a folder of files (README.md, the summaries, and the tracked files under repo/). preview=1 answers
// only the start, for the page's preview: the Markdown's first lines, or the zip's README and its list of files.
export async function exportFile(ctx, params = new URLSearchParams(), opts = {}) {
  const k = await getSections(ctx, opts);
  const { ids, prompts } = pickSections(params);
  if (params.get('format') === 'zip') {
    const parts = { repo: k.sections.repo, backlog: k.backlogSummary || k.sections.backlog, tests: k.sections.tests, github: k.sections.github, conversations: k.sections.conversations };
    const entries = zipEntries({ repo: ctx.repo, branch: k.branch, sha: k.sha, at: k.at, ids, parts, files: k.files, talks: prompts ? k.talks : [] });
    if (params.get('preview') === '1') {
      const list = entries.map(e => `  ${e.name}`), shown = list.slice(0, 40).join('\n') + (list.length > 40 ? `\n  … and ${list.length - 40} more` : '');
      return { name: zipName(k.at, k.sha), type: 'text/plain; charset=utf-8', body: `${entries[0].data.split('\n').slice(0, PREVIEW_LINES).join('\n')}\n\nThe zip holds ${entries.length} files:\n${shown}\n` };
    }
    return { name: zipName(k.at, k.sha), type: 'application/zip', body: zip(entries, { at: new Date(k.at) }) };
  }
  const sections = { ...k.sections, conversations: prompts ? k.sections.conversationsWriting : k.sections.conversations };
  let body = assemble({ repo: ctx.repo, branch: k.branch, sha: k.sha, at: k.at, sections, ids });
  if (params.get('preview') === '1') body = body.split('\n').slice(0, PREVIEW_LINES).join('\n');
  return { name: fileName(k.at, k.sha), type: 'text/markdown; charset=utf-8', body };
}

const kb = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const tok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export async function exportPage(ctx, params = new URLSearchParams()) {
  const k = await getSections(ctx);
  const size = text => ({ bytes: Buffer.byteLength(text), tokens: estimateTokens(text) });
  const data = {
    sections: sectionsFor(ctx.m).map(s => ({ id: s.id, on: s.on, ...size(k.sections[s.id] || '') })),
    prompts: (() => { const a = size(k.sections.conversationsWriting), b = size(k.sections.conversations); return { bytes: a.bytes - b.bytes, tokens: a.tokens - b.tokens }; })(),
    header: 700,
  };
  const preview = (await exportFile(ctx, new URLSearchParams('preview=1'), {})).body;
  const rows = sectionsFor(ctx.m).map(s => {
    const d = data.sections.find(x => x.id === s.id);
    const extra = s.id === 'conversations' ? `<label class="ex-sub"><input type="checkbox" name="prompts" disabled> Include what people and Claude wrote <span class="hint" data-size-of="prompts">${kb(data.prompts.bytes)} · ${tok(data.prompts.tokens)} tokens</span>${info('The prompts and Claude\'s replies, never tool output. They can hold anything pasted into a session, so read them before sending the file on.', 'About this')}</label>` : '';
    return `<div class="ex-row"><label class="ex-main"><input type="checkbox" name="section" value="${s.id}"${s.on ? ' checked' : ''}>
      <span class="ex-label">${esc(s.label)}</span><span class="hint ex-size" data-size-of="${s.id}">${kb(d.bytes)} · ${tok(d.tokens)} tokens</span></label>
      <p class="hint ex-about">${esc(s.about)}</p>${extra}</div>`;
  }).join('');
  const body = `<div class="hq-pagehead"><h1>Export${info(`Built from this checkout at ${k.sha.slice(0, 7)} on ${k.branch}, in ${(k.ms / 1000).toFixed(1)} s, and kept for a minute. Docs and source are read only from files git tracks, so nothing ignored (an .env, local data) gets in. GitHub comes from what HQ last heard; the export never asks GitHub itself.`, 'About this page')}</h1></div>
    <p class="ex-lede">What HQ shows, to hand to Claude or keep: one Markdown file, or a zip of files Claude can look through and open only what it needs.</p>
    <form class="card ex-form" onsubmit="return false">
      <div class="ex-format"><span class="ex-label">As</span><div class="seg hq-spans" role="group" aria-label="As one file or a zip">
        <button type="button" class="seg-opt" data-format="md" aria-pressed="true">One Markdown file</button><button type="button" class="seg-opt" data-format="zip" aria-pressed="false">A zip of files</button></div>
        <span class="hint" data-format-note>Everything in one file, in order. Best when it fits in a conversation.</span></div>${rows}
      <div class="ex-total"><span><b data-total>…</b></span><span class="ex-warn" data-warn hidden></span></div>
      <div class="ex-actions"><a class="btn btn-primary" data-download href="/export/download">Download</a><button type="button" class="btn btn-secondary" data-copy>Copy to clipboard</button>
        <span class="hint" data-said aria-live="polite"></span></div>
      <p class="hint">Only files git tracks are read for Docs and Source code.</p></form>
    <h2>The start of the file</h2>
    <pre class="ex-preview" data-preview>${esc(preview)}</pre>
    <script type="application/json" id="ex-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
    <script src="/hq/hq-export.js" defer></script>`;
  return layout({ title: 'Export', active: 'export', body });
}
