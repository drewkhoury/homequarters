// What the problem register refuses to hold (docs/plans/problem-register.md, Privacy; Theo's review). Its entries show on
// HQ and leave in every JSON export, and backfill writes them from transcripts, where one line can be a whole message. So
// hq/problem.mjs refuses a free-text field that matches any pattern here, and the export checks again, so a line
// written before a pattern was added still cannot leave. The evidence an entry carries is a pointer (a run id, a file and
// line, a commit, feedback/<id>), never copied text, and a player's report is cited by its id alone.
import { join, posix, basename } from 'node:path';
import { homedir } from 'node:os';
import { demoSettings } from './demo.mjs';

export const MAX_TEXT = 200;

// What evidence points at: a run (a laptop run id, CI's junit-<run>-<attempt>-<set>), a file and line, a commit, a
// player's report, or a pull request. The plan: evidence is a pointer, never copied text.
const POINTERS = [/\b\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z_\d+\b/, /\bjunit-\d+-\d+-[\w-]+/, /(?:^|[^\w./~-])[A-Za-z_~.][\w./~-]*:\d+\b/, /\b[0-9a-f]{7,40}\b/, /\bfeedback\/[A-Za-z0-9]+\b/, /\b(?:PR|pull request) ?#?\d+\b|#\d{2,}\b/i];
export const pointsAt = text => typeof text === 'string' && POINTERS.some(re => re.test(text));
// a player's report or the fix, which is all an entry players found may cite
export const citesReport = text => typeof text === 'string' && (/\bfeedback\/[A-Za-z0-9]+\b/.test(text) || /\b[0-9a-f]{7,40}\b/.test(text));

const EMAIL = /[\w.%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi; // as hq/lib/demo.mjs finds addresses
const TOKENS = [/\bBearer\s+[\w.~+/=-]{8,}/i, /\bya29\.[\w-]+/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\beyJ[\w-]{6,}\.eyJ[\w-]{6,}\.[\w-]+/,
  /\bdiscord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-ant-[\w-]{10,}/];
// a Firebase account id is 28 letters and digits, mixed case; a git hash is lower-case hex, so it is never one
const ACCOUNT = [/\busers\/[A-Za-z0-9]{20,}\b/, /\b(?=[A-Za-z0-9]{28}\b)(?=[^\s]*[A-Z])(?=[^\s]*[a-z])(?=[^\s]*\d)[A-Za-z0-9]{28}\b/];
// an absolute path, or one from the home folder: where each starts in the text
const PATHS = /(?:^|[\s'"(=,:])((?:~|\/(?:Users|home|private|tmp|var|etc|opt|Volumes))(?:\/[^\s'"),;]*)?)/g;

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Why a field's text may not be written, as a list of reasons that never repeat the text: [] when it may. ctx: { home,
// keepEmailDomains, private }, as privacyContext gives them for this laptop.
export function textProblems(text, { home = homedir(), keepEmailDomains = [], private: secret = [], repo = null, cache = null } = {}) {
  if (typeof text !== 'string') return ['it is not text'];
  const out = [];
  if (/[\r\n]/.test(text)) out.push('it is more than one line');
  if (text.length > MAX_TEXT) out.push(`it is longer than ${MAX_TEXT} characters`);
  const kept = d => keepEmailDomains.some(k => d.toLowerCase() === k.toLowerCase() || d.toLowerCase().endsWith(`.${k.toLowerCase()}`));
  if ([...text.matchAll(EMAIL)].some(m => !kept(m[1]))) out.push("it holds an email address on a domain HQ's demo does not keep");
  if (TOKENS.some(re => re.test(text))) out.push('it holds a token');
  if (ACCOUNT.some(re => re.test(text))) out.push('it holds an account id');
  // the cache, the repo and its worktrees (<repo>-<name> beside it), and this project's Claude transcripts, which backfill
  // cites by file and line; with neither given, every path outside ~/notes and ~/personal is allowed
  const allowed = [cache && new RegExp(`^${esc(cache)}(/|$)`), repo && new RegExp(`^${esc(repo)}(-[\\w.-]+)?(/|$)`),
    repo && new RegExp(`^${esc(home)}/\\.claude/projects/[\\w.-]*${esc(basename(repo))}[\\w.-]*/[\\w.-]+\\.jsonl(:\\d+)?$`)].filter(Boolean);
  // a file:// link names the path after it; a path is judged where it ends up, after any ..
  for (const m of text.replace(/\bfile:\/\//gi, ' ').matchAll(PATHS)) {
    const path = posix.normalize(m[1].startsWith('~') ? `${home}${m[1].slice(1)}` : m[1]);
    if (/^\/(Users|home)\/[^/]+\/(notes|personal)(\/|$)/.test(path)) { out.push('it names a path in a private folder (~/notes or ~/personal)'); continue; }
    if (allowed.length && !allowed.some(re => re.test(path))) out.push('it names a path outside the repo, its worktrees and the cache folder');
  }
  // as HQ's demo does, the home folder reads as ~ first: its name is on the private list, and its allowed paths are not
  // and so does the home folder as Claude Code names its project folders (/Users/x becomes -Users-x)
  const flat = home.replace(/[^a-zA-Z0-9-]/g, '-');
  const shown = text.split(home).join('~').split(flat).join('-~').toLowerCase();
  if (secret.some(s => s && shown.includes(String(s).toLowerCase()))) out.push("it holds a string HQ's demo setting lists as private");
  return [...new Set(out)];
}

// This laptop's context for the check: its home, and the kept domains and private strings from HQ's demo settings
// (hq/demo.json with <cache>/hq/demo.json on top).
export function privacyContext({ cache = null, home = homedir(), repo = null } = {}) {
  const s = cache ? demoSettings(cache) : {};
  return { home, cache, repo, keepEmailDomains: s.keepEmailDomains || [], private: s.private || [] };
}
