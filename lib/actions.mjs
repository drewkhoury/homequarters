// GitHub Actions minutes: what the plan includes, what has been used, and where it is heading. Pure: the GitHub page
// fetches the billing usage through gh and hands the items here. Days are UTC days, as GitHub's billing counts them.

// Minutes a month each plan includes for private repos, from GitHub's "About billing for GitHub Actions"
// (docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions,
// "Included storage and minutes"). The allowance resets on the 1st of each calendar month.
export const ALLOWANCE = { free: 2000, team: 3000, enterprise: 50000 };

// A minute on Windows counts as 2 against the allowance and a minute on macOS as 10 (same page, "Minute multipliers").
export function multiplier(sku) {
  if (/mac/i.test(sku || '')) return 10;
  if (/windows/i.test(sku || '')) return 2;
  return 1;
}

// Only the Actions minutes, each counted at its multiplier: [{ repo, sku, raw, minutes }].
export function minutesOf(items) {
  return (items || []).filter(i => i.product === 'actions' && i.unitType === 'Minutes')
    .map(i => ({ repo: i.repositoryName || '(no repo)', sku: i.sku, raw: +i.quantity || 0, minutes: (+i.quantity || 0) * multiplier(i.sku) }));
}
const sum = list => list.reduce((s, x) => s + x.minutes, 0);

// UTC dates. A day is { y, m, d, key: 'YYYY-MM-DD' } with m from 1.
export const dayOf = date => { const t = new Date(date); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), key: t.toISOString().slice(0, 10) }; };
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const plusDays = (key, n) => new Date(Date.parse(key + 'T00:00:00Z') + n * 86400000);

// The last n days up to and including today, oldest first.
export const lastDays = (today, n = 30) => Array.from({ length: n }, (_, i) => dayOf(plusDays(dayOf(today).key, i - n + 1)));

// One entry per day: { ...day, total, byRepo: { repo: minutes }, monthStart, fair }. A day with no usage is 0, not a
// gap. fair is that day's even share of its own month's allowance, so it steps where a month of 30 meets one of 31.
export function daySeries(days, itemsByDay, allowance) {
  return days.map((day, i) => {
    const rows = minutesOf(itemsByDay[day.key]);
    const byRepo = {};
    for (const r of rows) byRepo[r.repo] = (byRepo[r.repo] || 0) + r.minutes;
    return { ...day, total: sum(rows), byRepo, monthStart: day.d === 1 && i > 0, fair: allowance / daysInMonth(day.y, day.m) };
  });
}

// The minutes of the last n days of the series (1 is today alone).
export const totalOf = (series, n) => series.slice(-n).reduce((s, x) => s + x.total, 0);

// This month against the plan: used, left, the share used, a level (ok, amber over 75%, red over 90%), and the reset.
export function monthGauge(used, allowance, today) {
  const t = dayOf(today), resets = new Date(Date.UTC(t.m === 12 ? t.y + 1 : t.y, t.m === 12 ? 0 : t.m, 1));
  const share = allowance ? used / allowance : 0;
  return { used, allowance, left: Math.max(0, allowance - used), over: Math.max(0, used - allowance), share,
    level: share > 0.9 ? 'red' : share > 0.75 ? 'amber' : 'ok', resets: resets.toISOString().slice(0, 10) };
}

// Where the month ends at the pace of the last 7 whole days (today is left out: it is not over, and usage arrives
// hours late). { avg, runsOut: 'YYYY-MM-DD' | null, endLeft, already } — runsOut is the day the allowance is used up
// if that comes before the month ends, else endLeft is roughly what will be left.
export function forecast(series, used, allowance, today) {
  const whole = series.slice(0, -1).slice(-7);
  const avg = whole.length ? whole.reduce((s, x) => s + x.total, 0) / whole.length : 0;
  const t = dayOf(today), remaining = daysInMonth(t.y, t.m) - t.d; // whole days after today in this month
  if (used >= allowance) return { avg, runsOut: null, endLeft: 0, already: true };
  if (avg <= 0) return { avg, runsOut: null, endLeft: allowance - used, already: false };
  // today still has the rest of its day to run, counted as one more day at the average
  const daysToEmpty = (allowance - used) / avg;
  if (daysToEmpty < remaining + 1) return { avg, runsOut: plusDays(t.key, Math.max(0, Math.ceil(daysToEmpty) - 1)).toISOString().slice(0, 10), endLeft: 0, already: false };
  return { avg, runsOut: null, endLeft: Math.round(allowance - used - avg * (remaining + 1)), already: false };
}

