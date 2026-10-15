// Proves: the backlog's history is rebuilt from git (lib/backlog.mjs): an item's file read into fields, the rules
// checked, an entry of the old one-file backlog followed through its versions, the item files' own commits, and what
// a branch does to the items, from text as git would print it.
// Why: the Backlog page's board, list and trends are only as true as this reading, and no repo is needed to pin it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseItem, check, parseOldEntries, followOld, followFiles, joinHistory, trend, branchTouches, oldTouches,
  parseNameStatusLog, commitType, itemPath, openBlockers, MAX_WORDS, MAX_INBOX,
} from '../lib/backlog.mjs';

// An item file as docs/backlog/README.md describes it.
const ITEM = `---
type: bug
asked: Jane, 27 Sep
blocked-by: stamp-copies
plan: docs/plans/sync-review.md
---
# A stamp reward stays drawn where this device put it

The device that lost the race keeps its own copy until it reloads.

Done when: smoke-reward compares both browsers.

Hurts today: anyone with two devices open when a card fills.
`;
const item = (slug, over = {}) => ({ ...parseItem(ITEM, { slug, stage: 'next' }), blockedBy: [], ...over });

test('an item file gives its type, who asked and when, what blocks it, its plan and its title', () => {
  const it = parseItem(ITEM, { slug: 'stamp-reward-redraw', stage: 'next' });
  assert.equal(it.type, 'bug');
  assert.deepEqual([it.askedBy, it.askedOn], ['Jane', '27 Sep']);
  assert.deepEqual(it.blockedBy, ['stamp-copies']);
  assert.equal(it.plan, 'docs/plans/sync-review.md');
  assert.equal(it.title, 'A stamp reward stays drawn where this device put it');
  assert.equal(it.doneWhen, 'smoke-reward compares both browsers.');
  assert.ok(!it.body.includes('# A stamp'), 'the title is not part of the body');
});

test('a well-formed set of items has no problems', () => {
  assert.deepEqual(check([item('stamp-copies'), item('stamp-reward-redraw', { blockedBy: ['stamp-copies'] })]), []);
});

test('each rule names the file that breaks it', () => {
  const wordy = item('wordy', { words: MAX_WORDS + 1 });
  const problems = check([
    item('no-type', { type: '' }), item('odd-type', { type: 'epic' }), item('no-asker', { asked: '' }),
    item('Bad_Name'), wordy, item('waits', { blockedBy: ['gone-item'] }),
  ]);
  for (const [slug, why] of [['no-type', /type is ""/], ['odd-type', /type is "epic"/], ['no-asker', /no asked/], ['Bad_Name', /lower-case/],
    ['wordy', /over 150/], ['waits', /blocked by gone-item, which is not an item/]]) {
    assert.ok(problems.some(p => p.includes(slug) && why.test(p)), `${slug}: ${why}`);
  }
});

test('an inbox past its cap is one problem', () => {
  const inbox = Array.from({ length: MAX_INBOX + 1 }, (_, i) => ({ ...item(`idea-${i}`), stage: 'inbox' }));
  assert.equal(check(inbox).filter(p => /inbox/.test(p)).length, 1);
  assert.deepEqual(check(inbox.slice(1)), []);
});

test('only blockers still on the list count', () => {
  const list = [item('a'), item('b', { blockedBy: ['a', 'shipped-already'] })];
  assert.deepEqual(openBlockers(list[1], list), ['a']);
});

test('commit types are the Conventional Commits ones; the first days\' "Backlog:" subjects have none', () => {
  assert.equal(commitType('feat(rules)!: old clients break'), 'feat');
  assert.equal(commitType('fix: a thing'), 'fix');
  assert.equal(commitType('Backlog: two entries'), '');
  assert.equal(commitType('Merge branch main'), '');
});

// ---- the old file ----

