// HQ's small charts, drawn as SVG in the Backlog Trends' styles (bl-chart, bl-s-*), so no page needs a chart library.
// Launch draws day columns and bars across in their classic look; the Delivery page adds a sparkline, a dot plot, a bar
// of parts, bars of parts on one axis and a strip of deploys. Each chart is an image labelled with the takeaway its
// caller writes. Every mark keeps a native <title>, and carries its words in data-tip for the HTML tooltip that
// hq/static/hq-charts.js shows on hover, focus and tap. A day a person can follow to a list is an HTML link laid over
// the SVG, never a link inside it, since a screen reader hides what sits inside an image. Delivery's charts ship a wide
// render at 640 units and a narrow one at 360, and a container query in hq.css shows one. The narrow one's text is 15
// units, 11 px on a phone where it is drawn 268 px wide; it shows at most 3 dates, and its marks and line labels move
// to one line under the chart, so its columns keep their width. Lines are straight segments between measured values,
// and a day with no value is a gap.
import { esc } from './page.mjs';

const num = n => Math.round(n).toLocaleString('en-GB');
const shortDate = key => new Date(key + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const r1 = n => Math.round(n * 10) / 10;
// A length of time in seconds, in two units at most: 42 s, 12 min, 1 h 51 min, 2 d 4 h. Pages use it for every
// duration they print, so a chart and the text beside it round the same way.
export const duration = s => {
  if (!(s >= 0)) return '';
  if (s < 59.5) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rest = m % 60;
  if (h < 24) return `${h} h${rest ? ` ${rest} min` : ''}`;
  return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`;
};
const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const tipOf = text => ` data-tip="${esc(text)}"`;
const WIDE = 640, NARROW = 360;
// Text size in SVG units per render, as hq.css sets it, and the width a character takes at that size, so a label can be
// measured before it is placed.
const fontOf = W => (W === NARROW ? 15 : 11);
const textWidth = (s, W) => String(s).length * fontOf(W) * 0.58;

// The wide and the narrow render side by side; hq.css shows the narrow one when the page is 700 px or less.
const bothWidths = draw => `<div class="bl-chart-wide">${draw(WIDE)}</div><div class="bl-chart-narrow">${draw(NARROW)}</div>`;
// Links laid over an SVG: cols are [{ x, w, href, text }] in the SVG's units for a column each, W the SVG's width, or
// [{ y, h, href, text }] with H for a row each.
const withLinks = (svg, cols, W, H) => {
  const at = c => (H ? `left:0%;width:100%;top:${((c.y / H) * 100).toFixed(3)}%;height:${((c.h / H) * 100).toFixed(3)}%` : `left:${((c.x / W) * 100).toFixed(3)}%;width:${((c.w / W) * 100).toFixed(3)}%`);
  const links = cols.filter(c => c.href).map(c => `<a href="${esc(c.href)}" style="${at(c)}" aria-label="${esc(c.text)}" title="${esc(c.text)}"${tipOf(c.text)}></a>`).join('');
  return links ? `<div class="bl-hitwrap">${svg}<div class="bl-hits">${links}</div></div>` : svg;
};
// Date labels along the bottom, measured so none touches another or the edge: on a phone the first, middle and last
// day; else one every so often. The last day always shows, and a label before it that would touch it is dropped.
const dateTicks = (days, mid, y, W) => {
  const n = days.length, every = Math.max(1, Math.ceil(n / 8));
  const want = W === NARROW ? [...new Set([0, Math.round((n - 1) / 2), n - 1])].filter(i => i >= 0) : days.map((d, i) => i).filter(i => i === n - 1 || i % every === 0);
  const kept = [];
  for (const i of want) {
    const words = shortDate(days[i]), tw = textWidth(words, W), x = Math.min(Math.max(mid(i), tw / 2 + 2), W - tw / 2 - 2);
    const clashes = () => kept.length && x - tw / 2 < kept.at(-1).to + 6;
    if (i === n - 1) while (clashes()) kept.pop();
    else if (clashes()) continue;
    kept.push({ x, words, to: x + tw / 2 });
  }
  return kept.map(k => `<text x="${r1(k.x)}" y="${y}" text-anchor="middle">${esc(k.words)}</text>`).join('');
};
// The circled numbers a phone's chart pins its marks with, and the one line under a chart that names its pins and the
// lines it would otherwise label at the side. items are [{ swatch, text }], a swatch being a class for a small key.
const PINS = '①②③④⑤⑥⑦⑧⑨⑩';
const keyLineOf = items => (items.length ? `<p class="bl-key-line">${items.map(it => `<span>${it.swatch ? `<i class="${it.swatch}"></i>` : ''}${esc(it.text)}</span>`).join(' · ')}</p>` : '');
// The left margin a value axis needs for its widest label.
const axisRoom = (labels, W) => Math.max(...labels.map(l => textWidth(l, W)), textWidth('0', W)) + 10;
// Round steps for a count axis: 1, 2 or 5 times a power of ten, whole numbers, about four steps to the top.
function roundTicks(max) {
  const raw = Math.max(max, 1) / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw));
  const top = Math.max(step, Math.ceil(max / step) * step), out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v));
  return out;
}
// Round steps for an axis of seconds, about four to the top: minutes, hours or days.
const TIME_STEPS = [60, 120, 300, 600, 1200, 1800, 3600, 7200, 18000, 36000, 86400, 172800, 432000, 864000];
function timeTicks(max) {
  const step = TIME_STEPS.find(s => max / s <= 4) || TIME_STEPS.at(-1), top = Math.max(step, Math.ceil(max / step) * step), out = [];
  for (let v = 0; v <= top; v += step) out.push(v);
  return out;
}
// Labels set beside the plot's right edge, each at the height of what it names, pushed apart where they would touch.
function sideLabels(labels, x, gap, lo, hi) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 0; i < sorted.length; i++) sorted[i].y = Math.max(sorted[i].y, lo, i ? sorted[i - 1].y + gap : lo);
  for (let i = sorted.length - 1; i >= 0; i--) sorted[i].y = Math.min(sorted[i].y, i < sorted.length - 1 ? sorted[i + 1].y - gap : hi);
  return sorted.map(l => `<text x="${r1(x)}" y="${r1(l.y + 4)}" class="bl-direct">${esc(l.text)}</text>`).join('');
}
const legendOf = series => `<div class="bl-legend">${series.map(s => `<span><i class="bl-s-${s.cls}"></i>${esc(s.label)}</span>`).join('')}</div>`;

// ---- Day columns ----

// Bars per day, stacked from the series marked bar. series are [{ key, cls, label, bar }]; Launch's look adds line.
//   before:      the period before's rows, drawn as a dashed line on the same axes, its first day over this period's
//                first day; a shorter list fills the last days, and a day whose values are all null is a gap
//   beforeLabel: that line's label on the chart; a day's tooltip names its paired day ("5 Oct: 4 deploys · 28 Sept: 2")
//   beforeDays:  the names of before's days, aligned with it; else each is the same day a period earlier
//   marks:       [{ day, label }], a short label and a hairline at the left edge of that day
//   href(day):   a link for the day, the column's full height and width; null leaves the day without one
//   narrow:      true ships a narrow render beside the wide one
//   classic:     Launch's look, unchanged: ticks at 0, half and the top, a legend under the chart and no tooltips
// Up to two series are labelled on the chart; a third brings a legend above it.
export function dayChart(rows, series, { label, before, beforeLabel = 'Prior period', beforeDays, marks, href, narrow, classic } = {}) {
  if (classic) return `<figure class="bl-chart">${classicColumns(rows, series, label)}${legendOf(series)}</figure>`;
  const draw = W => dayColumns(rows, series, { label, before, beforeLabel, beforeDays, marks, href }, W);
  return `<figure class="bl-chart">${series.filter(s => s.bar).length > 2 ? legendOf(series) : ''}${narrow ? bothWidths(draw) : draw(WIDE)}</figure>`;
}

function dayColumns(rows, series, { label, before, beforeLabel, beforeDays, marks, href }, W) {
  const bars = series.filter(s => s.bar), n = rows.length, fs = fontOf(W), phone = W === NARROW;
  const total = d => bars.reduce((t, s) => t + (d[s.key] || 0), 0);
  const known = d => bars.some(s => d[s.key] != null);
  const prior = before ? [...Array(Math.max(0, n - before.length)).fill(null), ...(n ? before.slice(-n) : []).map(d => (known(d) ? total(d) : null))] : null;
  const ticks = roundTicks(Math.max(0, ...rows.map(total), ...(prior || []).filter(v => v != null))), top = ticks.at(-1);
  const placed = (marks || []).map(m => ({ ...m, i: rows.findIndex(d => d.day === m.day) })).filter(m => m.i >= 0);
  placed.forEach((m, k) => { m.pin = PINS[k] || String(k + 1); });
  // what the two series and the dashed line are called: at the right of a wide chart, under a phone's
  const named = [];
  if (bars.length === 2) for (const s of bars) if (rows.some(d => d[s.key])) named.push({ swatch: `bl-s-${s.cls}`, text: s.label, s });
  if (prior && prior.some(v => v != null)) named.push({ swatch: 'bl-k-dash', text: beforeLabel });
  const padL = axisRoom(ticks.map(num), W), padR = !phone && named.length ? Math.max(...named.map(x => textWidth(x.text, W))) + 14 : 10;
  const bw = (W - padL - padR) / Math.max(1, n);
  // the marks above the plot: a label each when wide, a numbered pin each on a phone, in rows that never overlap
  const line = fs + 3, ends = [];
  for (const m of placed) {
    const x = padL + m.i * bw, tw = textWidth(phone ? m.pin : m.label, W);
    m.x = x;
    m.left = phone ? Math.max(2, Math.min(x - tw / 2, W - 2 - tw)) : Math.max(2, Math.min(x + 4, W - 2 - tw));
    let r = ends.findIndex(end => m.left >= end + 6);
    if (r < 0) { r = ends.length; ends.push(0); }
    ends[r] = m.left + tw;
    m.row = r;
  }
  const pad = { l: padL, r: padR, t: 10 + ends.length * line + (ends.length ? 6 : 0), b: phone ? 34 : 26 };
  const BH = phone ? 180 : 204, h = pad.t + BH + pad.b, right = W - pad.r;
  const y = v => pad.t + BH - (v / top) * BH, mid = i => pad.l + i * bw + bw / 2;
  const grid = ticks.map(v => `<line x1="${pad.l}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="bl-grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`).join('');
  // a day's words, with the same day of the period before named by its date: "3 Oct: 6 deploys · 26 Sept: 8"
  const dayNames = beforeDays ? [...Array(Math.max(0, n - beforeDays.length)).fill(null), ...(n ? beforeDays.slice(-n) : [])] : [];
  const paired = (day, i) => { if (dayNames[i] != null) return dayNames[i]; const t = new Date(`${day}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - n); return shortDate(t.toISOString().slice(0, 10)); };
  const said = (d, i) => `${shortDate(d.day)}: ${bars.map(s => `${d[s.key] || 0} ${s.label}`).join(', ')}${prior ? ` · ${paired(d.day, i)}: ${prior[i] == null ? 'no data' : prior[i]}` : ''}`;
  const x0 = i => pad.l + i * bw + bw * 0.15, w = Math.max(1, bw * 0.7);
  const cols = rows.map((d, i) => {
    let acc = 0;
    return bars.map(s => { const v = d[s.key] || 0; const out = v ? `<rect x="${x0(i)}" y="${y(acc + v)}" width="${w}" height="${y(acc) - y(acc + v)}" class="bl-s-${s.cls}"><title>${esc(shortDate(d.day))}: ${v} ${esc(s.label)}</title></rect>` : ''; acc += v; return out; }).join('');
  }).join('');
  // the period before as a step along each column's top, broken where a day has no record
  let dashed = '';
  if (prior) {
    let run = [];
    const flush = () => { if (run.length) dashed += `<polyline points="${run.join(' ')}" class="bl-prior"><title>${esc(beforeLabel)}</title></polyline>`; run = []; };
    prior.forEach((v, i) => { if (v == null) flush(); else run.push(`${r1(x0(i))},${r1(y(v))}`, `${r1(x0(i) + w)},${r1(y(v))}`); });
    flush();
  }
  const notes = placed.map(m => {
    const ty = 10 + m.row * line + fs, said = `${shortDate(m.day)}: ${m.label}`;
    return `<line x1="${r1(m.x)}" x2="${r1(m.x)}" y1="${ty + 3}" y2="${y(0)}" class="bl-mark"${tipOf(said)}><title>${esc(said)}</title></line>` +
      `<text x="${r1(m.left)}" y="${ty}" class="bl-mark"${tipOf(said)}>${esc(phone ? m.pin : m.label)}</text>`;
  }).join('');
  // the labels at the right of a wide chart: each of two series at its last column, and the dashed line at its last day
  const side = [];
  if (!phone) for (const x of named) {
    if (x.s) {
      const i = rows.findLastIndex(d => d[x.s.key]), k = bars.indexOf(x.s);
      side.push({ text: x.text, y: y(bars.slice(0, k).reduce((t, b) => t + (rows[i][b.key] || 0), 0) + rows[i][x.s.key] / 2) });
    } else { const i = prior.findLastIndex(v => v != null); side.push({ text: x.text, y: y(prior[i]) }); }
  }
  // a column over each day that answers the tooltip, the SVG's full height as its link is, drawn last so it lies on top
  const hits = rows.map((d, i) => `<rect x="${r1(pad.l + i * bw)}" y="0" width="${r1(bw)}" height="${h}" class="bl-col"${tipOf(said(d, i))}><title>${esc(said(d, i))}</title></rect>`).join('');
  const svg = `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${grid}${cols}${dashed}${dateTicks(rows.map(d => d.day), mid, h - 8, W)}${sideLabels(side, right + 6, fs + 2, pad.t, y(0))}${hits}${notes}</svg>`;
  const key = phone ? keyLineOf([...named.map(({ swatch, text }) => ({ swatch, text })), ...placed.map(m => ({ text: `${m.pin} ${m.label}` }))]) : '';
  return (href ? withLinks(svg, rows.map((d, i) => ({ x: pad.l + i * bw, w: bw, href: href(d.day), text: said(d, i) })), W) : svg) + key;
}

