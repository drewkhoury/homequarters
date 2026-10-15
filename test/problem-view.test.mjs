// Proves: what the Problems page shows, as data (lib/problem-view.mjs): costs summed over every observation at once
// and filtered by when they happened, the period before offered only once it holds data, time waiting on the person
// as clock hours, every share with its count, and the export's text checked for privacy again.
// Why: the reviews set these rules (Juno on the counts, Noor on the shares, Theo on privacy, since entries from git
// never pass the writer), and the page and its export carry them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { windowOf, overview, trends, slot, exportJSON, clockMinutes, testsView } from '../lib/problem-view.mjs';
import { useQuestKeepStages } from './fixtures/stages.mjs';

useQuestKeepStages();

const DAY = 86400000, START = Date.parse('2026-09-24T00:00:00Z'), NOW = Date.parse('2026-10-11T12:00:00Z');
const at = d => new Date(Date.parse('2026-10-01T12:00:00Z') + d * DAY).toISOString(); // day 0 is 1 October
const red = (d, over = {}) => ({ type: 'red', sig: 'smoke-wake', class: 'flaky', run: `r${d}`, when: at(d), kind: 'docker-gate', minutes: 3, partial: false, ...over });
const reg = (over = {}) => ({ entries: [], unexplained: [], leftOut: [], notPlaced: [], observations: { reds: [], slot: [], prs: [] }, sources: {}, start: START, ...over });

test('the period before is offered only when it lies wholly after the register starts', () => {
  assert.equal(windowOf('7d', NOW, START).prev, true, '27 Sep to 4 Oct is after 24 Sep');
  assert.equal(windowOf('30d', NOW, START).prev, false, '11 Aug to 11 Sep is before it');
  assert.deepEqual([windowOf('7d', NOW, START).days, windowOf('all', NOW, START).from], [7, START]);
});

// Juno's finding 4: page totals must be summed over all observations together, never entry by entry.
test("machine time counts each run once across every entry and group, and only the period's runs", () => {
  const shared = red(8, { run: 'same' });
  const r = reg({ observations: { reds: [shared, red(8, { run: 'same', sig: 'smoke-sync' }), red(2), red(9, { class: 'dirty' })], slot: [], prs: [] } });
  const o = overview(r, windowOf('7d', NOW, START));
  assert.equal(o.machineMinutes, 3, 'one run in the week; day 2 is before it, and a dirty red is left out');
});

// Noor's finding 6: summed waits ran in parallel and read as "you cost 218 hours".
test('waiting on the person is the clock time at least one pull request waited, with how many waited', () => {
  const prs = [{ type: 'pr-wait', pr: 1, greenAt: at(8), at: new Date(Date.parse(at(8)) + 60 * 60000).toISOString(), minutes: 60 },
    { type: 'pr-wait', pr: 2, greenAt: new Date(Date.parse(at(8)) + 30 * 60000).toISOString(), at: new Date(Date.parse(at(8)) + 90 * 60000).toISOString(), minutes: 60 }];
  assert.equal(clockMinutes(prs), 90, 'two waits of an hour, half an hour apart, are 90 minutes of the clock');
  const o = overview(reg({ observations: { reds: [], slot: [], prs } }), windowOf('7d', NOW, START));
  assert.deepEqual([o.waitingOnYou.minutes, o.waitingOnYou.prs], [90, 2]);
});

// Juno's finding 6: Live only leaves backfilled entries out, but the costs of the period stay the period's.
test('Live only leaves backfilled entries out of entry counts, and costs stay those of the period', () => {
  const entries = [{ id: 'P-a', record: 'backfill', kind: 'flaky-test', openedAt: at(8), observations: [red(8)] }, { id: 'F-b', record: 'live', kind: 'test-failure', openedAt: at(8), observations: [] }];
  const r = reg({ entries, observations: { reds: [red(8)], slot: [], prs: [] } });
  const all = overview(r, windowOf('7d', NOW, START)), live = overview(r, windowOf('7d', NOW, START), { live: true });
  assert.deepEqual([all.opened, live.opened], [2, 1]);
  assert.equal(live.machineMinutes, all.machineMinutes);
});