const OLD = (...lines) => `# Backlog\n\nIntro.\n\n## 26 September 2026\n\n${lines.join('\n')}\n`;
const V = (sha, date, text, { shipped = false, subject = `docs: ${sha}` } = {}) => ({ sha, date: `2026-09-${date}T10:00:00-04:00`, subject, shipped, text });
const SPRINT = '- **Sprint.** A button that makes Moss go faster and roll up into a ball.';
const SPRINT_EDITED = '- **Sprint.** A button that makes Moss go faster and roll up into a ball. Not started.';
const SPRINT_RENAMED = '- **Moss sprints.** A button that makes Moss go faster and roll up into a ball. Not started.';
const NAMING = '3. **Name your world.** (Jane) Let people name their world.';

test('old entries are the list lines that open with a bold title, numbered or not', () => {
  const e = parseOldEntries(OLD(SPRINT, NAMING, 'A plain line.'));
  assert.deepEqual(e.map(x => x.title), ['Sprint', 'Name your world']);
  assert.equal(e[1].body, '(Jane) Let people name their world.');
  assert.equal(e[0].section, '26 September 2026');
});

test('an entry is followed from the commit that added it through an edit and a rename to the one that took it off', () => {
  const [l] = followOld([
    V('a1', 25, OLD(SPRINT)), V('b2', 26, OLD(SPRINT_EDITED)), V('c3', 26, OLD(SPRINT_RENAMED)),
    V('d4', 27, OLD(), { shipped: true, subject: 'feat(world): Moss sprints' }),
  ]);
  assert.deepEqual(l.events.map(e => e.kind), ['added', 'edited', 'renamed', 'closed']);
  assert.deepEqual(l.titles, ['Sprint', 'Moss sprints']);
  assert.equal(l.open, false);
  assert.deepEqual([l.events[3].shipped, l.events[3].type], [true, 'feat']);
});

test('an entry taken off and later put back keeps one history', () => {
  const lineages = followOld([V('a1', 25, OLD(SPRINT)), V('b2', 26, OLD()), V('c3', 27, OLD(SPRINT))]);
  assert.equal(lineages.length, 1);
  assert.deepEqual(lineages[0].events.map(e => e.kind), ['added', 'closed', 'reopened']);
  assert.equal(lineages[0].open, true);
});

test('two different entries swapped in one commit are not taken for a rename', () => {
  const lineages = followOld([V('a1', 25, OLD(SPRINT)), V('b2', 26, OLD(NAMING))]);
  assert.equal(lineages.length, 2);
  assert.deepEqual(lineages.map(l => l.events.map(e => e.kind)), [['added', 'closed'], ['added']]);
});

// ---- the item files ----

// `git log --name-status` as fileCommits asks for it, newest first
const LOG = [
  '\x01c3\t2026-09-30T09:00:00-04:00\tdrew\tfix(world): the reward is redrawn', 'D\tdocs/backlog/next/stamp-reward-redraw.md', 'M\tweb/moss3d.js',
  '\x01b2\t2026-09-29T21:00:00-04:00\tdrew\tdocs: sort the inbox', 'R100\tdocs/backlog/inbox/sprint.md\tdocs/backlog/parked/sprint.md',
  '\x01a1\t2026-09-29T20:00:00-04:00\tdrew\tdocs: the backlog becomes one file per item', 'D\tdocs/BACKLOG.md', 'A\tdocs/backlog/inbox/sprint.md', 'A\tdocs/backlog/next/stamp-reward-redraw.md',
].join('\n');

test('a file added with the old file\'s delete came across from it; a stage move keeps the item; a delete with code ships it', () => {
  const ev = followFiles(parseNameStatusLog(LOG));
  assert.deepEqual(ev.get('sprint').map(e => [e.kind, e.stage]), [['migrated', 'inbox'], ['moved', 'parked']]);
  const redraw = ev.get('stamp-reward-redraw');
  assert.deepEqual(redraw.map(e => e.kind), ['migrated', 'closed']);
  assert.deepEqual([redraw[1].shipped, redraw[1].type], [true, 'fix']);
});

