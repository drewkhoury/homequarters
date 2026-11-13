// Proves: a deploy counts only when it changed what reaches users, and a failed deploy, a pipeline red and a reused
// gate are each told apart, over real runs (fixtures/dora, whose README says why each is there), with git's two
// answers given as plain lists.
// Why: a reader shown a number that means something else trusts the wrong thing; these figures are what the Delivery
// page leads with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compute, summarise, deploysOf, failuresOf, recoveriesOf, changesOf, mergesOf, prRedsOf, gatesOf, fixesOf, rowFromLog, slotOf, stats, dayStart, dayKey, addDays, windowsAt, lateDays, COUNTING_CHANGES, P90_FROM, configureDelivery } from '../lib/dora.mjs';
import * as dora from '../lib/dora.mjs';
import { QK_DELIVERY } from './fixtures/delivery.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = name => JSON.parse(readFileSync(join(here, 'fixtures', 'dora', `${name}.json`), 'utf8'));
const runs = fixture('runs'), jobs = fixture('jobs'), pulls = fixture('pulls'), lock = fixture('lock'), commits = fixture('commits');
const logs = new Map(Object.entries(fixture('logs')).map(([id, line]) => [Number(id), line]));
const jobsOf = (id, attempt) => jobs[`${id}-${attempt}`] || null;
// what reaches players in the repo these runs came from: its manifest would say delivery.userPaths; without one, every
// change counts as reaching users (tested below)
// QuestKeep's own job and step names, which these fixtures carry (test/fixtures/delivery.mjs)
configureDelivery(QK_DELIVERY);

// main's pushes in the order they landed, which is how "a contains b" is answered on a straight line
const MAIN = runs.filter(r => r.path.endsWith('deploy.yml') && r.event === 'push').map(r => r.head_sha);
const contains = (a, b) => MAIN.indexOf(b) <= MAIN.indexOf(a);
// every push here changed the served app, except the ones listed
const changedExcept = (...same) => (a, b) => !same.some(([x, y]) => a.startsWith(x) && b.startsWith(y));
const git = { changed: changedExcept(), contains };
const rows = new Map([...logs].map(([id, t]) => [id, rowFromLog(t)]));
const deploys = deploysOf({ runs, jobsOf, rows, changed: git.changed });
const run = id => r => r.run === id;

test('a deploy counts when its deploy step passed: a cancelled job that released counts, a failed step or a skip does not', () => {
  assert.deepEqual(deploys.map(d => d.run), [36691018155, 36692304266, 36694091370, 36930221298, 37106204812, 37107791344, 37370455019, 37380538618, 37400367027]);
  assert.equal(deploys.find(run(37106204812)).liveAt, '2026-10-03T07:25:42Z');
  // its first attempt's gate went red; the re-run deployed
  assert.equal(deploys.find(run(36930221298)).attempt, 2);
  assert.equal(deploys.find(run(36691018155)).runner, 'hosted');
  assert.equal(deploys.find(run(37107791344)).runner, 'laptop');
});

test('decide\'s row is read from its log line, and each deploy carries it', () => {
  assert.deepEqual(rowFromLog(logs.get(37416302816)).row, 5);
  assert.equal(rowFromLog(logs.get(37416302816)).action, 'skip');
  assert.equal(deploys.find(run(37380538618)).row, 6);
  assert.equal(deploys.find(run(37400367027)).row, 7);
  assert.equal(rowFromLog('no row here'), null);
});

test('a deploy that served the same app as the one before it is not player-facing; the first brought the app to players', () => {
  const ds = deploysOf({ runs, jobsOf, rows, changed: changedExcept(['ec13700', 'c5b78b0']) });
  assert.equal(ds.find(run(37380538618)).playerFacing, false);
  assert.equal(ds.find(run(37400367027)).playerFacing, true);
  assert.equal(ds[0].playerFacing, true);
});

test('a smoke red after a release is a failed deploy; a deploy step that failed released nothing and is a pipeline red', () => {
  const f = failuresOf({ runs, jobsOf });
  assert.deepEqual(f.map(x => [x.run, x.kind, x.released]), [[36692304266, 'smoke', true], [36824992530, 'deploy-job', false]]);
});

test('recovery runs from the bad release going live to the next release whose smoke test passed', () => {
  const [r] = recoveriesOf(failuresOf({ runs, jobsOf }), deploys);
  assert.equal(r.failedRun, 36692304266);
  assert.equal(r.restoredRun, 36694091370);
  assert.equal(r.sec, 985); // 08:52:05 to 09:08:30
});

test('lead time for a PR landed by rebase starts at its last push, and its parts add up to the whole', () => {
  const c = changesOf({ runs, jobsOf, pulls, deploys, lock, ...git }).find(x => x.pr === 172);
  assert.equal(c.sha.slice(0, 7), 'c5b78b0'); // merged as c5b78b0, pushed as 74ab1b1
  assert.equal(c.startAt, '2026-10-05T21:59:20Z');
  assert.equal(c.totalSec, 604);
  assert.deepEqual(c.split, { runnerWaitSec: 19, slotWaitSec: 0, gateSec: 252, greenToMergeSec: 282, mergeToLiveSec: 51, reused: false, otherSec: 0 });
});

test('a gate that went red and was re-run puts that time in other, not in waiting for a runner', () => {
  const c = changesOf({ runs, jobsOf, pulls, deploys, lock, ...git }).find(x => x.pr === 175);
  assert.equal(c.split.runnerWaitSec, 2);
  assert.equal(c.split.gateSec, 274);
  assert.equal(c.totalSec, 6691); // 23:55:08 to 01:46:39
  // the parts: runner wait 2, slot wait 0, gate 274, green 01:38:38 to merged 01:40:34 (116), merged to live 01:46:39 (365)
  assert.equal(c.split.otherSec, 6691 - (2 + 0 + 274 + 116 + 365));
});

test('a change ends at the first deploy that contains it, and one that changed nothing players get is left out', () => {
  const cs = changesOf({ runs, jobsOf, pulls, deploys, lock, changed: changedExcept(['e9d5b78', '6a1e5bc']), contains });
  assert.equal(cs.find(x => x.pr === 132).deployRun, 37106204812);
  // 5b09943's own run was cancelled while queued; e5f2e2e's run, pushed the same second, shipped it
  const c75 = cs.find(x => x.pr === 75);
  assert.equal(c75.deployRun, 36930221298);
  assert.equal(c75.liveAt, '2026-10-01T22:14:52Z');
  assert.equal(cs.find(x => x.pr === 189), undefined);
  // PR #161's own runs are not here, so it has no start and no total, and is counted as such
  const c161 = cs.find(x => x.pr === 161);
  assert.equal(c161.startAt, null); assert.equal(c161.totalSec, null);
});

