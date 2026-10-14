// Claude from HQ (hq/lib/claude.mjs): who pays, what the read-only claude may do, what the panel makes of claude's
// stream, and the script Open in Claude hands to Terminal. No claude runs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, utimesSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { billing, childEnv, askArgs, askPrompt, validSession, mapEvent, loginMeaning, openScript, openInClaude, projectFolder, programStamp, pickTerminal, terminalCommand, focusTabCommand } from '../lib/claude.mjs';

const SESSION = '2dd45ba5-8d8f-46a6-8f53-610e4ea5c1fd';
// Lines as claude 2.1 printed them for `claude -p --output-format stream-json --verbose --include-partial-messages`
// on a Max login (29 September), cut to the fields the panel reads.
const INIT = { type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-opus-5-5', apiKeySource: 'none', tools: ['Read', 'Grep', 'Glob'] };
const DELTA = { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } } };
const LIMITS = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1790671200, isUsingOverage: false,
  unifiedWindows: { five_hour: { utilization: 0.02, resetsAt: 1790671200 }, seven_day: { utilization: 0.04, resetsAt: 1791241200 } } } };
const RESULT = { type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: SESSION, duration_ms: 1455, num_turns: 1, total_cost_usd: 0.0127782, permission_denials: [],
  usage: { input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 11890, cache_creation_input_tokens: 420 } };

test('with no billing variables set, Ask runs on the subscription', () => {
  assert.deepEqual(billing({ PATH: '/bin' }), { set: [], stripped: [], blocked: [], ok: true });
});

test('an API key is left out of the claude HQ runs, so it still uses the subscription, and the rest of the environment stays', () => {
  const env = { PATH: '/bin', HOME: '/Users/dev', ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_AUTH_TOKEN: 'tok' };
  assert.deepEqual(billing(env), { set: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'], stripped: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'], blocked: [], ok: true });
  assert.deepEqual(childEnv(env), { PATH: '/bin', HOME: '/Users/dev' });
});

test('Bedrock, Vertex or Foundry would bill a cloud account HQ cannot undo, so Ask is off', () => {
  for (const k of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
    const b = billing({ [k]: '1' });
    assert.deepEqual([b.ok, b.blocked], [false, [k]], k);
  }
});

test('the read-only claude has the three readers and nothing that runs code or writes', () => {
  const args = askArgs();
  const tools = args[args.indexOf('--tools') + 1].split(',');
  assert.deepEqual(tools, ['Read', 'Grep', 'Glob']);
  for (const flag of ['-p', '--restricted', '--strict-mcp-config']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.ok(!args.some(a => /Bash|Edit|Write|bypass/i.test(a)), args.join(' '));
});

test('a conversation continues by its session id, and nothing else from the browser becomes an argument', () => {
  assert.deepEqual(askArgs({ session: SESSION }).slice(-2), ['--resume', SESSION]);
  for (const bad of ['--dangerously-skip-permissions', 'abc', '../x', 42, null]) assert.equal(validSession(bad), null, String(bad));
});

test('the question tells claude where in HQ it was asked', () => {
  assert.equal(askPrompt({ question: ' What calls this? ', file: 'web/app.js', title: 'app.js', page: '/code/web/app.js' }),
    'I am looking at the file web/app.js titled "app.js" (HQ page /code/web/app.js) in HQ.\n\nWhat calls this?');
  assert.equal(askPrompt({ question: 'Hi' }), 'Hi');
});

test('claude\'s stream becomes start, text, limits and done; the rest is dropped', () => {
  assert.deepEqual(mapEvent(INIT), { type: 'start', session: SESSION, model: 'claude-opus-5-5', login: 'none', tools: ['Read', 'Grep', 'Glob'] });
  assert.deepEqual(mapEvent(DELTA), { type: 'text', text: 'ok' });
  assert.deepEqual(mapEvent(LIMITS), { type: 'limits', status: 'allowed', fiveHour: 0.02, week: 0.04, fiveHourResets: 1790671200, weekResets: 1791241200, overage: false });
  assert.deepEqual(mapEvent(RESULT), { type: 'done', session: SESSION, error: false, text: 'ok', ms: 1455, turns: 1,
    tokens: { in: 3, out: 5, cacheRead: 11890, cacheWrite: 420 }, refused: 0 });
  assert.equal(mapEvent({ type: 'system', subtype: 'status', status: 'requesting' }), null);
});

test('a tool use shows which file claude read', () => {
  const read = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/web/app.js' } }] } };
  assert.deepEqual(mapEvent(read), { type: 'tools', uses: [{ name: 'Read', on: '/repo/web/app.js' }] });
});

test('the login claude reports says who pays', () => {
  assert.equal(loginMeaning('none').subscription, true);
  assert.equal(loginMeaning('ANTHROPIC_API_KEY').subscription, false);
  assert.match(loginMeaning('ANTHROPIC_API_KEY').text, /API credits/);
});

// A repo path with a quote in it, so the quoting is tested where it matters.
const REPO = "/Users/dev/it's here/questkeep";

test('the Terminal script enters the repo, asks before using an API key, and passes the comments from a file', () => {
  const s = openScript({ repo: REPO, promptFile: '/c/q.md', claudePath: '/Users/dev/.local/bin/claude' });
  assert.match(s, /^#!\/bin\/zsh -l\n/);
  assert.ok(s.includes(`cd -- '/Users/dev/it'\\''s here/questkeep' || exit 1`));
  assert.match(s, /for v in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; do/);
  assert.match(s, /read -q .*unset \$v/);
  assert.ok(s.trimEnd().endsWith(`exec '/Users/dev/.local/bin/claude' "$(cat -- '/c/q.md')"`));
});

const hasZsh = (() => { try { execFileSync('zsh', ['-c', 'true']); return true; } catch { return false; } })();
test('zsh accepts the script', { skip: !hasZsh && 'no zsh here' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-claude-'));
  const f = join(dir, 's.command');
  writeFileSync(f, openScript({ repo: REPO, promptFile: '/c/q.md' }));
  execFileSync('zsh', ['-n', f]);
  rmSync(dir, { recursive: true, force: true });
});

test('Open in Claude writes the comments and a private script under the cache, opens the script, and clears week-old ones', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  const opened = [];
  const first = await openInClaude({ repo: '/r', cache, text: 'Comments', platform: 'darwin', run: async (cmd, args) => { opened.push([cmd, ...args]); return null; }, now: Date.parse('2026-09-20T10:00:00Z') });
  assert.equal(first.status, 200);
  const [cmd, script] = opened[0];
  assert.equal(cmd, 'open');
  assert.equal(statSync(script).mode & 0o777, 0o700);
  const promptFile = /cat -- '([^']+)'/.exec(readFileSync(script, 'utf8'))[1];
  assert.equal(readFileSync(promptFile, 'utf8'), 'Comments');
  // a week and a day later the first pair is gone
  utimesSync(script, new Date('2026-09-20T10:00:00Z'), new Date('2026-09-20T10:00:00Z'));
  utimesSync(promptFile, new Date('2026-09-20T10:00:00Z'), new Date('2026-09-20T10:00:00Z'));
  await openInClaude({ repo: '/r', cache, text: 'Later', platform: 'darwin', run: async () => null, now: Date.parse('2026-09-28T11:00:00Z') });
  assert.equal(existsSync(script), false);
  rmSync(cache, { recursive: true, force: true });
});

