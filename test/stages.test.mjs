// Proves: the problem register's stages are the pipeline file's stages in order, with HQ's fixed five around them (self,
// reviewer and you before the merge; you-after and users after), the shipped default when a project has no pipeline, and
// QuestKeep's old people-names read as the new ones. Why: most problems are found by people and agents rather than
// pipeline steps (84 of 106 trailers on QuestKeep's main), so a list built from steps alone would lose them, and the
// recorded events already name the old ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagesFrom, DEFAULT_STAGES, FIXED } from '../lib/stages.mjs';
import { configureStages, STAGES, STAGE, BEFORE_MERGE, canonStage, afterMerge, lateFinder, stageOfResult, fold } from '../lib/problems.mjs';
import { vocabulary } from '../lib/problem-view.mjs';
import { QK_PIPELINE } from './fixtures/stages.mjs';

const ids = s => s.stages.map(([k]) => k);

test('no pipeline: the shipped default, with the fixed five around it', () => {
  const s = stagesFrom(null);
  assert.deepEqual(ids(s), ['self', 'checks', 'reviewer', 'you', 'merge', 'after', 'you-after', 'users']);
  assert.equal(s.merge, 'merge');
  assert.deepEqual(s.warnings, []);
  assert.deepEqual(DEFAULT_STAGES.map(x => x.id), ['checks', 'merge', 'after']);
  assert.deepEqual(FIXED.map(([k]) => k), ['self', 'reviewer', 'you', 'you-after', 'users']);
});

test("QuestKeep's pipeline: its stages in order, split at the one marked merge, and its steps' results mapped to stages", () => {
  const s = stagesFrom(QK_PIPELINE);
  assert.deepEqual(ids(s), ['self', 'test-fast', 'pre-push', 'smoke', 'pr-gate', 'reviewer', 'you', 'merge', 'prod-smoke', 'nightly', 'you-after', 'users']);
  assert.equal(s.merge, 'merge');
  assert.equal(s.stages.find(([k]) => k === 'pr-gate')[1], 'PR gate', 'a stage keeps the label the file gives it');
  assert.deepEqual(s.resultStages, { 'ci/gate': 'pr-gate', 'laptop/gate': 'pr-gate', 'ci/rules': 'pr-gate', 'ci/after': 'nightly', 'laptop/after': 'nightly', 'container/docker-gate': 'pr-gate' }, "a part takes its step's stage");
  assert.deepEqual(s.warnings, []);
});

test('a pipeline with stages but no merge mark reads every stage as before the merge, and says so', () => {
  const s = stagesFrom({ schema: 1, stages: ['lint', { id: 'e2e', label: 'End to end' }], paths: [] });
  assert.deepEqual(ids(s), ['self', 'lint', 'e2e', 'reviewer', 'you', 'you-after', 'users']);
  assert.equal(s.merge, 'you-after');
  assert.ok(s.warnings.some(w => w.includes('no stage is marked merge')));
});

test('a stage that takes a fixed id, an old name, a bad id or a repeat is left out with a warning; a step naming no known stage warns', () => {
  const s = stagesFrom({ schema: 1, stages: ['self', 'players', 'Bad Id', 'gate', 'gate', { id: 'ship', merge: true }], paths: [{ id: 'p', title: 'P', steps: [{ title: 'Build', stage: 'nope' }] }] });
  assert.deepEqual(ids(s), ['self', 'gate', 'reviewer', 'you', 'ship', 'you-after', 'users']);
  assert.equal(s.warnings.length, 5);
  assert.ok(s.warnings.some(w => w.includes('"self" is one of HQ\'s own')));
  assert.ok(s.warnings.some(w => w.includes('"players" is an old name of "users"')));
  assert.ok(s.warnings.some(w => w.includes('"Bad Id"')));
  assert.ok(s.warnings.some(w => w.includes('"gate" twice')));
  assert.ok(s.warnings.some(w => w.includes('step "Build" names stage "nope"')));
});

test('a project may give an old name for a stage of its own, and the fixed five carry theirs', () => {
  const s = stagesFrom({ schema: 1, stages: [{ id: 'gate', was: ['ci-gate', 'pr-gate'] }, { id: 'merge', merge: true }], paths: [] });
  assert.deepEqual(s.aliases, { 'ci-gate': 'gate', 'pr-gate': 'gate', person: 'you', 'person-after': 'you-after', players: 'users' });
});

test("a project's old name may not be one of HQ's own stages or their old names: the shipped aliases stand, with a warning", () => {
  const s = stagesFrom({ schema: 1, stages: [{ id: 'gate', was: ['players', 'you', 'ci-gate'] }, { id: 'merge', merge: true }], paths: [] });
  assert.equal(s.aliases.players, 'users', 'the shipped players alias is not overwritten');
  assert.equal(s.aliases.you, undefined, 'a fixed id is never an alias');
  assert.equal(s.aliases['ci-gate'], 'gate');
  assert.equal(s.warnings.filter(w => /is HQ's own|an old name of HQ's/.test(w)).length, 2, s.warnings.join('\n'));
});

test('configured, the register reads old names as the new ones, and knows which stages are after the merge', () => {
  configureStages(stagesFrom(QK_PIPELINE));
  assert.deepEqual(STAGES.map(([k]) => k).slice(0, 3), ['self', 'test-fast', 'pre-push']);
  assert.deepEqual([...BEFORE_MERGE], ['self', 'test-fast', 'pre-push', 'smoke', 'pr-gate', 'reviewer', 'you']);
  assert.ok(STAGE.smoke.i < STAGE['pr-gate'].i, 'smoke before the PR gate (Mags and Hollis)');
  assert.equal(canonStage('person'), 'you'); assert.equal(canonStage('pr-gate'), 'pr-gate'); assert.equal(canonStage('nope'), 'nope');
  assert.equal(afterMerge('players'), true); assert.equal(afterMerge('pr-gate'), false); assert.equal(afterMerge('nope'), false);
  assert.equal(afterMerge('person'), false, 'an old name of a stage before the merge is before the merge (the adversary)');
  assert.equal(lateFinder('reviewer'), true); assert.equal(lateFinder('person'), true); assert.equal(lateFinder('nightly'), true); assert.equal(lateFinder('smoke'), false);
  assert.equal(stageOfResult('ci', 'gate'), 'pr-gate'); assert.equal(stageOfResult('laptop', 'unit'), null);
  const { entries } = fold([{ at: '2026-10-11T09:00:00Z', ev: 'opened', id: 'P-2026-10-11-product-bug-a1b2', by: 'x', fields: { title: 't', kind: 'product-bug', foundAt: 'players', shouldHaveCaughtAt: 'person' } }]);
  assert.equal(entries[0].foundAt, 'users', 'an old name on a recorded line is read as the new one');
  assert.equal(entries[0].shouldHaveCaughtAt, 'you');
  assert.equal(vocabulary().stages.map(s => s.key).join(' '), STAGES.map(([k]) => k).join(' '), 'the export names the configured stages, not the ones at load');
  configureStages();
  assert.deepEqual(STAGES.map(([k]) => k), ['self', 'checks', 'reviewer', 'you', 'merge', 'after', 'you-after', 'users'], 'configured with nothing, back to the default');
});
