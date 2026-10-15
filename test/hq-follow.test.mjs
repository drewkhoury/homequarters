// Proves: following a conversation that carries on in a terminal (lib/follow.mjs): which lines of a transcript the
// panel shows and where the transcript is. The route and the stream are in hq-server.test.mjs.
// Why: the panel shows a live transcript; the wrong lines, or the wrong file, show someone else's conversation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { turnsFrom, sessionFile } from '../lib/follow.mjs';
import { askArgs } from '../lib/claude.mjs';

const SESSION = '2dd45ba5-8d8f-46a6-8f53-610e4ea5c1fd';
// Transcript lines as claude writes them in a terminal session, cut to the fields followed.
const PROMPT = { type: 'user', uuid: 'u1', timestamp: '2026-09-29T01:10:00Z', message: { role: 'user', content: 'Now make the change.' } };
const COMMAND = { type: 'user', uuid: 'u2', message: { role: 'user', content: '<command-name>/clear</command-name>' } };
const TOOL = { type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/web/app.js' } }] } };
const RESULT = { type: 'user', uuid: 'u3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } };
const ANSWER = { type: 'assistant', uuid: 'a2', timestamp: '2026-09-29T01:10:09Z', message: { id: 'm1', content: [{ type: 'text', text: 'Done: `web/app.js` now rounds down.' }] } };
const SUBAGENT = { type: 'assistant', uuid: 'a3', isSidechain: true, message: { content: [{ type: 'text', text: 'from a subagent' }] } };
const lines = (...o) => o.map(x => JSON.stringify(x));

test('the panel gets the person\'s prompts, Claude\'s text and each tool call, in order; tool results, commands and subagents stay out', () => {
  assert.deepEqual(turnsFrom(lines(PROMPT, COMMAND, TOOL, RESULT, ANSWER, SUBAGENT)), [
    { type: 'you', text: 'Now make the change.', at: '2026-09-29T01:10:00Z' },
    { type: 'tool', name: 'Edit', on: '/repo/web/app.js' },
    { type: 'claude', text: 'Done: `web/app.js` now rounds down.', at: '2026-09-29T01:10:09Z' },
  ]);
});

test('a line read twice is sent once, and a line cut off mid-write is skipped', () => {
  const seen = new Set();
  assert.equal(turnsFrom(lines(PROMPT), seen).length, 1);
  assert.equal(turnsFrom([...lines(PROMPT), '{"type":"assist'], seen).length, 0);
});

test('the transcript is found in whichever of the repo\'s session folders holds it', () => {
  const projects = mkdtempSync(join(tmpdir(), 'hq-projects-'));
  const main = '/Users/dev/repos/questkeep';
  mkdirSync(join(projects, '-Users-dev-repos-questkeep'));
  mkdirSync(join(projects, '-Users-dev-repos-questkeep-sync'));
  writeFileSync(join(projects, '-Users-dev-repos-questkeep-sync', `${SESSION}.jsonl`), '');
  assert.equal(sessionFile({ projectsDir: projects, main, id: SESSION }), join(projects, '-Users-dev-repos-questkeep-sync', `${SESSION}.jsonl`));
  assert.equal(sessionFile({ projectsDir: projects, main, id: '00000000-0000-0000-0000-000000000000' }), null);
  rmSync(projects, { recursive: true, force: true });
});

test('branching off resumes the conversation as a copy; without a conversation there is nothing to fork', () => {
  assert.deepEqual(askArgs({ session: SESSION, fork: true }).slice(-3), ['--resume', SESSION, '--fork-session']);
  assert.ok(!askArgs({ fork: true }).includes('--fork-session'));
});