test('each PR gate red gets one cause, and a laptop red carries the machine\'s state beside it', () => {
  const reds = prRedsOf({ runs, jobsOf, lock }).filter(r => !r.earlier);
  assert.deepEqual(reds.map(r => [r.run, r.cause]), [[37096136960, 'infra'], [37103854046, 'filing'], [37168916705, 'test'], [37355400331, 'experiment']]);
  assert.equal(reds.find(run(37168916705)).runner, 'laptop');
  assert.ok(reds.find(run(37168916705)).load.load1 > 0);
  assert.equal(reds.find(run(37096136960)).load, null);
});

// A run that was re-run kept one conclusion, the last attempt's, so a red that went green on re-run left no trace (24 of
// 156 shown for the week of 5 October, against 43 of 175 counting every attempt).
test('a PR gate attempt that went red and was re-run counts as a red of its own, whatever the run ended as', () => {
  const reds = prRedsOf({ runs, jobsOf, lock });
  assert.deepEqual(reds.filter(r => r.earlier).map(r => [r.run, r.attempt, r.cause]).sort(), [[37103854046, 1, 'infra'], [37168916705, 1, 'test'], [37391190949, 1, 'test']]);
  assert.equal(reds.filter(r => r.run === 37168916705).length, 2, 'a run red on both attempts is two reds');
  assert.equal(reds.filter(r => r.run === 37391190949).length, 1, 'the green final attempt is no red');
});

test('gate seconds come from passed PR gates, from the first gate job\'s start to the last one\'s end', () => {
  const g = gatesOf({ runs, jobsOf, lock });
  assert.deepEqual(g.map(x => [x.run, x.runner, x.sec]), [[37076848861, 'hosted', 400], [37105642855, 'laptop', 346], [37379510900, 'laptop', 252], [37391190949, 'laptop', 274]]);
  assert.ok(g.every(x => !x.reused));
});

// No pull request gate has reused a laptop gate yet (deploy.yml's test job does that), so this one is PR #172's real
// gate with its tests marked skipped, as test.yml's laptop job leaves them when it reuses one
test('a gate that reused a laptop gate ran no tests, so it is counted apart from gate seconds', () => {
  const reusedJobs = { ...jobs, '37379510900-1': jobs['37379510900-1'].map(j => j.name !== 'laptop' ? j
    : { ...j, steps: j.steps.map(s => s.name === 'Run the tests' ? { ...s, conclusion: 'skipped' } : s) }) };
  const g = gatesOf({ runs, jobsOf: (id, a) => reusedJobs[`${id}-${a}`], lock });
  assert.equal(g.find(run(37379510900)).reused, true);
  assert.equal(g.filter(x => x.reused).length, 1);
});

test('a fix: commit carries Player-facing and Found-by trailers when it has them, and null when not', () => {
  const f = fixesOf([
    { sha: 'a', at: '2026-10-05T10:00:00Z', subject: 'fix: the board kept yesterday', body: 'Why.\n\nPlayer-facing: yes\nFound-by: a player' },
    { sha: 'b', at: '2026-10-05T11:00:00Z', subject: 'fix(hq): a label', body: 'Player-facing: no' },
    { sha: 'c', at: '2026-10-05T12:00:00Z', subject: 'fix: no trailer', body: '' },
    { sha: 'd', at: '2026-10-05T13:00:00Z', subject: 'feat: not a fix', body: 'Player-facing: yes' },
  ]);
  assert.deepEqual(f.map(x => [x.sha, x.playerFacing, x.foundBy]), [['a', true, 'a player'], ['b', false, null], ['c', null, null]]);
});

test('the 90th percentile shows only from P90_FROM values, since below that it is just the largest', () => {
  const upTo = n => Array.from({ length: n }, (_, i) => i + 1);
  assert.equal(stats(upTo(P90_FROM - 1)).p90, null);
  assert.equal(stats(upTo(10)).p90, 9);
  assert.equal(stats([1, 2, 3, 4]).median, 3); // 2.5 rounded
  assert.equal(stats([]), null);
});

