// The decisions make dora's counting changes cite (lib/dora.mjs COUNTING_CHANGES) are files in QuestKeep's
// docs/decisions/. Reads the real repo. The rest of make dora's tests stay in test/dora.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTING_CHANGES } from '../../lib/dora.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every decision a counting change names is still in docs/decisions', () => {
  const missing = COUNTING_CHANGES.filter(c => c.decision && !existsSync(join(root, 'docs', 'decisions', c.decision))).map(c => c.decision);
  assert.deepEqual(missing, []);
});
