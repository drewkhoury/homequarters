// Firebase Hosting, read only: the live release and the ones before it, the preview channels, and which commit live
// serves, from the version.json each deploy stamps (scripts/stamp-version.mjs). Hosting has two ways in, tried in order,
// and HQ never logs in to either itself:
//   1. the Hosting REST API with a token from `gcloud auth print-access-token`, when gcloud is installed and logged in
//   2. the Firebase CLI's own login, through the copy make install puts in node_modules (it lists the channels, and
//      the live channel carries its current release, but not the releases before it)
// The token stays in the server's memory and is never written down or sent to the browser. version.json is public and
// needs no login.
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// What live's /version.json answered (the stamp scripts/stamp-version.mjs writes in QuestKeep: commit, hash, served, time, where).
// Anything that is not a well-formed stamp counts as missing, and a value handed to git must look like a commit first.
const SHA_RE = /^[0-9a-f]{40}$/, HASH_RE = /^v\d+:[0-9a-f]{64}$/, SERVED_RE = /^s\d+:[0-9a-f]{64}$/;
export function readLive(status, body, error) {
  if (error || status === 0) return { status: 'error', detail: error || 'no answer' };
  if (status >= 500) return { status: 'error', detail: `HTTP ${status}` };
  if (status !== 200) return { status: 'missing' };
  let v; try { v = JSON.parse(body); } catch { return { status: 'missing' }; }
  if (!v || typeof v !== 'object' || !SHA_RE.test(v.commit || '')) return { status: 'missing' };
  return { status: 'ok', v: { ...v, short: (v.commit || '').slice(0, 7), hash: HASH_RE.test(v.hash || '') ? v.hash : null, served: SERVED_RE.test(v.served || '') ? v.served : null } };
}

// The project, from .firebaserc's default, else the projectId in web/firebase-config.js.
export function projectId(repo) {
  try { const p = JSON.parse(readFileSync(join(repo, '.firebaserc'), 'utf8')).projects.default; if (p) return p; } catch { /* next */ }
  try { const m = /projectId:\s*["']([\w-]+)["']|"projectId":\s*"([\w-]+)"/.exec(readFileSync(join(repo, 'web', 'firebase-config.js'), 'utf8')); if (m) return m[1] || m[2]; } catch { /* none */ }
  return null;
}

const last = name => String(name || '').split('/').pop();

// A release as HQ shows it. Hosting does not know the commit; live's version.json does (liveVersion).
export function release(r) {
  const v = r.version || {};
  return { id: last(r.name), version: last(v.name), when: r.releaseTime || v.createTime || null, by: (r.releaseUser && r.releaseUser.email) || (v.createUser && v.createUser.email) || '',
    type: r.type || '', message: r.message || '', files: v.fileCount ? +v.fileCount : null, tool: (v.labels && v.labels['deployment-tool']) || '' };
}

export function channel(c) {
  return { id: last(c.name), url: c.url || '', expires: c.expireTime || null, updated: c.updateTime || null, live: last(c.name) === 'live', release: c.release ? release(c.release) : null };
}

// Whether main is what is live, from the commit in live's version.json, or from its served hash (scripts/tree-hash.mjs):
// a merge that changes nothing served skips the deploy, so live keeps the older commit and still serves main. served is
// { live, main }; a stamp from before served hashes has none, and then the commits decide.
export function compareLive(liveCommit, mainSha, served = {}) {
  if (!liveCommit) return { known: false, words: "Live's version.json names no commit, so which commit is live is not known." };
  if (!mainSha) return { known: false, words: `Live is commit ${liveCommit.slice(0, 7)}; main is not known here.` };
  if (mainSha.startsWith(liveCommit) || liveCommit.startsWith(mainSha)) return { known: true, same: true, words: 'Live is main.' };
  if (served.live && served.live === served.main) {
    return { known: true, same: true, words: `Live serves main. It was deployed from ${liveCommit.slice(0, 7)}, and main (${mainSha.slice(0, 7)}) has changed nothing a deploy serves since.` };
  }
  return { known: true, same: false, words: `Live is ${liveCommit.slice(0, 7)}; main is ${mainSha.slice(0, 7)}.` };
}

// The console's main pages for the project, for the links table.
export const consoleLinks = project => {
  const c = `https://console.firebase.google.com/project/${project}`;
  return [
    ['Hosting', `${c}/hosting/sites`, 'Releases, preview channels and rolling back.'],
    ['Firestore', `${c}/firestore`, 'The data, the rules and the indexes.'],
    ['Storage', `${c}/storage`, 'Photos and the Storage rules.'],
    ['Authentication', `${c}/authentication/users`, 'Accounts and the sign-in providers.'],
    ['App Check', `${c}/appcheck`, 'The reCAPTCHA key and what it enforces.'],
    ['Analytics', `${c}/analytics`, 'Usage, for people who agreed to it.'],
    ['Performance Monitoring', `${c}/performance`, "The universe's frame times, for people who agreed to it."],
  ];
};

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
    if (err) { err.stderr = String(stderr || ''); err.stdout = String(stdout || ''); reject(err); } else resolve(String(stdout));
  });
});

