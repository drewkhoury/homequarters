// Proves: a run folder stamped ahead with folderStamps, which asks the disk without holding the server's thread, answers
// its causes from what was kept with no stat of its own, and a log changed before the stamp is still read again.
// Why: the Problems page's read after a new run stat'd every log of every red run, 44,000 files on QuestKeep's runs,
// one at a time on the server's one thread, and every page asked of HQ meanwhile waited.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { causesOfFolder, folderStamps } from '../lib/facts.mjs';

// a run folder with a red test (a) and its log and status
function folder() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hq-stamps-'))), logs = join(dir, 'logs');
  mkdirSync(logs);
  writeFileSync(join(logs, 'a.status'), '1\n'); writeFileSync(join(logs, 'a.log'), 'Error: the board fell over\n');
  return { dir, logs, done: () => rmSync(dir, { recursive: true, force: true }) };
}
// the files under dir that are stat'd or opened while fn runs
function touchedUnder(dir, fn) {
  const real = { statSync: fs.statSync, readFileSync: fs.readFileSync, readdirSync: fs.readdirSync, existsSync: fs.existsSync }, seen = [];
  for (const [name, f] of Object.entries(real)) fs[name] = function (p, ...rest) { if (String(p).startsWith(dir)) seen.push(`${name} ${p}`); return f.call(this, p, ...rest); };
  syncBuiltinESMExports();
  try { return { value: fn(), seen }; } finally { Object.assign(fs, real); syncBuiltinESMExports(); }
}

test('a folder stamped ahead and unchanged answers as before, touching no file', async () => {
  const f = folder();
  try {
    const first = causesOfFolder(f.dir, new Set());
    const stamps = await folderStamps([f.dir]);
    const again = touchedUnder(f.dir, () => causesOfFolder(f.dir, new Set(), { stamps }));
    assert.deepEqual(again.seen, []);
    assert.deepEqual([...again.value], [...first]);
  } finally { f.done(); }
});

test('a log changed before the stamp is read again', async () => {
  const f = folder();
  try {
    causesOfFolder(f.dir, new Set());
    writeFileSync(join(f.logs, 'a.log'), 'Error: the bridge gave way under the third quest\n');
    const stamps = await folderStamps([f.dir]);
    assert.equal(causesOfFolder(f.dir, new Set(), { stamps }).get('a').line, 'Error: the bridge gave way under the third quest');
  } finally { f.done(); }
});

test('a folder that is gone, or has no rerun, stamps as a folder read now does', async () => {
  const f = folder();
  try {
    const stamps = await folderStamps([f.dir, join(f.dir, 'nothing-here')]);
    assert.equal(stamps.size, 2);
    causesOfFolder(f.dir, new Set(), { stamps });
    const again = touchedUnder(f.dir, () => causesOfFolder(f.dir, new Set()));
    assert.deepEqual(again.seen.filter(s => !s.startsWith('statSync') && !s.startsWith('readdirSync')), [], 'the stamp taken ahead is the one a read takes');
  } finally { f.done(); }
});
