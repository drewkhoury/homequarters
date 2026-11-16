// Export: what HQ shows, as one Markdown file to hand to Claude or keep. Each part of HQ is a section that can be left
// in or out: the repo's state, the docs, the backlog, the tests, GitHub (from HQ's kept answers only), the
// conversations and the source. Docs and source are read only from files git tracks, so nothing ignored (an .env, the
// emulators' data) can get in. The pieces here are pure or read one folder, so the tests can feed them.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { languageOf } from './highlight.mjs';
import { isText } from './files.mjs';
import { fileFor, readEntry } from './stash.mjs';

// The sections, in the file's order, with what each holds and whether it starts ticked.
export const SECTIONS = [
  { id: 'repo', label: 'Repo state', about: 'Branch, commit, where it stands against main, worktrees and the last 30 commits.', on: true },
  { id: 'docs', label: 'Docs', about: 'The README, the agent instructions and the docs that say how things are now, in full.', on: true },
  { id: 'plans', label: 'Plans, design and history', about: 'The docs folders for working plans, research, reviews and docs that have stopped being true, when the repo has them.', on: false },
  { id: 'backlog', label: 'Backlog', about: 'The board, every open item in full, each item\'s history in brief, and the trend numbers.', on: true, feature: 'backlog' },
  { id: 'tests', label: 'Tests', about: 'The test catalogue, the last run in each place, and flaky tests.', on: true, feature: 'testing' },
  { id: 'github', label: 'GitHub', about: 'Open pull requests, recent runs and deploys, from what HQ last heard from GitHub. The export never asks GitHub itself.', on: true },
  { id: 'conversations', label: 'Conversations', about: 'Every Claude Code conversation in this repo: title, branch, dates, prompts, tokens, files changed, commits.', on: false },
  { id: 'source', label: 'Source code', about: 'Every text file git tracks, in full, apart from lock files, vendored libraries, generated or minified files and files over 512 KB.', on: false },
];
export const SECTION_IDS = SECTIONS.map(s => s.id);
// The sections for a manifest: one tied to a feature starts ticked only when the manifest turns that feature on.
export const sectionsFor = m => SECTIONS.map(s => (s.feature && !(m?.features || {})[s.feature] ? { ...s, on: false } : s));

// Roughly how many tokens a text is to Claude: about four characters each.
export const estimateTokens = text => Math.ceil(String(text).length / 4);

// The sections a request asks for: ?sections=repo,docs (unknown names dropped), else the ones ticked to start with.
// prompts=1 adds what people and Claude wrote to Conversations, and only when Conversations is in.
export function pickSections(params = new URLSearchParams()) {
  const asked = params.has('sections') ? String(params.get('sections')).split(',').map(s => s.trim()).filter(s => SECTION_IDS.includes(s)) : SECTIONS.filter(s => s.on).map(s => s.id);
  const ids = SECTION_IDS.filter(id => asked.includes(id));
  return { ids, prompts: params.get('prompts') === '1' && ids.includes('conversations') };
}

// questkeep-hq-2026-09-29-7357b0e.md
export const fileName = (date, sha) => `hq-${new Date(date).toISOString().slice(0, 10)}-${String(sha || 'nocommit').slice(0, 7)}.md`;