test('a day starts at midnight Eastern, and the day the clocks go back is 25 hours long', () => {
  assert.equal(new Date(dayStart('2026-11-01')).toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(new Date(dayStart('2026-11-02')).toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(new Date(dayStart('2026-03-08')).toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(dayKey(Date.parse('2026-10-06T03:59:00Z')), '2026-10-05');
  const [day] = windowsAt(Date.parse('2026-11-02T12:00:00Z'));
  assert.equal((day.to - day.from) / 3600e3, 25);
});

test('a missed night is filled from the last copy before today, and nothing is filled when there is no copy before', () => {
  assert.deepEqual(lateDays(['2026-10-03', '2026-10-06'], '2026-10-06'), ['2026-10-04', '2026-10-05']);
  assert.deepEqual(lateDays(['2026-10-06'], '2026-10-06'), []);
  assert.deepEqual(lateDays(['2026-10-01', '2026-10-03'], '2026-10-05'), ['2026-10-04']);
  assert.equal(lateDays(['2026-01-01'], '2026-10-06', 30).length, 30);
});

// A late daily copy is taken as of the manifest's dailyAt on its day, read off the local clock, so the day the clocks
// change moves it with them; with no dailyAt it is the last millisecond of the day.
test('a late copy is as of dailyAt on its own day in the figures\' zone, clock changes included, or the day\'s end without one', () => {
  const asOf = (day, at) => new Date(dora.dailyAsOf(day, 'America/New_York', at)).toISOString();
  assert.equal(asOf('2026-11-11', '07:07'), '2026-11-11T12:07:00.000Z');
  assert.equal(asOf('2026-11-01', '07:07'), '2026-11-01T12:07:00.000Z', 'the clocks went back at 02:00');
  assert.equal(asOf('2026-03-08', '07:07'), '2026-03-08T11:07:00.000Z', 'the clocks went forward at 02:00');
  assert.equal(asOf('2026-11-11', null), '2026-11-12T04:59:59.999Z');
});

// dora.json's shape, as docs/decisions/2026-10-06-make-dora-counts-delivery.md documents it
const all = compute({ runs, jobsOf, logs, pulls, lock, commits, git });
const file = summarise(all, { asOf: Date.parse('2026-10-06T12:00:00Z'), repo: 'owner/questkeep', sources: { runs: { status: 'read' } } });

test('dora.json has the documented shape, with portable figures apart from the project\'s own', () => {
  assert.equal(file.version, 4);
  assert.deepEqual(Object.keys(file).sort(), ['blindSpots', 'countingChanges', 'generatedAt', 'items', 'level', 'repo', 'series', 'sources', 'start', 'today', 'tz', 'version', 'waiting', 'windows']);
  assert.deepEqual(file.windows.map(w => w.id), ['1d', '7d', '30d']);
  for (const w of file.windows) {
    assert.deepEqual(Object.keys(w.portable).sort(), ['deploys', 'failedDeploys', 'leadTime', 'recovery', 'rework']);
    assert.deepEqual(Object.keys(w.project).sort(), ['cost', 'hours', 'identicalRedeploys', 'leadSplit', 'rows', 'slowest', 'typical']);
    assert.ok(w.prev.from < w.prev.to && w.prev.to === w.from && w.from < w.to);
  }
});

test('yesterday\'s figures: three deploys, decide\'s rows, and a change with no start counted, not dropped', () => {
  const day = file.windows[0];
  assert.equal(day.from, '2026-10-05T04:00:00.000Z');
  assert.equal(day.portable.deploys.n, 3);
  assert.deepEqual(day.questkeep.rows, { 5: 0, 6: 1, 7: 2 });
  assert.equal(day.portable.leadTime.n, 2);
  assert.equal(day.portable.leadTime.noStart, 1);
  assert.deepEqual(day.portable.leadTime.paths, { pr: 3 });
});

test('an empty figure says why instead of showing 0, and machine figures are not compared across runners', () => {
  const asOf = Date.parse('2026-10-04T12:00:00Z');
  const f = summarise(all, { asOf, repo: null, sources: {} });
  // 3 October ran on the laptop and 2 October on GitHub's machines
  assert.equal(f.windows[0].prev.questkeep.cost.reason, 'different runner');
  const empty = summarise(compute({ runs: [], jobsOf, git }), { asOf, sources: {} });
  assert.equal(empty.windows[0].portable.leadTime.n, 0);
  assert.match(empty.windows[0].portable.leadTime.reason, /No change/);
  assert.equal(empty.windows[0].portable.rework.status, 'none');
});

// From 6 October 2026 the lock logs the Actions run on each line (ciRun, ciAttempt), and a line with the run is
// matched by it, ahead of any line that only falls inside the job's span. These two lines are made up for PR #172's
// gate: a wait of 30 s for the slot, which its real, time-matched lines do not have.
test('slot wait comes from the lines that name the run when the lock logged it, ahead of matching by time', () => {
  const named = [
    { at: '2026-10-05T21:59:40.000Z', event: 'wait', pid: 7, person: 'the laptop runner (test.yml)', ciRun: 37379510900, ciAttempt: 1 },
    { at: '2026-10-05T22:00:10.000Z', event: 'take', pid: 7, person: 'the laptop runner (test.yml)', ciRun: 37379510900, ciAttempt: 1 },
  ];
  const c = changesOf({ runs, jobsOf, pulls, deploys, lock: [...lock, ...named], ...git }).find(x => x.pr === 172);
  assert.equal(c.split.slotWaitSec, 30);
  assert.equal(c.split.gateSec, 252 - 30);
});

// When the checkout has not fetched a deploy's commit, git cannot say what it changed. Counting it as player-facing
// would inflate the figure on any HQ refresh that ran before a fetch, so it is unknown and counted apart.
test('a deploy git could not judge is unknown: neither a deploy players got nor an identical one', () => {
  const unread = (a, b) => (b.startsWith('c5b78b0') ? null : true);
  const all = compute({ runs, jobsOf, logs, pulls, lock, git: { changed: unread, contains } });
  const day = summarise(all, { asOf: Date.parse('2026-10-06T12:00:00Z'), sources: {} }).windows[0];
  assert.equal(day.portable.deploys.n, 2);
  assert.equal(day.portable.deploys.unknown, 1);
  assert.equal(day.questkeep.identicalRedeploys, 0);
});

// Until early November the 7- and 30-day windows straddle the 3 October switch to the laptop runner. A gate median
// across both machines measures neither, so the figure says it is mixed and gives each runner its own.
test('a window whose gates ran on both GitHub\'s machines and the laptop says so, with each runner\'s own figure', () => {
  const week = file.windows[1];
  assert.deepEqual(week.questkeep.cost.mixed, { hosted: 1, laptop: 3 });
  assert.equal(week.questkeep.cost.gateSecByRunner.hosted.median, 400);
  assert.equal(week.questkeep.cost.gateSecByRunner.laptop.median, 274);
  assert.equal(file.windows[0].questkeep.cost.mixed, null);
});

// The figures a reader sees, not only the flags under them: each count must leave out what its definition leaves out.
// Here ec13700 to c5b78b0 is an identical redeploy, so yesterday had two deploys players got and one that changed nothing.
const sameDay = summarise(compute({ runs, jobsOf, logs, pulls, lock, commits, git: { changed: changedExcept(['ec13700', 'c5b78b0']), contains } }),
  { asOf: Date.parse('2026-10-06T12:00:00Z'), sources: {} });

test('yesterday counts the deploys players got, and the identical one apart', () => {
  assert.equal(sameDay.windows[0].portable.deploys.n, 2);
  assert.equal(sameDay.windows[0].questkeep.identicalRedeploys, 1);
});

test('over 30 days the smoke red is a failed deploy and the deploy step that failed is a pipeline red, not both', () => {
  const month = sameDay.windows[2];
  assert.equal(month.portable.failedDeploys.n, 1);
  assert.deepEqual(month.portable.failedDeploys.items, [36692304266]);
  assert.equal(month.questkeep.cost.pipelineReds, 1);
});

// The two variants below are real jobs with one step's result changed, since no real run has that shape yet
const variant = (key, name, step, conclusion) => ({ ...jobs, [key]: jobs[key].map(j => j.name !== name ? j
  : { ...j, steps: j.steps.map(s => step.test(s.name) ? { ...s, conclusion } : s) }) });

test('a gate that reused a laptop gate is counted as reused and kept out of gate seconds', () => {
  const reusedJobs = variant('37379510900-1', 'laptop', /^Run the tests$/, 'skipped');
  const week = summarise(compute({ runs, jobsOf: (id, a) => reusedJobs[`${id}-${a}`], logs, pulls, lock, git }), { asOf: Date.parse('2026-10-06T12:00:00Z'), sources: {} }).windows[1];
  assert.equal(week.questkeep.cost.gateReused, 1);
  assert.equal(week.questkeep.cost.gateSec.n, 3);
});

test('a deploy job that went red after its deploy step passed released, so it is a failed deploy', () => {
  // e6b4837's run with its deploy step passing, as if a later step had failed
  const released = variant('36824992530-1', 'deploy', /^Run make deploy/, 'success');
  const f = failuresOf({ runs, jobsOf: (id, a) => released[`${id}-${a}`] }).find(run(36824992530));
  assert.equal(f.kind, 'deploy-job');
  assert.equal(f.released, true);
  const month = summarise(compute({ runs, jobsOf: (id, a) => released[`${id}-${a}`], logs, pulls, lock, git }), { asOf: Date.parse('2026-10-06T12:00:00Z'), sources: {} }).windows[2];
  assert.equal(month.portable.failedDeploys.n, 2);
  assert.equal(month.questkeep.cost.pipelineReds, 0);
});

test('recovery ends at the next release whose smoke test passed, not one whose smoke test was skipped', () => {
  const skipped = { ...jobs, '36694091370-1': jobs['36694091370-1'].map(j => j.name === 'smoke' ? { ...j, conclusion: 'skipped' } : j) };
  const jo = (id, a) => skipped[`${id}-${a}`];
  const ds = deploysOf({ runs, jobsOf: jo, rows, changed: git.changed });
  const [r] = recoveriesOf(failuresOf({ runs, jobsOf: jo }), ds);
  assert.equal(r.restoredRun, 36930221298);
});

// ---- Version 2: what the Delivery page draws ----

// read inside each test, so a file without the series fails its tests one by one
const on = (key, f = file) => f.series.days.find(x => x.day === key);

test('the day series runs 60 Eastern days, one after another, ending the day before asOf', () => {
  const days = file.series.days;
  assert.equal(days.length, 60);
  assert.equal(days.at(-1).day, '2026-10-05');
  assert.equal(days[0].day, '2026-08-07');
  assert.ok(days.every((x, i) => i === 0 || x.day === addDays(days[i - 1].day, 1)));
});

test('each day counts the deploys players got, the identical ones and the unknown ones apart', () => {
  assert.deepEqual(on('2026-09-30').deploys, { player: 3, same: 0, unknown: 0 });
  assert.deepEqual(on('2026-10-04').deploys, { player: 0, same: 0, unknown: 0 });
  // ec13700 to c5b78b0 served the same app; 37400367027 went live at 01:46 UTC on the 6th, still the 5th in New York
  assert.deepEqual(on('2026-10-05', sameDay).deploys, { player: 2, same: 1, unknown: 0 });
});

test('each day counts its failed releases, its changes and their median lead time', () => {
  assert.equal(on('2026-09-30').failed, 1);
  // e6b4837's deploy step failed, so it released nothing and is not a failed deploy
  assert.equal(on('2026-10-01').failed, 0);
  assert.equal(on('2026-09-30').changes, 2);
  // neither of the 30th's changes has a start in these fixtures
  assert.deepEqual(on('2026-09-30').leadSec, { median: null });
  // #161 has no start; #172 took 604 s and #175 6691 s
  assert.equal(on('2026-10-05').changes, 3);
  assert.deepEqual(on('2026-10-05').leadSec, { median: 3648 });
});

test('each day counts its gates, reds by cause and gate seconds per runner, and names its era from them', () => {
  // attempts that went red and were re-run count as reds of their own; the infra red ran on GitHub's machines; the filing red, the test red at 01:44 UTC on the 4th and the passed gate on the laptop
  assert.deepEqual(on('2026-10-03').gates, { passed: 1, red: { test: 2, infra: 2, experiment: 0, filing: 1 }, secMedian: { laptop: 346 } });
  assert.equal(on('2026-10-03').era, 'mixed');
  assert.deepEqual(on('2026-10-02').gates.secMedian, { hosted: 400 });
  assert.equal(on('2026-10-02').era, 'hosted');
  assert.deepEqual(on('2026-10-05').gates, { passed: 2, red: { test: 1, infra: 0, experiment: 1, filing: 0 }, secMedian: { laptop: 263 } });
  assert.equal(on('2026-10-05').era, 'laptop');
  // a day with no gate has no era
  assert.equal(on('2026-09-30').era, null);
});

// No real run falls near a clock change yet, so these two deploys are made up: one 30 minutes after midnight on
// 1 November 2026 in New York (still daylight time) and one 30 minutes before the next midnight, after the clocks
// went back. Both are the 1st. The two test runs are made up in hq/lib/runs.mjs's shape: one test passed and failed
// on one commit, so it is one flake in two runs.
test('a day the clocks go back holds all 25 of its hours, and counts that day\'s test runs and flakes', () => {
  const base = compute({ runs: [], jobsOf, git });
  const deploy = (run, liveAt) => ({ run, attempt: 1, sha: String(run), liveAt, runner: 'laptop', row: 7, smoke: 'success', playerFacing: true, url: '' });
  const testRun = (when, status) => ({ when, source: 'laptop', info: { commit: 'abc1234', dirty: false, kind: 'gate' }, tasks: [{ id: 'gate', cases: [{ name: 'smoke-x', status }] }] });
  const d = { ...base, deploys: [deploy(1, '2026-11-01T04:30:00Z'), deploy(2, '2026-11-02T04:30:00Z')],
    testRuns: [testRun('2026-11-01T15:00:00Z', 'pass'), testRun('2026-11-01T16:00:00Z', 'fail')] };
  const ds = summarise(d, { asOf: Date.parse('2026-11-03T12:00:00Z'), sources: {} }).series.days;
  const nov1 = ds.find(x => x.day === '2026-11-01');
  assert.equal(nov1.deploys.player, 2);
  assert.equal(ds.find(x => x.day === '2026-11-02').deploys.player, 0);
  assert.equal(ds.find(x => x.day === '2026-10-31').deploys.player, 0);
  assert.equal(nov1.testRuns, 2);
  assert.equal(nov1.flakes, 1);
});

test('each change carries its pull request\'s title', () => {
  const c = all.changes.find(x => x.pr === 172);
  assert.equal(c.title, 'refactor: the save step moves to a tested module');
});

// With pulls.json not fetched, every change is a direct push, and the commit's subject is the only title there is
test('a change with no pull request takes its commit\'s subject as its title', () => {
  const cs = changesOf({ runs, jobsOf, pulls: [], deploys, lock, commits, ...git });
  assert.equal(cs.find(x => x.sha.startsWith('c5b78b0')).title, 'test: an item heard twice is held once');
  assert.equal(cs.find(x => x.sha.startsWith('ff3a047')).title, null); // its commit is not in the fixture
});

test('failed deploys are out of the deploys players got, the same count as deploy frequency', () => {
  const month = sameDay.windows[2];
  assert.equal(month.portable.deploys.n, 8);
  assert.equal(month.portable.failedDeploys.of, 8);
});

// The 7 days to 6 October hold three changes with a start: #132 (728 s), #172 (604 s) and #175 (6691 s)
const week = file.windows[1];

test('the typical change is the one at the median, and its own parts add up to its total', () => {
  const t = week.questkeep.typical;
  assert.equal(t.pr, 132);
  assert.equal(t.totalSec, 728);
  assert.equal(t.title, 'CI runs on the laptop runner behind one switch');
  const s = t.split;
  assert.equal(s.runnerWaitSec + s.slotWaitSec + s.gateSec + s.greenToMergeSec + s.mergeToLiveSec + s.otherSec, 728);
});

test('hours sums each part over the period\'s changes', () => {
  assert.deepEqual(week.questkeep.hours, { n: 3, totalSec: 728 + 604 + 6691, runnerWaitSec: 2 + 19 + 2, slotWaitSec: 0, gateSec: 346 + 252 + 274,
    greenToMergeSec: 262 + 282 + 116, mergeToLiveSec: 117 + 51 + 365, otherSec: 1 + 0 + 5934 });
});

test('the slowest changes come longest first, each with its title, total, parts and link', () => {
  const s = week.questkeep.slowest;
  assert.deepEqual(s.map(x => [x.pr, x.totalSec]), [[175, 6691], [132, 728], [172, 604]]);
  assert.equal(s[0].title, 'feat: lists can be pinned to the top');
  assert.equal(s[0].split.otherSec, 5934);
  assert.equal(s[0].url, 'https://github.com/example-org/questkeep/pull/175');
  assert.deepEqual(Object.keys(s[0]).sort(), ['pr', 'split', 'title', 'totalSec', 'url']);
});

// e6b4837's message names Deploy run 36692304266 and says what the smoke test saw. The code links the two and never
// judges the failure from the words: the person reads the subject.
test('a failure carries the first commit on main whose message names its run, or null', () => {
  const f = all.failures.find(run(36692304266));
  assert.deepEqual(f.explainedBy, { sha: 'e6b4837829db97bbb97405f712dcf524224e93e6', subject: 'fix: deploys go green and the backlog is tidied (#65)' });
  assert.equal(all.failures.find(run(36824992530)).explainedBy, null);
  assert.deepEqual(file.items.failures.find(run(36692304266)).explainedBy.sha.slice(0, 7), 'e6b4837');
});

// Real runs and the lock's own lines (fixtures/dora/slot.json; its README row says why each is there). Every laptop
// change in the 7 days to 6 October shows no slot wait, which is true: the runner waited on 14 of 85 laptop gate jobs,
// and each of those was a red gate a later push replaced, a pull request that changed nothing players get, or one not
// merged yet. These pin the waits that are there.
const slot = fixture('slot');
const slotJobsOf = (id, a) => slot.jobs[`${id}-${a}`] || null;
const laptopJob = id => slot.jobs[`${id}-1`].find(j => j.name === 'laptop');

test('a gate that waited for the slot before the lock logged its run is matched by time, past a pid a session used before', () => {
  // #157's first gate, red, waited 13 minutes behind a soak's test container
  assert.equal(slotOf(slot.lock, laptopJob(37239479411), 37239479411, 1).waitSec, 793);
  // its next gate, the one #157's lead time counts, took the slot at once
  assert.equal(slotOf(slot.lock, laptopJob(37255436574), 37255436574, 1).waitSec, 0);
});

test('a gate whose lock lines name its run takes its wait from them', () => {
  assert.equal(slotOf(slot.lock, laptopJob(37434109311), 37434109311, 1).waitSec, 330);
});

test('each gate and red carries its slot wait, and the period counts the gates that waited', () => {
  const d = compute({ runs: slot.runs, jobsOf: slotJobsOf, lock: slot.lock, git });
  assert.deepEqual(d.gates.map(g => [g.run, g.slotWaitSec, g.sec]), [[37255436574, 0, 337], [37434109311, 330, 518 - 330]]);
  assert.equal(d.prReds.find(run(37239479411)).slotWaitSec, 793);
  const cost = summarise(d, { asOf: Date.parse('2026-10-07T12:00:00Z'), sources: {} }).windows[1].questkeep.cost;
  assert.equal(cost.slotWait.gates, 3);
  assert.equal(cost.slotWait.waited, 2);
  assert.equal(cost.slotWait.sec.median, 562);
});

// The numerator must count the same deploys as the denominator. b61152e did change what players get; here git is
// told it did not, so its smoke red follows an identical redeploy. The release changed nothing a player gets, so it
// is counted apart, never dropped.
test('a failure after an identical redeploy is counted apart from failed deploys, not in them', () => {
  const asIfSame = summarise(compute({ runs, jobsOf, logs, pulls, lock, commits, git: { changed: changedExcept(['7dfb910', 'b61152e']), contains } }),
    { asOf: Date.parse('2026-10-06T12:00:00Z'), sources: {} });
  const month = asIfSame.windows[2].portable.failedDeploys;
  assert.equal(month.n, 0);
  assert.deepEqual(month.items, []);
  assert.equal(month.apart, 1);
  assert.equal(on('2026-09-30', asIfSame).failed, 0);
  // and the real one is counted
  assert.equal(sameDay.windows[2].portable.failedDeploys.apart, 0);
});

// ---- Version 3: the product page ----

// The open pull requests in fixtures/dora/waiting.json (its README row says which are as they stood, and why)
const wfx = fixture('waiting');
const waitingAt = (asOf, runsIn = wfx.runs) => summarise(compute({ runs: runsIn, jobsOf, pulls: wfx.merged, openPulls: wfx.open, git }), { asOf: Date.parse(asOf), sources: {} }).waiting;

test('waiting lists the open pull requests oldest first, each with its age from its last push', () => {
  const w = waitingAt('2026-10-06T18:00:00Z');
  assert.deepEqual(w.map(x => x.pr), [1, 157, 179, 199]);
  const p199 = w.find(x => x.pr === 199);
  assert.equal(p199.title, 'fix: a device whose own list is stuck far ahead comes back to today');
  assert.equal(p199.url, 'https://github.com/example-org/questkeep/pull/199');
  assert.equal(p199.openedAt, '2026-10-06T17:05:32Z');
  assert.equal(p199.lastPushAt, '2026-10-06T17:05:37Z'); // the first run GitHub made for its head
  assert.equal(p199.ageSec, 3263); // 17:05:37 to 18:00:00
  // #1 has no run, so its age runs from when it was opened
  const p1 = w.find(x => x.pr === 1);
  assert.equal(p1.lastPushAt, null);
  assert.equal(p1.ageSec, (Date.parse('2026-10-06T18:00:00Z') - Date.parse('2026-09-25T20:27:14Z')) / 1000);
});

test('each waiting pull request\'s checks come from its head\'s latest gate run', () => {
  const checks = Object.fromEntries(waitingAt('2026-10-06T18:00:00Z').map(x => [x.pr, x.checks]));
  assert.deepEqual(checks, { 1: 'none', 157: 'fail', 179: 'pass', 199: 'pass' });
  // #199's gate as it was while it ran
  const running = wfx.runs.map(r => r.id === 37500849479 ? { ...r, status: 'in_progress', conclusion: null } : r);
  assert.equal(waitingAt('2026-10-06T18:00:00Z', running).find(x => x.pr === 199).checks, 'pending');
});

test('a waiting pull request whose title matches a merged one is marked stale, with the merged one named', () => {
  const stale = Object.fromEntries(waitingAt('2026-10-06T18:00:00Z').map(x => [x.pr, x.stale]));
  assert.deepEqual(stale[179], { pr: 197, title: 'feat: lists can be sorted by due date' });
  assert.deepEqual(stale[1], { pr: 2, title: 'Task list: easy, medium and hard tasks, grouped in the hint' });
  assert.equal(stale[199], null);
  assert.equal(stale[157], null);
});

// A daily copy written late is worked out as if made that morning, when a pull request opened since did not exist yet
test('waiting leaves out a pull request opened after the moment the figures are for', () => {
  assert.deepEqual(waitingAt('2026-10-06T12:00:00Z').map(x => x.pr), [1, 157, 179]);
});

// The 7 days to 6 October hold three fix: commits in fixtures/dora/commits.json: b61152e and e6b4837 changed web/,
// 7ad0722 changed only hq/. Nine deploys changed what players get.
test('rework counts the fix: commits that changed what players get, out of the deploys that changed it, as a proxy', () => {
  const r = week.portable.rework;
  assert.equal(r.fixes, 3);
  assert.equal(r.playerFixes, 2);
  assert.equal(r.of, 9);
  assert.equal(r.proxy, true);
  assert.equal(r.tagged, 0);
  assert.equal(r.n, 0);
});

// A project whose manifest names no delivery.userPaths: nothing says which paths reach users, so every fix with known
// paths counts, as a deploy counts when changed() diffs no particular paths.
test('with no user paths declared, every fix: commit with known paths counts as reaching users', () => {
  configureDelivery({ userPaths: [] });
  try {
    const w = summarise(compute({ runs, jobsOf, logs, pulls, lock, commits, git }), { asOf: Date.parse('2026-10-06T12:00:00Z'), sources: {} }).windows[1];
    assert.equal(w.portable.rework.fixes, 3);
    assert.equal(w.portable.rework.playerFixes, 3, '7ad0722 changed only hq/, which reaches users when no paths are named');
  } finally { configureDelivery(QK_DELIVERY); }
});

test('a fix: commit whose changed paths are unknown is not counted as changing what players get', () => {
  const bare = commits.map(({ paths, ...c }) => c);
  const w = summarise(compute({ runs, jobsOf, logs, pulls, lock, commits: bare, git }), { asOf: Date.parse('2026-10-06T12:00:00Z'), sources: {} }).windows[1];
  assert.equal(w.portable.rework.fixes, 3);
  assert.equal(w.portable.rework.playerFixes, 0);
});

// The fixtures' first run is on 30 September, so that is where their record starts
test('each window says where its record starts: the later of its start and the first run, or null with none', () => {
  const [day, wk, month] = file.windows;
  assert.equal(day.recordFrom, day.from);
  assert.equal(day.prev.recordFrom, day.prev.from);
  assert.equal(wk.recordFrom, '2026-09-30T04:00:00.000Z');
  assert.equal(wk.prev.recordFrom, null);
  assert.equal(month.recordFrom, '2026-09-30T04:00:00.000Z');
});

test('deploys a day are a rate over the days the record covers', () => {
  // 9 deploys over the 6 recorded days of the 7
  assert.equal(week.portable.deploys.perDay, 1.5);
  assert.equal(file.windows[2].portable.deploys.perDay, 1.5);
});

test('a tile compares nothing when the period before has no record, and says so', () => {
  for (const k of ['deploys', 'leadTime', 'failedDeploys', 'rework']) {
    assert.deepEqual(week.portable[k].compare, { ok: false, now: week.portable[k].compare.now, before: null, reason: 'No earlier data' }, k);
  }
});

test('a tile compares nothing when either period has fewer than 5 values', () => {
  // yesterday had 3 deploys and the day before none
  const c = file.windows[0].portable.deploys.compare;
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'Too few to compare');
  assert.equal(c.now, 3);
  assert.equal(c.before, 0);
});

// Made-up deploys, since the fixtures hold no two periods with 5 of anything: the record starts on 1 October, two
// days into the 7 days before; those 5 days hold 5 deploys, and the 7 days after hold 14.
test('deploys compare as a rate a day over the days each period\'s record covers', () => {
  const base = compute({ runs: [], jobsOf, git });
  const deploy = (i, liveAt) => ({ run: i, attempt: 1, sha: String(i), liveAt, runner: 'laptop', row: 7, smoke: 'success', playerFacing: true, url: '' });
  const at = (day, i) => deploy(Number(day.replace(/-/g, '')) * 10 + i, `${day}T16:00:0${i}Z`);
  const before = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map(k => at(k, 0));
  const now = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'].flatMap(k => [at(k, 0), at(k, 1)]);
  const d = { ...base, deploys: [...before, ...now], recordFrom: dayStart('2026-10-01') };
  const w = summarise(d, { asOf: Date.parse('2026-10-13T12:00:00Z'), sources: {} }).windows[1];
  assert.deepEqual(w.portable.deploys.compare, { ok: true, now: 2, before: 1, reason: null });
});

test('lead time and its spread per day: the median, and the 90th percentile only on a day with 10 changes', () => {
  // the record starts on 30 Sept; only #132 (3 Oct) and #172 and #175 (5 Oct) have a start
  const band = week.leadBand;
  assert.deepEqual(band.map(b => b.day), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
  assert.deepEqual(band.find(b => b.day === '2026-10-03'), { day: '2026-10-03', days: 1, n: 1, median: 728, p90: null });
  assert.deepEqual(band.find(b => b.day === '2026-10-05'), { day: '2026-10-05', days: 1, n: 2, median: 3648, p90: null });
  assert.equal(band.find(b => b.day === '2026-09-30').median, null);
});

test('over 30 days a day with fewer than 3 changes turns the spread into weeks, counted back from the last day', () => {
  // the record covers 6 days, so one bucket, cut at the record's start
  assert.deepEqual(file.windows[2].leadBand, [{ day: '2026-09-30', days: 6, n: 3, median: 728, p90: null }]);
});

test('the stage shares split the period\'s hours in the order a change meets them', () => {
  const s = week.stageShare;
  assert.deepEqual(s.map(x => x.stage), ['reruns', 'queue', 'slot', 'gate', 'mergeWait', 'toLive']);
  assert.deepEqual(s.map(x => x.sec), [5935, 23, 0, 872, 660, 533]);
  assert.equal(s.find(x => x.stage === 'reruns').share, 0.74); // 5935 of 8023
  assert.equal(s.find(x => x.stage === 'mergeWait').share, 0.082);
});

// A pull request landed by rebase brings every one of its commits to main, so in a real week 117 fix: commits that
// changed web/ reached players in 68 deploys. A rate needs its count out of the same deploys: the deploys that
// shipped a fix. b61152e shipped in its own deploy; e6b4837's deploy released nothing, so the next deploy that
// contains it, e5f2e2e's, shipped it.
test('rework counts the deploys that shipped a fix, so it can never exceed the deploys it is out of', () => {
  const r = week.portable.rework;
  assert.equal(r.fixDeploys, 2);
  assert.ok(r.fixDeploys <= r.of);
  assert.deepEqual(r.compare, { ok: false, now: Math.round((2 / 9) * 1000) / 1000, before: null, reason: 'No earlier data' });
});

// A rate whose count is of events needs 5 events in each period before it shows a trend: one failure against none
// says nothing about where things are heading. Made-up deploys as above: 5 in the 5 recorded days before and 14 in the
// 7 days after, with failures and fixes marked on some of them.
const ratePeriods = ({ failedNow = 0, fixesBefore = 0, fixesNow = 0 }) => {
  const base = compute({ runs: [], jobsOf, git });
  const deploy = (day, i) => ({ run: Number(day.replace(/-/g, '')) * 10 + i, attempt: 1, sha: `${day}-${i}`, liveAt: `${day}T16:00:0${i}Z`, runner: 'laptop', row: 7, smoke: 'success', playerFacing: true, url: '' });
  const before = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map(k => deploy(k, 0));
  const now = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'].flatMap(k => [deploy(k, 0), deploy(k, 1)]);
  before.slice(0, fixesBefore).forEach(x => { x.shipsFix = true; });
  now.slice(0, fixesNow).forEach(x => { x.shipsFix = true; });
  const failures = now.slice(0, failedNow).map(x => ({ run: x.run, attempt: 1, sha: x.sha, kind: 'smoke', released: true, playerFacing: true, liveAt: x.liveAt, at: x.liveAt, url: '', explainedBy: null }));
  const d = { ...base, deploys: [...before, ...now], failures, recordFrom: dayStart('2026-10-01') };
  return summarise(d, { asOf: Date.parse('2026-10-13T12:00:00Z'), sources: {} }).windows[1].portable;
};

test('failed deploys compare only when each period had 5 failures, however many deploys they are out of', () => {
  const p = ratePeriods({ failedNow: 1 });
  assert.equal(p.deploys.compare.ok, true);
  assert.deepEqual(p.failedDeploys.compare, { ok: false, now: Math.round((1 / 14) * 1000) / 1000, before: 0, reason: 'Too few to compare' });
});

test('rework compares only when each period had 5 deploys that shipped a fix', () => {
  assert.equal(ratePeriods({ fixesBefore: 4, fixesNow: 9 }).rework.compare.ok, false);
  assert.equal(ratePeriods({ fixesBefore: 4, fixesNow: 9 }).rework.compare.reason, 'Too few to compare');
  assert.deepEqual(ratePeriods({ fixesBefore: 5, fixesNow: 7 }).rework.compare, { ok: true, now: 0.5, before: 1, reason: null });
});

// ---- What each source held, as the page's Sources table shows it ----

// read from the module when called, so the rest of this file still runs if it is missing
const sourcesFor = (over = {}) => dora.sourcesOf({ d: all, runs, logs, deployments: [], pulls, openPulls: [], lock, testRuns: [], ref: 'origin/main', ...over });

test('every source carries the label the page shows as it is', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(sourcesFor()).map(([k, v]) => [k, v.label])), {
    runs: 'Actions runs', logs: 'Deploy decision logs', deployments: 'Production deployments', pulls: 'Pull requests', pullsOpen: 'Open pull requests',
    hostingReleases: 'Hosting releases', lockLog: 'Test slot log', testRuns: 'Recorded test runs', git: 'Git',
  });
});

