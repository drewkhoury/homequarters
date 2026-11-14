// Proves: with no delivery.tz in the manifest, the Delivery figures count days in this machine's own time zone, and the
// manifest's defaults come from one table per schema. Why: the default was New York, QuestKeep's, which would have cut a
// Sydney user's days at 3 pm silently (Nell); and a default that is a literal in the code costs a schema epoch to change
// once published, so the table exists before 0.1.0 does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TZ, countingChangesFor } from '../lib/dora.mjs';
import { DEFAULTS, SCHEMA, resolveManifest } from '../lib/manifest.mjs';

test('the time zone defaults to this machine\'s, not one project\'s', () => {
  assert.equal(TZ, Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test('the manifest\'s defaults are one table per schema, and the resolver reads the current one', () => {
  const d = DEFAULTS[SCHEMA];
  assert.ok(d, `DEFAULTS[${SCHEMA}]`);
  const { m } = resolveManifest({ schemaVersion: SCHEMA, name: 'r', backlog: { dir: 'docs/backlog' } }, { repo: '/r/x', home: '/h', env: {} });
  assert.equal(m.docs.home, d.docs.home);
  assert.deepEqual(m.backlog.stages, d.backlog.stages);
  assert.equal(m.delivery.deployWorkflow, null, 'the workflows stay null in the manifest; dora.mjs applies its own defaults');
  assert.deepEqual(Object.keys(d).sort(), ['backlog', 'delivery', 'docs']);
});

test('a counting change is shown only when the repo has its decision file, and with none listed there are none', () => {
  const own = [{ date: '2026-02-01', what: 'Screen tests moved.', decision: 'screen.md' }, { date: '2026-01-01', what: 'Older.', decision: null }];
  assert.deepEqual(countingChangesFor('/r/docs/decisions', p => p.endsWith('/screen.md'), null, own), own);
  assert.deepEqual(countingChangesFor('/r/docs/decisions', () => false, null, own), [own[1]]);
  assert.deepEqual(countingChangesFor('/r/docs/decisions', () => true, null, null), [], 'the package carries none of its own');
});
