// Proves: a project's groups file (lib/groups.mjs) sorts the Code page's files by three kinds of pattern, a pattern
// can take a folder back out of a wider group, and a repo with no groups file gets one group. Whether a project's own
// file places every tracked file is hq check's.
// Why: the file tree's filter is only useful if every file lands in one place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadGroups, groupsOf, groupOf, matches, DEFAULT_GROUPS } from '../lib/groups.mjs';

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

test('a path that matches no group lands in the one with no patterns, else in other', () => {
  const g = [{ id: 'app', paths: ['web/'] }, { id: 'rest', paths: [] }];
  assert.equal(groupOf('web/app.js', g), 'app');
  assert.equal(groupOf('Makefile', g), 'rest');
  assert.equal(groupOf('Makefile', [{ id: 'app', paths: ['web/'] }]), 'other');
});

test('the groups file the manifest names is read; with none, or one that cannot be read, there are no groups to narrow to', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-groups-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'groups.json'), JSON.stringify({ groups: [{ id: 'app', title: 'The app', paths: ['web/'] }, { id: 'other', title: 'Other', paths: [] }] }));
  assert.deepEqual(loadGroups(join(dir, 'groups.json')).map(g => g.id), ['app', 'other']);
  assert.equal(loadGroups(null), DEFAULT_GROUPS);
  assert.equal(loadGroups(join(dir, 'missing.json')), DEFAULT_GROUPS);
  assert.deepEqual(DEFAULT_GROUPS, [], 'the Code page adds All itself, so a default group would show twice');
  assert.equal(groupOf('anything/at/all.txt', DEFAULT_GROUPS), 'other');
});
