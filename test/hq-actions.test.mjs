// Proves: the Actions minutes maths on the GitHub page: multipliers, days with nothing, a month boundary inside the
// last 30 days, the gauge's levels, and a forecast that runs out mid-month or not, on items shaped as GitHub's
// billing API returns them.
// Why: the gauge is read before a run is started, so a wrong forecast spends minutes the plan does not have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWANCE, multiplier, minutesOf, lastDays, daySeries, totalOf, monthGauge, forecast, byRepo, orgOf } from '../lib/actions.mjs';

const item = (repositoryName, quantity, sku = 'Actions Linux', extra = {}) =>
  ({ date: '2026-09-26T08:21:32Z', product: 'actions', sku, unitType: 'Minutes', quantity, repositoryName, netAmount: 0, ...extra });
// 26 September 2026, mid-afternoon UTC
const TODAY = '2026-09-26T15:00:00Z';

test('the plans and their allowances, one place', () => {
  assert.deepEqual(ALLOWANCE, { free: 2000, team: 3000, enterprise: 50000 });
});

test('a Windows minute counts 2 and a macOS minute 10; storage and other products are not minutes', () => {
  assert.deepEqual(['Actions Linux', 'Actions Windows', 'Actions macOS', 'Actions macOS 12-core'].map(multiplier), [1, 2, 10, 10]);
  const rows = minutesOf([item('a', 10), item('a', 10, 'Actions Windows'), item('b', 3, 'Actions macOS'),
    item('a', 99, 'Actions storage', { unitType: 'GigabyteHours' }), item('a', 50, 'Copilot', { product: 'copilot' })]);
  assert.deepEqual(rows.map(r => [r.repo, r.raw, r.minutes]), [['a', 10, 10], ['a', 10, 20], ['b', 3, 30]]);
});

test('the last 30 days run oldest first to today, across the month boundary', () => {
  const days = lastDays(TODAY, 30);
  assert.equal(days.length, 30);
  assert.equal(days[0].key, '2026-08-28');
  assert.equal(days[29].key, '2026-09-26');
});

test('a day with no usage is a zero, and the first of a month is marked with its own fair share', () => {
  const days = lastDays('2026-10-03T10:00:00Z', 5); // 29 Sep .. 3 Oct
  const s = daySeries(days, { '2026-09-29': [item('q', 40)], '2026-10-02': [item('q', 5), item('t', 7, 'Actions Windows')] }, 2000);
  assert.deepEqual(s.map(d => [d.key, d.total]), [['2026-09-29', 40], ['2026-09-30', 0], ['2026-10-01', 0], ['2026-10-02', 19], ['2026-10-03', 0]]);
  assert.deepEqual(s.map(d => d.monthStart), [false, false, true, false, false]);
  assert.deepEqual(s[3].byRepo, { q: 5, t: 14 });
  assert.equal(s[0].fair, 2000 / 30, 'September has 30 days');
  assert.equal(s[2].fair, 2000 / 31, 'October has 31');
  assert.equal(totalOf(s, 1), 0);
  assert.equal(totalOf(s, 5), 59);
});

test('the first day of the window is not marked as a new month, since nothing is before it', () => {
  const s = daySeries(lastDays('2026-10-02T00:00:00Z', 2), {}, 2000);
  assert.deepEqual(s.map(d => [d.key, d.monthStart]), [['2026-10-01', false], ['2026-10-02', false]]);
});

test('the gauge turns amber over 75% and red over 90%, and says when it resets', () => {
  assert.deepEqual(monthGauge(345, 2000, TODAY), { used: 345, allowance: 2000, left: 1655, over: 0, share: 0.1725, level: 'ok', resets: '2026-10-01' });
  assert.equal(monthGauge(1501, 2000, TODAY).level, 'amber');
  assert.equal(monthGauge(1500, 2000, TODAY).level, 'ok', 'exactly 75% is still fine');
  assert.equal(monthGauge(1801, 2000, TODAY).level, 'red');
  assert.deepEqual([monthGauge(2100, 2000, TODAY).left, monthGauge(2100, 2000, TODAY).over], [0, 100]);
  assert.equal(monthGauge(0, 2000, '2026-12-31T23:00:00Z').resets, '2027-01-01');
});

// a series with the same minutes every day, today included
const steady = (perDay, today = TODAY) => daySeries(lastDays(today, 30), Object.fromEntries(lastDays(today, 30).map(d => [d.key, [item('q', perDay)]])), 2000);

test('at this pace it runs out mid-month: the day is named', () => {
  // 1 September, 100 a day: 2,000 lasts 20 days, today included, so it is gone on the 20th
  const s = steady(100, '2026-09-01T12:00:00Z');
  const f = forecast(s, 0, 2000, '2026-09-01T12:00:00Z');
  assert.deepEqual([f.avg, f.runsOut, f.already], [100, '2026-09-20', false]);
});