// The month's minutes by repo, largest first: [{ repo, minutes, share }].
export function byRepo(items) {
  const rows = minutesOf(items), total = sum(rows), m = new Map();
  for (const r of rows) m.set(r.repo, (m.get(r.repo) || 0) + r.minutes);
  return [...m].map(([repo, minutes]) => ({ repo, minutes, share: total ? minutes / total : 0 })).sort((a, b) => b.minutes - a.minutes || a.repo.localeCompare(b.repo));
}

// The org from the origin remote's owner/repo.
export const orgOf = slug => (slug ? slug.split('/')[0] : null);

// The spans the Actions section can be switched between. Each: the days it covers (keys), its total, and its
// minutes by repo, so the total, the chart's shading and the table all follow the switch together.
export function spans(series, today) {
  const t = dayOf(today);
  const defs = [['1', 'Today', series.slice(-1)], ['7', '7 days', series.slice(-7)], ['30', '30 days', series.slice(-30)],
    ['month', 'This month', series.filter(d => d.y === t.y && d.m === t.m)]];
  return defs.map(([id, label, days]) => {
    const m = new Map();
    for (const d of days) for (const [repo, min] of Object.entries(d.byRepo)) m.set(repo, (m.get(repo) || 0) + min);
    const total = days.reduce((s, d) => s + d.total, 0);
    const byRepo = [...m].filter(([, min]) => min > 0).map(([repo, minutes]) => ({ repo, minutes, share: total ? minutes / total : 0 }))
      .sort((a, b) => b.minutes - a.minutes || a.repo.localeCompare(b.repo));
    return { id, label, keys: days.map(d => d.key), total, byRepo };
  });
}

// The last whole day against the average of the last 7 whole days (today is left out, as in forecast). Within 15%
// either way reads as about the same.
export function burnRate(series) {
  const whole = series.slice(0, -1), day = whole.length ? whole[whole.length - 1].total : 0;
  const week = whole.slice(-7), avg = week.length ? week.reduce((s, d) => s + d.total, 0) / week.length : 0;
  const ratio = avg ? day / avg : day ? Infinity : 1;
  const trend = ratio > 1.15 ? 'faster' : ratio < 0.85 ? 'slower' : 'same';
  const words = { faster: 'Burning faster than your 7-day average', slower: 'Burning slower than your 7-day average', same: 'About the same as your 7-day average' }[trend];
  return { day, avg, ratio, trend, words };
}

// Whole days from today to the reset, today counted: on 26 September with the reset on 1 October that is 5
// (the 26th to the 30th).
export const daysToReset = (today, resets) => Math.round((Date.parse(resets + 'T00:00:00Z') - Date.parse(dayOf(today).key + 'T00:00:00Z')) / 86400000);

// What you can use each day until the reset without running out.
export const affordPerDay = (left, days) => (days > 0 ? left / days : 0);

// The month so far and the rest of it at `rate` a day, as running totals at the end of each day: [{ key, total,
// projected }] from the first of the month to its last, and the day the running total would reach the allowance
// (or null: no crossing). Days before today are what was used. Today is still going, so from today on each day adds
// the rate to what is used so far, the same reckoning as forecast, so the two name the same day.
export function projection(series, used, rate, allowance, today) {
  const t = dayOf(today), out = [];
  let run = 0;
  for (const d of series) if (d.y === t.y && d.m === t.m && d.key < t.key) { run += d.total; out.push({ key: d.key, total: run, projected: false }); }
  let cum = used, crossing = used >= allowance ? t.key : null;
  const last = daysInMonth(t.y, t.m);
  for (let day = t.d; day <= last; day++) {
    const key = `${t.y}-${String(t.m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cum += rate;
    out.push({ key, total: cum, projected: true });
    if (!crossing && cum >= allowance) crossing = key;
  }
  return { points: out, crossing };
}
