// HQ's Firebase tab reads Hosting two ways, gcloud's token and the REST API first, then the Firebase CLI's own login,
// and never logs in. These put stand-ins in place of both: each way working, the first failing, both failing. Also the
// project id, a release as the API gives it, and which commit is live, from the version.json each deploy stamps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { projectId, release, channel, compareLive, consoleLinks, firebaseData } from '../lib/firebase.mjs';
import { githubPart } from '../pages/github.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// a release and channels shaped as the Hosting API answered them on 26 September
const RELEASE = { name: 'sites/questkeep/channels/live/releases/1790459156578000', type: 'DEPLOY', releaseTime: '2026-09-26T21:45:56.578Z',
  releaseUser: { email: 'github-deploy@questkeep.iam.gserviceaccount.com' },
  version: { name: 'sites/questkeep/versions/087d343b4cba9371', status: 'FINALIZED', labels: { 'deployment-tool': 'cli-firebase' }, fileCount: '44' } };
const LIVE = { name: 'projects/questkeep/sites/questkeep/channels/live', url: 'https://questkeep.web.app', release: RELEASE };
const PREVIEW = { name: 'projects/questkeep/sites/questkeep/channels/try-it', url: 'https://questkeep--try-it-abc.web.app', expireTime: '2026-10-03T00:00:00Z' };
// live's /version.json as scripts/stamp-version.mjs writes it, and a stand-in for fetch that answers it
const STAMP = { commit: '5a14563f9e0d4c2b8a7e6d5c4b3a291807f6e5d4', dirty: false, at: '2026-09-26T21:45:50Z', by: 'ci', hash: null, gate: 'ci', scope: 'all' };
const site = (status, body, asked = []) => async url => { asked.push(url); return { status, text: async () => body }; };
const hosting = { gcloud: async () => 'token', api: async path => (path.includes('releases') ? { releases: [RELEASE] } : { channels: [LIVE, PREVIEW] }) };