test('at this pace it lasts the month: roughly what will be left', () => {
  // 26 September with 1,000 used, 50 a day: today and 4 more days at 50 leaves 750
  const f = forecast(steady(50), 1000, 2000, TODAY);
  assert.deepEqual([f.avg, f.runsOut, f.endLeft], [50, null, 750]);
});

test('the pace is the last 7 whole days, not today, which is still going', () => {
  const s = steady(10);
  s[s.length - 1].total = 5000;
  assert.equal(forecast(s, 100, 2000, TODAY).avg, 10);
});

test('nothing used lately means nothing runs out; all used already says so', () => {
  assert.deepEqual(forecast(steady(0), 300, 2000, TODAY), { avg: 0, runsOut: null, endLeft: 1700, already: false });
  assert.equal(forecast(steady(10), 2000, 2000, TODAY).already, true);
});

test("the month's minutes by repo, largest first, with each one's share", () => {
  assert.deepEqual(byRepo([item('todos', 2), item('questkeep', 181), item('questkeep', 17), item('todos', 1, 'Actions macOS')]), [
    { repo: 'questkeep', minutes: 198, share: 198 / 210 },
    { repo: 'todos', minutes: 12, share: 12 / 210 },
  ]);
  assert.deepEqual(byRepo([]), []);
});

test('the org comes from the remote', () => {
  assert.equal(orgOf('example-org/questkeep'), 'example-org');
  assert.equal(orgOf(null), null);
});

test('the section: a day per slot to the reset, the new month and the reset marked, and when it runs out', async () => {
  const { actionsHtml } = await import('../pages/actions.mjs');
  // 3 October: 30 days reach back into September, and the month's first two days used 1,200 between them
  const now = Date.parse('2026-10-03T12:00:00Z');
  const byDay = { '2026-09-30': [item('questkeep', 60)], '2026-10-01': [item('questkeep', 500), item('todos', 50, 'Actions Windows')], '2026-10-02': [item('questkeep', 600)] };
  const month = [...byDay['2026-10-01'], ...byDay['2026-10-02']];
  const out = actionsHtml({ org: 'o', plan: 'free', allowance: 2000, month, byDay, now });
  assert.equal((out.html.match(/<g class="day"/g) || []).length, 30, 'the past 30 days');
  assert.equal((out.html.match(/<g class="day ahead"/g) || []).length, 28, '4 to 31 October, ahead');
  assert.equal((out.html.match(/class="month"/g) || []).length, 1, 'one new month inside the window');
  assert.match(out.html, /class="axis reset"[^>]*>resets 1 Nov</);
  assert.match(out.html, /data-tip="1 October: 600 min\nquestkeep: 500\ntodos: 100\n600 this month by the end of the day"/);
  assert.match(out.mini, /1,200<\/b> of 2,000 minutes used, <b>800<\/b> left, resets 1 November/);
  // the 7 whole days before today average 180, so the running total crosses 2,000 on 7 October
  assert.match(out.mini, /you will run out on 7 October/);
  assert.match(out.html, /runs out 7 Oct/);
  assert.match(out.html, /class="cross"/);
});