test('only files directly in a stage folder are items', () => {
  assert.deepEqual(itemPath('docs/backlog/next/a-b.md'), { stage: 'next', slug: 'a-b' });
  for (const p of ['docs/backlog/README.md', 'docs/backlog/done/a.md', 'docs/backlog/next/x/a.md', 'docs/BACKLOG.md']) assert.equal(itemPath(p), null, p);
});

test('the old history and the files join into one record per item, through the map', () => {
  const lineages = followOld([V('o1', 25, OLD(SPRINT))]);
  const fileEvents = followFiles(parseNameStatusLog(LOG));
  const items = [{ ...parseItem(ITEM, { slug: 'sprint', stage: 'parked' }), title: 'Moss sprints' }];
  const records = joinHistory({ items, lineages, fileEvents, map: [{ old: 'Sprint', slug: 'sprint' }] });
  const sprint = records.find(r => r.slug === 'sprint');
  assert.deepEqual(sprint.events.map(e => e.kind), ['added', 'migrated', 'moved']);
  assert.equal(sprint.added, '2026-09-25T10:00:00-04:00', 'listed since the old file, not since the move');
  assert.equal(sprint.open, true);
  const redraw = records.find(r => r.slug === 'stamp-reward-redraw');
  assert.equal(redraw.open, false);
  assert.equal(redraw.type, 'bug', 'a closed item with no file takes its type from the fix that shipped it');
});

test('the trend counts each day\'s adds and closes and the open count at its end', () => {
  const rec = (added, closed) => ({ added, closed: closed ? { date: closed, shipped: true } : null });
  const t = trend([rec('2026-09-25T09:00'), rec('2026-09-25T10:00', '2026-09-26T10:00'), rec('2026-09-26T11:00')]);
  assert.deepEqual(t.map(d => [d.day, d.added, d.closed, d.open]), [['2026-09-25', 2, 0, 2], ['2026-09-26', 1, 1, 2]]);
});

// ---- branches ----

test('a branch that deletes an item ships it, one that changes it works on it, and a new file is only proposed', () => {
  const diff = 'D\tdocs/backlog/next/a.md\nM\tdocs/backlog/next/b.md\nA\tdocs/backlog/inbox/c.md\nM\tweb/app.js\n';
  assert.deepEqual(branchTouches(diff).map(t => [t.slug, t.how]), [['a', 'shipping'], ['b', 'editing'], ['c', 'adding']]);
});

test('on a branch still on the old file, a line taken off is being shipped and a changed line is being worked on', () => {
  const base = OLD(SPRINT, NAMING), tip = OLD('3. **Name your world.** (Jane) Let people name their world, privately first.');
  assert.deepEqual(oldTouches(base, tip), [{ title: 'Sprint', how: 'shipping' }, { title: 'Name your world', how: 'editing' }]);
  assert.deepEqual(oldTouches(base, base), []);
});

test('a numbered entry retitled and rewritten on a branch is being worked on, since its number stays', () => {
  const tip = OLD(SPRINT, '3. **Naming, decided.** Let people name their world, private to them first.');
  assert.deepEqual(oldTouches(OLD(SPRINT, NAMING), tip), [{ title: 'Name your world', how: 'editing' }]);
});

test('a number given to a new entry the moment the old one shipped is a new entry, not a rename', () => {
  const tip = OLD(SPRINT, '3. **Cache node_modules on CI.** A cache keyed on the lock file would skip the unpack.');
  assert.deepEqual(oldTouches(OLD(SPRINT, NAMING), tip), [{ title: 'Name your world', how: 'shipping' }]);
});

test('an item whose file is gone before any commit takes it off is not open and has no close yet', () => {
  // a file deleted in the working tree: its history has no 'closed' event yet, so the board keeps it off every column
  // rather than drawing it as done
  const fileEvents = new Map([['sprint', [{ kind: 'migrated', date: '2026-09-26T10:00:00Z', stage: 'next' }]]]);
  const [r] = joinHistory({ items: [], lineages: followOld([V('a1', 25, OLD(SPRINT))]), fileEvents, map: [{ old: 'Sprint', slug: 'sprint' }] });
  assert.deepEqual([r.slug, r.open, r.closed], ['sprint', false, null]);
});
