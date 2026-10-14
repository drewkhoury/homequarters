// hq/groups.json sorts the repo's files for the Code page's filter. Every tracked file must land in exactly one group,
// so a new folder or a README inside hq/ makes this fail until the file says where it belongs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGroups, groupsOf, groupOf, matches } from '../lib/groups.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const groups = loadGroups(REPO);

test('the three kinds of pattern: a folder, a kind of file, one file', () => {
  assert.equal(matches('web/app.js', 'web/'), true);
  assert.equal(matches('webby.js', 'web/'), false);
  assert.equal(matches('docs/history/research.md', '*.md'), true);
  assert.equal(matches('README.MD', '*.md'), true);
  assert.equal(matches('Makefile', 'Makefile'), true);
  assert.equal(matches('docker/Makefile', 'Makefile'), false);
});

test('a ! pattern takes a folder back out of a wider group', () => {
  const g = [{ id: 'docs', paths: ['docs/', '*.md', '!docs/backlog/'] }, { id: 'backlog', paths: ['docs/backlog/'] }];
  assert.deepEqual(groupsOf('docs/backlog/next/sprint.md', g), ['backlog']);
  assert.deepEqual(groupsOf('docs/DATA.md', g), ['docs']);
});

test('every tracked file matches at most one group, and so lands in exactly one', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: REPO }).toString().trim().split('\n');
  assert.ok(files.length > 50, 'git ls-files found the repo');
  const twice = files.map(f => [f, groupsOf(f, groups)]).filter(([, g]) => g.length > 1);
  assert.deepEqual(twice, [], 'files in two groups');
  const ids = new Set(groups.map(g => g.id));
  for (const f of files) assert.ok(ids.has(groupOf(f, groups)), f);
});

test('the groups land where Drew asked', () => {
  const where = f => groupOf(f, groups);
  assert.deepEqual(['web/app.js', 'tests/helpers.js', 'devpipe.toml', 'README.md', 'docs/DATA.md', 'firestore.rules', '.github/workflows/test.yml', 'Makefile', 'hq/server.mjs', 'package.json', 'docs/backlog/README.md', 'docs/backlog/next/sprint.md'].map(where),
    ['app', 'tests', 'tests', 'docs', 'docs', 'infra', 'infra', 'infra', 'hq', 'other', 'backlog', 'backlog']);
});
