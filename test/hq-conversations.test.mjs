// The conversations index (hq/lib/conversations.mjs): which transcript folders are this repo's, what the list shows
// for each session, reading only what was added since, and the transcript read a page of turns at a time. Every test
// builds its own small ~/.claude/projects in a temp folder, and git is answered by a stub, so nothing real is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  escapePath, belongs, repoRelative, promptText, commitSubjects, commitLines, conversationsIndex, resolveCommits,
  mentions, search, readTurns, sourceOf,
} from '../lib/conversations.mjs';

// The repo lives at MAIN; its backlog worktree beside it, as git worktree add makes them here.
const MAIN = '/work/questkeep', WORKTREE = '/work/questkeep-backlog';
const git = async args => (args.includes('--git-common-dir') ? `${MAIN}/.git\n` : '');
const A = '11111111-aaaa-4aaa-8aaa-111111111111', B = '22222222-bbbb-4bbb-8bbb-222222222222', OTHER = '33333333-cccc-4ccc-8ccc-333333333333';
const line = o => `${JSON.stringify(o)}\n`;
const base = (t, extra = {}) => ({ sessionId: A, cwd: MAIN, gitBranch: 'main', entrypoint: 'cli', timestamp: `2026-09-28T${t}:00Z`, ...extra });
const HEREDOC = "git -C /work/questkeep-backlog commit -q -F - <<'EOF'\nfeat(hq): the backlog becomes files\n\nWhy it moved.\nEOF";

// A terminal session: a title, two prompts around command noise, a reply streamed as two lines of one message, an
// edit in the worktree, a commit, and a tool result.
const SESSION_A = [
  { type: 'ai-title', aiTitle: 'Backlog review', sessionId: A },
  { type: 'user', ...base('10:00'), message: { role: 'user', content: 'Move the backlog into files; start with which-day-counts.' } },
  { type: 'user', ...base('10:00'), message: { role: 'user', content: '<command-name>/clear</command-name>' } },
  { type: 'user', ...base('10:00'), isMeta: true, message: { role: 'user', content: 'Caveat: meta' } },
  { type: 'assistant', ...base('10:01'), message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'Moving ' }], usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 } } },
  { type: 'assistant', ...base('10:01'), message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'it now.' }], usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 } } },
  { type: 'assistant', ...base('10:02'), message: { id: 'msg_2', role: 'assistant', usage: { input_tokens: 200, output_tokens: 20 }, content: [
    { type: 'tool_use', id: 'tu_edit', name: 'Edit', input: { file_path: `${WORKTREE}/hq/lib/backlog.mjs`, old_string: 'a', new_string: 'b' } },
    { type: 'tool_use', id: 'tu_outside', name: 'Write', input: { file_path: '/tmp/scratch.txt', content: 'x' } },
    { type: 'tool_use', id: 'tu_commit', name: 'Bash', input: { command: HEREDOC } },
  ] } },
  { type: 'user', ...base('10:03'), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_edit', content: 'The file was updated.' }, { type: 'tool_result', tool_use_id: 'tu_commit', content: '[explore/backlog 492e951] feat(hq): the backlog becomes files' }] } },
];
const PROMPT_2 = { type: 'user', ...base('11:00', { gitBranch: 'explore/backlog' }), message: { role: 'user', content: [{ type: 'text', text: 'And now the board.' }] } };
const REPLY_2 = { type: 'assistant', ...base('11:01'), message: { id: 'msg_3', role: 'assistant', usage: { input_tokens: 10, output_tokens: 7 }, content: [{ type: 'text', text: 'Board done.' }] } };
// Its subagent, in a file of its own, all sidechain.
const SUBAGENT = [
  { type: 'user', ...base('10:05'), isSidechain: true, agentId: 'a1', message: { role: 'user', content: 'Review the move.' } },
  { type: 'assistant', ...base('10:06'), isSidechain: true, agentId: 'a1', message: { id: 'msg_s1', role: 'assistant', usage: { input_tokens: 50, output_tokens: 5 }, content: [{ type: 'tool_use', id: 'tu_s', name: 'Edit', input: { file_path: `${MAIN}/web/app.js` } }] } },
];
// HQ's Chat, run as claude -p in the worktree, with HQ's note of where it was asked.
const SESSION_B = [
  { type: 'user', sessionId: B, cwd: WORKTREE, gitBranch: 'explore/backlog', entrypoint: 'sdk-cli', timestamp: '2026-09-29T09:00:00Z', message: { role: 'user', content: 'I am looking at the file docs/backlog/README.md in QuestKeep HQ.\n\nWhere is MAX_INBOX set?' } },
];
// A project whose folder name looks like a worktree of this repo, but whose sessions ran somewhere else.
const LOOKALIKE = [{ type: 'user', sessionId: OTHER, cwd: '/work/questkeep.notes', entrypoint: 'cli', timestamp: '2026-09-27T09:00:00Z', message: { role: 'user', content: 'Unrelated.' } }];

