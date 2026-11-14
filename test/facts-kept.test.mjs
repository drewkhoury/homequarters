// Proves: a run folder's causes (lib/facts.mjs's causesOfFolder) are read from its logs once, and again only when a log,
// a status or the lines passing tests printed elsewhere change, with the same answers as a fresh read.
// Why: every Problems read opened every red run's logs again, about 2 seconds a read on QuestKeep's runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { causesOfFolder } from '../lib/facts.mjs';

// a run folder with a red test (a) and a green one (b), each with its log and status
function folder() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hq-facts-'))), logs = join(dir, 'logs');
  mkdirSync(logs);
  writeFileSync(join(logs, 'a.status'), '1\n'); writeFileSync(join(logs, 'a.log'), 'Error: the board fell over\nERR the sky went dark\n');
  writeFileSync(join(logs, 'b.status'), '0\n'); writeFileSync(join(logs, 'b.log'), 'ERR the avatar was refused\n');
  return { dir, logs, done: () => rmSync(dir, { recursive: true, force: true }) };
}

// counts the files under dir that are opened while fn runs
function readsUnder(dir, fn) {
  const real = fs.readFileSync, seen = [];
  fs.readFileSync = function (p, ...rest) { if (String(p).startsWith(dir)) seen.push(String(p)); return real.call(this, p, ...rest); };
  syncBuiltinESMExports();
  try { return { value: fn(), seen }; } finally { fs.readFileSync = real; syncBuiltinESMExports(); }
}
const lineOf = m => (m.get('a') || {}).line;

test("a folder whose logs have not changed is not read again, and answers as it did", () => {
  const f = folder();
  try {
    const first = readsUnder(f.dir, () => causesOfFolder(f.dir, new Set()));
    assert.ok(first.seen.length > 0);
    assert.equal(lineOf(first.value), 'Error: the board fell over');
    const again = readsUnder(f.dir, () => causesOfFolder(f.dir, new Set()));
    assert.deepEqual(again.seen, []);
    assert.deepEqual([...again.value], [...first.value]);
  } finally { f.done(); }
});

test('a log that changes, or a new status, is read again', () => {
  const f = folder();
  try {
    causesOfFolder(f.dir, new Set());
    writeFileSync(join(f.logs, 'a.log'), 'Error: the bridge gave way under the third quest\n');
    assert.equal(lineOf(causesOfFolder(f.dir, new Set())), 'Error: the bridge gave way under the third quest');
    writeFileSync(join(f.logs, 'c.status'), '1\n'); writeFileSync(join(f.logs, 'c.log'), 'Error: the map tore\n');
    assert.equal((causesOfFolder(f.dir, new Set()).get('c') || {}).line, 'Error: the map tore');
  } finally { f.done(); }
});

test('lines passing tests printed elsewhere that change give the answer for the new lines', () => {
  const f = folder();
  try {
    assert.equal(lineOf(causesOfFolder(f.dir, new Set())), 'Error: the board fell over');
    assert.equal(lineOf(causesOfFolder(f.dir, new Set(['Error: the board fell over']))), 'ERR the sky went dark'.replace(/^ERR\s+/, ''));
    assert.equal(lineOf(causesOfFolder(f.dir, new Set())), 'Error: the board fell over');
  } finally { f.done(); }
});
