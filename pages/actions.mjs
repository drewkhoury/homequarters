// Actions minutes on the GitHub page's Dashboard, and a compact version for Home's panel: this month against the plan,
// where it is heading, the last 1, 7 and 30 days, a chart of the last 30 days by repo, and the month by repo.
import { esc } from '../lib/page.mjs';
import { info, dataTable } from '../lib/ui.mjs';
import { lastDays, daySeries, monthGauge, forecast, byRepo, minutesOf, spans, burnRate, daysToReset, affordPerDay, projection, dayOf } from '../lib/actions.mjs';

// The chart's repo colours: the dataviz reference's categorical slots for a dark ground, checked with its validator
// against HQ's two grounds (#161826 and #232532). Given to repos in name order, so a repo keeps its colour whatever
// its rank; past seven, the rest share Other's grey.
const SLOTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
const OTHER = '#75798c';

const num = n => Math.round(n).toLocaleString('en-GB');
const dayName = key => new Date(key + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const short = key => new Date(key + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function colours(repos) {
  const named = [...repos].sort((a, b) => a.localeCompare(b));
  return new Map(named.map((r, i) => [r, i < SLOTS.length ? SLOTS[i] : OTHER]));
}

function gaugeHtml(g, plan) {
  const pct = Math.min(100, g.share * 100);
  return `<div class="hq-gauge ${g.level}" role="img" aria-label="${esc(`${num(g.used)} of ${num(g.allowance)} minutes used`)}"><span style="width:${pct.toFixed(1)}%"></span></div>
    <p class="hq-gauge-text"><b>${num(g.used)}</b> of ${num(g.allowance)} minutes used, <b>${num(g.left)}</b> left${g.over ? `, ${num(g.over)} over` : ''}, resets ${esc(dayName(g.resets))}.${info(`Plan: ${plan}, which includes ${num(g.allowance)} minutes a month for private repos. Windows minutes count twice and macOS minutes ten times. Usage reaches GitHub's billing up to a few hours late, so today's number is low until later.`, 'About these minutes')}</p>`;
}

function forecastText(f) {
  if (f.already) return 'The allowance for this month is used up.';
  if (!f.avg) return 'Nothing used in the last 7 days, so nothing will run out at this pace.';
  const pace = `At ${num(f.avg)} minutes a day (the last 7 days)`;
  return f.runsOut ? `${pace}, you will run out on ${dayName(f.runsOut)}.` : `${pace}, you will finish the month with about ${num(f.endLeft)} left.`;
}

// The chart: the last 30 days and on to the next reset, in two thin bands that share the days along the bottom
// (two bands rather than two scales on one: running totals and daily minutes differ by a hundred times).
//   top:    this month's running total, solid so far and dashed ahead at the 7-day rate, against the allowance; a dot
//           where they cross, if they do
//   bottom: each past day's minutes stacked by repo, with the day's fair share of the allowance as a dashed step
// A new month inside the 30 days and the next reset are marked. Hovering a day shows its detail (hq.js).
export function chartSvg(series, colour, proj, allowance, now, spanSets) {
  const t = dayOf(now), past = series.length;
  const ahead = proj.points.filter(p => p.key > t.key).map(p => ({ key: p.key, projected: true }));
  const slots = [...series, ...ahead];
  const W = 900, L = 8, R = 118, T = 8, CH = 46, GAP = 10, DH = 34, AX = 14, H = T + CH + GAP + DH + AX + 4;
  const pw = W - L - R, step = pw / slots.length, x = i => L + i * step;
  const topMax = Math.max(allowance, ...proj.points.map(p => p.total)) * 1.08;
  const yc = v => T + CH - (v / topMax) * CH;
  const dayMax = Math.max(1, ...series.map(d => d.total), ...series.map(d => d.fair)) * 1.1;
  const d0 = T + CH + GAP, yd = v => d0 + DH - (v / dayMax) * DH;
  const idx = new Map(slots.map((d, i) => [d.key, i]));
  let out = '';
  // bands' baselines
  out += `<line class="base" x1="${L}" x2="${L + pw}" y1="${yd(0)}" y2="${yd(0)}"/>`;
  // this month: the allowance, the running total so far, and the projection
  const monthFirst = idx.get(proj.points[0].key) ?? 0;
  out += `<line class="allow" x1="${x(monthFirst)}" x2="${L + pw}" y1="${yc(allowance)}" y2="${yc(allowance)}"/><text class="lbl" x="${L + pw + 6}" y="${yc(allowance) + 3}">${num(allowance)} allowance</text>`;
  const pt = p => `${(x(idx.get(p.key)) + step / 2).toFixed(1)} ${yc(p.total).toFixed(1)}`;
  const solid = proj.points.filter(p => !p.projected), dashed = proj.points.filter((p, i, a) => p.projected || (a[i + 1] && a[i + 1].projected));
  if (!solid.length && dashed.length) dashed.unshift({ key: dashed[0].key, total: 0 }); // the 1st: start from nothing
  if (solid.length) out += `<path class="cum" d="M${solid.map(pt).join('L')}"/>`;
  if (dashed.length > 1) out += `<path class="cum ahead" d="M${dashed.map(pt).join('L')}"/>`;
  else if (dashed.length === 1) out += `<circle class="cumdot" cx="${pt(dashed[0]).split(' ')[0]}" cy="${pt(dashed[0]).split(' ')[1]}" r="2.5"/>`;
  const end = proj.points[proj.points.length - 1];
  if (proj.crossing && idx.has(proj.crossing)) {
    const c = proj.points.find(p => p.key === proj.crossing);
    out += `<circle class="cross" cx="${(x(idx.get(c.key)) + step / 2).toFixed(1)}" cy="${yc(allowance).toFixed(1)}" r="4"/>`;
    out += `<text class="lbl warn" x="${L + pw + 6}" y="${yc(end.total) + 3}">runs out ${esc(short(proj.crossing))}</text>`;
  } else out += `<text class="lbl" x="${L + pw + 6}" y="${Math.min(yc(end.total), yc(allowance) + 14) + 3}">no crossing</text>`;
  // the days: past bars, future slots, each with its hover text
  slots.forEach((d, i) => {
    const bw = Math.max(1.5, step - 2);
    if (d.monthStart) out += `<line class="month" x1="${x(i) - 1}" x2="${x(i) - 1}" y1="${T}" y2="${yd(0)}"/>`;
    let segs = '', tip;
    if (!d.projected) {
      let base = 0;
      for (const [repo, m] of Object.entries(d.byRepo).sort(([a], [b]) => a.localeCompare(b))) {
        if (!m) continue;
        segs += `<rect x="${(x(i) + 1).toFixed(1)}" y="${yd(base + m).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, yd(base) - yd(base + m)).toFixed(1)}" rx="1.5" fill="${colour.get(repo) || OTHER}"/>`;
        base += m;
      }
      const run = proj.points.find(p => p.key === d.key);
      tip = `${dayName(d.key)}${d.key === t.key ? ' (today, still counting)' : ''}: ${num(d.total)} min` + Object.entries(d.byRepo).filter(([, m]) => m).map(([r, m]) => `\n${r}: ${num(m)}`).join('') +
        (run ? `\n${run.projected ? 'about ' : ''}${num(run.total)} this month by the end of the day` : '');
    } else {
      const run = proj.points.find(p => p.key === d.key);
      tip = `${dayName(d.key)}, ahead: about ${num(run.total - (proj.points[proj.points.indexOf(run) - 1] || { total: 0 }).total)} min at the 7-day rate\n${num(run.total)} this month by then`;
    }
    const inSpans = d.projected ? '' : spanSets.filter(s => s.keys.includes(d.key)).map(s => s.id).join(' ');
    out += `<g class="day${d.projected ? ' ahead' : ''}" data-spans="${inSpans}" data-tip="${esc(tip)}" tabindex="0" aria-label="${esc(tip.replace(/\n/g, ', '))}"><rect class="hit" x="${x(i).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${(yd(0) - T).toFixed(1)}"/>${segs}</g>`;
    if (i === 0 || d.monthStart || (d.key === t.key)) out += `<text class="axis" x="${(x(i) + step / 2).toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : 'middle'}">${d.key === t.key ? 'today' : esc(short(d.key))}</text>`;
  });
  // fair share, stepping where a month of 30 days meets one of 31
  const fair = slots.map((d, i) => { const f = d.fair ?? series[series.length - 1].fair; return [[x(i), yd(f)], [x(i + 1), yd(f)]]; }).flat();
  out += `<path class="fair" d="M${fair.map(p => p.map(n => n.toFixed(1)).join(' ')).join('L')}"/><text class="lbl" x="${L + pw + 6}" y="${yd(series[past - 1].fair) + 3}">fair share a day</text>`;
  // the next reset, at the end of the month
  out += `<line class="reset" x1="${L + pw}" x2="${L + pw}" y1="${T - 2}" y2="${yd(0) + 2}"/><text class="axis reset" x="${L + pw}" y="${H - 4}" text-anchor="middle">resets ${esc(short(monthGaugeReset(now)))}</text>`;
  return `<svg class="hq-actions-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="This month's running total against the allowance, and the minutes of each of the last 30 days by repo">${out}</svg>`;
}
const monthGaugeReset = now => monthGauge(0, 1, now).resets;

// { html, mini, level } for the GitHub page and Home's panel.
export function actionsHtml(data) {
  if (data.allowance == null) {
    const msg = `<p class="hq-problem">This org is on the ${esc(data.plan)} plan, which HQ has no allowance for. hq/lib/actions.mjs holds the table.</p>`;
    return { html: msg, mini: msg, level: 'unknown' };
  }
  const days = lastDays(data.now, 30), series = daySeries(days, data.byDay, data.allowance);
  const used = minutesOf(data.month).reduce((s, x) => s + x.minutes, 0);
  const g = monthGauge(used, data.allowance, data.now), f = forecast(series, used, data.allowance, data.now);
  const monthRepos = byRepo(data.month), all = new Set([...monthRepos.map(r => r.repo), ...series.flatMap(d => Object.keys(d.byRepo))]);
  const colour = colours(all);
  const spanSets = spans(series, data.now);
  // the month table comes from the month's own total, which counts a little more than the days' sum when usage is late
  spanSets.find(x => x.id === 'month').byRepo = monthRepos;
  spanSets.find(x => x.id === 'month').total = used;
  const burn = burnRate(series), left = daysToReset(data.now, g.resets), afford = affordPerDay(g.left, left);
  const proj = projection(series, used, f.avg, data.allowance, data.now);
  const arrow = { faster: '<span class="hq-arrow up" aria-hidden="true">↑</span>', slower: '<span class="hq-arrow down" aria-hidden="true">↓</span>', same: '<span class="hq-arrow same" aria-hidden="true">→</span>' }[burn.trend];
  const burnPanel = `<div class="hq-burn">
    <div class="hq-burn-tile ${burn.trend}">${arrow}<div><b>${num(burn.day)}</b> min yesterday, <b>${num(burn.avg)}</b> a day over 7 days<span>${esc(burn.words)}.</span></div>${info('Yesterday is the last whole day. Today is left out while it is still going, and because usage reaches GitHub hours late. Within 15% either way counts as about the same.', 'About the burn rate')}</div>
    <div class="hq-burn-tile"><div><b>Resets in ${left} day${left === 1 ? '' : 's'}</b><span>${esc(dayName(g.resets))}</span></div></div>
    <div class="hq-burn-tile"><div><b>About ${num(afford)} a day</b><span>you can use until then without running out</span></div>${info(`${num(g.left)} left over ${left} day${left === 1 ? '' : 's'}, today included.`, 'How this is worked out')}</div></div>`;
  const switcher = `<div class="hq-spans"><div class="seg" role="group" aria-label="Show minutes for">${spanSets.map(x =>
    `<button type="button" class="seg-opt" data-span="${x.id}" aria-pressed="${x.id === '7'}">${esc(x.label)}</button>`).join('')}</div>
    ${spanSets.map(x => `<span class="hq-span-value" data-span-value="${x.id}"${x.id === '7' ? '' : ' hidden'}><b>${num(x.total)}</b> minutes</span>`).join('')}</div>`;
  const legend = `<ul class="hq-legend">${all.size > 1 ? [...colour].map(([r, c]) => `<li><span style="background:${c}"></span>${esc(r)}</li>`).join('') : ''}<li><span class="cumkey"></span>this month so far</li><li><span class="cumkey ahead"></span>ahead at the 7-day rate</li><li><span class="fairkey"></span>fair share a day</li></ul>`;
  const tables = spanSets.map(x => `<div class="hq-span-table" data-span-value="${x.id}"${x.id === '7' ? '' : ' hidden'}>${dataTable({ id: `actions-repos-${x.id}`,
    columns: [{ key: 'repo', label: 'Repo', filter: 'text' }, { key: 'min', label: 'Minutes', num: true, w: 'sm' }, { key: 'share', label: 'Share', num: true, w: 'sm' }],
    rows: x.byRepo.map(r => ({ cells: { repo: `<span class="hq-swatch" style="background:${colour.get(r.repo) || OTHER}"></span>${esc(r.repo)}`, min: { html: num(r.minutes), v: r.minutes }, share: { html: `${Math.round(r.share * 100)}%`, v: r.share } } })),
    empty: `No Actions minutes ${x.id === '1' ? 'today' : x.id === 'month' ? 'this month' : `in the last ${x.id} days`}.` })}</div>`).join('');
  const html = `<section class="card hq-actions" data-span="7">
    <div class="hq-actions-head"><h3>Actions minutes</h3><span class="hint" data-updated-for="actions"></span></div>
    ${gaugeHtml(g, data.plan)}<p class="hq-forecast">${esc(forecastText(f))}</p>
    ${burnPanel}
    ${switcher}${legend}<div class="hq-chartbox">${chartSvg(series, colour, proj, data.allowance, data.now, spanSets)}</div>
    <h4>By repo</h4>${tables}</section>`;
  const mini = `${gaugeHtml(g, data.plan)}<p class="hq-forecast hint">${esc(forecastText(f))}</p>`;
  return { html, mini, level: g.level };
}
