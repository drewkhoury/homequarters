// GitHub through the gh CLI, run by the server with the developer's own login, so no token ever reaches the browser.
// gh finds the repo from the checkout's git remote. Each part is fetched on its own and kept for a minute, so one
// failing leaves the rest, and moving between pages does not wait on GitHub.
import { execFile } from 'node:child_process';
import { ALLOWANCE, lastDays, dayOf, orgOf } from './actions.mjs';
import { gitInfo } from './outside.mjs';
import { makeStash, writeEntry } from './stash.mjs';
import { firebaseData } from './firebase.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// gh with its arguments, no shell. Answers what gh printed; gh auth status prints to stderr, so that counts too.
export const runGh = (args, cwd) => new Promise((resolve, reject) => {
  execFile('gh', args, { cwd, timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    if (err) { err.stderr = String(stderr || ''); err.stdout = String(stdout || ''); reject(err); } else resolve(String(stdout) || String(stderr));
  });
});

// What a failure from gh means, and what to run about it.
export function ghProblem(err) {
  const text = `${err && err.message || ''}\n${err && err.stderr || ''}`;
  if (err && err.code === 'ENOENT') return { kind: 'missing', message: 'gh is not installed.', fix: 'Install it from https://cli.github.com, then run gh auth login.' };
  if (/auth login|not logged|authentication|HTTP 401/i.test(text)) return { kind: 'signed-out', message: 'gh is not logged in.', fix: 'Run gh auth login in a terminal.' };
  if (/no git remote|not a git repository|could not determine|none of the git remotes/i.test(text)) return { kind: 'no-repo', message: 'gh could not tell which GitHub repo this is.', fix: 'gh reads the remote named origin. Check it with git remote get-url origin.' };
  if (/rate limit/i.test(text)) return { kind: 'rate', message: 'GitHub says this account has made too many requests.', fix: 'Wait for the limit to reset. The gh panel says when.' };
  if (err && err.killed) return { kind: 'slow', message: 'gh took more than 20 seconds.', fix: 'GitHub may be slow. Try again in a minute.' };
  return { kind: 'error', message: (err && err.stderr || err && err.message || 'gh failed.').trim().split('\n').slice(0, 3).join(' '), fix: '' };
}