test('the switch drives the total, the table and the chart: each span has its own of each', async () => {
  const { actionsHtml } = await import('../pages/actions.mjs');
  const now = Date.parse('2026-10-03T12:00:00Z');
  const byDay = { '2026-09-30': [item('questkeep', 60)], '2026-10-03': [item('todos', 7)] };
  const out = actionsHtml({ org: 'o', plan: 'free', allowance: 2000, month: byDay['2026-10-03'], byDay, now }).html;
  for (const id of ['1', '7', '30', 'month']) {
    assert.match(out, new RegExp(`data-span="${id}"`), `a button for ${id}`);
    assert.match(out, new RegExp(`class="hq-span-value" data-span-value="${id}"`), `a total for ${id}`);
    assert.match(out, new RegExp(`class="hq-span-table" data-span-value="${id}"`), `a table for ${id}`);
  }
  assert.match(out, /<section class="card hq-actions" data-span="7">/, 'the chart dims days outside the span through this');
  // 30 September is in the 7 days and the 30, not in today or this month
  assert.match(out, /data-spans="7 30" data-tip="30 September/);
  assert.match(out, /data-spans="1 7 30 month" data-tip="3 October \(today/);
  // today's table has todos alone; the 30 days' has both
  const table = id => out.split(`class="hq-span-table" data-span-value="${id}"`)[1].split('</table>')[0];
  assert.doesNotMatch(table('1'), /questkeep/);
  assert.match(table('30'), /questkeep[\s\S]*todos/);
});

test('the burn rate, the countdown and the daily budget are on the dashboard', async () => {
  const { actionsHtml } = await import('../pages/actions.mjs');
  const out = actionsHtml({ org: 'o', plan: 'free', allowance: 2000, month: [item('q', 345)], byDay: {}, now: Date.parse(TODAY) }).html;
  assert.match(out, /Resets in 5 days/);
  assert.match(out, /About 331 a day/);
  assert.match(out, /About the same as your 7-day average/);
});

test('a plan HQ has no allowance for says so rather than guessing', async () => {
  const { actionsHtml } = await import('../pages/actions.mjs');
  assert.match(actionsHtml({ plan: 'pro', allowance: null, month: [], byDay: {}, now: Date.now() }).html, /no allowance for/);
});

test('the switch spans: today, 7 days, 30 days and this month, each with its total and repos', async () => {
  const { spans } = await import('../lib/actions.mjs');
  const days = lastDays('2026-10-02T10:00:00Z', 30); // 3 September .. 2 October
  const s = daySeries(days, { '2026-09-30': [item('a', 10)], '2026-10-01': [item('a', 5), item('b', 3, 'Actions macOS')], '2026-10-02': [item('b', 1)] }, 2000);
  const by = Object.fromEntries(spans(s, '2026-10-02T10:00:00Z').map(x => [x.id, x]));
  assert.deepEqual([by['1'].total, by['7'].total, by['30'].total, by.month.total], [1, 46, 46, 36]);
  assert.deepEqual(by.month.keys, ['2026-10-01', '2026-10-02']);
  assert.deepEqual(by.month.byRepo.map(r => [r.repo, r.minutes]), [['b', 31], ['a', 5]]);
  assert.deepEqual(by['1'].byRepo, [{ repo: 'b', minutes: 1, share: 1 }]);
});

test('burn rate: the last whole day against the 7-day average, with about the same inside 15%', async () => {
  const { burnRate } = await import('../lib/actions.mjs');
  const withYesterday = y => { const s = steady(20); s[s.length - 2].total = y; return s; };
  // the 7 whole days are six 20s and yesterday
  assert.equal(burnRate(withYesterday(40)).trend, 'faster');
  assert.equal(burnRate(withYesterday(5)).trend, 'slower');
  assert.equal(burnRate(withYesterday(22)).trend, 'same');
  assert.match(burnRate(withYesterday(40)).words, /faster than your 7-day average/);
  assert.equal(burnRate(steady(0)).trend, 'same', 'nothing against nothing');
  assert.equal(burnRate(withYesterday(20)).avg, 20);
});

test('the countdown and what you can afford a day until the reset', async () => {
  const { daysToReset, affordPerDay } = await import('../lib/actions.mjs');
  assert.equal(daysToReset(TODAY, '2026-10-01'), 5);
  assert.equal(daysToReset('2026-09-30T23:00:00Z', '2026-10-01'), 1);
  assert.equal(affordPerDay(1650, 5), 330);
  assert.equal(affordPerDay(100, 0), 0);
});

test('the projection runs the month to its end at the 7-day rate and names the day it crosses the allowance', async () => {
  const { projection } = await import('../lib/actions.mjs');
  // 26 September: 1,800 used so far, 100 a day: 1,900 by the end of today, 2,000 by the end of the 27th
  const p = projection(steady(100), 1800, 100, 2000, TODAY);
  assert.equal(p.crossing, '2026-09-27');
  assert.deepEqual(p.points.slice(-6).map(x => [x.key.slice(8), x.total, x.projected]), [['25', 2500, false], ['26', 1900, true], ['27', 2000, true], ['28', 2100, true], ['29', 2200, true], ['30', 2300, true]]);
  assert.equal(p.points[0].key, '2026-09-01', 'from the first of the month');
  assert.equal(p.points[0].total, 100, 'past days are what was used');
});

test('the projection and the forecast name the same day', async () => {
  const { projection } = await import('../lib/actions.mjs');
  for (const [used, rate] of [[1800, 100], [1200, 180], [0, 150], [1999, 1]]) {
    const s = steady(rate), f = forecast(s, used, 2000, TODAY);
    assert.equal(projection(s, used, f.avg, 2000, TODAY).crossing, f.runsOut, `${used} used at ${rate}`);
  }
});

test('no crossing when the month ends under the allowance, and a crossing today when it is already used up', async () => {
  const { projection } = await import('../lib/actions.mjs');
  assert.equal(projection(steady(10), 500, 10, 2000, TODAY).crossing, null);
  assert.equal(projection(steady(10), 2000, 10, 2000, TODAY).crossing, '2026-09-26');
  assert.equal(projection(steady(10), 1995, 10, 2000, TODAY).crossing, '2026-09-26', 'today\'s rest of the day tips it over');
});