test('product bugs caught before the merge are counted against all product bugs whose finder is known, with both counts', () => {
  const bug = (id, foundAt) => ({ id, kind: 'product-bug', record: 'live', foundAt, openedAt: at(8), observations: [] });
  const o = overview(reg({ entries: [bug('a', 'pr-gate'), bug('b', 'reviewer'), bug('c', 'users'), bug('d', undefined)] }), windowOf('7d', NOW, START));
  assert.deepEqual(o.caughtBeforeMerge, { caught: 2, of: 3 });
});

// The plan's Trends: gate reds per 100 gate runs, split by what the stores saw of them.
const gates = n => Array.from({ length: n }, (_, i) => ({ id: `g${i + 1}`, source: 'laptop', when: at(8), info: { kind: 'docker-gate', commit: 'c', dirty: false }, tasks: [] }));
const weekOf8 = (r, runs) => trends(r, { runs, now: NOW }).weeks.find(w => w.gateRuns);

test('a red gate run counts once, by its worst cause: infra, then code, then not known, then flaky', () => {
  const reds = [red(8, { run: 'g1', class: 'infra' }), red(8, { run: 'g1', class: 'never-rerun' }), red(8, { run: 'g2', class: 'red-twice' }),
    red(8, { run: 'g3', class: 'passed-alone' }), red(8, { run: 'g4', class: 'never-rerun' }), red(8, { run: 'g4', class: 'flaky', sig: 'smoke-sync' })];
  const week = weekOf8(reg({ observations: { reds, slot: [], prs: [] } }), gates(5));
  assert.deepEqual([week.gateRuns, week.reds.infra, week.reds.code, week.reds.unknown, week.reds.flaky], [5, 1, 1, 1, 1]);
  assert.deepEqual(week.per100, { infra: 20, code: 20, unknown: 20, flaky: 20 });
});

// Before rerun-once (11 Oct) almost no red was rerun, so a red nothing else was seen of says nothing about the code.
test('a red never rerun and owned by no entry counts as not known, never as code', () => {
  const week = weekOf8(reg({ observations: { reds: [red(8, { run: 'g1', class: 'never-rerun' })], slot: [], prs: [] } }), gates(1));
  assert.deepEqual(week.reds, { infra: 0, code: 0, unknown: 1, flaky: 0 });
});

// The 8 October slowness to gstatic read as 17 real breaks while the backfill that judged each of those runs called them
// flaky or infra (Register's check, 11 Oct).
test('a red takes its cause from the entry judged from its run, whatever the stores called it', () => {
  const owned = (id, kind, o) => ({ id, kind, record: 'backfill', status: 'closed', openedAt: at(9), runs: [o.run], observations: [o] });
  const net = red(8, { run: 'g1', class: 'never-rerun' }), npm = red(8, { run: 'g2', class: 'never-rerun', sig: 'smoke-prep' }), bug = red(8, { run: 'g3', class: 'flaky', sig: 'smoke-sync' });
  const entries = [owned('P-net', 'flaky-test', net), owned('P-npm', 'tooling-breakage', npm), owned('P-bug', 'test-failure', bug)];
  const week = weekOf8(reg({ entries, observations: { reds: [net, npm, bug], slot: [], prs: [] } }), gates(3));
  assert.deepEqual(week.reds, { infra: 1, code: 1, unknown: 0, flaky: 1 });
});

// Juno's review: a closed test-failure entry keeps owning later reds of its test when they come back, with no end date,
// so owning a red by its test alone must not make it a real break.
test('an entry that owns a red only by its test, without being judged from its run, leaves it not known', () => {
  const later = red(8, { run: 'g1', class: 'never-rerun' });
  const fixEntry = { id: 'F-old', kind: 'test-failure', record: 'live', status: 'closed', signature: 'smoke-wake', openedAt: at(2), closedAt: at(2), observations: [later] };
  const week = weekOf8(reg({ entries: [fixEntry], observations: { reds: [later], slot: [], prs: [] } }), gates(1));
  assert.deepEqual(week.reds, { infra: 0, code: 0, unknown: 1, flaky: 0 });
});