// The parts of the page and the gh command behind each. health is checked separately below.
export const PARTS = {
  prs: ['pr', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,author,headRefName,baseRefName,updatedAt,url,isDraft,reviewDecision,statusCheckRollup'],
  runs: ['run', 'list', '--limit', '40', '--json', 'databaseId,displayTitle,workflowName,status,conclusion,headBranch,headSha,event,createdAt,updatedAt,url'],
  deploys: ['api', 'repos/{owner}/{repo}/deployments?per_page=10'],
  commits: ['api', 'repos/{owner}/{repo}/commits?per_page=20'],
  branches: ['api', 'repos/{owner}/{repo}/branches?per_page=100'],
};

// The four things gh needs to work here, each { ok, label, detail, fix }.
export async function ghHealth(repo, gh) {
  const check = async (label, args, read) => {
    try { return { label, ...read(await gh(args, repo)) }; } catch (e) { const p = ghProblem(e); return { label, ok: false, detail: p.message, fix: p.fix, kind: p.kind }; }
  };
  const installed = await check('gh installed', ['--version'], out => ({ ok: true, detail: (/gh version (\S+)/.exec(out) || [, out.split('\n')[0]])[1] }));
  if (!installed.ok) {
    const needs = label => ({ label, ok: false, detail: 'Needs gh.', fix: '' });
    return [installed, needs('Logged in'), needs('Repo found'), needs('API calls left')];
  }
  const [auth, found, rate] = await Promise.all([
    check('Logged in', ['auth', 'status'], out => {
      const m = /Logged in to (\S+) (?:account|as) (\S+)/.exec(out);
      return { ok: true, detail: m ? `${m[2]} on ${m[1]}` : 'Yes' };
    }),
    check('Repo found', ['repo', 'view', '--json', 'nameWithOwner'], out => ({ ok: true, detail: JSON.parse(out).nameWithOwner })),
    check('API calls left', ['api', 'rate_limit'], out => {
      const c = JSON.parse(out).resources.core, at = new Date(c.reset * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return c.remaining > 100
        ? { ok: true, detail: `${c.remaining} of ${c.limit} this hour` }
        : { ok: false, detail: `${c.remaining} of ${c.limit} this hour`, fix: `The count resets at ${at}.` };
    }),
  ]);
  return [installed, auth, found, rate];
}

// Each branch with how far it is ahead of and behind the default branch, from GitHub's compare. A compare that fails
// leaves the branch without the numbers rather than failing the list.
async function withCompare(branches, repo, gh) {
  const main = branches.find(b => b.name === 'main') ? 'main' : (branches[0] || {}).name;
  return Promise.all(branches.slice(0, 40).map(async b => {
    if (b.name === main) return { ...b, isDefault: true };
    try {
      const c = JSON.parse(await gh(['api', `repos/{owner}/{repo}/compare/${encodeURIComponent(main)}...${b.name.split('/').map(encodeURIComponent).join('/')}`, '--jq', '{ahead_by, behind_by}'], repo));
      return { ...b, ahead: c.ahead_by, behind: c.behind_by };
    } catch { return b; }
  }));
}

// The dashboard's answers, from the other parts: main's last CI result, the last deploy, open pull requests, runs that
// are still failing (the newest run of that workflow on that branch failed), and branches ahead of main.
export function dashboard({ runs = [], prs = [], branches = [] }) {
  const done = runs.filter(r => r.status === 'completed');
  const mainRun = runs.find(r => r.headBranch === 'main');
  const lastDeploy = done.find(r => /deploy/i.test(r.workflowName));
  const newest = new Map();
  for (const r of done) { const k = `${r.workflowName}\t${r.headBranch}`; if (!newest.has(k)) newest.set(k, r); }
  const failing = [...newest.values()].filter(r => ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion));
  const ahead = branches.filter(b => !b.isDefault && b.ahead > 0);
  const ok = !!mainRun && (mainRun.status !== 'completed' || mainRun.conclusion === 'success') && (!lastDeploy || lastDeploy.conclusion === 'success') && !failing.length;
  return { ok, mainRun, lastDeploy, prs, failing, ahead };
}

// Actions minutes: the plan, this month's usage, and each of the last 30 days, from GitHub's billing usage API through
// gh. A day that has fully passed does not change, so it is kept for good; today and yesterday are asked again each
// time, since usage arrives hours late. The calls run a few at a time.
const dayCache = new Map(), planCache = new Map();
async function limited(tasks, n) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } }));
  return out;
}
export async function actionsUsage({ repo, gh, now = Date.now(), org = orgOf((gitInfo(repo) || {}).slug), dir = null }) {
  if (!org) throw Object.assign(new Error('No GitHub remote named origin, so no org to ask about.'), { kind: 'no-repo' });
  const usage = async q => JSON.parse(await gh(['api', `/organizations/${org}/settings/billing/usage?${q}`], repo)).usageItems || [];
  let plan = planCache.get(org);
  if (!plan || now - plan.at > 3600000) {
    plan = { at: now, name: (JSON.parse(await gh(['api', `/orgs/${org}`], repo)).plan || {}).name || 'free' };
    planCache.set(org, plan);
  }
  const today = dayOf(now), yesterday = dayOf(now - 86400000).key, days = lastDays(now, 30);
  // the days kept on disk from earlier runs, so a restart asks GitHub for today and yesterday alone
  const daysFile = dir && join(dir, `actions-days-${org.replace(/[^\w-]/g, '_')}.json`);
  if (daysFile && !dayCache.has(`${org}\tloaded`)) {
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(daysFile, 'utf8')).data || {})) dayCache.set(`${org}\t${k}`, v); } catch { /* none yet */ }
    dayCache.set(`${org}\tloaded`, true);
  }
  const byDay = {};
  await limited(days.map(d => async () => {
    const key = `${org}\t${d.key}`, keep = d.key !== today.key && d.key !== yesterday;
    if (keep && dayCache.has(key)) { byDay[d.key] = dayCache.get(key); return; }
    byDay[d.key] = await usage(`year=${d.y}&month=${d.m}&day=${d.d}`);
    if (keep) dayCache.set(key, byDay[d.key]);
  }), 4);
  if (daysFile) {
    const kept = {};
    for (const [k, v] of dayCache) if (k.startsWith(`${org}\t`) && k !== `${org}\tloaded` && days.some(d => `${org}\t${d.key}` === k)) kept[k.split('\t')[1]] = v;
    writeEntry(daysFile, { at: now, data: kept });
  }
  const month = await usage(`year=${today.y}&month=${today.m}`);
  return { org, plan: plan.name, allowance: ALLOWANCE[plan.name] ?? null, month, byDay, now };
}

