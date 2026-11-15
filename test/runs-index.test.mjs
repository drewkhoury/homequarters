// Proves: after HQ restarts, the runs it reads are the ones a cold read gives, taken from the index it saved in
// <cache>/hq without opening a run's files again; a run that changed while HQ was stopped is read again, and an index
// another HQ version wrote, or one cut off, is passed over.
// Why: reading QuestKeep's 3,600 runs and 2.8 million results cold takes about 7 s, and every restart paid it before
// Home or Problems could answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildStore } from './run-fixtures.mjs';
import { FILES } from '../lib/runs.mjs';

let n = 0;
// The run store as a newly started HQ has it: the module loaded afresh, keeping nothing from before
const restarted = () => import(`../lib/runs.mjs?restart=${++n}`);
const now = f => f();
// The run files a read opens, by path relative to the cache
function counting(cache) {
  const opened = [], note = p => opened.push(p.slice(cache.length + 1));
  return { opened, io: { read: p => (note(p), FILES.read(p)), head: p => (note(p), FILES.head(p)), exists: FILES.exists } };
}
const plain = runs => JSON.parse(JSON.stringify(runs));
const indexOf = s => join(s.cache, 'hq', 'runs-index.json');

test('after a restart the runs come from the saved index, the same as a cold read, opening no run', async () => {
  const s = buildStore();
  try {
    const cold = (await restarted()).allRuns(s.cache, { saveIndex: now });
    assert.equal(existsSync(indexOf(s)), true, 'the index is saved');
    const c = counting(s.cache);
    const again = (await restarted()).allRuns(s.cache, { io: c.io, saveIndex: now });
    assert.deepEqual(c.opened, []);
    assert.deepEqual(plain(again), plain(cold));
  } finally { s.done(); }
});

test('a run that ends or changes while HQ is stopped is read, and only it', async () => {
  const s = buildStore();
  try {
    (await restarted()).allRuns(s.cache, { saveIndex: now });
    s.laptop('2026-11-06T09-00-00Z_000013', { at: '2026-11-06T09:01:00Z', tasks: [{ id: 'unit', cases: [{ name: 'the newer copy wins', status: 'passed', time: 0.01 }], info: { kind: 'test' } }] });
    writeFileSync(join(s.cache, 'ci', 'junit-62-1-load', 'unit.xml'), '<testsuite><testcase name="midnight rolls the day" time="0.01"/></testsuite>');
    const c = counting(s.cache);
    const runs = (await restarted()).allRuns(s.cache, { io: c.io, saveIndex: now });
    assert.deepEqual([...new Set(c.opened.map(p => p.split('/').slice(0, -1).join('/').replace(/\/logs$/, '')))].sort(),
      ['ci/junit-62-1-load', 'runs/runs/2026-11-06T09-00-00Z_000013']);
    assert.deepEqual(plain(runs), plain((await restarted()).allRuns(s.cache, { index: false })), 'the same as a cold read');
  } finally { s.done(); }
});

test('an index another HQ version saved, or one cut off, is passed over and the runs read cold', async () => {
  const s = buildStore();
  try {
    const cold = plain((await restarted()).allRuns(s.cache, { saveIndex: now }));
    const saved = JSON.parse(readFileSync(indexOf(s), 'utf8'));
    for (const bad of [JSON.stringify({ ...saved, hq: '0.0.1' }), JSON.stringify(saved).slice(0, 200)]) {
      writeFileSync(indexOf(s), bad);
      const c = counting(s.cache);
      assert.deepEqual(plain((await restarted()).allRuns(s.cache, { io: c.io, saveIndex: now })), cold);
      assert.ok(c.opened.some(p => p.endsWith('run.json')), 'read cold');
    }
  } finally { s.done(); }
});