test('production deployments say how many deploy jobs released', () => {
  assert.equal(sourcesFor().deployments.note, '9 deploy jobs released');
});

test('a reason is a short phrase with no full stop or trailing space, and a source not collected has one', () => {
  const missing = sourcesFor({ deployments: null, pulls: [], openPulls: null, lock: [], logs: new Map(), testRuns: [] });
  const reasons = [...Object.values(sourcesFor()), ...Object.values(missing)].map(s => s.reason).filter(r => r !== undefined);
  assert.ok(reasons.length >= 6);
  for (const r of reasons) assert.match(r, /^\S(.*\S)?$/, r);
  for (const r of reasons) assert.doesNotMatch(r, /\.$/, r);
  assert.ok(sourcesFor().hostingReleases.reason);
});

// The fixture's lock lines carry load1 only. Here the release line of 37168916705's re-run (attempt 2, pid 42246), the
// test red, also carries paging and pressure, as lines have since the lock began logging them.
test('the test slot log says in one line how many Laptop reds have the machine\'s paging and pressure', () => {
  assert.equal(sourcesFor().lockLog.coverageText, 'Paging and pressure on 0 of 6 Laptop reds');
  const withLoad = lock.map(e => e.pid === 42246 && e.event === 'release' ? { ...e, machine: { ...e.machine, pagingMBps: 12.5, pressure: 'warn' } } : e);
  const d = compute({ runs, jobsOf, logs, pulls, lock: withLoad, commits, git });
  const s = sourcesFor({ d, lock: withLoad }).lockLog;
  assert.equal(s.coverageText, 'Paging and pressure on 1 of 6 Laptop reds');
  assert.deepEqual(s.coverage, { pagingMBps: 1, pressure: 1, of: 6 });
});