function world() {
  const root = mkdtempSync(join(tmpdir(), 'hq-conv-'));
  const projects = join(root, 'projects'), cache = join(root, 'cache');
  const fa = join(projects, escapePath(MAIN)), fb = join(projects, escapePath(WORKTREE)), fo = join(projects, escapePath('/work/questkeep.notes')), fx = join(projects, escapePath('/work/questkeeper'));
  for (const d of [fa, fb, fo, fx, join(fa, A, 'subagents')]) mkdirSync(d, { recursive: true });
  const fileA = join(fa, `${A}.jsonl`);
  writeFileSync(fileA, SESSION_A.map(line).join(''));
  writeFileSync(join(fa, A, 'subagents', 'agent-a1.jsonl'), SUBAGENT.map(line).join(''));
  writeFileSync(join(fb, `${B}.jsonl`), SESSION_B.map(line).join(''));
  writeFileSync(join(fo, `${OTHER}.jsonl`), LOOKALIKE.map(line).join(''));
  writeFileSync(join(fx, 'x.jsonl'), LOOKALIKE.map(line).join(''));
  return { root, projects, cache, fileA, done: () => rmSync(root, { recursive: true, force: true }) };
}
const index = w => conversationsIndex({ repo: WORKTREE, cache: w.cache, projectsDir: w.projects, git });
const byId = (r, id) => r.sessions.find(s => s.id === id);

test('Claude Code names a folder by its path with every other character a hyphen', () => {
  assert.equal(escapePath('/Users/drew/repos/questkeep-backlog'), '-Users-drew-repos-questkeep-backlog');
  assert.equal(escapePath('/a/b.c_d'), '-a-b-c-d');
});

test('the main checkout, a folder in it and a worktree beside it belong; a lookalike does not', () => {
  for (const c of [MAIN, `${MAIN}/web`, WORKTREE, `${WORKTREE}/hq`]) assert.equal(belongs(c, MAIN), true, c);
  for (const c of ['/work/questkeeper', '/work/questkeep.notes', '/elsewhere']) assert.equal(belongs(c, MAIN), false, c);
  assert.equal(repoRelative(`${WORKTREE}/hq/lib/x.mjs`, MAIN), 'hq/lib/x.mjs');
  assert.equal(repoRelative('/tmp/x', MAIN), null);
});

test('only a person\'s prompts count as prompts: not commands, meta lines or tool results', () => {
  assert.equal(promptText(SESSION_A[1]), 'Move the backlog into files; start with which-day-counts.');
  for (const o of [SESSION_A[2], SESSION_A[3], SESSION_A[7]]) assert.equal(promptText(o), null);
  assert.equal(promptText(PROMPT_2), 'And now the board.');
});

test('a commit\'s subject comes from its heredoc or -m, and git\'s own [branch sha] line gives the sha', () => {
  assert.deepEqual(commitSubjects(HEREDOC), ['feat(hq): the backlog becomes files']);
  assert.deepEqual(commitSubjects('git commit -q -m "fix: one thing" -m "body"'), ['fix: one thing']);
  assert.deepEqual(commitSubjects('git commit --amend --no-edit'), []);
  assert.deepEqual(commitSubjects('git status'), []);
  assert.deepEqual(commitLines('[main (root-commit) abc1234] first\n[explore/backlog 492e951] feat: x'), [
    { branch: 'main', sha: 'abc1234', subject: 'first' }, { branch: 'explore/backlog', sha: '492e951', subject: 'feat: x' }]);
});

test('the index finds this repo\'s sessions and leaves out a project that only shares the prefix', async () => {
  const w = world();
  try {
    const r = await index(w);
    assert.equal(r.main, MAIN);
    assert.deepEqual(r.sessions.map(s => s.id).sort(), [A, B]);
  } finally { w.done(); }
});

test('a session\'s title, source, prompts, tokens (each message once), files changed and commits', async () => {
  const w = world();
  try {
    const a = byId(await index(w), A), b = byId(await index(w), B);
    assert.equal(a.title, 'Backlog review');
    assert.equal(b.title, 'Where is MAX_INBOX set?', 'HQ\'s note of where it was asked is not the title');
    assert.deepEqual([sourceOf(a.entrypoint), sourceOf(b.entrypoint)], ['terminal', 'HQ chat / claude -p']);
    assert.equal(a.prompts, 1);
    // msg_1 streamed twice counts once, at its last usage; the subagent's tokens count too
    assert.deepEqual(a.tokens, { in: 100 + 200 + 50, out: 40 + 20 + 5, cacheRead: 5000, cacheWrite: 300 });
    assert.deepEqual(a.edited, ['hq/lib/backlog.mjs', 'web/app.js'], 'worktree paths made repo-relative; /tmp left out');
    assert.deepEqual(a.commits.map(c => c.sha), ['492e951']);
    assert.deepEqual(a.subjects.map(c => c.subject), ['feat(hq): the backlog becomes files']);
    assert.equal(a.subagents, 1);
  } finally { w.done(); }
});

