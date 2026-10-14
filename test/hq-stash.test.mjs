// HQ keeps GitHub's and Firebase's answers in memory and on disk, shows the last one at once, and asks again in the
// background when it is old: after 30 s, or 10 minutes for billing. These check those rules, the disk surviving a
// restart, and that a failed answer never replaces a good one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { freshness, maxAge, makeStash } from '../lib/stash.mjs';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'hq-stash-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

test('an answer is fresh for 30 s, billing for 10 minutes, and the Refresh button makes any of them old', () => {
  assert.equal(freshness(null, 'runs', 0), 'missing');
  assert.equal(freshness({ at: 0 }, 'runs', 30000), 'fresh');
  assert.equal(freshness({ at: 0 }, 'runs', 30001), 'stale');
  assert.equal(freshness({ at: 0 }, 'actions', 9 * 60000), 'fresh');
  assert.equal(freshness({ at: 0 }, 'actions', 10 * 60000 + 1), 'stale');
  assert.equal(freshness({ at: 0 }, 'runs', 1, true), 'stale');
  assert.equal(maxAge('prs'), 30000);
});

// a question that counts how often it is asked and answers with that count
const counter = () => { const q = { n: 0 }; q.ask = async () => ({ data: ++q.n }); return q; };

test('the first look asks and waits; a fresh answer is served without asking', async () => {
  const st = makeStash({ dir }), q = counter();
  assert.deepEqual(await st.get('runs', '/r1', q.ask, { now: 1000 }), { at: 1000, data: 1 });
  assert.deepEqual(await st.get('runs', '/r1', q.ask, { now: 20000 }), { at: 1000, data: 1 });
  assert.equal(q.n, 1);
});

test('an old answer is shown at once and marked, while a new one is fetched behind it', async () => {
  const st = makeStash({ dir }), q = counter();
  await st.get('runs', '/r2', q.ask, { now: 0 });
  const shown = await st.get('runs', '/r2', q.ask, { now: 40000 });
  assert.deepEqual(shown, { at: 0, data: 1, refreshing: true });
  const waited = await st.get('runs', '/r2', q.ask, { now: 40001, wait: true });
  assert.deepEqual(waited, { at: 40000, data: 2 }, 'the background answer, not a third ask');
  assert.equal(q.n, 2);
});

test('a restart serves the last answer from disk at once, without asking', async () => {
  const q = counter();
  await makeStash({ dir }).get('prs', '/r3', q.ask, { now: 5000 });
  const again = makeStash({ dir }); // a new server: nothing in memory
  assert.deepEqual(await again.get('prs', '/r3', q.ask, { now: 6000 }), { at: 5000, data: 1 });
  assert.equal(q.n, 1);
  assert.ok(readdirSync(dir).some(f => f.startsWith('prs-') && f.endsWith('.json')), 'one file per question');
});

test('a failed answer keeps the good one, marked with the problem, and is never written over it', async () => {
  const st = makeStash({ dir });
  await st.get('commits', '/r4', async () => ({ data: 'good' }), { now: 0 });
  const out = await st.get('commits', '/r4', async () => ({ problem: { message: 'HTTP 502' } }), { now: 1, force: true });
  assert.deepEqual([out.data, out.at, out.problem.message], ['good', 0, 'HTTP 502']);
  assert.equal((await makeStash({ dir }).get('commits', '/r4', async () => assert.fail('asked'), { now: 2 })).data, 'good', 'the disk still has the good one');
});

test('nothing kept and a failure: the problem is answered and not kept, so the next look asks again', async () => {
  const st = makeStash({ dir });
  let n = 0;
  const failing = async () => { n++; return { problem: { message: 'gh is not installed.' } }; };
  assert.equal((await st.get('branches', '/r5', failing, { now: 0 })).problem.message, 'gh is not installed.');
  await st.get('branches', '/r5', failing, { now: 1 });
  assert.equal(n, 2);
});

test('a question that throws becomes a problem rather than an unhandled error', async () => {
  const out = await makeStash({ dir }).get('runs', '/r6', async () => { throw new Error('boom'); }, { now: 0 });
  assert.equal(out.problem.message, 'boom');
});