// 9 Oct 2026: run 37887271953's smoke test went red at 05:11:31, and a re-run of that job on the same release passed at
// 05:12:56. The release was never broken, so it was green again 110 s after it went live (05:11:06). Waiting for the
// next deploy instead, as the code first did, made the headline read 1 h 16 min (Nell, review of #281).
test('a smoke test that passes on a re-run of the same release ends the recovery there, not at the next deploy', () => {
  const fx = fixture('recheck');
  const jo = (id, a) => fx.jobs[`${id}-${a}`] || null;
  const ds = deploysOf({ runs: fx.runs, jobsOf: jo, rows: new Map(), changed: () => true });
  const [r] = recoveriesOf(failuresOf({ runs: fx.runs, jobsOf: jo }), ds);
  assert.equal(r.failedRun, 37887271953);
  assert.equal(r.restoredRun, 37887271953);
  assert.equal(r.restoredAt, '2026-10-09T05:12:56Z');
  assert.equal(r.sec, 110);
});

// Two ways the stale match could go wrong that the real fixture can't show (Mags, review of #281). pulls holds every
// closed pull request, so one closed without merging must not mark an open one stale; and titles differ in case as
// people retype them. These pull requests are made up for the two cases; numbers 900 and up are not real.
test('a closed pull request that never merged marks nothing stale, and titles match whatever their case', () => {
  const pr = (number, title, extra = {}) => ({ number, title, html_url: `https://example.test/pull/${number}`, created_at: '2026-10-05T10:00:00Z', head: { sha: `${number}`.padEnd(40, '0'), ref: `b${number}` }, ...extra });
  const open = [pr(900, 'Fix the shop totals'), pr(901, 'feat: Moss naps')];
  const pulls = [
    pr(910, 'Fix the shop totals', { merged_at: null, closed_at: '2026-10-05T12:00:00Z' }),
    pr(911, 'FEAT: moss NAPS', { merged_at: '2026-10-05T12:00:00Z' }),
  ];
  const stale = Object.fromEntries(dora.waitingOf({ open, pulls, runs: [] }).map(x => [x.pr, x.stale]));
  assert.equal(stale[900], null, 'a closed, unmerged twin is not a reason to call it stale');
  assert.deepEqual(stale[901], { pr: 911, title: 'FEAT: moss NAPS' });
});

