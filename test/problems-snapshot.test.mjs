// Proves: the Problems page answers from the snapshot it has, at once, and reads the register again after the
// response when the run store has a new run or the snapshot has aged past its time, so the next page shows it; asked
// to read again (?fresh=1), it reads at once. The read after the response lets other pages in before it ends.
// Why: a register read took 30 seconds on QuestKeep's runs, and a page that waited on it every five minutes, or after
// every new run, was the slowest page HQ had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStore } from './run-fixtures.mjs';
import { snapshot } from '../pages/problems.mjs';

const RUN = { at: '2026-11-06T09:01:00Z', tasks: [{ id: 'unit', cases: [{ name: 'the newer copy wins', status: 'passed', time: 0.01 }], info: { kind: 'test' } }] };
// a later() that holds the work until the test lets it run
const held = () => { const jobs = []; return { later: f => jobs.push(f), run: () => Promise.all(jobs.splice(0).map(f => f())), get count() { return jobs.length; } }; };

test('a new run is shown on the page after the next one, and the page between waits on no read', async () => {
  const s = buildStore();
  try {
    const ctx = { repo: s.repo, cache: s.cache }, t = Date.now(), h = held();
    const first = snapshot(ctx, { fresh: true, now: t });
    s.laptop('2026-11-07T09-00-00Z_000099', RUN);
    const between = snapshot(ctx, { now: t + 2000, later: h.later });
    assert.equal(between, first, 'the page between answers from the snapshot it had');
    assert.equal(h.count, 1, 'one read is queued');
    assert.equal(snapshot(ctx, { now: t + 2100, later: h.later }), first);
    assert.equal(h.count, 1, 'and only one');
    await h.run();
    const next = snapshot(ctx, { now: t + 2200, later: h.later });
    assert.ok(next.runs.some(r => r.id === '2026-11-07T09-00-00Z_000099'), 'the next page shows the new run');
    assert.equal(h.count, 0);
  } finally { s.done(); }
});

test('a snapshot past its time is read again after the response, and ?fresh=1 reads at once', async () => {
  const s = buildStore();
  try {
    const ctx = { repo: s.repo, cache: s.cache }, t = Date.now(), h = held();
    const first = snapshot(ctx, { fresh: true, now: t });
    assert.equal(snapshot(ctx, { now: t + 5000, later: h.later }), first);
    assert.equal(h.count, 0, 'nothing changed, nothing read');
    assert.equal(snapshot(ctx, { now: t + 10 * 60000, later: h.later }), first);
    assert.equal(h.count, 1);
    await h.run();
    assert.notEqual(snapshot(ctx, { now: t + 10 * 60000 + 1, later: h.later }), first);
    const forced = snapshot(ctx, { fresh: true, now: t + 10 * 60000 + 2, later: h.later });
    assert.equal(snapshot(ctx, { now: t + 10 * 60000 + 3, later: h.later }), forced);
  } finally { s.done(); }
});

test('the read after the response lets other pages in before it ends', async () => {
  const s = buildStore();
  try {
    const ctx = { repo: s.repo, cache: s.cache }, t = Date.now();
    const first = snapshot(ctx, { fresh: true, now: t });
    s.laptop('2026-11-07T09-00-00Z_000098', RUN);
    let reading = null;
    // a later() that starts the read straight away, as a quiet server's setImmediate does
    snapshot(ctx, { now: t + 2000, later: f => { reading = f(); } });
    assert.equal(snapshot(ctx, { now: t + 2001, later: () => {} }), first, 'a page asked while it reads answers from the snapshot it had');
    await reading;
    assert.ok(snapshot(ctx, { now: t + 2002, later: () => {} }).runs.some(r => r.id === '2026-11-07T09-00-00Z_000098'), 'and the read, once done, shows the new run');
  } finally { s.done(); }
});