const fence = (text, lang = '') => {
  // a fence longer than any run of backticks inside, so the file's own fences never close it early
  const longest = Math.max(2, ...[...String(text).matchAll(/`+/g)].map(m => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}${lang}\n${String(text).replace(/\n$/, '')}\n${f}`;
};

// ---- which tracked files go in ----

// the project's own files up to this size; web/app.js, the app's main file, is about 240 KB
export const MAX_FILE = 512 * 1024;
const NEVER = [/(^|\/)node_modules\//, /(^|\/)vendor\//, /(^|\/)emulator-data\//, /(^|\/)firebase-export-/, /(^|\/)package-lock\.json$/, /\.lock$/, /(^|\/)yarn\.lock$/,
  /\.min\.(js|css)$/, /\.map$/, /(^|\/)test-results\//, /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|mp3|mp4|webm|wav|ogg|pdf|zip|gz)$/i];

// Whether text has a line of at least n characters, in one pass: /[^\n]{2000,}/ tries again from every character of a
// line just short of it, which took 1.3 s over QuestKeep's tracked files.
export function longLine(text, n) {
  let run = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) run = 0; else if (++run >= n) return true;
  return false;
}

// Why a tracked file stays out of Source, or '' when it goes in. `size` in bytes and `head`, its first bytes.
export function skipReason(path, size, head) {
  if (NEVER.some(re => re.test(path))) return /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|mp3|mp4|webm|wav|ogg|pdf|zip|gz)$/i.test(path) ? 'binary' : 'generated or someone else\'s';
  if (size > MAX_FILE) return `over ${MAX_FILE / 1024} KB`;
  if (head && !isText(head)) return 'binary';
  // one very long line is how minified or generated files look
  if (head && longLine(head.toString('utf8', 0, Math.min(head.length, 8000)), 2000)) return 'minified';
  return '';
}

const lines = text => String(text).split('\n').map(l => l.trim()).filter(Boolean);

// Tracked files from git, as paths from the repo root. git(args, cwd) answers what git printed.
export async function trackedFiles(repo, git, pattern) {
  return lines(await git(['ls-files', '-z', ...(pattern ? ['--', pattern] : [])], repo).then(t => t.replace(/\0/g, '\n')));
}

// ---- the sections that read files ----

// Where a Markdown file goes: the backlog's items have their own section (its README stays with the docs); plans,
// design and history are their own section, off to start with, since they are most of the words.
export const DEEP = /^docs\/(plans|design|history)\//;
export const docKind = p => (p.startsWith('docs/backlog/') && p !== 'docs/backlog/README.md' ? 'backlog' : DEEP.test(p) ? 'plans' : 'docs');

// Tracked Markdown files of one kind (docKind), as { path, text }.
export async function trackedDocs(repo, git, kind = 'docs') {
  const out = [];
  for (const p of (await trackedFiles(repo, git, '*.md')).filter(p => docKind(p) === kind)) {
    try { out.push({ path: p, text: readFileSync(join(repo, p), 'utf8') }); } catch { /* gone since git listed it */ }
  }
  return out;
}

// Every tracked text file that is the project's own, as { path, buf }, and what was left out and why.
export async function trackedSource(repo, git) {
  const paths = (await trackedFiles(repo, git)).filter(p => !/\.md$/i.test(p));
  const files = [], skipped = {};
  for (const p of paths) {
    let st, buf;
    try { st = statSync(join(repo, p)); } catch { continue; }
    if (!st.isFile()) continue;
    const early = skipReason(p, st.size, null);
    if (early) { (skipped[early] ||= []).push(p); continue; }
    try { buf = readFileSync(join(repo, p)); } catch { continue; }
    const why = skipReason(p, st.size, buf);
    if (why) { (skipped[why] ||= []).push(p); continue; }
    files.push({ path: p, buf });
  }
  return { files, skipped };
}

// Tracked Markdown files of one kind, in full, each under its path.
export function docsSection(docs, kind = 'docs') {
  const title = kind === 'plans' ? 'Plans, design and history' : 'Docs';
  return `## ${title}\n\n${docs.length} Markdown files git tracks. Each is fenced as it is in the repo.\n\n${docs.map(d => `### ${d.path}\n\n${fence(d.text, 'markdown')}`).join('\n\n')}`;
}

// The project's own text files in full, fenced with their language, and what was left out.
export function leftOut(skipped) {
  return Object.entries(skipped).map(([why, ps]) => `- ${why}: ${ps.length} (${ps.slice(0, 6).join(', ')}${ps.length > 6 ? ', …' : ''})`).join('\n');
}
export function sourceSection({ files, skipped }) {
  const bytes = files.reduce((n, f) => n + f.buf.length, 0), left = leftOut(skipped);
  return `## Source code\n\n${files.length} files git tracks, ${Math.round(bytes / 1024)} KB. Markdown is under Docs.${left ? `\n\nLeft out:\n${left}` : ''}\n\n${files.map(f => `### ${f.path}\n\n${fence(f.buf.toString('utf8'), languageOf(f.path) || f.path.split('.').pop())}`).join('\n\n')}`;
}

// ---- the sections that read what HQ already has ----

export function repoSection(health, log) {
  const c = health.checkout, r = c.remote;
  const wt = health.worktrees.map(w => `- \`${w.path}\` on ${w.branch ? `\`${w.branch}\`` : 'a detached HEAD'}, ${w.clean ? 'clean' : `${w.changed} changed, ${w.untracked} untracked`}, ${w.ahead ?? '?'} ahead of and ${w.behind ?? '?'} behind ${health.base}`).join('\n');
  return `## Repo state\n\n- Branch: \`${c.branch || 'detached'}\`, ${c.clean ? 'clean' : `${c.changed} changed, ${c.untracked} untracked`}
- Against ${r.against || 'nothing'}: ${r.toPush ?? '?'} to push, ${r.toPull ?? '?'} to pull${c.lastFetch ? ` (as of the last fetch, ${c.lastFetch})` : ''}
- Stashes: ${health.stashes.length}; local branches already merged into ${health.base}: ${health.merged.join(', ') || 'none'}

### Worktrees

${wt || 'None.'}

### The last 30 commits

${fence(log.trim())}`;
}

export function testsSection(files, runs, flaky) {
  const bySet = {};
  for (const f of files) (bySet[f.set] ||= []).push(f);
  const TITLES = { helper: 'Helpers' };
  const cat = Object.entries(bySet).map(([set, fs]) => `### ${TITLES[set] || set[0].toUpperCase() + set.slice(1)}\n\n${fs.map(f => { const what = f.fields?.proves || f.description; return `- \`${f.path}\`${what ? `: ${what}` : ''}`; }).join('\n')}`).join('\n\n');
  const places = ['laptop', 'container', 'ci'].map(w => {
    const r = runs.find(x => (x.info.where || x.source) === w);
    if (!r) return `- ${w}: no runs kept`;
    const failed = r.tasks.filter(t => t.status !== 'pass').map(t => `${t.id}${t.cases.some(c => c.status === 'fail') ? ` (${t.cases.filter(c => c.status === 'fail').map(c => c.name).join(', ')})` : ''}`);
    return `- ${w}: ${r.ok ? 'passed' : 'FAILED'}, ${r.info.kind || '?'} on \`${r.info.commit || '?'}\`${r.info.branch ? ` (${r.info.branch})` : ''}, ${r.when}${failed.length ? `; failed: ${failed.join('; ')}` : ''}`;
  }).join('\n');
  const fl = flaky.length ? flaky.map(f => `- ${f.test} in ${f.task} on \`${f.commit}\``).join('\n') : 'None found.';
  return `## Tests\n\n${files.length} test files.\n\n### The last run in each place\n\n${places}\n\n### Flaky (passed and failed on one clean commit)\n\n${fl}\n\n${cat}`;
}

// What HQ last heard from GitHub, from the answers it keeps on disk. Never asks GitHub.
export function githubSection(cache, repo, now = Date.now()) {
  const dir = join(cache, 'hq');
  const kept = name => readEntry(fileFor(dir, name, repo));
  const age = e => (e ? ` (as HQ last heard, ${Math.round((now - e.at) / 60000)} min ago)` : '');
  const prs = kept('prs'), runs = kept('runs'), deploys = kept('deploys');
  const prLines = Array.isArray(prs?.data) ? (prs.data.length ? prs.data.map(p => `- #${p.number} ${p.title} (\`${p.headRefName}\` → \`${p.baseRefName}\`, ${p.author?.login || '?'}${p.isDraft ? ', draft' : ''})`).join('\n') : 'None open.') : 'Not cached. Open HQ\'s GitHub page once to fetch it.';
  const runLines = Array.isArray(runs?.data) ? runs.data.slice(0, 15).map(r => `- ${r.workflowName} on \`${r.headBranch}\` (${String(r.headSha || '').slice(0, 7)}): ${r.conclusion || r.status}, ${r.createdAt}. ${r.displayTitle}`).join('\n') : 'Not cached.';
  const depLines = Array.isArray(deploys?.data) ? deploys.data.slice(0, 10).map(d => `- ${d.environment} at \`${String(d.sha || '').slice(0, 7)}\`, ${d.created_at}${d.description ? `: ${d.description}` : ''}`).join('\n') || 'None.' : 'Not cached.';
  return `## GitHub\n\n### Open pull requests${age(prs)}\n\n${prLines}\n\n### Recent runs${age(runs)}\n\n${runLines}\n\n### Deploys${age(deploys)}\n\n${depLines}`;
}

const k = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

// The index of conversations; with `writing`, each one's prompts and Claude's text from the index's text files.
export function conversationsSection(sessions, { writing = false, textOf = () => '' } = {}) {
  const rows = [...sessions].sort((a, b) => String(b.lastActive).localeCompare(String(a.lastActive))).map(s => {
    const t = s.tokens || {};
    const head = `### ${s.title}\n\n- id \`${s.id}\`, ${s.entrypoint === 'sdk-cli' ? 'HQ chat / claude -p' : 'terminal'}, branch ${s.branches.map(b => `\`${b}\``).join(', ') || '?'}, in \`${s.cwd || '?'}\`
- ${s.started || '?'} to ${s.lastActive || '?'}, ${s.prompts} prompts, ${k((t.in || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0))} tokens in, ${k(t.out || 0)} out${s.gone ? ', transcript deleted by Claude Code' : ''}
- Files changed: ${s.edited.length ? s.edited.map(f => `\`${f}\``).join(', ') : 'none'}
- Commits: ${s.commits.length ? s.commits.map(c => `\`${String(c.sha).slice(0, 7)}\` ${c.subject || ''}`.trim()).join('; ') : 'none'}`;
    if (!writing) return head;
    const text = textOf(s.id).trim();
    return `${head}\n\nWhat people and Claude wrote (no tool output):\n\n${text ? fence(text, 'text') : '(nothing kept)'}`;
  });
  return `## Conversations\n\n${sessions.length} Claude Code conversations in this repo.${writing ? ' With what people and Claude wrote, which can hold anything pasted into a session.' : ''}\n\n${rows.join('\n\n')}`;
}