// Launch's day columns as they were: stacked bars, with a line (a running total) in a band of its own above them on
// its own scale, as the Actions minutes chart does, since a total and the day's count differ too much to share one.
function classicColumns(rows, series, label) {
  const W = WIDE, bars = series.filter(s => s.bar), line = series.find(s => s.line);
  const pad = { l: 34, r: 10, t: 12, b: 26 }, LH = line ? 70 : 0, GAP = line ? 24 : 0, BH = line ? 120 : 204, h =pad.t + LH + GAP + BH + pad.b;
  const bw = (W - pad.l - pad.r) / Math.max(1, rows.length), mid = i => pad.l + i * bw + bw / 2;
  const band = (top, height, max) => v => top + height - (v / max) * height;
  const grid = (y, max) => [...new Set([0, Math.round(max / 2), max])].map(v => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="bl-grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`).join('');
  const barMax = Math.max(1, ...rows.map(d => bars.reduce((n, s) => n + (d[s.key] || 0), 0)));
  const y = band(pad.t + LH + GAP, BH, barMax);
  // a date every so often, and the last day always, with the one before it dropped when they would touch
  const every = Math.max(1, Math.ceil(rows.length / 8)), n = rows.length;
  const cols = rows.map((d, i) => {
    let acc = 0;
    const x0 = pad.l + i * bw + bw * 0.15, w = Math.max(1, bw * 0.7);
    const stack = bars.map(s => { const v = d[s.key] || 0; const out = v ? `<rect x="${x0}" y="${y(acc + v)}" width="${w}" height="${y(acc) - y(acc + v)}" class="bl-s-${s.cls}"><title>${esc(shortDate(d.day))}: ${v} ${esc(s.label)}</title></rect>` : ''; acc += v; return out; }).join('');
    const tick = i === n - 1 || (i % every === 0 && n - 1 - i >= every * 0.75) ? `<text x="${mid(i)}" y="${h - 8}" text-anchor="middle">${esc(shortDate(d.day))}</text>` : '';
    return stack + tick;
  }).join('');
  let top = '';
  if (line) {
    const lineMax = Math.max(1, ...rows.map(d => d[line.key] || 0)), yl = band(pad.t, LH, lineMax);
    top = grid(yl, lineMax) + `<polyline points="${rows.map((d, i) => `${mid(i)},${yl(d[line.key] || 0)}`).join(' ')}" class="bl-line bl-s-${line.cls}"/>` +
      (n <= 45 ? rows.map((d, i) => `<circle cx="${mid(i)}" cy="${yl(d[line.key] || 0)}" r="2.5" class="bl-s-${line.cls}"><title>${esc(shortDate(d.day))}: ${d[line.key]} ${esc(line.label)}</title></circle>`).join('') : '');
  }
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${top}${grid(y, barMax)}${cols}</svg>`;
}

// Bars across, one per value, as the Backlog's "Open, by type". A row's text, when given, is shown in place of n.
export const hbars = (rows, label) => {
  const max = Math.max(1, ...rows.map(r => r.n));
  return `<div class="bl-hbars" role="img" aria-label="${esc(label)}">${rows.map(r => `<div class="bl-hbar"><span class="bl-hbar-k">${esc(r.label || r.k)}</span><span class="bl-hbar-bar"><i style="width:${(r.n / max) * 100}%"></i></span><span class="bl-hbar-n">${esc(r.text ?? r.n)}</span></div>`).join('')}</div>`;
};

// ---- Sparkline ----

// A tiny line over the period before and this one: the first `before` values in grey, the rest in the accent from the
// last grey point on, so the line is unbroken. A missing value (null) breaks it. A dot marks the latest value, and each
// value answers the tooltip with title(v, i).
export function spark(values, { before = 0, label, title = v => String(v), beforeName = 'the period before', nowName = 'this period' } = {}) {
  const W = 120, H = 28, p = 5, n = values.length;
  const known = values.filter(v => v != null), lo = Math.min(...known), hi = Math.max(...known);
  const x = i => r1(p + (n > 1 ? (i * (W - 2 * p)) / (n - 1) : (W - 2 * p) / 2));
  const y = v => r1(hi > lo ? H - p - ((v - lo) / (hi - lo)) * (H - 2 * p) : H / 2);
  // the runs of known values from a to b inclusive, each drawn as one line
  const lines = (a, b, cls, name) => {
    const out = [];
    let run = [];
    for (let i = a; i <= b; i++) {
      if (values[i] == null) { out.push(run); run = []; } else run.push(`${x(i)},${y(values[i])}`);
    }
    out.push(run);
    return out.filter(r => r.length > 1).map(r => `<polyline points="${r.join(' ')}" class="bl-line bl-s-${cls}"><title>${esc(name)}</title></polyline>`).join('');
  };
  const last = values.findLastIndex(v => v != null);
  const dot = last < 0 ? '' : `<circle cx="${x(last)}" cy="${y(values[last])}" r="4" class="bl-dot bl-s-${last < before ? 'before' : 'now'}"><title>${esc(title(values[last], last))}</title></circle>`;
  const grey = before > 0 ? lines(0, Math.min(before, n) - 1, 'before', beforeName) : '';
  const now = before < n ? lines(Math.max(0, before - 1), n - 1, 'now', nowName) : '';
  const hits = values.map((v, i) => (v == null ? '' : `<circle cx="${x(i)}" cy="${y(v)}" r="5" class="bl-hit"${tipOf(title(v, i))}/>`)).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="bl-spark" role="img" aria-label="${esc(label)}">${grey}${now}${dot}${hits}</svg>`;
}

// ---- Dot plot ----

// Round ticks for a log scale of seconds, and the words for each.
const LOG_TICKS = [[10, '10 s'], [60, '1 min'], [600, '10 min'], [3600, '1 h'], [36000, '10 h'], [86400, '1 d'], [864000, '10 d']];
// The runs of consecutive columns that have a value, so a line or band breaks at a day without one.
const runsOf = idx => idx.sort((a, b) => a - b).reduce((out, i) => { const r = out.at(-1); if (r && r.at(-1) === i - 1) r.push(i); else out.push([i]); return out; }, []);

// One dot per value, in its day's column, with a line through each day's median. points are [{ day, v, title }].
//   days:       the period's days in order, so a day with nothing still has its column; else the days of the points
//   band:       [{ day, median, p90 }], the median line and a band from it up to the 90th percentile behind it;
//               without it, each day's median is worked out from the points
//   ref:        { v, label }, a labelled line across the chart, such as the period's median
//   logY:       a log scale of seconds (the default), or false for a linear one from 0
//   dayHref(d): a link for each day, the column's full height; a dot is never a link
//   names:      { median, p90 }, the words on the chart for the line and the band
// The narrow render draws the line and the band alone.
export function dotPlot(points, { label, days, band, ref, logY = true, dayHref, fmt = duration, names = {} } = {}) {
  const N = { median: 'Daily median', p90: 'p90', ...names };
  const cols = days || [...new Set([...points.map(p => p.day), ...(band || []).map(b => b.day)])].sort();
  const meds = band ? band.filter(b => b.median != null).map(b => ({ day: b.day, v: b.median, p90: b.p90 }))
    : cols.map(day => ({ day, v: median(points.filter(p => p.day === day).map(p => p.v)) })).filter(m => m.v != null);
  // the scale and its ticks for the values a render draws: the narrow one, with no dots, fits the line and band alone
  const scaleFor = vals => {
    if (!logY) { const t = roundTicks(Math.max(0, ...vals)); return { scale: v => v / t.at(-1), ticks: t.map(v => [v, fmt(v)]) }; }
    const pos = vals.map(v => Math.max(1, v));
    const lo0 = pos.length ? Math.min(...pos) : 60, hi0 = pos.length ? Math.max(...pos) : 3600;
    let a = LOG_TICKS.findLastIndex(t => t[0] <= lo0), b = LOG_TICKS.findIndex(t => t[0] >= hi0);
    if (a < 0) a = 0;
    if (b < 0) b = LOG_TICKS.length - 1;
    if (a === b) { a = Math.max(0, a - 1); b = Math.min(LOG_TICKS.length - 1, b + 1); }
    const lo = Math.log(LOG_TICKS[a][0]), span = Math.log(LOG_TICKS[b][0]) - lo;
    return { scale: v => (Math.log(Math.max(LOG_TICKS[a][0], v)) - lo) / span, ticks: LOG_TICKS.slice(a, b + 1) };
  };
  const curve = [...meds.map(m => m.v), ...meds.filter(m => m.p90 != null).map(m => m.p90), ...(ref ? [ref.v] : [])];
  const draw = (W, dots) => {
    // the line, the band and the reference are named at the right of a wide chart, and in one line under a phone's
    const fs = fontOf(W), phone = W === NARROW, sides = [...(meds.length ? [N.median] : []), ...(meds.some(m => m.p90 != null) ? [N.p90] : []), ...(ref ? [ref.label] : [])];
    const { scale, ticks } = scaleFor(dots || !curve.length ? [...points.map(p => p.v), ...curve] : curve);
    const h = 200, pad = { l: axisRoom(ticks.map(t => t[1]), W), r: !phone && sides.length ? Math.max(...sides.map(s => textWidth(s, W))) + 14 : 10, t: 12, b: phone ? 34 : 26 };
    const iw = W - pad.l - pad.r, ih = h - pad.t - pad.b, right = W - pad.r;
    const bw = iw / Math.max(1, cols.length), mid = i => r1(pad.l + i * bw + bw / 2), y = v => r1(pad.t + ih - scale(v) * ih);
    let last = Infinity;
    const grid = ticks.map(([v, words]) => {
      const at = y(v), keep = last - at >= fs + 3;
      if (keep) last = at;
      return `<line x1="${pad.l}" x2="${right}" y1="${at}" y2="${at}" class="bl-grid"/>${keep ? `<text x="${pad.l - 6}" y="${at + 4}" text-anchor="end">${esc(words)}</text>` : ''}`;
    }).join('');
    const where = new Map(cols.map((d, i) => [d, i]));
    const on = meds.filter(m => where.has(m.day)), at = new Map(on.map(m => [where.get(m.day), m]));
    const runs = runsOf([...at.keys()]);
    // the band from the median up to p90, run by run; a day on its own gets a short block of its own
    const bandSvg = runs.map(r => {
      const rs = r.filter(i => at.get(i).p90 != null);
      if (!rs.length) return '';
      const hw = rs.length === 1 ? bw * 0.2 : 0;
      const up = rs.flatMap(i => (hw ? [[mid(i) - hw, y(at.get(i).p90)], [mid(i) + hw, y(at.get(i).p90)]] : [[mid(i), y(at.get(i).p90)]]));
      const down = [...rs].reverse().flatMap(i => (hw ? [[mid(i) + hw, y(at.get(i).v)], [mid(i) - hw, y(at.get(i).v)]] : [[mid(i), y(at.get(i).v)]]));
      return `<polygon points="${[...up, ...down].map(([px, py]) => `${r1(px)},${py}`).join(' ')}" class="bl-band"><title>${esc(N.p90)}</title></polygon>`;
    }).join('');
    const dotSvg = dots ? cols.map((day, i) => {
      const here = points.filter(p => p.day === day), m = here.length;
      return here.map((p, k) => { const t = p.title ?? `${shortDate(day)}: ${fmt(p.v)}`; return `<circle cx="${r1(mid(i) + (m > 1 ? (k / (m - 1) - 0.5) * bw * 0.5 : 0))}" cy="${y(p.v)}" r="4" class="bl-dot bl-s-now"${tipOf(t)}><title>${esc(t)}</title></circle>`; }).join('');
    }).join('') : '';
    const medText = m => `${shortDate(m.day)}: median ${fmt(m.v)}${m.p90 != null ? ` · p90 ${fmt(m.p90)}` : ''}`;
    const lineSvg = runs.filter(r => r.length > 1).map(r => `<polyline points="${r.map(i => `${mid(i)},${y(at.get(i).v)}`).join(' ')}" class="bl-line bl-s-amber"><title>${esc(N.median)}</title></polyline>`).join('') +
      on.map(m => `<circle cx="${mid(where.get(m.day))}" cy="${y(m.v)}" r="4" class="bl-med bl-s-amber"${tipOf(medText(m))}><title>${esc(medText(m))}</title></circle>`).join('');
    const refSvg = ref ? `<line x1="${pad.l}" x2="${right}" y1="${y(ref.v)}" y2="${y(ref.v)}" class="bl-ref"${tipOf(ref.label)}><title>${esc(ref.label)}</title></line>` : '';
    const side = [];
    const lastMed = phone ? null : on.at(-1);
    if (lastMed) side.push({ text: N.median, y: y(lastMed.v) });
    const lastP90 = [...on].reverse().find(m => m.p90 != null);
    if (lastP90 && !phone) side.push({ text: N.p90, y: y(lastP90.p90) });
    if (ref && !phone) side.push({ text: ref.label, y: y(ref.v) });
    const key = phone ? keyLineOf(sides.map(t => ({ swatch: t === N.median ? 'bl-s-amber' : t === N.p90 ? 'bl-k-band' : 'bl-k-ref', text: t }))) : '';
    const svg = `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${grid}${bandSvg}${refSvg}${dotSvg}${lineSvg}${dateTicks(cols, mid, h - 8, W)}${sideLabels(side, right + 6, fs + 2, pad.t, pad.t + ih)}</svg>`;
    const said = day => { const k = points.filter(p => p.day === day).length, m = meds.find(x => x.day === day); return `${shortDate(day)}: ${k} ${k === 1 ? 'change' : 'changes'}${m ? `, median ${fmt(m.v)}` : ''}`; };
    return (dayHref ? withLinks(svg, cols.map((d, i) => ({ x: pad.l + i * bw, w: bw, href: dayHref(d), text: said(d) })), W) : svg) + key;
  };
  return `<figure class="bl-chart">${bothWidths(W => draw(W, W === WIDE))}</figure>`;
}

// ---- A bar of parts ----

// The colours a part takes when its caller names none, in order: never the accent beside blue, which deutan vision
// cannot tell apart. Past four, a part is grey.
const PART_CLS = ['now', 'amber', 'before', 'blue'];
// The ink a label inside a segment wears, by the segment's fill: light on the greys, dark on the rest (5:1 or more).
const inkOn = cls => (['before', 'mute', 'mute2'].includes(cls) ? 'bl-ink-light' : 'bl-ink-dark');
const shareOf = (v, sum) => { const p = Math.round((v / sum) * 100); return `${p || '<1'}%`; };

// One bar across of named parts, such as where a typical change's time went. parts are [{ label, v, cls? }]. The bar is
// SVG; its labels are HTML, so they keep the page's text size at any width. A part's label sits inside its segment when
// it fits there on a phone, where the bar is about 260 px wide; the rest share one line under the bar, in the bar's
// order: "Queue <1% · Gate 15% · To live 16%".
//   focus: the label of the part to draw in the accent, with the others in muted greys
//   share: label each part with its share of the whole instead of its value, which moves to the tooltip
const PHONE_BAR = 260, LABEL_PX = 7; // px: the bar's width on a phone, and a character's at the labels' 12.5 px
export function partsBar(parts, { label, fmt = duration, focus, share } = {}) {
  let muted = 0;
  const shown = parts.filter(p => p.v > 0).map((p, i) => ({ ...p, cls: p.cls || (focus ? (p.label === focus ? 'now' : muted++ % 2 ? 'mute2' : 'mute') : PART_CLS[i] || 'before') }));
  const sum = shown.reduce((n, p) => n + p.v, 0);
  const W = WIDE, bh = 24, GAP = 3, pct = n => (n * 100).toFixed(3);
  let x = 0, segs = '', inside = '';
  const below = [];
  shown.forEach((p, i) => {
    const full = (p.v / sum) * W, w = Math.max(1, full - (i < shown.length - 1 ? GAP : 0));
    const words = share ? `${p.label} ${shareOf(p.v, sum)}` : `${p.label} ${fmt(p.v)}`;
    const said = share ? `${p.label}: ${fmt(p.v)} · ${shareOf(p.v, sum)}` : `${p.label}: ${fmt(p.v)}`;
    segs += `<rect x="${r1(x)}" y="0" width="${r1(w)}" height="${bh}" class="bl-s-${p.cls}"${tipOf(said)}><title>${esc(said)}</title></rect>`;
    if (words.length * LABEL_PX + 12 <= (w / W) * PHONE_BAR) inside += `<span class="${inkOn(p.cls)}" style="left:${pct(x / W)}%;width:${pct(w / W)}%">${esc(words)}</span>`;
    else below.push(words);
    x += full;
  });
  if (!shown.length) segs = `<rect x="0" y="0" width="${W}" height="${bh}" class="bl-track"><title>Nothing to show</title></rect>`;
  return `<figure class="bl-chart bl-parts"><div class="bl-parts-bar"><svg viewBox="0 0 ${W} ${bh}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${segs}</svg>` +
    `${inside ? `<div class="bl-parts-in" aria-hidden="true">${inside}</div>` : ''}</div>${below.length ? `<p class="bl-parts-small" aria-hidden="true">${esc(below.join(' · '))}</p>` : ''}</figure>`;
}

// ---- Bars of parts on one axis ----

// One bar across per row, each stacked from its parts, all on one shared axis of seconds, so a 13 h change draws three
// times as long as a 4 h one. rows are [{ label, total, parts: [{ label, v, cls? }], href?, tip? }]; a row with no
// parts draws its total in grey. A part keeps one colour in every row. A row's whole label sits above its bar, across
// the row beside its total, on up to 2 lines, and a row with an href is a link over the whole row.
//   max: the axis's end in seconds; else the longest row, rounded up to a tick
export function stackBars(rows, { label, max, fmt = duration } = {}) {
  const names = [...new Set(rows.flatMap(r => r.parts.map(p => p.label)))];
  const clsOf = p => p.cls || PART_CLS[names.indexOf(p.label)] || 'before';
  const ticks = timeTicks(max ?? Math.max(0, ...rows.map(r => r.total || 0))), end = ticks.at(-1);
  const draw = W => {
    const fs = fontOf(W), line = fs + 3, bh = 14, GAP = 2, left = 4, right = W - 4, pw = right - left, top = 4;
    const x = v => left + (Math.min(v, end) / end) * pw;
    // each row's label in lines that fit beside its total, 2 at most, the second ending in "…" when words are left
    const laid = rows.map(r => {
      const room = W - 8 - textWidth(fmt(r.total || 0), W) - 12, most = Math.max(1, Math.floor(room / (fs * 0.58)));
      const lines = [];
      for (const word of String(r.label).split(/\s+/).filter(Boolean)) {
        const last = lines.at(-1);
        if (last != null && `${last} ${word}`.length <= most) lines[lines.length - 1] = `${last} ${word}`;
        else lines.push(word.length > most ? `${word.slice(0, most - 1)}…` : word);
      }
      if (lines.length > 2) { const second = `${lines[1]} ${lines.slice(2).join(' ')}`; lines.splice(1, lines.length, `${second.slice(0, most - 1).trimEnd()}…`); }
      return { r, lines: lines.length ? lines : [''] };
    });
    let y = top;
    for (const l of laid) { l.y = y; l.h = l.lines.length * line + 4 + bh + 10; y += l.h; }
    const h = y + fs + 10;
    // the end ticks' labels lean inwards, so neither runs off the chart
    const anchor = i => (i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle');
    const grid = ticks.map((v, i) => `<line x1="${r1(x(v))}" x2="${r1(x(v))}" y1="${top}" y2="${y}" class="bl-grid"/><text x="${r1(x(v))}" y="${h - 4}" text-anchor="${anchor(i)}" class="bl-axis">${v ? esc(fmt(v)) : '0'}</text>`).join('');
    const body = laid.map(({ r, lines, y: y0 }) => {
      const by = y0 + lines.length * line + 4;
      const parts = r.parts.length ? r.parts.filter(p => p.v > 0) : [{ label: '', v: r.total || 0, cls: 'before' }];
      let at = left, segs = '';
      parts.forEach((p, i) => {
        const full = Math.max(0, Math.min((p.v / end) * pw, right - at)), w = Math.max(1, full - (i < parts.length - 1 ? GAP : 0));
        const said = p.label ? `${r.label} · ${p.label}: ${fmt(p.v)}` : `${r.label}: ${fmt(p.v)}`;
        segs += `<rect x="${r1(at)}" y="${r1(by)}" width="${r1(w)}" height="${bh}" class="bl-s-${clsOf(p)}"${tipOf(said)}><title>${esc(said)}</title></rect>`;
        const words = p.label ? `${p.label} ${fmt(p.v)}` : '';
        if (words && textWidth(words, W) + 10 <= w) segs += `<text x="${r1(at + w / 2)}" y="${r1(by + bh / 2 + fs / 3)}" text-anchor="middle" class="${inkOn(clsOf(p))}">${esc(words)}</text>`;
        at += full;
      });
      const name = lines.map((t, j) => `<text x="${left}" y="${r1(y0 + fs + j * line)}" class="bl-rowlabel">${esc(t)}</text>`).join('');
      const total = `<text x="${right}" y="${r1(y0 + fs)}" text-anchor="end" class="bl-total">${esc(fmt(r.total || 0))}</text>`;
      return segs + name + total;
    }).join('');
    const svg = `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">${grid}${body}</svg>`;
    return withLinks(svg, laid.map(({ r, y: ry, h: rh }) => ({ y: ry, h: rh, href: r.href, text: r.tip || `${r.label}: ${fmt(r.total || 0)}` })), W, h);
  };
  // the key wears each part's colour as the bars do, taken from the first part with that label
  const first = n => rows.flatMap(r => r.parts).find(p => p.label === n);
  const key = names.length > 1 ? `<div class="bl-legend">${names.map(n => `<span><i class="bl-s-${clsOf(first(n))}"></i>${esc(n)}</span>`).join('')}</div>` : '';
  return `<figure class="bl-chart">${key}${bothWidths(draw)}</figure>`;
}

// ---- A strip of deploys ----

const ms = t => (typeof t === 'number' ? t : Date.parse(t));
const isoDay = t => new Date(t).toISOString().slice(0, 10);

// Every deploy along a line of time: a grey tick, or for one that failed a taller tick in the failure colour with a "!",
// since colour alone must never carry it, and a bar from the failure to the moment it was green again.
//   events: [{ at, title, failed?, recovered? }], times as milliseconds or ISO strings
//   from, to: the period's ends (else the first and last deploy); ticks: [{ at, label }] for the axis (else its ends)
//   names: { deploy, failed, recovery }, the key's words above the strip
//   compact: a small strip for a headline tile, 40 px tall and the tile's full width, with no key or dates; its "!" is
//            HTML over the SVG, which stretches to the tile's width
export function strip(events, { label, from, to, ticks, names = {}, compact, recoveryTitle = (e, sec) => `${e.title} · green in ${duration(sec)}` } = {}) {
  const N = { deploy: 'Deploy', failed: 'Failed', recovery: 'Until green', ...names };
  const evs = events.map(e => ({ ...e, at: ms(e.at), recovered: e.recovered == null ? null : ms(e.recovered) }));
  let a = from != null ? ms(from) : evs.length ? Math.min(...evs.map(e => e.at)) : null;
  let b = to != null ? ms(to) : evs.length ? Math.max(...evs.map(e => e.at)) : null;
  if (a != null && !(b > a)) { a -= 12 * 3600000; b = a + 24 * 3600000; }
  const axis = ticks || (a == null ? [] : [{ at: a, label: shortDate(isoDay(a)), end: 'start' }, { at: b, label: shortDate(isoDay(b)), end: 'end' }]);
  if (compact) return compactStrip(evs, a, b, label, recoveryTitle);
  const draw = W => {
    const pad = 10, h = W === NARROW ? 64 : 60, base = 40, x = t => r1(pad + ((t - a) / (b - a)) * (W - 2 * pad));
    const inside = t => a != null && t >= a && t <= b;
    let marks = '';
    for (const e of evs.filter(e => inside(e.at))) {
      if (!e.failed) { marks += `<line x1="${x(e.at)}" x2="${x(e.at)}" y1="${base - 14}" y2="${base}" class="bl-tick bl-s-before"${tipOf(e.title)}><title>${esc(e.title)}</title></line>`; continue; }
      if (e.recovered != null) {
        const end = Math.min(e.recovered, b), said = recoveryTitle(e, (e.recovered - e.at) / 1000);
        marks += `<rect x="${x(e.at)}" y="${base + 1}" width="${Math.max(2, r1(x(end) - x(e.at)))}" height="5" class="bl-recover bl-s-fail"${tipOf(said)}><title>${esc(said)}</title></rect>`;
      }
      marks += `<line x1="${x(e.at)}" x2="${x(e.at)}" y1="${base - 22}" y2="${base}" class="bl-tick bl-s-fail"${tipOf(e.title)}><title>${esc(e.title)}</title></line>` +
        `<text x="${x(e.at)}" y="${base - 25}" text-anchor="middle" class="bl-bang">!</text>`;
    }
    const labels = axis.filter(t => inside(ms(t.at))).map(t => `<text x="${x(ms(t.at))}" y="${h - 4}" text-anchor="${t.end || 'middle'}">${esc(t.label)}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}"><line x1="${pad}" x2="${W - pad}" y1="${base}" y2="${base}" class="bl-grid"/>${marks}${labels}</svg>`;
  };
  const key = `<div class="bl-legend"><span><i class="bl-key-tick"></i>${esc(N.deploy)}</span><span><i class="bl-key-bang">!</i>${esc(N.failed)}</span><span><i class="bl-key-bar"></i>${esc(N.recovery)}</span></div>`;
  return `<figure class="bl-chart">${key}${bothWidths(draw)}</figure>`;
}

// The headline tile's strip: ticks along a baseline in a 300 by 40 box stretched to the tile's width, with strokes that
// keep their width, a taller red tick for a failure with its "!" above it in HTML, and a bar to its recovery.
function compactStrip(evs, a, b, label, recoveryTitle) {
  const W = 300, base = 30, x = t => r1(((t - a) / (b - a)) * W), inside = t => a != null && t >= a && t <= b;
  let marks = '', bangs = '';
  for (const e of evs.filter(e => inside(e.at))) {
    if (!e.failed) { marks += `<line x1="${x(e.at)}" x2="${x(e.at)}" y1="${base - 12}" y2="${base}" class="bl-tick bl-s-before"${tipOf(e.title)}><title>${esc(e.title)}</title></line>`; continue; }
    if (e.recovered != null) {
      const said = recoveryTitle(e, (e.recovered - e.at) / 1000);
      marks += `<rect x="${x(e.at)}" y="${base + 1}" width="${Math.max(2, r1(x(Math.min(e.recovered, b)) - x(e.at)))}" height="4" class="bl-recover bl-s-fail"${tipOf(said)}><title>${esc(said)}</title></rect>`;
    }
    marks += `<line x1="${x(e.at)}" x2="${x(e.at)}" y1="${base - 20}" y2="${base}" class="bl-tick bl-s-fail"${tipOf(e.title)}><title>${esc(e.title)}</title></line>`;
    bangs += `<span class="bl-bang-pin" style="left:${((x(e.at) / W) * 100).toFixed(3)}%" aria-hidden="true">!</span>`;
  }
  return `<figure class="bl-chart bl-strip-compact"><div class="bl-hitwrap"><svg viewBox="0 0 ${W} 40" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">` +
    `<line x1="0" x2="${W}" y1="${base}" y2="${base}" class="bl-grid"/>${marks}</svg>${bangs}</div></figure>`;
}

// ---- A chart's values as a table ----

// The values a chart draws, as a table behind a "The numbers" disclosure, for a page to put under the chart: its
// titles and data-tip reach a mouse or a tap, and a screen reader reaches this. head names the columns, each row starts
// with its row's name, and a value of null says "–". Opt-in, so a chart without it is unchanged.
export function numbers({ caption = '', head = [], rows = [] }) {
  const cell = v => (v == null || Number.isNaN(v) ? '–' : v);
  return `<details class="bl-numbers"><summary>The numbers</summary><table class="hq-table">${caption ? `<caption>${esc(caption)}</caption>` : ''}`
    + `<thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>`
    + rows.map(([first, ...rest]) => `<tr><th scope="row">${esc(first)}</th>${rest.map(v => `<td class="num">${esc(cell(v))}</td>`).join('')}</tr>`).join('')
    + '</tbody></table></details>';
}