// From October 2026 a red container gate reruns its failing tests once (docs/decisions/2026-10-11-rerun-once-on-a-gate-red.md),
// which finds flakes that went unseen before and adds no run, so flakes per 100 runs rises without the tests getting
// worse. The figure says how many of its flakes the rerun found.
test('flakes per 100 runs says how many of its flakes the rerun found', () => {
  const at = '2026-10-11T05:00:00Z', info = commit => ({ commit, dirty: false, kind: 'docker-gate', where: 'container' });
  const one = (id, commit, tasks) => ({ id, source: 'laptop', when: at, info: info(commit), ok: false, tasks });
  const testRuns = [
    one('r1', 'a6cc739', [{ id: 'docker-gate', cases: [{ name: 'smoke-reject', status: 'fail', seconds: 12 }] }, { id: 'rerun', cases: [{ name: 'smoke-reject', status: 'pass', seconds: 11 }] }]),
    one('r2', 'b7dd840', [{ id: 'docker-gate', cases: [{ name: 'smoke-sync', status: 'fail', seconds: 20 }] }]),
    one('r3', 'b7dd840', [{ id: 'docker-gate', cases: [{ name: 'smoke-sync', status: 'pass', seconds: 20 }] }]),
  ];
  const week = summarise(compute({ runs: [], jobsOf, git, testRuns }), { asOf: Date.parse('2026-10-12T12:00:00Z'), sources: {} }).windows.find(w => w.days === 7);
  assert.equal(week.questkeep.cost.flakes, 2);
  assert.equal(week.questkeep.cost.testRuns, 3, 'the rerun adds no run');
  assert.equal(week.questkeep.cost.flakesByRerun, 1);
  assert.ok(COUNTING_CHANGES.some(c => c.decision === '2026-10-11-rerun-once-on-a-gate-red.md'), 'the change of count is dated on Delivery');
});