// The file: a header saying what it is and what is in it, then the chosen sections in order.
export function assemble({ repo, branch, sha, at, sections, ids }) {
  const chosen = ids.filter(id => sections[id] != null);
  const body = chosen.map(id => sections[id]).join('\n\n---\n\n');
  const list = chosen.map(id => `- ${SECTIONS.find(s => s.id === id).label}: about ${k(estimateTokens(sections[id]))} tokens`).join('\n');
  const header = `# HQ export

What HQ showed at ${new Date(at).toISOString()}: the repo \`${repo}\` on branch \`${branch || 'detached'}\` at commit \`${sha || '?'}\`. Paths are from the repo root. Docs and source come only from files git tracks.

In it, about ${k(estimateTokens(body))} tokens in all:

${list || '- nothing chosen'}`;
  return `${header}\n\n---\n\n${body}\n`;
}

// ---- the same, as a folder of files in a zip ----

// questkeep-hq-2026-09-29-7357b0e.zip, and the folder inside it
export const zipName = (date, sha) => fileName(date, sha).replace(/\.md$/, '.zip');
export const folderName = (date, sha) => fileName(date, sha).replace(/\.md$/, '');

// A file name for a conversation: its day, its title in a few words, and the start of its id.
export const conversationFile = s => `${String(s.started || '').slice(0, 10) || 'undated'}-${String(s.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'untitled'}-${String(s.id).slice(0, 8)}.md`;