test('a later request reads only what was added, and a line still being written waits', async () => {
  const w = world();
  try {
    await index(w);
    const before = statSync(w.fileA).size;
    const added = line(PROMPT_2) + line(REPLY_2);
    appendFileSync(w.fileA, added + '{"type":"user","half');
    const r = await index(w);
    assert.equal(r.readBytes, Buffer.byteLength(added));
    const a = byId(r, A);
    assert.equal(a.prompts, 2);
    assert.equal(a.tokens.out, 40 + 20 + 5 + 7);
    assert.deepEqual(a.branches, ['main', 'explore/backlog']);
    assert.ok(statSync(w.fileA).size > before);
    assert.equal((await index(w)).readBytes, 0, 'nothing new: nothing read');
  } finally { w.done(); }
});

test('a transcript that shrank is read again from the start', async () => {
  const w = world();
  try {
    appendFileSync(w.fileA, line(PROMPT_2));
    assert.equal(byId(await index(w), A).prompts, 2);
    truncateSync(w.fileA, SESSION_A.slice(0, 2).map(line).join('').length);
    const a = byId(await index(w), A);
    assert.equal(a.prompts, 1);
    assert.equal(a.tokens.out, 5, 'only the subagent\'s tokens are left');
  } finally { w.done(); }
});

test('a session whose transcript Claude Code deleted stays in the index, marked gone', async () => {
  const w = world();
  try {
    await index(w);
    rmSync(w.fileA); rmSync(join(w.projects, escapePath(MAIN), A), { recursive: true });
    const a = byId(await index(w), A);
    assert.equal(a.gone, true);
    assert.equal(a.title, 'Backlog review');
  } finally { w.done(); }
});

test('mentions of a backlog item and search both read what people and Claude wrote', async () => {
  const w = world();
  try {
    const r = await index(w);
    const said = mentions(w.cache, r.sessions, [{ slug: 'which-day-counts', title: 'Which day a thing counts on' }, { slug: 'sprint', title: 'Sprint' }]);
    assert.deepEqual(said.get('which-day-counts'), [A]);
    assert.deepEqual(said.get('sprint'), []);
    const hits = search(w.cache, r.sessions, 'MAX_INBOX set');
    assert.deepEqual(hits.map(h => h.id), [B]);
    assert.match(hits[0].snippet, /MAX_INBOX/);
    assert.deepEqual(search(w.cache, r.sessions, 'The file was updated'), [], 'tool output is not searched');
  } finally { w.done(); }
});

test('commits found only by their subject are matched to git\'s log within the session\'s time', async () => {
  const s = { id: A, started: '2026-09-28T10:00:00Z', commits: [], subjects: [{ subject: 'feat(hq): the backlog becomes files', at: '2026-09-28T10:02:00Z' }] };
  const log = async () => ['aaaaaaa1\t2026-09-20T10:02:30Z\tfeat(hq): the backlog becomes files', 'bbbbbbb2\t2026-09-28T10:02:30Z\tfeat(hq): the backlog becomes files', 'ccccccc3\t2026-09-28T10:03:00Z\tfix: other'].join('\n');
  const [r] = await resolveCommits('/r', [s], log);
  assert.deepEqual(r.commitsFound.map(c => c.sha), ['bbbbbbb2'], 'the same subject a week earlier is another commit');
});

test('a transcript is read a page of turns at a time, each tool call paired with its result', async () => {
  const w = world();
  try {
    appendFileSync(w.fileA, line(PROMPT_2) + line(REPLY_2));
    const all = await readTurns(w.fileA);
    assert.equal(all.prompts, 2);
    const [first, second] = all.turns;
    assert.deepEqual(first.items.map(i => i.kind === 'text' ? i.text : `${i.name}:${i.result}`), ['Moving it now.', 'Edit:The file was updated.', 'Write:null', 'Bash:[explore/backlog 492e951] feat(hq): the backlog becomes files']);
    assert.equal(second.prompt, 'And now the board.');
    const latest = await readTurns(w.fileA, { from: 1, to: 1 });
    assert.deepEqual(latest.turns.map(t => t.n), [1]);
  } finally { w.done(); }
});