test("each week's causes add up to its red gate runs", () => {
  const reds = [red(8, { run: 'g1', class: 'infra' }), red(8, { run: 'g1', class: 'flaky', sig: 'smoke-sync' }), red(8, { run: 'g2', class: 'never-rerun' }),
    red(8, { run: 'g3', class: 'red-twice' }), red(8, { run: 'g3', class: 'never-rerun', sig: 'smoke-sync' })];
  const week = weekOf8(reg({ observations: { reds, slot: [], prs: [] } }), gates(4));
  assert.equal(Object.values(week.reds).reduce((a, b) => a + b, 0), 3, 'three red runs of four, each once');
});

test("the slot's day counts the minutes waited behind another run, and the most runs holding or waiting at once", () => {
  const w = (h, m, over) => ({ type: 'wait', at: new Date(Date.parse(at(8)) + h * 3600e3).toISOString(), session: 's', agent: null, worktree: 'w', behind: 'other', outcome: 'took', minutes: m, ...over });
  const lock = [{ at: at(8), event: 'take', pid: 1, session: 'a', worktree: 'x' }, { at: new Date(Date.parse(at(8)) + 3 * 3600e3).toISOString(), event: 'release', pid: 1, session: 'a', worktree: 'x' }];
  // the holder from 0:00 to 3:00, one wait from 1:00 to 1:40 and another from 1:30 to 1:40: three at 1:30
  const s = slot(reg({ observations: { reds: [], slot: [w(1, 40, { worktree: 'w1' }), w(1.5, 10, { worktree: 'w2' }), w(2, 5, { behind: 'own' })], prs: [] } }), { lock, now: NOW, w: windowOf('7d', NOW, START) });
  const day = s.days.find(d => d.waitMinutes);
  assert.deepEqual([day.waitMinutes, day.waits, day.atOnce], [50, 2, 3], 'the holder and two waiting at once');
});

// Theo's review: entries from git never pass the writer, so the export checks every text field again.
test('the export withholds any text the privacy check refuses, naming why, and keeps the rest', () => {
  const entries = [{ id: 'F-1e79f371', source: 'git', title: 'fix: reply to a.player@gmail.com about the board', kind: 'product-bug', openedAt: at(8), observations: [], events: [] },
    { id: 'F-2a2b2c2d', source: 'git', title: 'fix: the board folds past three quests', kind: 'product-bug', openedAt: at(8), observations: [], events: [] }];
  const j = exportJSON(reg({ entries }), { w: windowOf('7d', NOW, START), ctx: { home: '/Users/someone', keepEmailDomains: [], private: [] }, now: NOW });
  const text = JSON.stringify(j);
  assert.ok(!text.includes('gmail'));
  assert.match(text, /withheld: it holds an email address/);
  assert.match(text, /the board folds past three quests/);
  assert.ok(j.vocabulary && j.vocabulary.kinds.length === 8, 'the values and their meanings travel with it');
});

// The plan's Tests tab: what each gate and long-set test costs and what it has caught. A catch is red twice or more on
// one commit, then green on a later one, with the test file the same on the red commit, its parent and the green
// commit: the code broke and was fixed while the test stayed put, so a red-first commit, which changes the test, is not one.
test('a test catches when it is red twice on a commit and green later, its file unchanged between them', () => {
  const files = [{ path: 'tests/smoke-wake.js', name: 'smoke-wake', set: 'gate', fields: { proves: 'the wake banner shows after a night away' } }];
  const res = (run, d, commit, status, over = {}) => ({ run, when: at(d), commit, status, full: true, kind: 'docker-gate', seconds: 30, ...over });
  const results = { 'smoke-wake': [res('a', 2, 'c2', 'fail'), res('b', 2.1, 'c2', 'fail'), res('c', 3, 'c3', 'pass'),
    res('d', 4, 'c4', 'fail'), res('e', 4.1, 'c4', 'fail'), res('f', 5, 'c5', 'pass')] };
  // c4 changed the test itself: a red-first commit
  const fileSame = (file, a, b) => !(a === 'c4^' && b === 'c4') && !(b === 'c4' || a === 'c4');
  const reds = [red(2, { run: 'a', class: 'never-rerun' }), red(2.1, { run: 'b', class: 'never-rerun' }), red(4, { run: 'd', class: 'flaky' })];
  const [row] = testsView(reg({ observations: { reds, slot: [], prs: [] } }), { files, results, fileSame, w: windowOf('all', NOW, START) });
  assert.deepEqual([row.test, row.runs, row.minutes, row.catches.length, row.catches[0].red, row.catches[0].green], ['smoke-wake', 6, 3, 1, 'c2', 'c3']);
  assert.deepEqual([row.flakyReds, row.neverRerun], [1, 2]);
  assert.equal(row.proves, 'the wake banner shows after a night away');
});

