// The problem register as HQ reads it (hq/lib/problem-register.mjs): the events file's entries and git's, joined to the
// observations from the run store and the lock log. Each source is passed in here, so the test needs no stores; HQ's
// Problems page and its JSON export read through the same function with the real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegister } from '../lib/problem-register.mjs';

const at = d => `2026-10-${String(d).padStart(2, '0')}T09:00:00.000Z`;
const run = (id, d, commit, status) => ({ id, source: 'laptop', when: at(d), info: { commit, kind: 'docker-gate', dirty: false }, tasks: [{ id: 'docker-gate', status, seconds: 120, cases: [{ name: 'smoke-wake', status, seconds: 20 }] }] });
const fixFromGit = { id: 'F-1e79f371', source: 'git', title: 'fix: the wake banner waits for its timer', kind: 'flaky-test', signature: 'smoke-wake', foundBy: ['test:smoke-wake'],
  fix: '1e79f371', openedAt: at(9), closedAt: at(9), status: 'closed', disposition: 'fixed', record: 'live', problems: [], events: [] };
const SOURCES = {
  runs: [run('r1', 5, 'c5', 'fail'), run('r2', 5, 'c5', 'pass'), run('r3', 6, 'c6', 'fail')],
  lock: [{ at: at(5), event: 'take', pid: 1, session: 'a' }, { at: at(5).replace('09:00', '09:01'), event: 'wait', pid: 2, session: 'b' }, { at: at(5).replace('09:00', '09:11'), event: 'take', pid: 2, session: 'b' }],
  events: [{ at: at(7), ev: 'opened', id: 'P-2026-10-07-slot-a1b2', by: 'builder', fields: { title: 'agents waited behind the laptop runner', kind: 'slot-contention', signature: 'slot', evidence: 'lock log 5 Oct' } },
    { at: at(8), ev: 'closed', id: 'P-2026-10-08-flaky-test-0a0b0c', by: 'builder', fields: { disposition: 'fixed' } }],
  git: { entries: [fixFromGit], contains: () => false },
  changes: [],
  now: Date.parse(at(12)),
};

test("the register joins the events file's entries and git's to the observations from the stores", () => {
  const r = readRegister(SOURCES);
  const fix = r.entries.find(p => p.id === 'F-1e79f371'), slot = r.entries.find(p => p.id === 'P-2026-10-07-slot-a1b2');
  assert.deepEqual(fix.observations.map(o => o.run), ['r1'], 'the flaky red; r3 is red and never rerun, a test failure\'s');
  assert.equal(fix.machineMinutes, 2);
  assert.deepEqual([slot.observations.length, slot.waitMinutes], [1, 10]);
  assert.deepEqual(r.unexplained.map(g => [g.sig, g.family, g.count]), [['smoke-wake', 'real', 1]], "r3's red is a real break no entry owns, so it stays unexplained");
});

test('an event the reader could not place is reported with the register', () => {
  assert.deepEqual(readRegister(SOURCES).notPlaced.map(x => x.why), ['P-2026-10-08-flaky-test-0a0b0c was never opened']);
});

test('the register says what it read from each source', () => {
  assert.deepEqual(readRegister(SOURCES).sources, { runs: 3, lockLines: 3, events: 2, gitEntries: 1, reds: 2, waits: 1, prWaits: 0, prRead: true });
});
