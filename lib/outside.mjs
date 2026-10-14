// Opening a file somewhere other than HQ: on github.com, in your editor, or in Finder.
//
// Show in Finder is the one thing HQ does rather than reads. It runs one fixed program with the path as an argument
// (open -R on macOS, explorer /select on Windows, xdg-open on the folder elsewhere), never a shell, and only for a path
// that passes the same check as reading a file. The server takes it only as a POST from HQ's own pages.
import { execFile, execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { statSync } from 'node:fs';
import { safePath } from './paths.mjs';
import { urlPath, esc, revealButton } from './page.mjs';

// 'owner/repo' from a GitHub remote, in its ssh or https form, or null for anything else.
export function parseRemote(url) {
  const m = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  return m ? m[1] : null;
}

// The file on github.com at a branch or commit, and a line when given.
export const githubFileUrl = ({ slug, ref, path, line }) =>
  `https://github.com/${slug}/blob/${urlPath(ref)}/${urlPath(path)}${line ? `#L${line}` : ''}`;

// Which ref a GitHub link should use. A branch that was never pushed is not on GitHub, so a link to it is a 404: the
// file link goes to the branch's pushed copy when there is one, else to the default branch. A line link goes to the
// commit itself when GitHub has it, so the line numbers match what you are reading; else it uses the file link's ref.
export function chooseGithubRef({ branch, head, remoteBranches, defaultBranch = 'main', headOnRemote }) {
  const pushed = !!branch && remoteBranches.includes(branch);
  const fileRef = pushed ? branch : defaultBranch;
  return { pushed, fileRef, lineRef: headOnRemote && head ? head : fileRef };
}

const gitOut = (repo, args) => { try { return execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).toString().trim(); } catch { return ''; } };

// The checkout's GitHub repo and which refs its links use, from git's remote-tracking refs (as of the last fetch; HQ
// never asks the network for this). Kept for ten seconds, since the branch can change under HQ.
let gitCache = null;
// After a fetch the remote-tracking refs have moved, so the next link asks git again.
export const forgetGit = () => { gitCache = null; };
export function gitInfo(repo, now = Date.now()) {
  if (gitCache && gitCache.repo === repo && now - gitCache.at < 10000) return gitCache.info;
  const slug = parseRemote(gitOut(repo, ['remote', 'get-url', 'origin']));
  let info = null;
  if (slug) {
    const branch = gitOut(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const head = gitOut(repo, ['rev-parse', 'HEAD']);
    const remoteBranches = gitOut(repo, ['for-each-ref', '--format=%(refname:lstrip=3)', 'refs/remotes/origin']).split('\n').filter(b => b && b !== 'HEAD');
    const defaultBranch = gitOut(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '') || 'main';
    const headOnRemote = !!gitOut(repo, ['branch', '-r', '--contains', 'HEAD']);
    info = { slug, branch, head, ...chooseGithubRef({ branch: branch === 'HEAD' ? '' : branch, head, remoteBranches, defaultBranch, headOnRemote }) };
  }
  gitCache = { repo, at: now, info };
  return info;
}

// The commit main is at on GitHub, as of the last fetch.
export const remoteMainSha = repo => gitOut(repo, ['rev-parse', '--verify', '--quiet', 'origin/main']) || null;

// Whether GitHub has this file at the ref, as far as the remote-tracking refs know. A file only on this branch is not.
export function onGithub(repo, info, path) {
  const ref = /^[0-9a-f]{40}$/.test(info.lineRef) && info.lineRef !== info.fileRef ? info.lineRef : `origin/${info.fileRef}`;
  return gitOut(repo, ['cat-file', '-t', `${ref}:${path}`]) === 'blob';
}

// The program and arguments that show a path in the system's file manager.
export function revealCommand(platform, abs, isDir) {
  if (platform === 'darwin') return { cmd: 'open', args: ['-R', abs], opts: {} };
  // explorer wants /select,"C:\a b\c.js" exactly, so the argument is passed as written rather than quoted by node; and
  // it is the one program here whose window is the point, so it is not started hidden
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [`/select,"${abs}"`], opts: { windowsVerbatimArguments: true, windowsHide: false } };
  return { cmd: 'xdg-open', args: [isDir ? abs : dirname(abs)], opts: {} };
}

// Starts the program hidden unless its options say otherwise. exec stands in for execFile in tests.
export const runFile = (cmd, args, opts, exec = execFile) => new Promise(resolve => {
  // explorer answers 1 even when it worked, so the exit code is not read; only a missing program counts as failing
  exec(cmd, args, { windowsHide: true, ...opts, timeout: 10000 }, err => resolve(err && err.code === 'ENOENT' ? err : null));
});

// Show a path from one of the roots. Answers { status, message } for the server to send back.
export async function reveal({ roots, root, path, platform = process.platform, run = runFile }) {
  if (!Object.hasOwn(roots, root) || typeof path !== 'string') return { status: 400, message: 'Say which folder: the repo or the cache.' };
  const abs = safePath(roots[root], path || '.');
  if (!abs) return { status: 403, message: 'HQ only shows files in the repo and in its cache folder.' };
  let isDir = false;
  try { isDir = statSync(abs).isDirectory(); } catch { return { status: 404, message: 'That file is gone.' }; }
  const { cmd, args, opts } = revealCommand(platform, abs, isDir);
  const err = await run(cmd, args, opts);
  if (err) return { status: 500, message: `Could not run ${cmd}: ${err.message}` };
  return { status: 200, message: platform === 'darwin' ? 'Shown in Finder.' : platform === 'win32' ? 'Shown in Explorer.' : 'Opened the folder.' };
}

// The editor link for a file and line. HQ_EDITOR changes it, as in HQ_EDITOR='cursor://file/{path}:{line}'.
export function editorLink(absPath, line = 1, template = process.env.HQ_EDITOR || 'vscode://file/{path}:{line}') {
  // vscode://file/Users/me/x.js on a Mac and Linux, vscode://file/C:/Users/me/x.js on Windows
  const path = absPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return template.replace('{path}', encodeURI(path)).replace('{line}', line);
}

// The ways out for a repo file: its GitHub links (null when GitHub does not have the file), the editor link, and the
// data hq.js needs to offer the same for each line. {line} in the data is filled in per line.
export function openOutside({ repo, rel, abs }) {
  const gh = gitInfo(repo);
  const has = gh && onGithub(repo, gh, rel);
  const github = has ? { file: githubFileUrl({ slug: gh.slug, ref: gh.fileRef, path: rel }), line: githubFileUrl({ slug: gh.slug, ref: gh.lineRef, path: rel, line: '{line}' }),
    note: gh.pushed ? `On GitHub, branch ${gh.branch}` : `On GitHub at ${gh.fileRef}. ${gh.branch} is not pushed.` } : null;
  return {
    editor: editorLink(abs, 1),
    github,
    githubMissing: gh && !has ? `Not on GitHub yet. ${gh.branch} is not pushed and ${gh.fileRef} has no such file.` : '',
    data: `data-editor="${esc(editorLink(abs, '{line}'))}" data-github="${esc(github ? github.line : '')}" data-root="repo" data-path="${esc(rel)}"`,
    // the old row of buttons, for pages that still show it
    buttons: `<a class="btn btn-secondary" href="${esc(editorLink(abs, 1))}">Open in editor</a>` +
      (github ? `<a class="btn btn-ghost" href="${esc(github.file)}" target="_blank" rel="noopener" title="${esc(github.note)}">GitHub</a>` : '') +
      revealButton('repo', rel),
  };
}
