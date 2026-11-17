// Proves: after a new run, the Problems page's test results and reds are worked out for that run alone, and the CI runs whose
// folders did not change are the same runs as before, so what was worked out from them is kept too.
// Why: each new run made the Problems page walk all of QuestKeep's 2.8 million test results again, about 1.5 s on the
// server's one thread, and every page asked of HQ meanwhile waited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { testResults } from '../lib/problem-derive.mjs';
import { observeReds } from '../lib/problem-observations.mjs';
import { allRuns } from '../lib/runs.mjs';
import { buildStore } from './run-fixtures.mjs';

// a clean unit run of its own tests on one commit, run at the given minute
const run = (i, tests) => ({ id: `run-${i}`, source: 'laptop', when: `2026-11-01T10:${String(i).padStart(2, '0')}:00Z`,
  info: { kind: 'test', commit: 'c0ffee1', dirty: false }, ok: true,
  tasks: [{ id: 'unit', name: 'unit', status: 'pass', seconds: 1, log: null, cases: tests.map(name => ({ name, status: 'pass', seconds: 0.01 })) }] });
// a keyer that counts what it is asked: the work a read of the results does
const counting = () => { const asked = []; return { asked, keyOf: (task, name) => (asked.push(name), name) }; };

test('after a new run, the results ask only about the new run', () => {
  const old = [run(1, ['a quest is kept', 'a stamp is kept']), run(2, ['a quest is kept'])];
  const c = counting(), keep = ['a quest is kept', 'an island is kept'];
  testResults(old, { keyOf: c.keyOf, keep });
  c.asked.length = 0;
  const now = [run(3, ['an island is kept']), ...old];
  const got = testResults(now, { keyOf: c.keyOf, keep });
  assert.deepEqual(c.asked, ['an island is kept'], 'only the new run is asked about');
  assert.deepEqual(got, testResults(now, { keyOf: (task, name) => name, keep }), 'as worked out afresh');
});

test('the results keep their order by time across old and new runs', () => {
  const old = [run(5, ['a quest is kept']), run(1, ['a quest is kept'])];
  const keyOf = (task, name) => name;
  testResults(old, { keyOf });
  const got = testResults([run(3, ['a quest is kept']), ...old], { keyOf });
  assert.deepEqual(got['a quest is kept'].map(r => r.run), ['run-1', 'run-3', 'run-5']);
});

// a run whose cases say when they are read, on a commit of its own
const watched = (i, read, cases) => { const r = run(i, []); r.info.commit = `c${i}`; Object.defineProperty(r.tasks[0], 'cases', { get: () => (read.push(r.id), cases) }); return r; };

test('after a new run, the reds walk only the new run and the runs on its commit', () => {
  const read = [], pass = [{ name: 'a quest is kept', status: 'pass', seconds: 0.01 }];
  const old = [watched(1, read, pass), watched(2, read, pass)];
  observeReds(old);
  read.length = 0;
  const red = watched(3, read, [{ name: 'a quest is kept', status: 'fail', seconds: 0.01 }]);
  const obs = observeReds([red, ...old]);
  assert.deepEqual([...new Set(read)], ['run-3'], 'the old runs, on other commits, are not walked');
  assert.deepEqual(obs.map(o => [o.run, o.sig, o.class]), [['run-3', 'a quest is kept', 'never-rerun']]);
});

test('a new laptop run leaves the CI runs as they were', () => {
  const s = buildStore();
  try {
    const before = allRuns(s.cache, { maxAge: 0 }).filter(r => r.source === 'ci');
    s.laptop('2026-11-06T09-00-00Z_000013', { at: '2026-11-06T09:01:00Z', tasks: [{ id: 'unit', cases: [{ name: 'the newer copy wins', status: 'passed', time: 0.01 }], info: { kind: 'test' } }] });
    const after = allRuns(s.cache, { maxAge: 0 }).filter(r => r.source === 'ci');
    assert.ok(before.length > 0);
    assert.equal(after.length, before.length);
    assert.ok(after.every((r, i) => r === before[i]), 'each CI run is the same run');
  } finally { s.done(); }
});