test('Open in Claude says what went wrong: not a Mac, nothing to send, Terminal refused', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  const ok = async () => null;
  assert.equal((await openInClaude({ repo: '/r', cache, text: 'x', platform: 'linux', run: ok })).status, 501);
  assert.equal((await openInClaude({ repo: '/r', cache, text: '  ', platform: 'darwin', run: ok })).status, 400);
  const refused = await openInClaude({ repo: '/r', cache, text: 'x', platform: 'darwin', run: async () => Object.assign(new Error('failed'), { stderr: 'LSOpenURLsWithRole() failed' }) });
  assert.deepEqual([refused.status, /LSOpen/.test(refused.message)], [502, true]);
  rmSync(cache, { recursive: true, force: true });
});

test('a new conversation starts in the repo, or in the folder the server names, and never in one a page sent', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  const opened = [];
  const run = async (cmd, args) => { opened.push(args[0]); return null; };
  await openInClaude({ repo: '/r', cache, text: 'x', cwd: '/Users/dev/elsewhere', platform: 'darwin', run, now: Date.parse('2026-10-02T09:00:00Z') });
  await openInClaude({ repo: '/r', cache, text: '/backlog-hunter', startIn: '/Users/dev/repos/questkeep-hunt', platform: 'darwin', run, now: Date.parse('2026-10-02T09:00:01Z') });
  assert.match(readFileSync(opened[0], 'utf8'), /cd -- '\/r'/, 'a cwd without resume is ignored, as before');
  assert.match(readFileSync(opened[1], 'utf8'), /cd -- '\/Users\/dev\/repos\/questkeep-hunt'/);
  rmSync(cache, { recursive: true, force: true });
});

test('Continue in Terminal resumes the conversation in the folder claude filed it under, and takes only a real id', async () => {
  const s = openScript({ repo: '/Users/dev/questkeep-sync', resume: SESSION, claudePath: '/c/claude' });
  assert.ok(s.includes(`cd -- '/Users/dev/questkeep-sync'`));
  assert.ok(s.trimEnd().endsWith(`exec '/c/claude' --resume '${SESSION}'`));
  const cache = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  const opened = [];
  const run = async (cmd, args) => { opened.push(args[0]); return null; };
  assert.equal((await openInClaude({ repo: '/r', cache, resume: '--help', platform: 'darwin', run })).status, 400);
  const ok = await openInClaude({ repo: '/r', cache, resume: SESSION, cwd: '/Users/dev/questkeep-sync', platform: 'darwin', run });
  assert.equal(ok.status, 200);
  assert.match(readFileSync(opened[0], 'utf8'), /cd -- '\/Users\/dev\/questkeep-sync'[\s\S]*--resume/);
  rmSync(cache, { recursive: true, force: true });
});