test('the project comes from .firebaserc, else from web/firebase-config.js', () => {
  assert.equal(projectId(REPO), 'questkeep');
  const d = mkdtempSync(join(tmpdir(), 'hq-fb-'));
  try {
    mkdirSync(join(d, 'web'));
    writeFileSync(join(d, 'web', 'firebase-config.js'), 'export const firebaseConfig = {\n  "apiKey": "x",\n  "projectId": "other-one"\n};');
    assert.equal(projectId(d), 'other-one');
    assert.equal(projectId(join(d, 'nowhere')), null);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a release reads as version, time, who and message', () => {
  assert.deepEqual(release(RELEASE), { id: '1790459156578000', version: '087d343b4cba9371', when: '2026-09-26T21:45:56.578Z', by: 'github-deploy@questkeep.iam.gserviceaccount.com',
    type: 'DEPLOY', message: '', files: 44, tool: 'cli-firebase' });
  assert.deepEqual([channel(PREVIEW).id, channel(PREVIEW).live, channel(LIVE).live], ['try-it', false, true]);
});

test('which commit is live: unknown without a stamp, else compared with main', () => {
  assert.equal(compareLive(null, 'abc').known, false);
  assert.doesNotMatch(compareLive(null, 'abc').words, /backlog/i);
  assert.deepEqual([compareLive('5a14563', '5a145632f9').same, compareLive('5a14563', 'f47423c').same], [true, false]);
});

// Review, 5 October: a merge that changes only tests skips the deploy on purpose, so live's version.json keeps naming
// the older commit, and the tab said live was behind main although live served exactly what main serves.
const SERVED = { a: `s1:${'a'.repeat(64)}`, b: `s1:${'b'.repeat(64)}` };
test("live is main when its served hash is main's, whatever the commits say", () => {
  const cmp = compareLive('5a14563', 'f47423c', { live: SERVED.a, main: SERVED.a });
  assert.equal(cmp.same, true);
  assert.doesNotMatch(cmp.words, /main is f47423c\.$/);
});

test('live is behind main when the served hashes differ', () => {
  assert.equal(compareLive('5a14563', 'f47423c', { live: SERVED.a, main: SERVED.b }).same, false);
});

test('the commits decide when live has no served hash, as deploys before it do not', () => {
  assert.deepEqual([compareLive('5a14563', '5a145632f9', { main: SERVED.b }).same, compareLive('5a14563', 'f47423c', { main: SERVED.a }).same], [true, false]);
});

// Review 13, 2 October: every deploy has stamped version.json since backlog 7 shipped, yet the Firebase tab still said
// which commit is live was not recorded, because nothing in HQ read the stamp.
test("the commit live serves is read from the project's version.json, and the tab compares it with main", async () => {
  const asked = [];
  const d = await firebaseData({ repo: REPO, ways: { ...hosting, fetch: site(200, JSON.stringify(STAMP), asked) } });
  assert.match(asked[0], /^https:\/\/questkeep\.web\.app\/version\.json(\?|$)/);
  assert.deepEqual([d.live.status, d.live.v.commit], ['ok', STAMP.commit]);
  const part = await githubPart({ repo: REPO, fb: { ...hosting, fetch: site(200, JSON.stringify(STAMP)) } }, 'firebase', { fresh: true, wait: true });
  assert.match(part.html, /Live is (main\.|(commit )?5a14563)/, "whether or not this checkout knows origin/main");
  assert.doesNotMatch(part.html, /not recorded|backlog 7/i);
});

test("a version.json that cannot be read leaves the commit unknown and says why, and Hosting still shows", async () => {
  const gone = await firebaseData({ repo: REPO, ways: { ...hosting, fetch: site(404, 'Not Found') } });
  assert.deepEqual([gone.live.status, gone.releases.length], ['missing', 1]);
  const down = await firebaseData({ repo: REPO, ways: { ...hosting, fetch: async () => { throw new Error('getaddrinfo ENOTFOUND questkeep.web.app'); } } });
  assert.deepEqual([down.live.status, down.live.detail, down.releases.length], ['error', 'getaddrinfo ENOTFOUND questkeep.web.app', 1]);
  const part = await githubPart({ repo: REPO, fb: { ...hosting, fetch: async () => { throw new Error('getaddrinfo ENOTFOUND questkeep.web.app'); } } }, 'firebase', { fresh: true, wait: true });
  assert.match(part.html, /Could not read live&#39;s version\.json|Could not read live's version\.json/);
});

test('the console links name the project', () => {
  const links = consoleLinks('questkeep');
  assert.deepEqual(links.map(l => l[0]), ['Hosting', 'Firestore', 'Storage', 'Authentication', 'App Check', 'Analytics', 'Performance Monitoring']);
  assert.ok(links.every(([, url]) => url.startsWith('https://console.firebase.google.com/project/questkeep/')));
});

test('with gcloud logged in, the releases and channels come from the Hosting API', async () => {
  const asked = [];
  const d = await firebaseData({ repo: REPO, ways: { gcloud: async () => 'token', api: async path => { asked.push(path); return path.includes('releases') ? { releases: [RELEASE] } : { channels: [LIVE, PREVIEW] }; }, cli: async () => assert.fail('the CLI is not needed'), fetch: site(200, JSON.stringify(STAMP)) } });
  assert.equal(d.source, 'gcloud');
  assert.deepEqual(asked, ['sites/questkeep/channels/live/releases?pageSize=10', 'sites/questkeep/channels?pageSize=50']);
  assert.deepEqual([d.releases.length, d.channels.map(c => c.id)], [1, ['live', 'try-it']]);
});

test('without gcloud, the Firebase CLI gives the channels and the live release', async () => {
  const d = await firebaseData({ repo: REPO, ways: {
    gcloud: async () => { throw Object.assign(new Error('spawn gcloud ENOENT'), { code: 'ENOENT' }); },
    cli: async args => { assert.deepEqual(args, ['hosting:channel:list', '--json', '--project', 'questkeep']); return JSON.stringify({ status: 'success', result: { channels: [LIVE, PREVIEW] } }); },
    fetch: site(200, JSON.stringify(STAMP)),
  } });
  assert.deepEqual([d.source, d.tried, d.releases.map(r => r.version), d.live.v.commit], ['firebase-cli', ['gcloud: not installed'], ['087d343b4cba9371'], STAMP.commit]);
});

test('with neither logged in, it says what each said and what to run, and runs no login', async () => {
  await assert.rejects(firebaseData({ repo: REPO, ways: {
    gcloud: async () => { throw Object.assign(new Error('x'), { stderr: 'ERROR: (gcloud.auth.print-access-token) You do not currently have an active account selected.' }); },
    cli: async () => JSON.stringify({ status: 'error', error: 'Failed to authenticate, have you run firebase login?' }),
  } }), e => /gcloud: ERROR: \(gcloud.auth.print-access-token\)/.test(e.message) && /Firebase CLI: Failed to authenticate/.test(e.message) && /gcloud auth login/.test(e.fix) && /never logs in/.test(e.fix));
});