// "Green PRs waiting on you" took only the pull requests that changed what players get (66 of 112 for the week of
// 5 October), since make dora's changes leave out every push that changed no served file.
test('every merged pull request with a green gate has its wait from green to merge, whether or not it changed what players get', () => {
  const nothingServed = { ...git, changed: () => false };
  const d = compute({ runs, jobsOf, logs, pulls, lock, commits, git: nothingServed });
  assert.equal(d.changes.length, 0, 'no change reached players');
  const merges = mergesOf({ runs, jobsOf, pulls, lock });
  assert.deepEqual(d.merges, merges);
  assert.ok(merges.length > 0);
  assert.ok(merges.every(m => Number.isFinite(m.greenToMergeSec) && m.greenToMergeSec >= 0 && m.mergedAt && m.pr));
  const pr172 = merges.find(m => m.pr === 172);
  assert.equal(pr172.mergedAt, '2026-10-05T22:08:33Z');
});

// The delivery key says what is the project's: which workflow deploys, which runs the tests, which paths reach users
// and which time zone the days are counted in. Until 15 October the first three were QuestKeep's names, baked in.
test("the delivery key's workflows and time zone are read, and the figures' project block keeps its old name for one release", () => {
  try {
    const shipped = runs.map(r => (r.path === '.github/workflows/deploy.yml' ? { ...r, path: '.github/workflows/ship.yml' } : r));
    assert.equal(deploysOf({ runs: shipped, jobsOf, rows, changed: git.changed }).length, 0, 'a renamed deploy workflow is nobody\'s deploy until the manifest names it');
    configureDelivery({ ...QK_DELIVERY, tz: 'UTC', deployWorkflow: '.github/workflows/ship.yml' });
    assert.equal(deploysOf({ runs: shipped, jobsOf, rows, changed: git.changed }).length, deploys.length);
    assert.equal(dayKey(Date.parse('2026-10-06T02:00:00Z')), '2026-10-06', 'days are counted in the configured zone (New York would say the 5th)');
    const f = summarise(all, { asOf: Date.parse('2026-10-06T12:00:00Z'), sources: {} });
    assert.equal(f.tz, 'UTC');
    assert.ok(f.windows[0].project && f.windows[0].project.cost, 'the project block');
    assert.deepEqual(f.windows[0].questkeep, f.windows[0].project, 'and its old name, read by the pages of one release ago');
  } finally { configureDelivery(QK_DELIVERY); }
});

