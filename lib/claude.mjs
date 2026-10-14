// Claude from HQ, two ways. Open in Claude writes the comments to a file and opens a new Terminal running an
// ordinary interactive `claude` in the repo with them as the first message, or continues a conversation there. Chat
// runs `claude -p` behind the Chat panel with only Read, Grep and Glob, so it can answer questions about the code and
// docs but change nothing.
//
// Both are meant to draw on the developer's Claude subscription, never on API credits. An API key in the environment
// makes claude bill the Console instead, so Chat runs claude without ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN, and
// Open in Claude's script asks before starting with one set. Bedrock, Vertex or Foundry would bill a cloud account,
// which HQ cannot undo, so Chat refuses to run and says why. The panel shows what claude itself reports: the login it
// used (apiKeySource) and how much of the plan's limits is used.
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync, chmodSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

// Environment variables that decide who pays. 'strip' ones HQ leaves out of the claude it runs; 'block' ones it
// cannot work around.
export const BILLING_VARS = {
  ANTHROPIC_API_KEY: 'strip', ANTHROPIC_AUTH_TOKEN: 'strip',
  CLAUDE_CODE_USE_BEDROCK: 'block', CLAUDE_CODE_USE_VERTEX: 'block', CLAUDE_CODE_USE_FOUNDRY: 'block',
};

// Which of them are set, which HQ removes, and whether Chat can run on the subscription at all.
export function billing(env = process.env) {
  const set = Object.keys(BILLING_VARS).filter(k => env[k]);
  const stripped = set.filter(k => BILLING_VARS[k] === 'strip'), blocked = set.filter(k => BILLING_VARS[k] === 'block');
  return { set, stripped, blocked, ok: !blocked.length };
}

// The environment Chat runs claude in: HQ's own, without the API keys.
export function childEnv(env = process.env) {
  const out = { ...env };
  for (const [k, how] of Object.entries(BILLING_VARS)) if (how === 'strip') delete out[k];
  return out;
}

export const ASK_TOOLS = ['Read', 'Grep', 'Glob'];
export const ASK_PROMPT = 'You are answering questions asked from HQ, a read-only page for the developers of this repo. ' +
  'You can read files but not change them or run anything. If asked for a change, say what you would change and where, and suggest ' +
  'Open in Claude (a full session in a terminal) to make it. Keep answers short and name files as repo paths.';

// The arguments for Chat. The question goes in on stdin, so nothing typed in the browser is ever an argument.
// --restricted takes away every tool that runs code and ignores the settings files that could allow more; --tools
// leaves only the three readers; dontAsk refuses anything else without waiting for an answer nobody can give.
// With fork, the conversation carries on in a copy with an id of its own, and the original is left as it was: the way
// to keep chatting in the browser while a terminal carries on the original.
export function askArgs({ session, fork = false } = {}) {
  return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--restricted', '--strict-mcp-config', '--tools', ASK_TOOLS.join(','), '--allowedTools', ASK_TOOLS.join(','),
    '--permission-mode', 'dontAsk', '--append-system-prompt', ASK_PROMPT, ...(session ? ['--resume', session, ...(fork ? ['--fork-session'] : [])] : [])];
}

// What Chat sends claude: the question, and where the person is in HQ, so "this file" means something.
export function askPrompt({ question, file, title, page } = {}) {
  const where = [file && `the file ${file}`, title && `titled "${title}"`, page && `(HQ page ${page})`].filter(Boolean).join(' ');
  return `${where ? `I am looking at ${where} in HQ.\n\n` : ''}${String(question || '').trim()}`;
}

// A session id claude gave back, checked before it becomes an argument again.
export const validSession = s => (typeof s === 'string' && /^[0-9a-f-]{16,64}$/i.test(s) ? s : null);

