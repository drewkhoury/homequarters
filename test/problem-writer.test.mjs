// What hq/problem.mjs writes to the problem register's events file, and what it refuses (the plan's "Where entries
// come from" and "The events file"). The writer is the only way in: it stamps the time itself, takes only defined
// fields with values from the register's vocabulary, puts every free-text field through the privacy check, and refuses
// any event the reader would refuse, so nothing it writes ever shows as not placed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventFor, parseArgs } from '../problem.mjs';

const NOW = new Date('2026-10-11T06:00:00.123Z');
const CTX = { home: '/Users/someone', keepEmailDomains: ['example.com'], private: ['Hollowmere'] };
const env = (events = []) => ({ events, now: NOW, by: 'builder', ctx: CTX, rand: () => 'a1b2c3' });
const NOTE = { title: 'smoke-wake times out waiting for the wake banner', kind: 'flaky-test', evidence: 'run 2026-10-11T04-50-29Z_058624', signature: 'smoke-wake' };
const noted = (over = {}) => eventFor('note', { ...NOTE, ...over }, env()).event;

test('a note opens an entry with an id from its date, its kind and random digits, stamped now by the writer', () => {
  const e = noted();
  assert.equal(e.ev, 'opened');
  assert.equal(e.id, 'P-2026-10-11-flaky-test-a1b2c3', 'never words of its title, which a redaction could not take back');
  assert.equal(e.at, '2026-10-11T06:00:00.123Z');
  assert.equal(e.by, 'builder');
  assert.deepEqual(e.fields, { ...NOTE, record: 'live' });
});

test('a note needs a title, a kind and evidence, and nothing else', () => {
  for (const drop of ['title', 'kind', 'evidence']) {
    const { [drop]: _, ...rest } = NOTE;
    assert.match(eventFor('note', rest, env()).refused.join(' '), new RegExp(drop));
  }
});

test('a free-text field the privacy check refuses is refused, naming the field and not its text', () => {
  const r = eventFor('note', { ...NOTE, evidence: 'reported by a.player@gmail.com' }, env());
  assert.equal(r.event, undefined);
  assert.match(r.refused[0], /^evidence: .*email address/);
  assert.ok(!r.refused.join(' ').includes('gmail'));
});

test("a value outside the register's vocabulary is refused", () => {
  assert.match(eventFor('note', { ...NOTE, kind: 'bogus' }, env()).refused.join(' '), /kind/);
  assert.match(eventFor('note', { ...NOTE, mode: 'regression' }, env()).refused.join(' '), /mode/, 'a mode of another kind');
  assert.match(eventFor('note', { ...NOTE, factors: 'clock,made-up' }, env()).refused.join(' '), /factors/);
  assert.match(eventFor('note', { ...NOTE, factors: 'clock,machine-load,slot-queue,stale-base' }, env()).refused.join(' '), /factors/, 'more than three');
  assert.deepEqual(noted({ factors: 'clock,machine-load' }).fields.factors, ['clock', 'machine-load']);
});

// The writer stamps the time; one given by hand could reorder history (Juno's review, finding 8).
test('an option the register does not define is refused, the time among them', () => {
  assert.match(eventFor('note', { ...NOTE, at: '2026-01-01T00:00:00Z' }, env()).refused.join(' '), /no option --at/);
  assert.match(eventFor('note', { ...NOTE, colour: 'red' }, env()).refused.join(' '), /no option --colour/);
});

test('player-facing reads yes or no', () => {
  assert.equal(noted({ playerFacing: 'yes' }).fields.playerFacing, true);
  assert.equal(noted({ playerFacing: 'no' }).fields.playerFacing, false);
  assert.match(eventFor('note', { ...NOTE, playerFacing: 'maybe' }, env()).refused.join(' '), /playerFacing/);
});

test('a set, a close, a reopen, a merge and a redaction name their entry and carry what they change', () => {
  const opened = noted(), id = opened.id, after = [opened];
  assert.deepEqual(eventFor('set', { id, mode: 'async-wait', status: 'fixing' }, env(after)).event.fields, { mode: 'async-wait', status: 'fixing' });
  const close = eventFor('close', { id, disposition: 'fixed', fix: '1e79f371' }, env(after)).event;
  assert.deepEqual([close.ev, close.id, close.fields], ['closed', id, { disposition: 'fixed', fix: '1e79f371' }]);
  assert.equal(eventFor('reopen', { id }, env([...after, close])).event.ev, 'reopened');
  const other = { ...opened, id: 'P-2026-10-11-flaky-test-d4e5f6' };
  assert.deepEqual(eventFor('merge', { id: other.id, into: id }, env([...after, other])).event, { at: NOW.toISOString(), ev: 'merged-into', id: other.id, into: id, by: 'builder' });
  assert.deepEqual(eventFor('redact', { id, fields: 'evidence,title' }, env(after)).event.fields, ['evidence', 'title']);
  assert.match(eventFor('redact', { id, fields: 'nonsense' }, env(after)).refused.join(' '), /fields/);
});

