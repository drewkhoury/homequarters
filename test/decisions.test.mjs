// The decisions keep to the shape docs/DECISIONS.md describes: that file's lines stop at 2 October 2026 and take no
// more, and each decision since is a file in docs/decisions/ named for its date, with a matching date, a title, and a
// superseded-by only when it names a later file. Reads the real files; HQ's reader (hq/lib/decisions.mjs) does the
// parsing, and tests/unit/hq-decisions.test.mjs tests it against a fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDecisions, check, OLD_FILE } from '../lib/decisions.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OLD = readFileSync(join(REPO, OLD_FILE), 'utf8');

// The decision lines docs/DECISIONS.md held when it was frozen on 2 October 2026. Every pull request that appended one
// conflicted with every other that did, so new decisions are files; a line appended here fails this test, and belongs
// in docs/decisions/ instead. Marking an old line superseded edits it in place and changes no count.
const FROZEN = 178;

test('docs/DECISIONS.md holds the frozen lines and no more', () => {
  assert.equal(OLD.split('\n').filter(l => l.startsWith('- **')).length, FROZEN,
    'a new decision is a file in docs/decisions/, never a line here (docs/DECISIONS.md says how)');
  assert.equal(OLD.split('\n').filter(l => l.startsWith('- ') && !l.startsWith('- **')).length, 0, 'every list line is a decision');
});

test('docs/DECISIONS.md has only its title and the months it covers as headings', () => {
  assert.deepEqual(OLD.split('\n').filter(l => l.startsWith('#')), ['# Decisions', '## September 2026', '## October 2026']);
});

test('docs/decisions holds at least one decision, and every file keeps to the rules', () => {
  const { files } = loadDecisions(REPO);
  assert.ok(files.length > 0, 'no files in docs/decisions');
  assert.deepEqual(check(files), []);
});