let token = null; // { value, at }: gcloud's tokens last an hour; HQ asks again after 45 minutes
async function gcloudToken(runner = run, now = Date.now()) {
  if (token && now - token.at < 45 * 60000) return token.value;
  const value = (await runner('gcloud', ['auth', 'print-access-token'])).trim();
  if (!value) throw new Error('gcloud gave no token.');
  token = { value, at: now };
  return value;
}
export const forgetToken = () => { token = null; };

async function hostingApi(path, tok, project) {
  const r = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${path}`, { headers: { authorization: `Bearer ${tok}`, 'x-goog-user-project': project } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((body.error && body.error.message) || `HTTP ${r.status}`), { status: r.status });
  return body;
}

// What live's /version.json says, read as scripts/decide.mjs reads it: { status: 'ok', v: { commit, short, ... } },
// { status: 'missing' } or { status: 'error', detail }. get stands in for fetch in tests.
export async function liveVersion(project, get = fetch) {
  try {
    const r = await get(`https://${project}.web.app/version.json?t=${Date.now()}`, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    return readLive(r.status, await r.text());
  } catch (e) { return readLive(0, '', e.message); }
}

// The Firebase CLI from node_modules, run with node itself so it works the same on Windows (no .cmd, no shell).
function cliPath(repo) {
  const p = join(repo, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  return existsSync(p) ? p : null;
}

// Everything the Firebase tab shows: { project, source, releases, channels, live, tried } or throws with .fix; live is
// liveVersion's answer, asked once Hosting has answered. The ways in can be replaced for tests: { gcloud: () => token,
// api: (path, token, project) => json, cli: (args) => text, fetch: (url) => response }.
export async function firebaseData({ repo, ways = {} }) {
  const project = projectId(repo);
  if (!project) throw Object.assign(new Error('No Firebase project named in .firebaserc or web/firebase-config.js.'), { fix: '' });
  const tried = [];
  const getToken = ways.gcloud || (() => gcloudToken());
  const api = ways.api || hostingApi;
  const live = () => liveVersion(project, ways.fetch);
  try {
    const tok = await getToken();
    const [rel, ch] = await Promise.all([
      api(`sites/${project}/channels/live/releases?pageSize=10`, tok, project),
      api(`sites/${project}/channels?pageSize=50`, tok, project),
    ]);
    return { project, source: 'gcloud', releases: (rel.releases || []).map(release), channels: (ch.channels || []).map(channel), live: await live(), tried };
  } catch (e) {
    tried.push(`gcloud: ${e.code === 'ENOENT' ? 'not installed' : String(e.stderr || e.message).trim().split('\n').pop()}`);
  }
  const cli = ways.cli || (args => { const p = cliPath(repo); if (!p) throw Object.assign(new Error('the Firebase CLI is not in node_modules; run make install'), { code: 'ENOENT' }); return run(process.execPath, [p, ...args], { cwd: repo }); });
  try {
    const out = JSON.parse(await cli(['hosting:channel:list', '--json', '--project', project]));
    if (out.status !== 'success') throw new Error(out.error || 'the CLI said no');
    const channels = ((out.result && out.result.channels) || []).map(channel);
    const current = channels.find(c => c.live);
    return { project, source: 'firebase-cli', releases: current && current.release ? [current.release] : [], channels, live: await live(), tried };
  } catch (e) {
    tried.push(`Firebase CLI: ${String(e.message).trim().split('\n').pop()}`);
  }
  throw Object.assign(new Error(`Could not read Firebase Hosting. ${tried.join('. ')}.`), {
    fix: 'Log in with one of them in a terminal: gcloud auth login, or node_modules/.bin/firebase login. HQ never logs in itself.' });
}
