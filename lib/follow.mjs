// Following a conversation that continues in a terminal. When Chat hands its session to iTerm or Terminal, the
// terminal's claude keeps writing the same transcript file, and the panel shows each new turn as it lands there: HQ
// watches the file and sends what was added. The panel sends nothing meanwhile, so the file only ever has one writer.
// Whether the terminal's claude is still running is read from the process list: a claude started with
// `--resume <id>`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { projectFolders, promptText } from './conversations.mjs';

// The transcript of session `id` in any of this repo's session folders, or null.
export function sessionFile({ projectsDir, main, id }) {
  for (const folder of projectFolders(projectsDir, main)) {
    const f = join(folder, `${id}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

const parse = l => { try { return JSON.parse(l); } catch { return null; } };
const toolOn = input => input?.file_path || input?.pattern || input?.path || (input?.command ? String(input.command).split('\n')[0].slice(0, 80) : '');

// What the panel shows from lines added to a transcript: a person's prompt, Claude's text, and each tool call, in the
// order written. `seen` holds the uuids already sent, so a line read twice is sent once. Subagents' lines are left out.
export function turnsFrom(lines, seen = new Set()) {
  const out = [];
  for (const line of lines) {
    const o = parse(line);
    if (!o || o.isSidechain || (o.uuid && seen.has(o.uuid))) continue;
    if (o.uuid) seen.add(o.uuid);
    const prompt = promptText(o);
    if (prompt) { out.push({ type: 'you', text: prompt, at: o.timestamp }); continue; }
    if (o.type !== 'assistant') continue;
    for (const b of o.message?.content || []) {
      if (b.type === 'text' && b.text.trim()) out.push({ type: 'claude', text: b.text, at: o.timestamp });
      else if (b.type === 'tool_use') out.push({ type: 'tool', name: b.name, on: toolOn(b.input) });
    }
  }
  return out;
}

// Whether a claude continuing session `id` is running: pgrep, no shell, for a command line holding `--resume <id>`.
// Chat's own claude also resumes by id, but the panel sends nothing while it follows, so only the terminal's matches.
export const resumedRunning = id => new Promise(done => {
  execFile('pgrep', ['-f', '--', `--resume '?${id}`], { timeout: 5000, windowsHide: true }, err => done(!err));
});
