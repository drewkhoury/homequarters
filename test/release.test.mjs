// Proves: the package's version has a line in CHANGELOG.md, and the things kept "for one release" (the QK_ names, the
// questkeep block the dora writer copies beside project) are gone once the version passes 0.2. Why: Nell's third review
// found six files saying "for one release" with no clock; this is the clock, red the day 0.3.0 is cut with them still in.
// It moved from 0.2 to 0.3 when QuestKeep's own CI turned out to check with the laptop's global hq.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(PKG, f), 'utf8');
const version = JSON.parse(read('package.json')).version;
const [major, minor] = version.split('.').map(Number);

test('the current version has its line in the changelog', () => {
  assert.match(read('CHANGELOG.md'), new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm'));
});

// 0.3, not 0.2: QuestKeep's CI checks with the laptop's global hq, so the names can only go once QuestKeep has moved off
// them on a release that still reads them (CHANGELOG 0.2.0)
test('what is kept for one release leaves at 0.3: the dora writer\'s questkeep copy and the QK_ names the writers read', { skip: major === 0 && minor < 3 && 'still 0.1 or 0.2: the aliases may stay' }, () => {
  assert.doesNotMatch(read('lib/dora.mjs'), /fig\.questkeep\s*=/, 'the writer alias');
  for (const f of ['lib/slot.mjs', 'problem.mjs', 'lib/space.mjs', 'lib/run-info.mjs', 'lib/ci-keep.mjs']) assert.doesNotMatch(read(f), /QK_[A-Z_]+/, `${f} still reads a QK_ name`);
});

test('the readers keep every old name for good, since nothing recorded is ever deleted', () => {
  assert.match(read('pages/delivery.mjs'), /w\.project \|\| w\.questkeep/, 'the Delivery page reads both blocks');
});
