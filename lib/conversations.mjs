// The Claude Code conversations about this repo, read from the transcripts Claude Code keeps under
// ~/.claude/projects/: one folder per directory a session started in, named by that path with every character that is
// not a letter, digit or '-' turned into '-'. HQ takes the folders of the main checkout and of every worktree beside
// it (<main>-<name>, removed ones too), and checks inside each session that its cwd really is this repo.
//
// The transcripts are large (hundreds of MB), so HQ keeps an index in <cache>/hq/conversations/: for each file the
// bytes already read, and for each session what the list shows. A request reads only the bytes added since. The index
// is kept forever, so a session whose transcript Claude Code has deleted (after cleanupPeriodDays, 30 by default)
// stays in the list, marked as gone. The words people and Claude wrote (not tool output) go to one text file per
// session there too, for the search box.
import { existsSync, readdirSync, statSync, mkdirSync, readFileSync, writeFileSync, openSync, readSync, closeSync, appendFileSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { runGit } from './git.mjs';
import { loadItems } from './backlog.mjs';

const INDEX_VERSION = 1;

// A path as Claude Code names its folder.
export const escapePath = p => String(p).replace(/[^a-zA-Z0-9-]/g, '-');

// The main checkout, from any worktree: the folder holding git's common directory.
export async function mainCheckout(repo, git = runGit) {
  const common = (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repo)).trim();
  return common ? dirname(common) : repo;
}

// Whether a directory is the main checkout, under it, or a worktree beside it (<main>-<name>).
export const belongs = (cwd, main) => !!cwd && (cwd === main || cwd.startsWith(`${main}/`) || new RegExp(`^${main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[^/]+(/|$)`).test(cwd));

// The folders under projectsDir that could hold this repo's sessions: the main checkout's and any <main>-<name>.
export function projectFolders(projectsDir, main) {
  if (!existsSync(projectsDir)) return [];
  const base = escapePath(main);
  return readdirSync(projectsDir).filter(f => f === base || f.startsWith(`${base}-`)).map(f => join(projectsDir, f));
}

// A path in the repo as the repo names it: the part after the checkout or worktree it is in, or null outside the repo.
export function repoRelative(path, main) {
  if (!path) return null;
  const m = new RegExp(`^${main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-[^/]+)?/(.+)$`).exec(path);
  return m ? m[1] : null;
}

const SOURCES = { cli: 'terminal', 'sdk-cli': 'HQ chat / claude -p' };
export const sourceOf = entrypoint => SOURCES[entrypoint] || entrypoint || '?';

// A user line that is a person's prompt, not a tool result, a command's echo or a notification. Answers its text.
export function promptText(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain) return null;
  const c = o.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) && c.every(b => b.type === 'text') ? c.map(b => b.text).join('\n') : null;
  if (!text || !text.trim()) return null;
  // commands, their output and notifications arrive as user lines wrapped in tags
  if (/^\s*<(command-name|command-message|local-command|task-notification|system-reminder|bash-input|bash-stdout|user-memory-input)/.test(text)) return null;
  if (/^\[Request interrupted/.test(text)) return null;
  return text;
}

// Commit subjects in a Bash command that runs git commit: the first line of a heredoc message, or each -m.
export function commitSubjects(command) {
  const cmd = String(command || '');
  if (!/\bgit\b[^\n|;&]*\bcommit\b/.test(cmd) || /--amend\b[^\n]*--no-edit/.test(cmd)) return [];
  const out = [];
  const here = /<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1\b/.exec(cmd);
  if (here) { const first = here[2].split('\n').map(l => l.trim()).find(Boolean); if (first) out.push(first); }
  for (const m of cmd.matchAll(/\s-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g)) { const first = (m[1] ?? m[2]).split('\n')[0].trim(); if (first) { out.push(first); break; } }
  return out;
}

// git's own "[branch sha] subject" line, when a commit's output was not silenced.
export function commitLines(text) {
  return [...String(text || '').matchAll(/^\[([^\]\s]+)(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/gm)].map(m => ({ branch: m[1], sha: m[2], subject: m[3].trim() }));
}

const EDITS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const resultText = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join('') : '');

