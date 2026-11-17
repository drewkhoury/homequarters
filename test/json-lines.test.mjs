// Proves: a JSON-lines log (the lock log, the problem events) is parsed once while it stays the same size and age, read
// again when it grows, and answers [] when it is gone; and the recent lines passing tests printed open each CI folder's
// run.json once.
// Why: every Problems read parsed both logs and every CI folder's run.json again, about 85 ms a read on QuestKeep's
// data, on the server's one thread.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonLines } from '../lib/json-lines.mjs';
import { recentPassingLines } from '../lib/facts.mjs';

const dir = () => realpathSync(mkdtempSync(join(tmpdir(), 'hq-lines-')));
function opened(under, fn) {
  const real = fs.readFileSync, seen = [];
  fs.readFileSync = function (p, ...rest) { if (String(p).startsWith(under)) seen.push(String(p).slice(under.length + 1)); return real.call(this, p, ...rest); };
  syncBuiltinESMExports();
  try { return { value: fn(), seen }; } finally { fs.readFileSync = real; syncBuiltinESMExports(); }
}

test('a log that has not changed is not opened again, and one that grows is', () => {
  const d = dir(), f = join(d, 'log.jsonl');
  try {
    writeFileSync(f, '{"event":"take","at":"2026-11-17T01:00:00Z"}\nnot json\n');
    const first = jsonLines(f);
    assert.deepEqual(first, [{ event: 'take', at: '2026-11-17T01:00:00Z' }]);
    const again = opened(d, () => jsonLines(f));
    assert.deepEqual(again.seen, []);
    assert.equal(again.value, first, 'the same lines');
    appendFileSync(f, '{"event":"release","at":"2026-11-17T01:05:00Z"}\n');
    assert.deepEqual(jsonLines(f).map(l => l.event), ['take', 'release']);
    assert.deepEqual(jsonLines(join(d, 'gone.jsonl')), []);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the recent lines open each CI folder's run.json once", () => {
  const cache = dir(), now = Date.parse('2026-11-17T02:00:00Z');
  try {
    const ci = join(cache, 'ci', 'junit-70-1-gate');
    mkdirSync(join(ci, 'logs'), { recursive: true });
    writeFileSync(join(ci, 'run.json'), JSON.stringify({ at: '2026-11-17T01:00:00Z', branch: 'main' }));
    writeFileSync(join(ci, 'logs', 'a.status'), '0\n'); writeFileSync(join(ci, 'logs', 'a.log'), 'ERR the avatar was refused\n');
    assert.deepEqual([...recentPassingLines(cache, { now })], ['the avatar was refused']);
    const again = opened(cache, () => recentPassingLines(cache, { now }));
    assert.deepEqual(again.seen, []);
    assert.deepEqual([...again.value], ['the avatar was refused']);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});