// Noor's review of the built page, finding 5: "Unexplained, 7 days" gave each group's whole-register count and cost
// (the slot: 759 waits, 39 h, beside a story of 18 h that week), mixed wait hours and machine minutes in one column,
// and showed 12 of 14 with nothing said of the rest.
test("an unexplained group in the overview counts only the period's observations, with its two clocks apart", () => {
  const wait = (d, minutes) => ({ type: 'wait', sig: 'slot', at: at(d), minutes });
  const g = (sig, observations) => ({ sig, family: 'real', state: 'alive', count: observations.length, firstSeen: observations[0].when || observations[0].at, lastSeen: (observations.at(-1).when || observations.at(-1).at), machineMinutes: 99, waitMinutes: 99, observations });
  const groups = [g('slot', [wait(1, 30), wait(8, 10), wait(9, 5)]), g('smoke-a', [red(2), red(9, { minutes: 4 })]),
    ...[...Array(12)].map((_, i) => g(`smoke-${i}`, [red(9, { run: `q${i}` })]))];
  const o = overview(reg({ unexplained: groups }), windowOf('7d', NOW, START));
  const slotRow = o.unexplained.list.find(x => x.sig === 'slot'), a = o.unexplained.list.find(x => x.sig === 'smoke-a');
  assert.deepEqual([slotRow.count, slotRow.waitMinutes, slotRow.machineMinutes], [2, 15, null], 'day 1 is before the week');
  assert.deepEqual([a.count, a.machineMinutes, a.waitMinutes], [1, 4, null]);
  assert.deepEqual([o.unexplained.list.length, o.unexplained.more], [12, 2], '14 groups in the week, 12 listed');
});

// Noor's review of the built page, finding 6: counts of who found them rose from 10 to 240 entries a week with the work,
// so "fewer found by you" could not be read off the chart. Each week's shares can.
test("each week says what share of its entries each finder found, out of those that say who", () => {
  const e = (i, foundBy) => ({ id: `F-${i}`, status: 'closed', openedAt: at(1), foundBy: [foundBy], observations: [] });
  const t = trends(reg({ entries: [e(1, 'gate'), e(2, 'builder'), e(3, 'test:smoke-wake'), e(4, 'you'), { id: 'F-5', status: 'closed', openedAt: at(1), observations: [] }] }), { runs: [], now: NOW });
  const wk = t.weeks.find(x => x.findersKnown);
  assert.deepEqual(wk.finderShares, { checks: 75, reviewer: 0, you: 25, after: 0 });
  assert.equal(t.weeks.find(x => !x.findersKnown).finderShares.checks, null, 'a week where no entry says who has no shares');
});

// 12 October: Trends counted 13 planted probe/exp runs and 5 lab runs as gate runs, and its last week ran to 15 October.
test('Trends leaves out probe, exp and lab runs and runs after now, and its last week ends at now', () => {
  const g = (id, d, info = {}) => ({ id, source: 'laptop', when: at(d), info: { kind: 'docker-gate', commit: 'c', dirty: false, branch: 'feat/x', ...info }, tasks: [] });
  const runs = [g('real', 8), g('probe', 8, { branch: 'probe/rerun-once' }), g('exp', 8, { branch: 'exp/vm-load' }), g('lab', 8, { branch: 'lab/hold' }), g('labkind', 8, { kind: 'lab' }), g('later', 11)];
  const week = trends(reg(), { runs, now: NOW }).weeks.at(-1);
  assert.equal(week.gateRuns, 1, 'only the real run, before now');
  assert.equal(week.through, '2026-10-11', 'the week says where it stops');
});
