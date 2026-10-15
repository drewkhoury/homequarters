// Proves: hq check names each way a repo breaks the conventions its manifest turns on, and says nothing about a repo
// that keeps them or about a convention the manifest does not name. Why: the brief asks for a contract HQ clearly
// keeps and checks; QuestKeep kept these checks as unit tests of its own, and a project should get them by naming a
// convention, with one command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { checks, report } from '../lib/check.mjs';
import { loadManifest } from '../lib/manifest.mjs';

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
const ITEM = (type, title) => `---\ntype: ${type}\nasked: Jane, 27 Sep\n---\n# ${title}\n\nA sentence.\n\nDone when: it is done.\n`;
const DECISION = (date, title) => `---\ndate: ${date}\n---\n# ${title}\n\nBecause.\n`;

function repo(t, { broken }) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-check-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (p, text) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), text); };
  put('README.md', '# A repo\n');
  put('web/app.js', '');
  put('docs/backlog/next/fix-the-door.md', ITEM('bug', 'The door sticks'));
  if (broken) put('docs/backlog/inbox/odd.md', ITEM('wish', 'A wish'));
  put('docs/decisions/2026-10-01-doors-open-outward.md', DECISION('2026-10-01', 'Doors open outward'));
  if (broken) put('docs/decisions/2026-10-02-bad.md', DECISION('2026-10-03', 'Dated wrong'));
  put('hq/groups.json', JSON.stringify({ schema: 1, groups: [{ id: 'app', title: 'App', paths: ['web/'] }, { id: 'docs', title: 'Docs', paths: broken ? ['docs/', '*.md', 'web/'] : ['docs/', '*.md'] }, { id: 'other', title: 'Other', paths: [] }] }));
  put('tests/sets.json', JSON.stringify({ schema: 1, sets: { gate: ['smoke-door'], after: ['walk-house'] } }));
  put('tests/smoke-door.js', '// Proves: the door opens.\n// Why it exists: doors.\n// Runs in: the gate.\n// Takes: budget 10 s on CI.\n// Run it when: the door changes.\n');
  put('tests/walk-house.js', broken ? '// A walk with no header to speak of.\n' : '// Proves: the house.\n// Why it exists: houses.\n// Runs in: after.yml.\n// Takes: 30 s.\n// Run it when: the house changes.\n');
  put('tests/layers.json', JSON.stringify({ schema: 1, layers: [{ id: 'browser', name: 'Browser', status: 'built' }] }));
  put('hq/pipeline.json', JSON.stringify({ schema: 1, stages: ['gate', { id: 'merge', merge: true }], paths: [{ id: 'pr', title: 'PR', steps: [
    { title: 'Gate', stage: 'gate', sets: ['gate'], layers: ['browser'] },
    { title: 'Long set', stage: 'merge', sets: broken ? ['after', 'nightly'] : ['after'], layers: broken ? ['browser', 'e2e'] : ['browser'] },
    ...(broken ? [{ title: 'Soon', stage: 'gate', planned: 'a-dream' }] : []),
  ] }] }));
  put('hq.json', JSON.stringify({ schemaVersion: 1, name: 'doors', cache: join(dir, 'cache'),
    docs: { home: 'README.md', groups: 'hq/groups.json' }, backlog: { dir: 'docs/backlog' }, decisions: { dir: 'docs/decisions' },
    tests: { layers: 'tests/layers.json', pipeline: 'hq/pipeline.json', sets: 'tests/sets.json' }, ...(broken ? { futureKey: 1 } : {}) }));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'm');
  return dir;
}

test('a repo that keeps its conventions gets no problems and one sentence', t => {
  const dir = repo(t, { broken: false });
  const problems = checks(dir);
  assert.deepEqual(problems, []);
  assert.equal(report(problems), 'hq check: the repo keeps its contract.');
});

test('each broken convention is named, under its area, with the file or the thing', t => {
  const dir = repo(t, { broken: true });
  const problems = checks(dir), by = area => problems.filter(p => p.area === area).map(p => p.problem);
  assert.ok(by('manifest').some(p => /futureKey/.test(p)), 'the unknown key');
  assert.ok(by('backlog').some(p => /odd(\.md)?: type is "wish"/.test(p)), 'the item with a made-up type');
  assert.ok(by('decisions').some(p => /2026-10-02-bad\.md: date is 2026-10-03/.test(p)), 'the decision dated against its name');
  assert.deepEqual(by('groups'), ['web/app.js: in app and docs']);
  assert.ok(by('pipeline').some(p => /Long set: names the set nightly/.test(p)));
  assert.ok(by('pipeline').some(p => /Long set: names the layer e2e/.test(p)));
  assert.ok(by('pipeline').some(p => /Soon: planned names a-dream/.test(p)));
  assert.deepEqual(by('headers'), ['tests/walk-house.js: no header']);
  assert.deepEqual(by('stages'), []);
  assert.match(report(problems), /^manifest \(\d+\):\n  /);
  assert.match(report(problems), /\n\n\d+ problems\.$/);
});

test('a convention the manifest does not name is not checked, and a bare manifest passes', t => {
  const dir = repo(t, { broken: true });
  const m = loadManifest(dir);
  const bare = { ...m, m: { ...m.m, backlog: null, decisions: null, docs: { home: null, groups: null }, tests: null }, warnings: [] };
  assert.deepEqual(checks(dir, bare), []);
});