test('claude files a directory\'s conversations under its path with every other character a hyphen', () => {
  assert.equal(projectFolder('/Users/drew/repos/questkeep-backlog', '/Users/drew'), '/Users/drew/.claude/projects/-Users-drew-repos-questkeep-backlog');
  assert.equal(projectFolder('/tmp/a.b_c', '/h'), '/h/.claude/projects/-tmp-a-b-c');
});

test('the program stamp changes when claude is updated, and is empty when it is gone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-claude-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, 'v1');
  const before = programStamp(bin);
  utimesSync(bin, new Date('2026-09-29T10:00:00Z'), new Date('2026-09-29T10:00:00Z'));
  assert.notEqual(programStamp(bin), before);
  assert.equal(programStamp(join(dir, 'missing')), '');
  rmSync(dir, { recursive: true, force: true });
});

test('iTerm opens when it is installed, Terminal otherwise, and HQ_TERMINAL picks either', () => {
  const withIterm = p => p === '/Applications/iTerm.app';
  const none = () => false;
  assert.equal(pickTerminal({ env: {}, has: withIterm }), 'iTerm');
  assert.equal(pickTerminal({ env: {}, has: none }), 'Terminal');
  assert.equal(pickTerminal({ env: { HQ_TERMINAL: 'terminal' }, has: withIterm }), 'Terminal');
  assert.equal(pickTerminal({ env: { HQ_TERMINAL: 'iterm' }, has: none }), 'Terminal', 'asking for iTerm when it is not there falls back');
  assert.equal(pickTerminal({ env: { HOME: '/Users/dev' }, has: p => p === '/Users/dev/Applications/iTerm.app' }), 'iTerm');
});

test('iTerm is asked for a window through AppleScript with the script as an argument; Terminal is handed the file', () => {
  const [cmd, args] = terminalCommand('iTerm', '/c/x.command');
  assert.equal(cmd, 'osascript');
  assert.equal(args.at(-1), '/c/x.command');
  assert.ok(!args.slice(0, -1).some(a => a.includes('/c/x.command')), 'the path never goes inside the AppleScript');
  assert.deepEqual(terminalCommand('Terminal', '/c/x.command'), ['open', ['/c/x.command']]);
});

test('Open in Claude runs the terminal it is given and names it in its answer', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  const ran = [];
  const out = await openInClaude({ repo: '/r', cache, text: 'x', platform: 'darwin', terminal: 'iTerm', run: async (cmd, args) => { ran.push(cmd); return null; } });
  assert.deepEqual([ran, out.message], [['osascript'], 'Opened a new iTerm window with claude.']);
  rmSync(cache, { recursive: true, force: true });
});

test("Take control's AppleScript gets the tty as an argument, never in its text, for Terminal and for iTerm", () => {
  for (const t of ['Terminal', 'iTerm']) {
    const [cmd, args] = focusTabCommand(t, '/dev/ttys004');
    assert.equal(cmd, 'osascript');
    assert.equal(args[args.length - 1], '/dev/ttys004');
    const script = args.filter((a, i) => args[i - 1] === '-e').join('\n');
    assert.ok(!script.includes('ttys004'), `${t}: the tty is not in the script`);
    assert.match(script, new RegExp(`tell application "${t}"`));
    assert.match(script, /error "no tab has "/, `${t}: a missing tab fails, so the exit status says so`);
  }
  assert.match(focusTabCommand('Terminal', '/dev/ttys004')[1].join(' '), /set index of w to 1/);
});

test('a continued conversation takes a first message when given one, and none otherwise', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'hq-cache-'));
  const opened = [];
  const run = async (cmd, args) => { opened.push(args[0]); return null; };
  await openInClaude({ repo: '/r', cache, resume: SESSION, cwd: '/Users/dev/repos/questkeep-hunt', text: '/backlog-hunter answers\n\nBacklog deck results: d, 1 of 1 answered', platform: 'darwin', run, now: Date.parse('2026-10-02T09:00:00Z') });
  await openInClaude({ repo: '/r', cache, resume: SESSION, cwd: '/Users/dev/repos/questkeep-hunt', platform: 'darwin', run, now: Date.parse('2026-10-02T09:00:01Z') });
  const withMessage = readFileSync(opened[0], 'utf8');
  assert.match(withMessage, new RegExp(`--resume '${SESSION}' "\\$\\(cat -- '([^']+)'\\)"`));
  assert.equal(readFileSync(/cat -- '([^']+)'/.exec(withMessage)[1], 'utf8'), '/backlog-hunter answers\n\nBacklog deck results: d, 1 of 1 answered');
  assert.ok(readFileSync(opened[1], 'utf8').trimEnd().endsWith(`--resume '${SESSION}'`));
  rmSync(cache, { recursive: true, force: true });
});