// One line of claude's stream-json as what the panel needs, or null for the lines it does not show.
export function mapEvent(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'system' && o.subtype === 'init') return { type: 'start', session: o.session_id, model: o.model, login: o.apiKeySource, tools: o.tools };
  if (o.type === 'stream_event' && o.event?.type === 'content_block_delta' && o.event.delta?.type === 'text_delta') return { type: 'text', text: o.event.delta.text };
  if (o.type === 'assistant') {
    const uses = (o.message?.content || []).filter(c => c.type === 'tool_use');
    if (uses.length) return { type: 'tools', uses: uses.map(u => ({ name: u.name, on: u.input?.file_path || u.input?.pattern || u.input?.path || '' })) };
    return null;
  }
  if (o.type === 'rate_limit_event') {
    const i = o.rate_limit_info || {}, w = i.unifiedWindows || {};
    return { type: 'limits', status: i.status, fiveHour: w.five_hour?.utilization ?? null, week: w.seven_day?.utilization ?? null,
      fiveHourResets: w.five_hour?.resetsAt ?? null, weekResets: w.seven_day?.resetsAt ?? null, overage: !!i.isUsingOverage };
  }
  if (o.type === 'result') {
    const u = o.usage || {};
    return { type: 'done', session: o.session_id, error: !!o.is_error, text: o.result || '', ms: o.duration_ms, turns: o.num_turns,
      tokens: { in: u.input_tokens || 0, out: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 },
      refused: (o.permission_denials || []).length };
  }
  return null;
}

// The answer so far, rendered as it streams, so Chat shows it as the finished answer will look rather than as raw
// markdown. Rendering the whole text again for every few characters would cost more the longer the answer got, so
// only the first piece and every `every`th after it are rendered. pause() renders what those left out, when claude
// stops writing to read a file, and puts what it writes next in a paragraph of its own.
export function answerSoFar(render, every = 8) {
  let text = '', pieces = 0, waiting = false, broke = false;
  const now = () => { waiting = false; return render(text); };
  return {
    add(piece) {
      if (broke) { text += '\n\n'; broke = false; }
      text += piece; pieces++; waiting = true;
      return pieces === 1 || pieces % every === 0 ? now() : undefined;
    },
    pause() { broke = !!text; return waiting ? now() : undefined; },
  };
}

// What the login claude reported means for the bill.
export function loginMeaning(source) {
  if (!source || source === 'none') return { subscription: true, text: 'your Claude subscription (claude.ai login)' };
  return { subscription: false, text: `an API key (${source}): this bills API credits, not your subscription` };
}

// ---- Open in Claude ----

const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// The script Terminal runs: into the repo, a check for keys that would bill API credits, then claude with the
// comments as its first message. zsh, because macOS gives each Terminal window a zsh and -l loads the login profile,
// so the check sees the environment claude will get.
export function openScript({ repo, promptFile, resume, claudePath = 'claude' }) {
  return `#!/bin/zsh -l
# Written by HQ (lib/claude.mjs). Starts an interactive claude in the repo, with your comments as the
# first message, or resumes a conversation, with a message when one is given. Safe to delete.
cd -- ${shellQuote(repo)} || exit 1
for v in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; do
  if [[ -n "\${(P)v}" ]]; then
    print -P "%F{yellow}$v is set in this shell, so claude would bill API credits instead of your subscription.%f"
    if read -q "?Unset it for this session and use your subscription? [y/n] "; then unset $v; fi; echo
  fi
done
for v in CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY; do
  [[ -n "\${(P)v}" ]] && print -P "%F{red}$v is set: this session bills that cloud account, not your subscription.%f"
done
${resume ? `exec ${shellQuote(claudePath)} --resume ${shellQuote(resume)}${promptFile ? ` "$(cat -- ${shellQuote(promptFile)})"` : ''}` : `exec ${shellQuote(claudePath)} "$(cat -- ${shellQuote(promptFile)})"`}
`;
}

const KEEP_MS = 7 * 86400000;

// Which terminal opens: iTerm when it is installed, else Terminal. HQ_TERMINAL=terminal or iterm picks one.
export function pickTerminal({ env = process.env, has = p => { try { return statSync(p).isDirectory(); } catch { return false; } }, home = env.HOME || '' } = {}) {
  const asked = String(env.HQ_TERMINAL || '').toLowerCase();
  const iterm = has('/Applications/iTerm.app') || (home && has(join(home, 'Applications', 'iTerm.app')));
  if (asked === 'terminal' || (!iterm && asked !== 'iterm')) return 'Terminal';
  return iterm ? 'iTerm' : 'Terminal';
}

// How to start the script in that terminal. Terminal runs a .command file it is handed; iTerm is asked through
// AppleScript for a new window running it, with the path as an argument, never inside the script's text. The first
// time, macOS asks whether the program running HQ may control iTerm.
export function terminalCommand(terminal, script) {
  if (terminal !== 'iTerm') return ['open', [script]];
  return ['osascript', ['-e', 'on run argv', '-e', 'tell application "iTerm"', '-e', 'activate',
    '-e', 'create window with default profile command (quoted form of (item 1 of argv))', '-e', 'end tell', '-e', 'end run', script]];
}

