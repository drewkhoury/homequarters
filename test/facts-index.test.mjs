// Proves: a run folder's causes are worked out from its logs once: a restarted HQ takes them from the index it saved,
// a change in the lines passing tests printed elsewhere needs no log read, and a log that changed while HQ was
// stopped is read again. The answers are a fresh read's.
// Why: after a restart, the first Problems read opened 336 red run folders' logs on QuestKeep, about 5 s, and read
// them all again whenever a new run brought a new passing line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let n = 0;
const restarted = () => import(`../lib/facts.mjs?restart=${++n}`);
const now = f => f();
// a run folder with a red test (a) and a green one (b), each with its log and status; the index beside it
function folder() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hq-facts-index-'))), dir = join(root, 'run'), logs = join(dir, 'logs');
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, 'a.status'), '1\n'); writeFileSync(join(logs, 'a.log'), 'Error: the board fell over\nERR the sky went dark\n');
  writeFileSync(join(logs, 'b.status'), '0\n'); writeFileSync(join(logs, 'b.log'), 'ERR the avatar was refused\n');
  return { dir, logs, index: join(root, 'hq', 'causes-index.json'), done: () => rmSync(root, { recursive: true, force: true }) };
}
function readsUnder(dir, fn) {
  const real = fs.readFileSync, seen = [];
  fs.readFileSync = function (p, ...rest) { if (String(p).startsWith(dir)) seen.push(String(p)); return real.call(this, p, ...rest); };
  syncBuiltinESMExports();
  try { return { value: fn(), seen }; } finally { fs.readFileSync = real; syncBuiltinESMExports(); }
}
const lineOf = m => (m.get('a') || {}).line;

test('after a restart a folder that has not changed is answered from the index, reading no log', async () => {
  const f = folder();
  try {
    const first = (await restarted()).causesOfFolder(f.dir, new Set(), { index: f.index, saveIndex: now });
    const { causesOfFolder } = await restarted();
    const again = readsUnder(f.dir, () => causesOfFolder(f.dir, new Set(), { index: f.index, saveIndex: now }));
    assert.deepEqual(again.seen, []);
    assert.deepEqual([...again.value], [...first]);
  } finally { f.done(); }
});

test('new lines from passing tests elsewhere change the answer without reading a log again', async () => {
  const f = folder();
  try {
    const { causesOfFolder } = await restarted();
    assert.equal(lineOf(causesOfFolder(f.dir, new Set())), 'Error: the board fell over');
    const moved = readsUnder(f.dir, () => causesOfFolder(f.dir, new Set(['Error: the board fell over'])));
    assert.deepEqual(moved.seen, []);
    assert.equal(lineOf(moved.value), 'the sky went dark');
  } finally { f.done(); }
});

test('a log that changed while HQ was stopped is read again', async () => {
  const f = folder();
  try {
    (await restarted()).causesOfFolder(f.dir, new Set(), { index: f.index, saveIndex: now });
    writeFileSync(join(f.logs, 'a.log'), 'Error: the bridge gave way under the third quest\n');
    const { causesOfFolder } = await restarted();
    assert.equal(lineOf(causesOfFolder(f.dir, new Set(), { index: f.index, saveIndex: now })), 'Error: the bridge gave way under the third quest');
  } finally { f.done(); }
});