// Answers kept in memory, and on disk once the server gives a folder (setStash); the tests use memory alone.
let stash = makeStash();
export const setStash = st => { stash = st; };

// What asking GitHub for one part means: { data } or { problem }.
async function ask(name, repo, gh, now, dir) {
  if (name === 'health') return { data: await ghHealth(repo, gh) };
  if (name === 'actions') {
    try { return { data: await actionsUsage({ repo, gh, now, dir }) }; } catch (e) {
      const p = e.kind === 'no-repo' ? { kind: 'no-repo', message: e.message, fix: '' } : ghProblem(e);
      // a 404 or 403 from the billing API: this login cannot see the org's billing
      if (/HTTP 40[34]/.test(`${e.message}\n${e.stderr || ''}`)) Object.assign(p, { kind: 'billing', message: 'gh could not read the org\'s billing.', fix: 'Your account needs to see the org\'s billing (an owner or billing manager). Check gh auth status shows the read:org scope; gh auth refresh -s read:org adds it.' });
      return { problem: p };
    }
  }
  try {
    const data = JSON.parse(await gh(PARTS[name], repo));
    return { data: name === 'branches' ? await withCompare(data, repo, gh) : data };
  } catch (e) {
    return { problem: e instanceof SyntaxError ? { kind: 'error', message: 'gh sent back something that is not JSON.', fix: '' } : ghProblem(e) };
  }
}

// One part: { at, data } or { at, problem }, plus refreshing: true when an old answer is shown while a new one is
// fetched. fresh asks GitHub now; wait waits for the new answer when the kept one is old.
export async function ghPart(name, { repo, gh = runGh, fresh = false, wait = false, now = Date.now(), dir = null, fb = {} }) {
  if (name === 'firebase') {
    return stash.get('firebase', repo, async () => {
      try { return { data: await firebaseData({ repo, ways: fb }) }; } catch (e) { return { problem: { kind: 'firebase', message: e.message, fix: e.fix || '' } }; }
    }, { force: fresh, wait, now });
  }
  if (name === 'dashboard') {
    const parts = await Promise.all(['runs', 'prs', 'branches'].map(n => ghPart(n, { repo, gh, fresh, wait, now, dir })));
    const bad = parts.find(x => x.data === undefined);
    if (bad) return { at: now, problem: bad.problem };
    const [runs, prs, branches] = parts;
    return { at: Math.min(...parts.map(x => x.at)), refreshing: parts.some(x => x.refreshing), data: dashboard({ runs: runs.data, prs: prs.data, branches: branches.data }) };
  }
  if (!['health', 'actions'].includes(name) && !Object.hasOwn(PARTS, name)) return { at: now, problem: { kind: 'error', message: `No part called ${name}.`, fix: '' } };
  return stash.get(name, repo, () => ask(name, repo, gh, now, dir), { force: fresh, wait, now });
}

// The newest pull request on a branch, open, merged or closed: { number, state, url }, null when it has none, or
// undefined when GitHub could not be asked. One gh question per branch, kept like the parts (the Hunter tab asks it
// for a claim whose pull request is no longer open).
export async function branchPr(branch, { repo, gh = runGh, now = Date.now() }) {
  const got = await stash.get(`pr-head-${branch}`, repo, async () => {
    try { return { data: JSON.parse(await gh(['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,state,url'], repo))[0] || null }; } catch (e) { return { problem: ghProblem(e) }; }
  }, { now });
  return got.data;
}

// A pull request's checks in one word: passing, failing, running, or none.
export function checksOf(pr) {
  const list = pr.statusCheckRollup || [];
  if (!list.length) return 'none';
  const states = list.map(c => (c.conclusion || c.state || c.status || '').toUpperCase());
  if (states.some(s => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(s))) return 'failing';
  if (states.some(s => ['', 'IN_PROGRESS', 'QUEUED', 'PENDING', 'EXPECTED', 'WAITING'].includes(s))) return 'running';
  return 'passing';
}