// The entries of the zip, all under one folder: a README saying what is where, a Markdown file per summary
// (repo-state.md, backlog.md, tests.md, github.md, conversations/), and under repo/ the tracked files themselves, at
// their paths in the repo, so Claude can list them and open only what it needs.
//   parts: { repo, backlog, tests, github, conversations } summaries as Markdown, plus
//   files: { docs: [{ path, text }], plans: [...], backlogItems: [...], source: { files, skipped } } and
//   talks: [{ file, text }] for one file per conversation (only when asked for).
export function zipEntries({ repo, branch, sha, at, ids, parts, files, talks = [] }) {
  const root = folderName(at, sha), out = [];
  const add = (name, data) => out.push({ name: `${root}/${name}`, data });
  const map = [];
  const note = (path, what, text) => map.push(`- \`${path}\`: ${what} (about ${k(estimateTokens(text))} tokens)`);
  if (ids.includes('repo')) { add('repo-state.md', parts.repo); note('repo-state.md', 'the branch, commit, worktrees and the last 30 commits', parts.repo); }
  if (ids.includes('backlog')) {
    add('backlog.md', parts.backlog); note('backlog.md', 'the board, each item\'s history in brief and the trend; the items themselves are under repo/docs/backlog/', parts.backlog);
    for (const f of files.backlogItems || []) add(`repo/${f.path}`, f.text);
  }
  if (ids.includes('tests')) { add('tests.md', parts.tests); note('tests.md', 'the test catalogue, the last runs and flaky tests', parts.tests); }
  if (ids.includes('github')) { add('github.md', parts.github); note('github.md', 'pull requests, runs and deploys, as HQ last heard', parts.github); }
  if (ids.includes('conversations')) {
    add('conversations/index.md', parts.conversations); note('conversations/index.md', 'every conversation in this repo, one entry each', parts.conversations);
    for (const t of talks) add(`conversations/${t.file}`, t.text);
    if (talks.length) map.push(`- \`conversations/*.md\`: what people and Claude wrote in each, ${talks.length} files (no tool output)`);
  }
  const tree = (label, list, size) => { if (list.length) map.push(`- \`repo/\`: ${label}, ${list.length} files, about ${k(size)} tokens`); };
  const docs = [...(ids.includes('docs') ? files.docs : []), ...(ids.includes('plans') ? files.plans : [])];
  for (const d of docs) add(`repo/${d.path}`, d.text);
  tree(ids.includes('plans') ? 'docs, plans, design and history' : 'docs', docs, docs.reduce((n, d) => n + estimateTokens(d.text), 0));
  if (ids.includes('source')) {
    for (const f of files.source.files) add(`repo/${f.path}`, f.buf);
    tree('source code', files.source.files, files.source.files.reduce((n, f) => n + Math.ceil(f.buf.length / 4), 0));
    const left = leftOut(files.source.skipped);
    if (left) map.push(`  Left out of the source:\n${left.split('\n').map(l => `  ${l}`).join('\n')}`);
  }
  const readme = `# HQ export

What HQ showed at ${new Date(at).toISOString()}: the repo \`${repo}\` on branch \`${branch || 'detached'}\` at commit \`${sha || '?'}\`.

This is a folder of files rather than one long one: start here, then open only what the question needs. Files under \`repo/\` are the files git tracks, at their paths in the repo, as they were at that commit; nothing git ignores is in it. The summaries sit at the top.

## What is where

${map.join('\n') || '- nothing was chosen'}
`;
  out.unshift({ name: `${root}/README.md`, data: readme });
  return out;
}