// A session as the index keeps it, before any line.
export function newSession(id, folder) {
  return { id, folder, title: '', aiTitle: '', customTitle: '', firstPrompt: '', cwd: '', cwds: [], branches: [], entrypoint: '', started: null, lastActive: null,
    prompts: 0, replies: 0, tools: {}, usage: {}, edited: [], commits: [], subjects: [], subagents: 0, gone: false };
}

// One parsed line into the session. `main` is the main checkout. Answers the words to add to the search text, if any.
export function absorb(s, o, main) {
  if (!o || typeof o !== 'object') return '';
  if (o.type === 'ai-title' && o.aiTitle) s.aiTitle = o.aiTitle;
  if (o.type === 'custom-title' && (o.customTitle || o.title)) s.customTitle = o.customTitle || o.title;
  if (o.type === 'summary' && o.summary && !s.aiTitle) s.aiTitle = o.summary;
  if (o.timestamp) { if (!s.started || o.timestamp < s.started) s.started = o.timestamp; if (!s.lastActive || o.timestamp > s.lastActive) s.lastActive = o.timestamp; }
  if (o.cwd) { if (!s.cwd) s.cwd = o.cwd; if (!s.cwds.includes(o.cwd)) s.cwds.push(o.cwd); }
  if (o.gitBranch && o.gitBranch !== 'HEAD' && !s.branches.includes(o.gitBranch)) s.branches.push(o.gitBranch);
  if (o.entrypoint && !s.entrypoint && !o.isSidechain) s.entrypoint = o.entrypoint;
  let words = '';
  const p = promptText(o);
  if (p) { s.prompts++; if (!s.firstPrompt) s.firstPrompt = p.replace(/^I am looking at [^\n]* in (\S+ )?HQ\.\n\n/, '').replace(/\s+/g, ' ').trim().slice(0, 160); words += `${p}\n`; }
  const content = Array.isArray(o.message?.content) ? o.message.content : [];
  if (o.type === 'assistant') {
    const id = o.message?.id, u = o.message?.usage;
    if (id && u) s.usage[id] = [u.input_tokens || 0, u.output_tokens || 0, u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0];
    if (id && !s.usage[`seen:${id}`] && !o.isSidechain) { s.usage[`seen:${id}`] = 1; s.replies++; }
    for (const b of content) {
      if (b.type === 'text' && b.text && !o.isSidechain) words += `${b.text}\n`;
      if (b.type !== 'tool_use') continue;
      s.tools[b.name] = (s.tools[b.name] || 0) + 1;
      const key = EDITS[b.name], rel = key && repoRelative(b.input?.[key], main);
      if (rel && !s.edited.includes(rel)) s.edited.push(rel);
      if (b.name === 'Bash') for (const subject of commitSubjects(b.input?.command)) s.subjects.push({ subject, at: o.timestamp });
    }
  }
  if (o.type === 'user') for (const b of content) {
    if (b.type !== 'tool_result') continue;
    for (const c of commitLines(resultText(b.content))) if (!s.commits.some(x => x.sha === c.sha)) s.commits.push({ ...c, at: o.timestamp });
  }
  return words;
}

// Total tokens, each message counted once however many lines streamed it.
export function tokensOf(s) {
  const t = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  for (const [k, v] of Object.entries(s.usage)) { if (k.startsWith('seen:')) continue; t.in += v[0]; t.out += v[1]; t.cacheRead += v[2]; t.cacheWrite += v[3]; }
  return t;
}

// The name the list shows: one the person gave, else Claude's, else the first prompt.
export const titleOf = s => s.customTitle || s.aiTitle || s.firstPrompt || s.id;

