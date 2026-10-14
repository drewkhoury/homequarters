// What a fix commit tells the problem register (hq/lib/problem-trailers.mjs; the plan's "Where entries come from").
// Agents put Player-facing and Found-by on every fix: commit unasked (154 of 154 since 7 October), so the register's
// judgement rides there too, in Kind, Found-at and an optional Signature trailer. Found-by was free text, written 77 ways
// on main by 11 October; it moves to fixed values, and an alias table reads the old spellings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findersOf, trailersOf, signatureOf, fixEntry, FINDERS } from '../lib/problem-trailers.mjs';

// every Found-by line on main on 11 October 2026, one per spelling (git log origin/main --format=%B)
const ON_MAIN = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'found-by-on-main.txt'), 'utf8').trim().split('\n');

test('every Found-by spelling on main reads as one or more fixed values, and none as unknown', () => {
  assert.equal(ON_MAIN.length, 77);
  const unread = ON_MAIN.filter(s => { const f = findersOf(s); return !f.length || f.some(x => !FINDERS.test(x)); });
  assert.deepEqual(unread, []);
});

test('the old spellings read as who found it', () => {
  assert.deepEqual(findersOf('review (Noor)'), ['noor']);
  assert.deepEqual(findersOf('Nell, review of the combined branch, 10 Oct 2026'), ['nell']);
  assert.deepEqual(findersOf('Mara, Nell and Theo, reading the code'), ['mara', 'nell', 'theo']);
  assert.deepEqual(findersOf('the person you work with (review of the local build)'), ['you']);
  assert.deepEqual(findersOf('Drew (review of #266)'), ['you']);
  assert.deepEqual(findersOf('smoke-link (trace)'), ['test:smoke-link']);
  assert.deepEqual(findersOf('smoke-firstcard-layout (green run of the card-mouse fix)'), ['test:smoke-firstcard-layout']);
  assert.deepEqual(findersOf('PR #276 laptop gate (EROFS after the read-only mount)'), ['gate']);
  assert.deepEqual(findersOf('fm-players, self-review 10 Oct 2026'), ['builder']);
  assert.deepEqual(findersOf("lead's test-unit run on the integration branch, 10 Oct 2026"), ['builder']);
  assert.deepEqual(findersOf('review (testing team), 6 Oct'), ['reviewer']);
  assert.deepEqual(findersOf('Jane'), ['someone-else']);
  assert.deepEqual(findersOf('fm-card (probe from Mags\' reading)'), ['builder', 'mags']);
});

test('the fixed values read as themselves', () => {
  for (const v of ['noor', 'you', 'gate', 'nightly', 'prod-smoke', 'builder', 'players', 'test:smoke-sync', 'someone-else']) assert.deepEqual(findersOf(v), [v]);
  assert.deepEqual(findersOf('Hollis'), ['hollis']);
});

const BODY = ['The wake banner waited on a timer the clock stub never fired.', '', 'Player-facing: no', 'Found-by: test:smoke-wake',
  'Kind: flaky-test', 'Found-at: pr-gate', 'Signature: smoke-wake', '', 'Co-Authored-By: Claude <noreply@anthropic.com>'].join('\n');

test("a fix commit's trailers read as the register's values", () => {
  assert.deepEqual(trailersOf(BODY), { playerFacing: false, finders: ['test:smoke-wake'], kind: 'flaky-test', foundAt: 'pr-gate', signature: 'smoke-wake', problems: [] });
});

test('a trailer with a value the register does not have is reported, not guessed', () => {
  const t = trailersOf(BODY.replace('Kind: flaky-test', 'Kind: flake').replace('Found-at: pr-gate', 'Found-at: CI'));
  assert.equal(t.kind, null);
  assert.equal(t.foundAt, null);
  assert.deepEqual(t.problems, ['Kind: flake is not a kind (hq/lib/problems.mjs)', 'Found-at: CI is not a stage (hq/lib/problems.mjs)']);
  assert.deepEqual(trailersOf('no trailers here'), { playerFacing: null, finders: [], kind: null, foundAt: null, signature: null, problems: [] });
});

// The plan: a fix's signature comes from the test files it or its failing-test commit changed, helpers left out; the
// trailer says which when that gives more than one test, or none.
test("a fix's signature is the one test its commits changed, or its Signature trailer", () => {
  assert.equal(signatureOf({ files: ['web/app.js', 'tests/smoke-wake.js', 'tests/helpers.js'] }), 'smoke-wake');
  assert.equal(signatureOf({ files: ['scripts/lock.mjs', 'tests/unit/lock.test.mjs'] }), 'tests/unit/lock.test.mjs');
  assert.equal(signatureOf({ files: ['tests/walk-roll.js', 'tests/smoke-sync.js', 'tests/walk-helpers.js'] }), null, 'two tests: the trailer must say');
  assert.equal(signatureOf({ files: ['tests/walk-roll.js', 'tests/smoke-sync.js'], trailer: 'walk-roll' }), 'walk-roll');
  assert.equal(signatureOf({ files: ['web/app.js'] }), null);
  assert.equal(signatureOf({ files: ['tests/fixtures/x.json', 'tests/unit/fixtures/hung-test.js', 'tests/unit/fixtures/found-by-on-main.txt'] }), null, 'fixtures are not tests');
});

test('a fix commit is a closed entry of the register, fixed by itself', () => {
  const e = fixEntry({ sha: '1e79f3713c5b', at: '2026-10-09T10:00:00Z', subject: 'fix: the wake banner waits for its own timer', body: BODY, files: ['tests/smoke-wake.js'] });
  assert.deepEqual(e, { id: 'F-1e79f371', source: 'git', title: 'fix: the wake banner waits for its own timer', kind: 'flaky-test', signature: 'smoke-wake', foundAt: 'pr-gate',
    foundBy: ['test:smoke-wake'], playerFacing: false, fix: '1e79f3713c5b', openedAt: '2026-10-09T10:00:00Z', closedAt: '2026-10-09T10:00:00Z',
    status: 'closed', disposition: 'fixed', record: 'live', problems: [], events: [] });
});
