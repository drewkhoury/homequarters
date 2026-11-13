// Proves: hq problem stores a stage's old name (person, person-after, players) exactly as it was given, and HQ's own
// reader still reads it as the stage it became (you, you-after, users).
// Why: QuestKeep main's reader knows only the old names and drops any other word, so a note written as "you" lost its
// stage on main's Problems page while main's server still served the register. Readers translate; the writer never
// rewrites what it was given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fold } from '../lib/problems.mjs';

const HQ = fileURLToPath(new URL('../bin/hq.mjs', import.meta.url));
// what QuestKeep main's fold() made of three lines, taken from main once (the file's about says when)
const MAIN = JSON.parse(readFileSync(new URL('./fixtures/questkeep-main-fold.json', import.meta.url), 'utf8'));
// a problem found at players (users) may cite only a player's report or the fix, so every note cites a report
const EVIDENCE = 'feedback/r3port1';

// Each note runs hq problem against a scratch repo with no hq.json and a scratch register, and answers its stored line.
function noteInScratch(stageArgs) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-stage-words-')), repo = join(dir, 'repo'), reg = join(dir, 'reg');
  mkdirSync(repo);
  try {
    execFileSync(process.execPath, [HQ, 'problem', 'note', '--repo', repo, '--title', 'A stage word as given', '--kind', 'agent-mistake', '--evidence', EVIDENCE, ...stageArgs],
      { encoding: 'utf8', env: { ...process.env, HOME: dir, HQ_PROBLEMS_DIR: reg, HQ_AGENT: 'builder' } });
    const lines = readFileSync(join(reg, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.equal(lines.length, 1);
    return lines[0];
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const stages = ({ fields }) => ({ foundAt: fields.foundAt ?? null, shouldHaveCaughtAt: fields.shouldHaveCaughtAt ?? null });

test('hq problem note stores person exactly as given', () => {
  assert.deepEqual(stages(noteInScratch(['--found-at', 'person'])), { foundAt: 'person', shouldHaveCaughtAt: null });
});

test('hq problem note stores players and person-after exactly as given', () => {
  assert.deepEqual(stages(noteInScratch(['--found-at', 'players', '--should-have-caught-at', 'person-after'])), { foundAt: 'players', shouldHaveCaughtAt: 'person-after' });
});

test("the stored old names are the lines QuestKeep main's reader keeps the stage of", () => {
  const written = [noteInScratch(['--found-at', 'person']), noteInScratch(['--found-at', 'players', '--should-have-caught-at', 'person-after'])];
  assert.deepEqual(written.map(stages), MAIN.lines.slice(0, 2).map(stages), 'the writer stores what the fixture fed main');
  assert.deepEqual(MAIN.mainFolded.slice(0, 2).map(({ id, ...s }) => s), written.map(stages), 'main kept both stages');
  for (const w of written.flatMap(l => Object.values(stages(l))).filter(Boolean)) assert.ok(MAIN.mainStages.includes(w), `${w} is one of main's stages`);
  // the new name is what main drops, which is why the writer must not translate on write
  assert.deepEqual(MAIN.mainFolded[2], { id: MAIN.lines[2].id, foundAt: null, shouldHaveCaughtAt: null });
});

test("HQ's own reader reads the stored old names as the stages they became", () => {
  const { entries, notPlaced } = fold(MAIN.lines);
  assert.deepEqual(notPlaced, []);
  assert.deepEqual(entries.map(p => [p.foundAt, p.shouldHaveCaughtAt ?? null]), [['you', null], ['users', 'you-after'], ['you', 'you-after']]);
});

test('a word that is neither a stage nor an old name of one is still refused', () => {
  assert.throws(() => noteInScratch(['--found-at', 'somebody']), e => /foundAt: "somebody" is not a value it takes/.test(String(e.stderr)));
});