// The complete lines added to a file since `offset`, and the offset after the last one. A line still being written
// (no newline yet) waits for the next read.
export function readNew(file, offset, size) {
  if (size <= offset) return { lines: [], offset };
  const fd = openSync(file, 'r'), chunks = [];
  let at = offset;
  try {
    const buf = Buffer.alloc(1 << 20);
    while (at < size) { const n = readSync(fd, buf, 0, Math.min(buf.length, size - at), at); if (!n) break; chunks.push(Buffer.from(buf.subarray(0, n))); at += n; }
  } finally { closeSync(fd); }
  const all = Buffer.concat(chunks), last = all.lastIndexOf(10);
  if (last < 0) return { lines: [], offset };
  return { lines: all.subarray(0, last).toString('utf8').split('\n'), offset: offset + last + 1 };
}

const parse = l => { try { return JSON.parse(l); } catch { return null; } };

// ---- the index on disk ----

let memo = null;

export function indexDir(cache) { return join(cache, 'hq', 'conversations'); }

function loadIndexFile(dir, main) {
  try {
    const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    if (idx.version === INDEX_VERSION && idx.main === main) return idx;
  } catch { /* none yet, or unreadable: start again */ }
  return { version: INDEX_VERSION, main, files: {}, sessions: {} };
}

// Every transcript file of every session in the folders: the session's own file and its subagents'.
function transcriptFiles(folders) {
  const out = [];
  for (const folder of folders) {
    let names = [];
    try { names = readdirSync(folder); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith('.jsonl')) continue;
      const id = f.slice(0, -6);
      out.push({ file: join(folder, f), id, folder, sub: false });
      const subs = join(folder, id, 'subagents');
      if (existsSync(subs)) for (const s of readdirSync(subs)) if (s.endsWith('.jsonl')) out.push({ file: join(subs, s), id, folder, sub: true });
    }
  }
  return out;
}

// Brings the index up to date and answers it: { main, sessions: [...], at, readBytes }. projectsDir defaults to
// ~/.claude/projects (CLAUDE_CONFIG_DIR moves it, as it does for Claude Code).
export async function conversationsIndex({ repo, cache, projectsDir, git = runGit }) {
  const main = await mainCheckout(repo, git);
  const pdir = projectsDir || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  const dir = indexDir(cache);
  const idx = memo && memo.dir === dir && memo.idx.main === main ? memo.idx : loadIndexFile(dir, main);
  const files = transcriptFiles(projectFolders(pdir, main));
  let readBytes = 0, changed = false;
  const present = new Set(), stats = new Map();
  for (const t of files) { try { stats.set(t.file, statSync(t.file)); } catch { /* gone between listing and reading */ } }
  // a file that shrank was replaced or rewritten: read its whole session again, every file of it
  for (const t of files) {
    const st = stats.get(t.file), was = idx.files[t.file];
    if (!st || !was || st.size >= was.offset) continue;
    idx.sessions[t.id] = newSession(t.id, t.folder);
    for (const k of Object.keys(idx.files)) if (idx.files[k].session === t.id) delete idx.files[k];
    try { writeFileSync(join(dir, 'text', `${t.id}.txt`), ''); } catch { /* none */ }
    changed = true;
  }
  for (const t of files) {
    const st = stats.get(t.file);
    if (!st) continue;
    present.add(t.id);
    let s = idx.sessions[t.id];
    if (!s) { s = idx.sessions[t.id] = newSession(t.id, t.folder); changed = true; }
    const from = idx.files[t.file]?.offset || 0;
    if (st.size > from) {
      const { lines, offset } = readNew(t.file, from, st.size);
      readBytes += offset - from;
      let words = '';
      for (const l of lines) { const o = parse(l); if (o && !(t.sub && o.type === 'user' && !o.isSidechain)) words += absorb(s, t.sub ? { ...o, isSidechain: true } : o, main); }
      if (words) { mkdirSync(join(dir, 'text'), { recursive: true }); appendFileSync(join(dir, 'text', `${t.id}.txt`), words); }
      idx.files[t.file] = { size: st.size, mtimeMs: st.mtimeMs, offset, session: t.id };
      changed = true;
    }
    s.gone = false;
  }
  for (const s of Object.values(idx.sessions)) {
    const gone = !present.has(s.id);
    if (gone !== s.gone) { s.gone = gone; changed = true; }
    s.subagents = files.filter(f => f.sub && f.id === s.id).length;
  }
  // a folder shares the prefix but its sessions ran somewhere else: not this repo
  const sessions = Object.values(idx.sessions).filter(s => !s.cwd || s.cwds.some(c => belongs(c, main)));
  if (changed) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'index.json'), JSON.stringify(idx)); }
  memo = { dir, idx, at: Date.now() };
  return { main, projectsDir: pdir, sessions: sessions.map(s => ({ ...s, title: titleOf(s), tokens: tokensOf(s) })), readBytes };
}