// The writer folds the file with its new event and refuses what the reader would not place.
test('an event the reader would refuse is refused before it is written', () => {
  const opened = noted(), id = opened.id;
  const closed = eventFor('close', { id, disposition: 'fixed' }, env([opened])).event;
  assert.match(eventFor('close', { id, disposition: 'fixed' }, env([opened, closed])).refused.join(' '), /closed already/);
  assert.match(eventFor('set', { id: 'P-2026-10-08-flaky-test-0a0b0c', mode: 'clock' }, env([opened])).refused.join(' '), /never opened/);
  assert.match(eventFor('reopen', { id }, env([opened])).refused.join(' '), /not closed/);
  assert.match(eventFor('close', { id }, env([opened])).refused.join(' '), /disposition/);
});

// Juno's review, finding 7: without it a problem found late is never counted late, and nothing asks for it.
test('closing a problem found by a reviewer, the person or anything after the merge needs where it should have been caught', () => {
  for (const foundAt of ['reviewer', 'person', 'merge', 'prod-smoke', 'nightly', 'person-after', 'players']) {
    const opened = noted({ foundAt, ...(foundAt === 'players' ? { evidence: 'feedback/8ZQ3k2' } : {}) }), id = opened.id;
    assert.match(eventFor('close', { id, disposition: 'fixed' }, env([opened])).refused.join(' '), /shouldHaveCaughtAt/, foundAt);
    assert.ok(eventFor('close', { id, disposition: 'fixed', shouldHaveCaughtAt: 'pr-gate' }, env([opened])).event, foundAt);
  }
  const gate = noted({ foundAt: 'pr-gate' });
  assert.ok(eventFor('close', { id: gate.id, disposition: 'fixed' }, env([gate])).event, 'found at the gate needs none');
});

test('options read as the register names its fields', () => {
  assert.deepEqual(parseArgs(['note', '--title', 'a title', '--found-at', 'pr-gate', '--player-facing', 'no']),
    { cmd: 'note', opts: { title: 'a title', foundAt: 'pr-gate', playerFacing: 'no' } });
  assert.deepEqual(parseArgs(['close', 'P-2026-10-11-x-a1b2', '--disposition', 'fixed']), { cmd: 'close', opts: { id: 'P-2026-10-11-x-a1b2', disposition: 'fixed' } });
});

// Found-by moves to fixed values (the plan, approved 10 October), several finders at once, as fix commits name them.
test("found-by takes the register's finders, several at once, and no free text", () => {
  assert.deepEqual(noted({ foundBy: 'noor,you' }).fields.foundBy, ['noor', 'you']);
  assert.deepEqual(noted({ foundBy: 'test:smoke-wake' }).fields.foundBy, ['test:smoke-wake']);
  assert.match(eventFor('note', { ...NOTE, foundBy: 'Noor (review of fm/card)' }, env()).refused.join(' '), /foundBy/);
});

// Theo's review of the build, finding 1: anything starting P- was taken as an entry's id, so text could ride in it.
test('repeat-of takes only an entry id, and the writer\'s name meets the same check as any text', () => {
  assert.match(eventFor('note', { ...NOTE, repeatOf: 'P- reply to someone, see the thread' }, env()).refused.join(' '), /repeatOf/);
  assert.equal(noted({ repeatOf: 'P-2026-10-09-flaky-test-0f1e2d' }).fields.repeatOf, 'P-2026-10-09-flaky-test-0f1e2d');
  assert.match(eventFor('note', NOTE, { ...env(), by: 'a.player@gmail.com' }).refused.join(' '), /^by: /);
  assert.match(eventFor('note', NOTE, { ...env(), by: 'x'.repeat(41) }).refused.join(' '), /^by: /);
});

// Juno's review of the build, finding 2: seenFrom moves an entry's window back, which only backfill should do.
test('only a backfilled entry may say when its problem was first seen', () => {
  assert.match(eventFor('note', { ...NOTE, seenFrom: '2026-09-28T10:00:00Z' }, env()).refused.join(' '), /seenFrom/);
  assert.equal(noted({ seenFrom: '2026-09-28T10:00:00Z', record: 'backfill' }).fields.seenFrom, '2026-09-28T10:00:00Z');
});

// Theo's review of the build, finding 6: "evidence is a pointer, never copied text" was only a comment.
test('evidence must point at something: a run, a file and line, a commit, a report or a pull request', () => {
  for (const evidence of ['run 2026-10-11T04-50-29Z_058624', 'CI run junit-18342-1-gate', 'tests/smoke-sync.js:120', 'fix 1e79f371', 'feedback/8ZQ3k2', 'PR #276'])
    assert.ok(noted({ evidence }), evidence);
  assert.match(eventFor('note', { ...NOTE, evidence: 'the board went blank and the player was upset' }, env()).refused.join(' '), /^evidence: .*pointer/);
});

test('a problem players found cites their report or the fix, never their words', () => {
  assert.match(eventFor('note', { ...NOTE, foundAt: 'players', evidence: 'run 2026-10-11T04-50-29Z_058624' }, env()).refused.join(' '), /feedback\/<id>/);
  assert.ok(noted({ foundAt: 'players', evidence: 'feedback/8ZQ3k2' }));
  assert.ok(noted({ foundAt: 'players', evidence: 'fix 1e79f371' }));
});