// Nell's third review, finding 8: the gate job, the deploy step and the reuse step were QuestKeep's GitHub names, so a
// stranger's deploys counted zero with no reason given. The delivery key names them; with none named, a deploy is any
// successful run of the deploy workflow, live when its last job ended, every job of a test run is the gate, and no
// gate is reused.
test('with no job or step names in the manifest, a deploy is a successful deploy run and every job is the gate; the names, when given, pick the step', () => {
  const T = m => `2026-10-10T00:${String(m).padStart(2, '0')}:00Z`;
  const runs2 = [
    { id: 1, path: '.github/workflows/deploy.yml', event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', run_attempt: 1, head_sha: 'aaa', html_url: 'u1', created_at: T(0) },
    { id: 2, path: '.github/workflows/deploy.yml', event: 'push', head_branch: 'main', status: 'completed', conclusion: 'failure', run_attempt: 1, head_sha: 'bbb', html_url: 'u2', created_at: T(10) },
    { id: 3, path: '.github/workflows/test.yml', event: 'pull_request', status: 'completed', conclusion: 'success', run_attempt: 1, head_sha: 'ccc', html_url: 'u3', created_at: T(20) },
  ];
  const jobs2 = {
    '1-1': [{ name: 'build', conclusion: 'success', started_at: T(1), completed_at: T(2), steps: [] },
      { name: 'ship', conclusion: 'success', started_at: T(2), completed_at: T(5), steps: [{ name: 'Push it to the host', conclusion: 'success', completed_at: T(4) }] }],
    '2-1': [{ name: 'ship', conclusion: 'failure', started_at: T(11), completed_at: T(12), steps: [{ name: 'Push it to the host', conclusion: 'failure', completed_at: T(12) }] }],
    '3-1': [{ name: 'checks', conclusion: 'success', created_at: T(20), started_at: T(21), completed_at: T(25), steps: [] },
      { name: 'lint', conclusion: 'success', created_at: T(20), started_at: T(21), completed_at: T(22), steps: [] }],
  };
  const jobsOf2 = (id, a) => jobs2[`${id}-${a}`] || null;
  try {
    configureDelivery({ userPaths: [], gateJobs: null, deployJob: null, smokeJob: null, deploySteps: null, reuseSteps: null, testSteps: null });
    const ds = deploysOf({ runs: runs2, jobsOf: jobsOf2, changed: () => true });
    assert.deepEqual(ds.map(d => [d.run, d.liveAt, d.runner]), [[1, T(5), 'hosted']], 'the successful run, live when its last job ended; the failed run is no deploy');
    assert.deepEqual(failuresOf({ runs: runs2, jobsOf: jobsOf2 }).map(f => [f.run, f.kind, f.released]), [[2, 'deploy-job', false]]);
    const gs = gatesOf({ runs: runs2, jobsOf: jobsOf2 });
    assert.deepEqual(gs.map(g => [g.run, g.sec, g.reused]), [[3, 240, false]], 'both jobs are the gate, from the first start to the last end, and nothing is reused');
    configureDelivery({ deploySteps: ['Push it'], gateJobs: ['checks'] });
    assert.deepEqual(deploysOf({ runs: runs2, jobsOf: jobsOf2, changed: () => true }).map(d => d.liveAt), [T(4)], 'a named step, matched by its first words, times the deploy');
    assert.deepEqual(gatesOf({ runs: runs2, jobsOf: jobsOf2 }).map(g => g.sec), [240], 'the named gate job alone');
  } finally { configureDelivery(QK_DELIVERY); }
});