// Each session's commits as shas: git's own lines when it printed them, else the subjects of its git commit commands
// matched against git's log within the session's time.
// since: read git's log from there, for a few sessions matched as part of a longer list; by default, the earliest of these.
export async function resolveCommits(repo, sessions, git = runGit, { since = sessions.map(s => s.started).filter(Boolean).sort()[0] } = {}) {
  if (!since) return sessions;
  const log = await git(['log', '--all', `--since=${new Date(new Date(since) - 86400000).toISOString()}`, '--format=%H%x09%cI%x09%s'], repo);
  const commits = log.split('\n').filter(Boolean).map(l => { const [sha, at, ...s] = l.split('\t'); return { sha, at, subject: s.join('\t') }; });
  return sessions.map(s => {
    const found = [...s.commits];
    for (const want of s.subjects) {
      const t = new Date(want.at || s.started);
      const hit = commits.filter(c => c.subject === want.subject && Math.abs(new Date(c.at) - t) < 3 * 3600000 && !found.some(f => f.sha.startsWith(c.sha.slice(0, 7)) || c.sha.startsWith(f.sha)))
        .sort((a, b) => Math.abs(new Date(a.at) - t) - Math.abs(new Date(b.at) - t))[0];
      if (hit) found.push({ sha: hit.sha, subject: hit.subject, at: hit.at });
    }
    return { ...s, commitsFound: found };
  });
}

// Which sessions mention each backlog item, by its file name or its title, in what people and Claude wrote.
export function mentions(cache, sessions, items) {
  const out = new Map(items.map(i => [i.slug, []]));
  for (const s of sessions) {
    let text = '';
    try { text = readFileSync(join(indexDir(cache), 'text', `${s.id}.txt`), 'utf8').toLowerCase(); } catch { continue; }
    for (const i of items) if (text.includes(i.slug) || (i.title.length > 12 && text.includes(i.title.toLowerCase()))) out.get(i.slug).push(s.id);
  }
  return out;
}

