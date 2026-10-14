// HQ's GitHub page runs gh with the developer's own login. These put a stand-in for gh in its place: gh missing, gh
// logged out, one part failing while the rest still load, the health panel's four checks, and the minute's cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ghProblem, ghPart, ghHealth, checksOf } from '../lib/github.mjs';

// errors shaped as execFile gives them
const missing = () => Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
const loggedOut = () => Object.assign(new Error('Command failed: gh auth status'), { code: 1, stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n' });

// what gh 2.88 prints for the health checks
const HEALTHY = {
  '--version': 'gh version 2.88.1 (2026-03-12)\nhttps://github.com/cli/cli/releases/tag/v2.88.1\n',
  'auth status': 'github.com\n  ✓ Logged in to github.com account drewkhoury (keyring)\n  - Active account: true\n',
  'repo view --json nameWithOwner': '{"nameWithOwner":"example-org/questkeep"}',
  'api rate_limit': JSON.stringify({ resources: { core: { limit: 5000, remaining: 4990, reset: 1790465000 } } }),
};
const fakeGh = (answers, fail = {}) => async args => {
  const k = args.join(' ');
  if (fail[k]) throw fail[k]();
  if (k in answers) return answers[k];
  return '[]';
};

test("gh's failures are told apart, each with what to run", () => {
  assert.deepEqual([ghProblem(missing()).kind, ghProblem(missing()).fix], ['missing', 'Install it from https://cli.github.com, then run gh auth login.']);
  assert.deepEqual([ghProblem(loggedOut()).kind, ghProblem(loggedOut()).fix], ['signed-out', 'Run gh auth login in a terminal.']);
  assert.equal(ghProblem(Object.assign(new Error('x'), { stderr: 'none of the git remotes configured for this repository point to a known GitHub host' })).kind, 'no-repo');
  assert.equal(ghProblem(Object.assign(new Error('x'), { stderr: 'API rate limit exceeded for user' })).kind, 'rate');
  assert.equal(ghProblem(Object.assign(new Error('x'), { killed: true })).kind, 'slow');
  assert.match(ghProblem(Object.assign(new Error('x'), { stderr: 'HTTP 502: Bad Gateway\nmore\nmore\nmore' })).message, /^HTTP 502/);
});

test('the health panel reads the version, the account, the repo and the calls left', async () => {
  const checks = await ghHealth('/r', fakeGh(HEALTHY));
  assert.deepEqual(checks.map(c => [c.label, c.ok, c.detail]), [
    ['gh installed', true, '2.88.1'],
    ['Logged in', true, 'drewkhoury on github.com'],
    ['Repo found', true, 'example-org/questkeep'],
    ['API calls left', true, '4990 of 5000 this hour'],
  ]);
});

test('without gh every check is a problem, and the first says how to install it', async () => {
  const checks = await ghHealth('/r', async () => { throw missing(); });
  assert.deepEqual(checks.map(c => c.ok), [false, false, false, false]);
  assert.match(checks[0].fix, /cli\.github\.com/);
});

test('logged out, or nearly out of calls, is marked with what to do', async () => {
  const low = { ...HEALTHY, 'api rate_limit': JSON.stringify({ resources: { core: { limit: 5000, remaining: 12, reset: 1790465000 } } }) };
  const checks = await ghHealth('/r', fakeGh(low, { 'auth status': loggedOut }));
  assert.deepEqual([checks[1].ok, checks[1].fix], [false, 'Run gh auth login in a terminal.']);
  assert.deepEqual([checks[3].ok, /resets at/.test(checks[3].fix)], [false, true]);
});

test('a part that fails says why, and the next look tries again', async () => {
  let calls = 0;
  const gh = async () => { calls++; throw Object.assign(new Error('x'), { stderr: 'HTTP 502: Bad Gateway' }); };
  const out = await ghPart('prs', { repo: '/r1', gh, now: 0 });
  assert.match(out.problem.message, /502/);
  await ghPart('prs', { repo: '/r1', gh, now: 1 });
  assert.equal(calls, 2, 'a failure is not kept');
});

test('answers are kept for 30 s, then shown while GitHub is asked again, or asked at once for Refresh', async () => {
  let n = 0;
  const gh = async () => { n++; return '[]'; };
  await ghPart('runs', { repo: '/r2', gh, now: 0 });
  await ghPart('runs', { repo: '/r2', gh, now: 30000 });
  assert.equal(n, 1, 'within 30 s gh is not asked');
  const old = await ghPart('runs', { repo: '/r2', gh, now: 31000 });
  assert.equal(old.refreshing, true, 'past 30 s the old answer comes back at once, marked');
  await ghPart('runs', { repo: '/r2', gh, now: 31001, wait: true });
  assert.equal(n, 2);
  await ghPart('runs', { repo: '/r2', gh, now: 31002, fresh: true });
  assert.equal(n, 3);
});

test('two pages asking at once share one gh call', async () => {
  let n = 0, release;
  const gate = new Promise(r => (release = r));
  const gh = async () => { n++; await gate; return '[]'; };
  const both = Promise.all([ghPart('commits', { repo: '/r3', gh }), ghPart('commits', { repo: '/r3', gh })]);
  release();
  await both;
  assert.equal(n, 1);
});

test('a part that is not one of the page\'s is refused without running gh', async () => {
  const out = await ghPart('secrets', { repo: '/r4', gh: async () => assert.fail('gh ran') });
  assert.match(out.problem.message, /No part called secrets/);
});

test("a pull request's checks read as failing, running, passing or none", () => {
  assert.equal(checksOf({ statusCheckRollup: [] }), 'none');
  assert.equal(checksOf({ statusCheckRollup: [{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }] }), 'failing');
  assert.equal(checksOf({ statusCheckRollup: [{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: '' }] }), 'running');
  assert.equal(checksOf({ statusCheckRollup: [{ conclusion: 'SUCCESS' }, { state: 'SUCCESS' }] }), 'passing');
});

// runs as gh run list gives them, newest first
const RUN = (workflowName, headBranch, conclusion, createdAt, status = 'completed') => ({ workflowName, headBranch, conclusion, status, createdAt, displayTitle: 't', url: 'u' });

test("the dashboard is fine when main's newest run and the last deploy passed and nothing is still failing", async () => {
  const { dashboard } = await import('../lib/github.mjs');
  const d = dashboard({ runs: [RUN('Deploy', 'main', 'success', '3'), RUN('Tests', 'feat', 'success', '2'), RUN('Tests', 'feat', 'failure', '1')], prs: [], branches: [] });
  assert.equal(d.ok, true);
  assert.deepEqual(d.failing, [], 'a failure since fixed on the same branch is not still failing');
  assert.equal(d.mainRun.workflowName, 'Deploy');
});

test('the dashboard names what needs a look: a failing branch, a failed deploy, branches ahead of main', async () => {
  const { dashboard } = await import('../lib/github.mjs');
  const d = dashboard({ runs: [RUN('Tests', 'feat', 'failure', '3'), RUN('Deploy', 'main', 'failure', '2')], prs: [{ number: 5 }],
    branches: [{ name: 'main', isDefault: true }, { name: 'feat', ahead: 3, behind: 1 }, { name: 'old', ahead: 0, behind: 9 }] });
  assert.equal(d.ok, false);
  assert.deepEqual(d.failing.map(r => r.headBranch), ['feat', 'main']);
  assert.equal(d.lastDeploy.conclusion, 'failure');
  assert.deepEqual(d.ahead.map(b => b.name), ['feat']);
});

test('a run still going on main does not count against the dashboard', async () => {
  const { dashboard } = await import('../lib/github.mjs');
  assert.equal(dashboard({ runs: [RUN('Tests', 'main', '', '2', 'in_progress'), RUN('Deploy', 'main', 'success', '1')] }).ok, true);
});