// Brings to the front the terminal tab whose device is `tty` (a running backlog hunter pass, Take control), as
// [command, args]. The tty goes in as an argument, never inside the script's text, and the script fails when no tab
// has it, so a caller reads only the exit status.
export function focusTabCommand(terminal, tty) {
  const lines = terminal === 'iTerm'
    ? ['on run argv', 'set t to item 1 of argv', 'tell application "iTerm"', 'repeat with w in windows', 'repeat with tb in tabs of w',
      'repeat with s in sessions of tb', 'if tty of s is t then', 'select w', 'tell tb to select', 'tell s to select', 'activate', 'return "found"',
      'end if', 'end repeat', 'end repeat', 'end repeat', 'end tell', 'error "no tab has " & t', 'end run']
    : ['on run argv', 'set t to item 1 of argv', 'tell application "Terminal"', 'repeat with w in windows', 'repeat with tb in tabs of w',
      'if tty of tb is t then', 'set selected of tb to true', 'set index of w to 1', 'activate', 'return "found"',
      'end if', 'end repeat', 'end repeat', 'end tell', 'error "no tab has " & t', 'end run'];
  return ['osascript', [...lines.flatMap(l => ['-e', l]), tty]];
}

// Writes the comments and the script under the cache folder, clears ones older than a week, and opens the script in a
// new window of `terminal` (pickTerminal). Answers { status, message }.
// With resume, the script continues that conversation (in `cwd`, where claude filed it) instead of starting one.
// `startIn` starts a new one in another folder than the repo; only the server sets it (the backlog hunter's
// checkout, for Start a pass), never a page.
export async function openInClaude({ repo, cache, text, resume, cwd, startIn, platform = process.platform, run, claudePath, terminal = 'Terminal', now = Date.now() }) {
  if (platform !== 'darwin') return { status: 501, message: 'Opening a Terminal works on macOS only for now. Copy the text or the resume command instead.' };
  if (resume != null && !validSession(resume)) return { status: 400, message: 'That is not a conversation id.' };
  if (!resume && !String(text || '').trim()) return { status: 400, message: 'Nothing to send.' };
  const dir = join(cache, 'hq', 'claude');
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) { try { if (now - statSync(join(dir, f)).mtimeMs > KEEP_MS) unlinkSync(join(dir, f)); } catch { /* gone */ } }
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const promptFile = join(dir, `${stamp}.md`), script = join(dir, `${stamp}.command`);
  // a resumed conversation takes a first message too when one is given (the hunter's deck answers)
  const message = String(text || '').trim() ? promptFile : null;
  if (message) writeFileSync(promptFile, text);
  writeFileSync(script, openScript({ repo: resume ? cwd || repo : startIn || repo, promptFile: message, resume, claudePath }));
  chmodSync(script, 0o700);
  const [cmd, args] = terminalCommand(terminal, script);
  const err = await run(cmd, args);
  if (err) return { status: 502, message: `${terminal} did not open: ${(err.stderr || err.message || '').trim().split('\n').pop()}` };
  return { status: 200, message: resume ? `Opened a new ${terminal} window continuing the conversation.` : `Opened a new ${terminal} window with claude.` };
}

// The folder claude keeps a directory's conversations in: ~/.claude/projects/ and the directory with every character
// that is not a letter, digit or hyphen turned into a hyphen.
export const projectFolder = (dir, home) => join(home, '.claude', 'projects', String(dir).replace(/[^A-Za-z0-9-]/g, '-'));

// Where claude is and its version, or null when it is not installed.
export const findClaude = () => new Promise(done => {
  execFile('claude', ['--version'], { timeout: 10000, windowsHide: true }, (err, out) => {
    if (err) return done(null);
    execFile('/usr/bin/which', ['claude'], { timeout: 5000 }, (e2, where) => done({ version: String(out).trim(), path: e2 ? 'claude' : String(where).trim() }));
  });
});

// What changes when claude is updated: the file its path leads to, and that file's time. '' when it cannot be read.
export function programStamp(path) {
  try { const real = realpathSync(path), st = statSync(real); return `${real}:${st.mtimeMs}:${st.size}`; } catch { return ''; }
}