// Sessions whose text holds every word of the query, with a snippet around the first.
export function search(cache, sessions, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const s of sessions) {
    let text = '';
    try { text = readFileSync(join(indexDir(cache), 'text', `${s.id}.txt`), 'utf8'); } catch { continue; }
    const low = text.toLowerCase();
    if (!words.every(w => low.includes(w))) continue;
    const at = low.indexOf(words[0]);
    out.push({ id: s.id, snippet: text.slice(Math.max(0, at - 80), at + 160).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

// Sessions running now: the test slot's board (scripts/lock.mjs) records each session's id and its claude process.
export function runningNow(cache) {
  const dir = join(cache, 'lock', 'board'), out = new Set();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    try {
      const b = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (b.session && b.claudePid) { try { process.kill(b.claudePid, 0); out.add(b.session); } catch (e) { if (e.code === 'EPERM') out.add(b.session); } }
    } catch { /* unreadable */ }
  }
  return out;
}

// ---- one transcript, read line by line ----

// The transcript's turns: each a person's prompt and what followed it, until the next prompt. Only turns from..to
// (by prompt number, 0 first) are kept, so a long transcript is read through but never held whole. Tool results are
// cut to `cap` characters.
export async function readTurns(file, { from = 0, to = Infinity, cap = 3000 } = {}) {
  const turns = [], pending = new Map();
  let n = -1, cur = null, lead = null;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const o = parse(line);
    if (!o || o.isSidechain) continue;
    const p = promptText(o);
    if (p != null) { n++; cur = n >= from && n <= to ? { n, at: o.timestamp, prompt: p, items: [] } : null; if (cur) turns.push(cur); continue; }
    const target = cur || (n < 0 && from === 0 ? (lead ||= { n: -1, at: o.timestamp, prompt: '', items: [] }) : null);
    if (!target) continue;
    const content = Array.isArray(o.message?.content) ? o.message.content : [];
    if (o.type === 'assistant') {
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) {
          const last = target.items[target.items.length - 1];
          // streamed pieces of one message arrive as separate lines with the same id
          if (last && last.kind === 'text' && last.id === o.message.id) last.text += b.text; else target.items.push({ kind: 'text', id: o.message.id, text: b.text });
        }
        if (b.type === 'tool_use') { const item = { kind: 'tool', id: b.id, name: b.name, input: b.input || {}, result: null, size: 0 }; target.items.push(item); pending.set(b.id, item); }
      }
    } else if (o.type === 'user') {
      for (const b of content) {
        if (b.type !== 'tool_result' || !pending.has(b.tool_use_id)) continue;
        const item = pending.get(b.tool_use_id), text = resultText(b.content);
        item.size = text.length; item.result = text.slice(0, cap); item.error = !!b.is_error;
        if (o.toolUseResult && typeof o.toolUseResult === 'object' && o.toolUseResult.agentId) item.agentId = o.toolUseResult.agentId;
        pending.delete(b.tool_use_id);
      }
    }
  }
  if (lead && lead.items.length) turns.unshift(lead);
  return { turns, prompts: n + 1 };
}

// The subagent transcripts beside a session, by agent id, with what their .meta.json says.
export function subagentsOf(folder, id) {
  const dir = join(folder, id, 'subagents'), out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const agentId = f.replace(/^agent-/, '').slice(0, -6);
    let meta = {};
    try { meta = JSON.parse(readFileSync(join(dir, f.replace(/\.jsonl$/, '.meta.json')), 'utf8')); } catch { /* none */ }
    out.push({ agentId, file: join(dir, f), ...meta });
  }
  return out;
}

// A subagent's transcript is all sidechain: its first user line is the prompt it was given.
export async function readAgent(file, { cap = 3000 } = {}) {
  const items = [], pending = new Map();
  let prompt = '';
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const o = parse(line);
    if (!o) continue;
    const content = Array.isArray(o.message?.content) ? o.message.content : [];
    if (o.type === 'user' && !prompt && typeof o.message?.content === 'string') { prompt = o.message.content; continue; }
    if (o.type === 'user' && !prompt && content.every(b => b.type === 'text')) { prompt = content.map(b => b.text).join('\n'); continue; }
    if (o.type === 'assistant') for (const b of content) {
      if (b.type === 'text' && b.text?.trim()) { const last = items[items.length - 1]; if (last && last.kind === 'text' && last.id === o.message.id) last.text += b.text; else items.push({ kind: 'text', id: o.message.id, text: b.text }); }
      if (b.type === 'tool_use') { const it = { kind: 'tool', id: b.id, name: b.name, input: b.input || {}, result: null, size: 0 }; items.push(it); pending.set(b.id, it); }
    }
    if (o.type === 'user') for (const b of content) {
      if (b.type !== 'tool_result' || !pending.has(b.tool_use_id)) continue;
      const it = pending.get(b.tool_use_id), text = resultText(b.content);
      it.size = text.length; it.result = text.slice(0, cap); it.error = !!b.is_error; pending.delete(b.tool_use_id);
    }
  }
  return { prompt, items };
}

// The current backlog items, for mentions.
export const backlogItems = repo => { try { return loadItems(repo); } catch { return []; } };

// Where a session's own transcript file is (it may be gone).
export const transcriptPath = s => join(s.folder, `${s.id}.jsonl`);
