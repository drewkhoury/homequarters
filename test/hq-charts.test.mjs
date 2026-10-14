// HQ's small SVG charts (hq/lib/charts.mjs): the day columns and bars across that Launch draws, and the pieces the
// Delivery page adds: a sparkline, a dot plot on a log scale with a 90th-percentile band, a bar of parts, bars of parts
// on one shared axis, and a strip of deploys with their failures. Every chart is an image with the takeaway its caller
// wrote as its label. Every mark keeps a native tooltip, and carries data-tip for the HTML tooltip hq/static/hq-charts.js
// shows on hover, focus and tap. A chart a person can follow to a list links whole days from outside the SVG, since links
// inside an image are hidden from a screen reader; dots are never links. The wide render and a narrow one at 360 units
// both ship, so labels stay readable on a phone. 6 October: the second Delivery page drew 0, 16 and 31 on its axes,
// legends under its charts and the slowest changes each scaled to its own total, so 13 h and 4 h looked the same. On
// a phone the third drew its text at 9.7 px, day links 23 px wide and event labels over the bars (Noor, 6 October).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dayChart, hbars, spark, dotPlot, partsBar, stackBars, strip, numbers } from '../lib/charts.mjs';
import { layout } from '../lib/page.mjs';
import '../static/hq-charts.js';
const { nearest, place, tapStep } = globalThis.hqChartTip;

const svgs = html => html.match(/<svg[\s\S]*?<\/svg>/g) || [];
const count = (re, s) => (s.match(re) || []).length;
const wide = html => /<div class="bl-chart-wide">([\s\S]*?)<\/div><div class="bl-chart-narrow">/.exec(html)?.[1] ?? '';
const narrow = html => /<div class="bl-chart-narrow">([\s\S]*)$/.exec(html)?.[1] ?? '';
// a link outside every SVG: a link inside one would sit inside an image
const linksOutsideSvg = html => count(/<a /g, html.replace(/<svg[\s\S]*?<\/svg>/g, ''));
const titled = (svg, cls) => [...svg.matchAll(new RegExp(`<(rect|circle|polyline|polygon|line)[^>]*class="[^"]*${cls}[^"]*"[^>]*?(/?)>`, 'g'))];
const tips = html => [...html.matchAll(/data-tip="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
// the numbers on a value axis, read from the labels set against its left edge
const axisNumbers = svg => [...svg.matchAll(/<text [^>]*text-anchor="end"[^>]*>([\d,]+)<\/text>/g)].map(m => Number(m[1].replace(/,/g, '')));
const pointsOf = s => s.trim().split(/\s+/).map(p => p.split(',').map(Number));
const keyLine = html => /<p class="bl-key-line">(.*?)<\/p>/.exec(html)?.[1].replace(/<[^>]+>/g, '') ?? '';
// How wide a narrow render is drawn on a 390 px phone: Noor read its 13-unit text at 9.7 px, so 360 units are 268 px.
const PHONE = 268;
// The date labels along a render's foot, as [from, to] in its units, measured as the chart measures them.
const dateBoxes = svg => {
  const W = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]), size = W === 360 ? 15 : 11;
  return [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="middle">(\d+ \w+)<\/text>/g)].map(m => { const w = m[2].length * size * 0.58; return [Number(m[1]) - w / 2, Number(m[1]) + w / 2]; });
};

// Each chart is an image whose label is the caller's takeaway, and no number in it is NaN or Infinity.
function isImage(html, label) {
  assert.ok(svgs(html).length, 'an SVG');
  for (const svg of svgs(html)) {
    assert.match(svg, /^<svg [^>]*role="img"/);
    assert.ok(svg.includes(`aria-label="${label}"`), `labelled ${label}`);
  }
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  assert.doesNotMatch(html, /\sd="[^"]*[CcSsQqTtAa]/, 'no curve anywhere: lines are straight segments');
}
// Every mark of a series keeps its native tooltip: no mark of that class closes itself, and each holds a <title>.
function everyMarkTitled(svg, cls) {
  const found = titled(svg, cls);
  assert.ok(found.length, `marks of ${cls}`);
  for (const m of found) assert.equal(m[2], '', `${m[0]} carries a <title>`);
}

// A week of deploys, and the week before for comparison. The day with 4 deploys had 2 the same day of the week before.
const day = n => `2026-10-${String(n).padStart(2, '0')}`;
const NOW_ROWS = [3, 0, 5, 2, 4, 1, 6].map((n, i) => ({ day: day(i + 1), n }));
const PRIOR = [2, 2, 5, 4, 2, 1, 0].map((n, i) => ({ day: `2026-09-${24 + i}`, n }));
const ONE = [{ key: 'n', cls: 'now', label: 'deploys', bar: true }];
const LABEL = 'Deploys per day, 1 – 7 Oct: 21. Prior 7 days: 16.';

test('dayChart in Launch\'s classic look: one SVG, a legend under it, its old ticks and no tooltips, so Launch stays as it was', () => {
  const two = [{ key: 'n', cls: 'now', label: 'visits', bar: true }, { key: 'b', cls: 'before', label: 'bounces', bar: true }];
  const html = dayChart(NOW_ROWS.map(r => ({ ...r, b: 1 })), two, { label: LABEL, classic: true });
  isImage(html, LABEL);
  assert.equal(svgs(html).length, 1);
  assert.equal(count(/<a |data-tip/g, html), 0);
  assert.match(html, /<div class="bl-legend">/);
  assert.deepEqual(axisNumbers(html), [0, 4, 7]);
});

test('dayChart: the value axis steps in round numbers, 0, 10, 20, 30, never 0, 16, 31', () => {
  const ticks = max => axisNumbers(svgs(dayChart([{ day: day(1), n: max }, { day: day(2), n: 1 }], ONE, { label: 'x' }))[0]);
  assert.deepEqual(ticks(31), [0, 10, 20, 30, 40]);
  assert.deepEqual(ticks(16), [0, 5, 10, 15, 20]);
  assert.deepEqual(ticks(3), [0, 1, 2, 3]);
  assert.deepEqual(axisNumbers(svgs(dayChart([], ONE, { label: 'x' }))[0]), [0, 1], 'an empty chart still has an axis');
});

test('dayChart: the period before is a dashed line on the same axes, each of its days over the same day of this period', () => {
  const html = dayChart(NOW_ROWS, ONE, { label: LABEL, before: PRIOR, beforeLabel: 'Prior 7 days', narrow: true });
  isImage(html, LABEL);
  for (const svg of [wide(html), narrow(html)]) {
    assert.equal(count(/<rect [^>]*class="bl-s-before"/g, svg), 0, 'no grey columns of its own');
    everyMarkTitled(svg, 'bl-prior');
    // 3 Oct had 5 deploys and the third day before had 5 too: the line runs level with that column's top
    const bar = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"[^>]*class="bl-s-now"><title>3 Oct/.exec(svg);
    const [x0, top, w] = [Number(bar[1]), Number(bar[2]), Number(bar[3])];
    const over = pointsOf(/<polyline points="([^"]*)" class="bl-prior"/.exec(svg)[1]).filter(([x]) => x >= x0 - 0.5 && x <= x0 + w + 0.5);
    assert.ok(over.length, 'the line crosses the column');
    for (const [, y] of over) assert.ok(Math.abs(y - top) < 0.6, `level with the column, ${y} against ${top}`);
  }
  assert.match(wide(html), /<text [^>]*class="bl-direct"[^>]*>Prior 7 days<\/text>/, 'labelled on the chart');
  assert.equal(keyLine(narrow(html)), 'Prior 7 days', 'on a phone, under the chart, so the columns keep their width');
  assert.doesNotMatch(svgs(narrow(html))[0], /bl-direct/);
});

test('dayChart: a day before with no record is a gap in the dashed line, not a zero', () => {
  const gappy = PRIOR.map((r, i) => (i === 3 ? { ...r, n: null } : r));
  const svg = svgs(dayChart(NOW_ROWS, ONE, { label: 'x', before: gappy, beforeLabel: 'Prior 7 days' }))[0];
  assert.equal(count(/class="bl-prior"/g, svg), 2, 'two runs either side of the gap');
  const short = svgs(dayChart(NOW_ROWS, ONE, { label: 'x', before: PRIOR.slice(4), beforeLabel: 'Prior 7 days' }))[0];
  assert.equal(count(/class="bl-prior"/g, short), 1, 'a record that starts late fills the last days only');
  const xs = pointsOf(/<polyline points="([^"]*)" class="bl-prior"/.exec(short)[1]).map(p => p[0]);
  assert.ok(Math.min(...xs) > 640 / 2, 'and those days sit on the right, over the period\'s last days');
});

test('dayChart: each day\'s tooltip pairs it with the same day of the period before, named by its date', () => {
  const href = d => `/delivery?list=deploys&day=${d}`;
  const html = dayChart(NOW_ROWS, ONE, { label: 'x', before: PRIOR.map((r, i) => (i === 6 ? { ...r, n: null } : r)), beforeLabel: 'Prior 7 days', href, narrow: true });
  const t = tips(wide(html));
  assert.ok(t.includes('5 Oct: 4 deploys · 28 Sept: 2'), t.join(' | '));
  assert.ok(t.includes('7 Oct: 6 deploys · 30 Sept: no data'));
  assert.match(html, /<a href="\/delivery\?list=deploys&amp;day=2026-10-05" style="left:[\d.]+%;width:[\d.]+%" aria-label="5 Oct: 4 deploys · 28 Sept: 2"[^>]* data-tip=/);
  const late = tips(dayChart(NOW_ROWS, ONE, { label: 'x', before: PRIOR.slice(4), beforeLabel: 'Prior 7 days' }));
  assert.ok(late.includes('1 Oct: 3 deploys · 24 Sept: no data'), 'a day before the record still has its date');
  for (const part of [wide(html), narrow(html)]) assert.equal(linksOutsideSvg(part), 7, 'a link for each day of this period, none for the days before');
});

test('dayChart: beforeDays names each day of the period before, for a caller whose days are not simply a period earlier', () => {
  const names = ['22 Sept', '23 Sept', '24 Sept', '25 Sept', '26 Sept', '27 Sept', '28 Sept'];
  const t = tips(dayChart(NOW_ROWS, ONE, { label: 'x', before: PRIOR, beforeDays: names, beforeLabel: 'Prior 7 days' }));
  assert.ok(t.includes('3 Oct: 5 deploys · 24 Sept: 5'), t.join(' | '));
  const short = tips(dayChart(NOW_ROWS, ONE, { label: 'x', before: PRIOR.slice(4), beforeDays: names.slice(4), beforeLabel: 'Prior 7 days' }));
  assert.ok(short.includes('5 Oct: 4 deploys · 26 Sept: 2'), 'aligned with before, so a shorter list fills the last days');
});

test('dayChart: without links, each day still has a column the tooltip answers to', () => {
  const svg = svgs(dayChart(NOW_ROWS, ONE, { label: 'x' }))[0];
  assert.equal(count(/<rect [^>]*class="bl-col"[^>]*data-tip="/g, svg), 7);
  everyMarkTitled(svg, 'bl-col');
});

test('dayChart: up to two series are labelled on the chart and need no legend; three keep one', () => {
  const two = [{ key: 'test', cls: 'now', label: 'Test', bar: true }, { key: 'machine', cls: 'amber', label: 'Machine', bar: true }];
  const rows = NOW_ROWS.map(r => ({ day: r.day, test: r.n, machine: 1 }));
  const html = dayChart(rows, two, { label: 'x', narrow: true });
  assert.doesNotMatch(html, /bl-legend/);
  for (const name of ['Test', 'Machine']) assert.match(svgs(html)[0], new RegExp(`class="bl-direct"[^>]*>${name}</text>`));
  assert.equal(keyLine(narrow(html)), 'Test · Machine');
  assert.doesNotMatch(dayChart(NOW_ROWS, ONE, { label: 'x' }), /bl-legend|bl-direct/, 'one series: the title names it');
  const three = [...two, { key: 'exp', cls: 'ghost', label: 'Experiment', bar: true }];
  assert.match(dayChart(rows.map(r => ({ ...r, exp: 1 })), three, { label: 'x' }), /<div class="bl-legend">/);
});

test('dayChart: marks are short labels at their day, in rows that never overlap, each with its tooltip', () => {
  const marks = [{ day: day(3), label: 'Laptop runner from here' }, { day: day(4), label: 'Redeploys skipped from here' }, { day: '2026-01-01', label: 'off the chart' }];
  const html = dayChart(NOW_ROWS, ONE, { label: 'x', marks, narrow: true });
  for (const svg of svgs(html)) assert.equal(count(/<line [^>]*class="bl-mark"/g, svg), 2, 'a day outside the chart draws no mark');
  {
    const svg = svgs(html)[0];
    everyMarkTitled(svg, 'bl-mark');
    const labels = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"(?: text-anchor="(\w+)")? class="bl-mark"[^>]*>([^<]*)<\/text>/g)]
      .map(m => { const w = m[4].length * 7.5, x = Number(m[1]); return { y: Number(m[2]), from: m[3] === 'end' ? x - w : x, to: m[3] === 'end' ? x : x + w }; });
    assert.equal(labels.length, 2);
    const [a, b] = labels;
    assert.ok(a.y !== b.y || a.to <= b.from || b.to <= a.from, 'the two labels sit in different rows or apart');
    for (const l of labels) assert.ok(l.from >= 0 && l.to <= Number(/viewBox="0 0 (\d+)/.exec(svg)[1]), 'inside the chart');
  }
  assert.ok(tips(html).includes('4 Oct: Redeploys skipped from here'));
});

test('dayChart on a phone: marks are numbered pins over their days, named in one line under the chart', () => {
  const marks = [{ day: day(3), label: 'Laptop CI from here' }, { day: day(5), label: 'Redeploys skipped from here' }];
  const html = dayChart(NOW_ROWS, ONE, { label: 'x', marks, narrow: true, before: PRIOR, beforeLabel: 'Prior 7 days' });
  const svg = svgs(narrow(html))[0];
  assert.match(svg, /class="bl-mark"[^>]*>①<\/text>/);
  assert.match(svg, /class="bl-mark"[^>]*>②<\/text>/);
  assert.doesNotMatch(svg, />Laptop CI from here</, 'no long label over the bars');
  assert.equal(keyLine(narrow(html)), 'Prior 7 days · ① Laptop CI from here · ② Redeploys skipped from here');
  assert.doesNotMatch(wide(html), /bl-key-line/, 'the wide render labels its marks in place');
});

test('dayChart on a phone: each of 7 days\' links is at least 24 px wide, the whole column', () => {
  const html = dayChart(NOW_ROWS, ONE, { label: 'x', before: PRIOR, beforeLabel: 'Prior 7 days', marks: [{ day: day(5), label: 'Redeploys skipped from here' }], href: d => `/x?day=${d}`, narrow: true });
  const widths = [...narrow(html).matchAll(/<a [^>]*style="left:[\d.]+%;width:([\d.]+)%"/g)].map(m => (Number(m[1]) / 100) * PHONE);
  assert.equal(widths.length, 7);
  for (const w of widths) assert.ok(w >= 24, `${w.toFixed(1)} px`);
});

test('dayChart: a day\'s tooltip column runs the SVG\'s full height, as its link does, so a tap near the dates still finds it', () => {
  for (const svg of svgs(dayChart(NOW_ROWS, ONE, { label: 'x', narrow: true, href: d => `/x?day=${d}` }))) {
    const h = Number(/viewBox="0 0 \d+ ([\d.]+)"/.exec(svg)[1]);
    for (const m of svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" class="bl-col"/g)) assert.deepEqual([Number(m[1]), Number(m[2])], [0, h]);
  }
});

test('every chart\'s phone render shows at most 3 dates along its foot, none touching another or the edge', () => {
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 6 + i)).toISOString().slice(0, 10));
  const renders = [
    dayChart(days30.map(d => ({ day: d, n: 2 })), ONE, { label: 'x', narrow: true }),
    dotPlot(days30.map(d => ({ day: d, v: 600 })), { label: 'x', days: days30 }),
  ];
  for (const html of renders) {
    const boxes = dateBoxes(svgs(narrow(html))[0]);
    assert.ok(boxes.length >= 2 && boxes.length <= 3, `${boxes.length} dates`);
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i][0] >= boxes[i - 1][1] + 6, 'apart');
    for (const [from, to] of boxes) assert.ok(from >= 0 && to <= 360, 'inside');
  }
});

test('dayChart: a narrow render at 360 units ships beside the wide one at 640, and no days, or one, draws no NaN', () => {
  const html = dayChart(NOW_ROWS, ONE, { label: LABEL, narrow: true });
  assert.match(wide(html), /<svg viewBox="0 0 640 /);
  assert.match(narrow(html), /<svg viewBox="0 0 360 /);
  isImage(dayChart([], ONE, { label: 'None', before: [], beforeLabel: 'Prior 7 days', narrow: true, href: d => `/x?day=${d}`, marks: [{ day: day(1), label: 'x' }] }), 'None');
  isImage(dayChart([NOW_ROWS[0]], ONE, { label: 'One', before: [PRIOR[0]], beforeLabel: 'Prior 7 days', narrow: true }), 'One');
});

test('the narrow renders\' text is at least 11 px on a 390 px phone', () => {
  const css = readFileSync(new URL('../static/hq.css', import.meta.url), 'utf8');
  const size = Number(/\.bl-chart-narrow text \{ font-size: ([\d.]+)px; \}/.exec(css)?.[1]);
  assert.ok(size * (PHONE / 360) >= 11, `${size} units at ${PHONE}/360 is ${(size * PHONE / 360).toFixed(1)} px`);
});

test('hbars: a bar across for each value, longest for the largest, inside one image', () => {
  const html = hbars([{ k: 'Tech lead', n: 4 }, { k: 'Developer', n: 2 }], 'Sign-ups by role');
  assert.match(html, /role="img" aria-label="Sign-ups by role"/);
  assert.deepEqual([...html.matchAll(/width:([\d.]+)%/g)].map(m => Number(m[1])), [100, 50]);
  assert.doesNotMatch(hbars([], 'Nothing'), /NaN/);
});

test('spark: the period before in grey and this one in the accent, joined, with a dot on the latest value', () => {
  const html = spark([4, 6, 5, 9, 10, 8, 12], { before: 3, label: 'Deploys rose from 15 to 39' });
  isImage(html, 'Deploys rose from 15 to 39');
  const svg = svgs(html)[0];
  const pts = cls => new RegExp(`<polyline points="([^"]*)" class="[^"]*bl-s-${cls}"`).exec(svg)[1].split(' ');
  assert.equal(pts('before').length, 3);
  assert.equal(pts('now').length, 5, 'the accent starts from the last grey point, so the line is unbroken');
  assert.equal(pts('now')[0], pts('before').at(-1));
  assert.match(svg, /<circle [^>]*class="bl-dot[^>]*><title>12<\/title><\/circle>/);
  everyMarkTitled(svg, 'bl-s-');
  assert.equal(tips(svg).length, 7, 'every value answers the tooltip');
});

test('spark: a missing value breaks the line instead of dropping to zero, and no values, or one, draws no NaN', () => {
  assert.equal(count(/<polyline /g, svgs(spark([1, 2, null, 4, 5], { label: 'With a gap' }))[0]), 2);
  isImage(spark([], { label: 'Nothing yet' }), 'Nothing yet');
  isImage(spark([7], { label: 'One value' }), 'One value');
});

// Changes and their lead time in seconds over five days. The middle day had none.
const DAYS5 = [1, 2, 3, 4, 5].map(day);
const CHANGES = [
  { day: day(1), v: 60, title: '#101: 1 min' }, { day: day(1), v: 6000, title: '#102: 1 h 40 min' },
  { day: day(2), v: 600, title: '#103: 10 min' }, { day: day(4), v: 720, title: '#104: 12 min' }, { day: day(5), v: 900, title: '#105: 15 min' },
];
const BAND = [{ day: day(1), median: 600, p90: 6000 }, { day: day(2), median: 600, p90: 600 }, { day: day(4), median: 720, p90: 900 }, { day: day(5), median: 900, p90: 3600 }];
const cy = (svg, title) => Number(new RegExp(`cy="([\\d.]+)"[^>]*><title>${title}</title>`).exec(svg)[1]);

test('dotPlot: one dot per change, each with its tooltip, and none of them a link; each day is a link outside the image', () => {
  const html = dotPlot(CHANGES, { label: 'Lead time per change', days: DAYS5, band: BAND, dayHref: d => `/delivery?list=changes&day=${d}` });
  isImage(html, 'Lead time per change');
  assert.equal(count(/<circle [^>]*class="bl-dot/g, wide(html)), 5);
  everyMarkTitled(wide(html), 'bl-dot');
  for (const t of ['#101: 1 min', '#105: 15 min']) assert.ok(tips(wide(html)).includes(t));
  for (const svg of svgs(html)) assert.doesNotMatch(svg, /<a /, 'no dot is a link');
  assert.equal(linksOutsideSvg(wide(html)), 5);
  assert.equal(linksOutsideSvg(narrow(html)), 5);
  assert.match(html, /<a href="\/delivery\?list=changes&amp;day=2026-10-03"/, 'a day with no changes still links to its empty list');
});

test('dotPlot: lead time runs up a log scale with round ticks, so 10 minutes sits halfway between 1 minute and 100', () => {
  const svg = svgs(dotPlot(CHANGES, { label: 'Lead time', days: DAYS5 }))[0];
  const [a, b, c] = [cy(svg, '#101: 1 min'), cy(svg, '#103: 10 min'), cy(svg, '#102: 1 h 40 min')];
  assert.ok(a > b && b > c, 'longer is higher');
  assert.ok(Math.abs((a - b) - (b - c)) < 0.5, `${a} ${b} ${c} are evenly spaced`);
  const ticks = [...svg.matchAll(/<text [^>]*text-anchor="end"[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
  assert.deepEqual(ticks, ['1 min', '10 min', '1 h', '10 h']);
});

test('dotPlot: a band from the median up to the 90th percentile sits behind the median line, and a day with no changes is a gap in both', () => {
  const html = dotPlot(CHANGES, { label: 'Lead time', days: DAYS5, band: BAND, narrow: true });
  for (const part of [wide(html), narrow(html)]) {
    assert.equal(count(/<polygon [^>]*class="bl-band"/g, part), 2, 'a band for 1–2 Oct and one for 4–5 Oct');
    assert.equal(count(/<polyline [^>]*class="bl-line bl-s-amber"/g, part), 2, 'the median breaks at 3 Oct');
    assert.ok(part.indexOf('class="bl-band"') < part.indexOf('class="bl-line bl-s-amber"'), 'the band is drawn first, behind');
    everyMarkTitled(part, 'bl-band');
    assert.doesNotMatch(part, /bl-legend/, 'labels on the chart, not a legend under it');
  }
  assert.match(wide(html), /class="bl-direct"[^>]*>Daily median<\/text>/);
  assert.match(wide(html), /class="bl-direct"[^>]*>p90<\/text>/);
  assert.equal(keyLine(narrow(html)), 'Daily median · p90', 'on a phone, under the chart');
  assert.ok(tips(html).includes('5 Oct: median 15 min · p90 1 h'));
  // the band's top on 1 Oct is the 90th percentile, level with the dot at 1 h 40 min
  const svg = svgs(html)[0], top = Math.min(...pointsOf(/<polygon points="([^"]*)" class="bl-band"/.exec(svg)[1]).map(p => p[1]));
  assert.ok(Math.abs(top - cy(svg, '#102: 1 h 40 min')) < 0.6);
});

test('dotPlot: at phone width the median line and band stand alone, without dots', () => {
  const html = dotPlot(CHANGES, { label: 'Lead time', days: DAYS5, band: BAND });
  assert.match(narrow(html), /<svg viewBox="0 0 360 /);
  assert.equal(count(/class="bl-dot/g, narrow(html)), 0);
  assert.ok(count(/class="bl-band"/g, narrow(html)) > 0 && count(/class="bl-line bl-s-amber"/g, narrow(html)) > 0);
});

test('dotPlot: the period\'s median can be drawn as a labelled reference line across the chart', () => {
  const svg = svgs(dotPlot(CHANGES, { label: 'Lead time', days: DAYS5, ref: { v: 720, label: 'Median 12 min' } }))[0];
  const line = /<line x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)" y2="([\d.]+)" class="bl-ref"/.exec(svg);
  assert.ok(line && line[3] === line[4], 'level');
  assert.match(svg, /class="bl-direct"[^>]*>Median 12 min<\/text>/);
});

test('dotPlot: no changes, or one, draws no NaN', () => {
  isImage(dotPlot([], { label: 'No changes yet', days: DAYS5, band: [], dayHref: d => `/x?day=${d}` }), 'No changes yet');
  isImage(dotPlot([], { label: 'No days at all' }), 'No days at all');
  const one = dotPlot([CHANGES[2]], { label: 'One change', band: [{ day: day(2), median: 600, p90: 600 }] });
  isImage(one, 'One change');
  assert.equal(count(/class="bl-dot/g, wide(one)), 1);
});

// The typical change's parts, in seconds: a long wait to merge, the gate, and two too short to hold their own label.
const PARTS = [{ label: 'Gate', v: 420 }, { label: 'Merge wait', v: 1500 }, { label: 'To live', v: 30 }, { label: 'Re-runs', v: 20 }];
const segments = svg => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" class="bl-s-(\w+)"[^>]*><title>([^<]*)<\/title>/g)]
  .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], cls: m[5], title: m[6] }));
// a label laid over the bar in HTML, as its left edge and width in % of the bar
const inside = (html, text) => { const m = new RegExp(`<span class="bl-ink-\\w+" style="left:([\\d.]+)%;width:([\\d.]+)%">${text}</span>`).exec(html); return m && { left: +m[1], width: +m[2] }; };
const smallLine = html => /<p class="bl-parts-small"[^>]*>([^<]*)<\/p>/.exec(html)?.[1].replace(/&lt;/g, '<') ?? '';

test('partsBar: one bar, a segment per part sized by its share, each with its tooltip', () => {
  const html = partsBar(PARTS, { label: '#52, the median change: 32 min' });
  isImage(html, '#52, the median change: 32 min');
  const segs = segments(svgs(html)[0]);
  assert.equal(segs.length, 4);
  assert.ok(segs[1].w > segs[0].w * 3 && segs[0].w > segs[2].w * 10);
  assert.equal(new Set(segs.map(s => s.y)).size, 1, 'one bar, not four');
  assert.ok(tips(html).includes('Merge wait: 25 min'));
});

test('partsBar: one bar whose labels are the page\'s own text, inside a segment with room and in one line below for the rest', () => {
  const html = partsBar(PARTS, { label: 'Parts' });
  assert.equal(svgs(html).length, 1, 'one render, since its words are HTML and keep the page\'s size at any width');
  assert.doesNotMatch(html, /bl-chart-narrow|<text /);
  const seg = segments(svgs(html)[0])[1], W = Number(/viewBox="0 0 (\d+)/.exec(html)[1]), label = inside(html, 'Merge wait 25 min');
  assert.ok(label, 'the long wait is labelled inside');
  assert.ok(Math.abs(label.left - (seg.x / W) * 100) < 0.6 && Math.abs(label.width - (seg.w / W) * 100) < 0.6, 'over its own segment');
  assert.equal(smallLine(html), 'Gate 7 min · To live 30 s · Re-runs 20 s', 'the rest in segment order, with no swatches');
  assert.doesNotMatch(html, /bl-key/);
});

test('partsBar: no purple segment beside a blue one when the caller leaves the colours to it', () => {
  const order = segments(svgs(partsBar(PARTS, { label: 'Parts' }))[0]).map(s => s.cls);
  for (let i = 1; i < order.length; i++) assert.notDeepEqual([order[i - 1], order[i]].sort(), ['blue', 'now']);
});

test('partsBar as a share bar: the stage in focus in the accent, the rest muted, each labelled with its share', () => {
  const hours = [{ label: 'Queue', v: 2 * 3600 }, { label: 'Gate', v: 15 * 3600 }, { label: 'Merge wait', v: 40 * 3600 }, { label: 'To live', v: 4 * 3600 }];
  const html = partsBar(hours, { label: 'Lead time by stage: merge wait 40 of 61 h', focus: 'Merge wait', share: true });
  isImage(html, 'Lead time by stage: merge wait 40 of 61 h');
  const segs = segments(svgs(html)[0]);
  assert.deepEqual(segs.map(s => s.cls === 'now'), [false, false, true, false], 'only the focus wears the accent');
  for (const s of segs.filter(x => x.cls !== 'now')) assert.match(s.cls, /^mute2?$/);
  assert.ok(inside(html, 'Merge wait 66%'), 'the share sits on the data');
  assert.equal(smallLine(html), 'Queue 3% · Gate 25% · To live 7%');
  assert.ok(tips(html).includes('Merge wait: 1 d 16 h · 66%'), 'two units at most: 40 h reads 1 d 16 h');
});

test('partsBar: nothing to share, or one part, draws no NaN', () => {
  isImage(partsBar([], { label: 'No changes' }), 'No changes');
  isImage(partsBar([{ label: 'Gate', v: 0 }], { label: 'All zero', share: true }), 'All zero');
  const one = partsBar([{ label: 'Gate', v: 300 }], { label: 'One part' });
  isImage(one, 'One part');
  assert.equal(segments(svgs(one)[0]).length, 1);
});

// The slowest changes: 13 h 17 min, mostly waiting to merge, down to 4 h 12 min.
const SLOW = [
  { label: '#161 Moss waves back', total: 47820, parts: [{ label: 'Gate', v: 240 }, { label: 'Merge wait', v: 47160 }, { label: 'To live', v: 420 }], href: 'https://github.com/x/pull/161' },
  { label: '#140 Shop sells hats', total: 15120, parts: [{ label: 'Gate', v: 600 }, { label: 'Merge wait', v: 14100 }, { label: 'To live', v: 420 }] },
  { label: 'a1b2c3d direct push', total: 15000, parts: [] },
];
// a row's length on the axis: from its first segment's start to its last segment's end
const rowWidth = (svg, title) => { const segs = segments(svg).filter(s => s.title.startsWith(title)); return Math.max(...segs.map(s => s.x + s.w)) - Math.min(...segs.map(s => s.x)); };

test('stackBars: every row on one shared axis, so 13 hours draws about three times as long as 4 hours', () => {
  const html = stackBars(SLOW, { label: 'Slowest: merge wait 16 h 47 min of 17 h 32 min' });
  isImage(html, 'Slowest: merge wait 16 h 47 min of 17 h 32 min');
  for (const svg of svgs(html)) {
    const ratio = rowWidth(svg, '#161') / rowWidth(svg, '#140');
    assert.ok(Math.abs(ratio - 47820 / 15120) < 0.05, `drawn ${ratio.toFixed(2)} times as long`);
    everyMarkTitled(svg, 'bl-s-');
  }
});

test('stackBars: a row\'s label on the left and its total on the right, a part the same colour in every row, and round ticks', () => {
  const svg = svgs(stackBars(SLOW, { label: 'x' }))[0];
  for (const t of ['#161 Moss waves back', '13 h 17 min', '4 h 12 min', 'a1b2c3d direct push']) assert.match(svg, new RegExp(`>${t}</text>`));
  const cls = name => new Set(segments(svg).filter(s => s.title.includes(`${name}:`)).map(s => s.cls));
  for (const name of ['Gate', 'Merge wait', 'To live']) assert.equal(cls(name).size, 1, `${name} keeps one colour`);
  const ticks = [...svg.matchAll(/<text [^>]*class="bl-axis"[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
  assert.deepEqual(ticks, ['0', '5 h', '10 h', '15 h']);
});

test('stackBars: each key entry wears the colour its part wears in the bars, as the caller set it', () => {
  const cls = { Gate: 'mute', 'Merge wait': 'now', 'To live': 'mute2' };
  const rows = SLOW.map(r => ({ ...r, parts: r.parts.map(p => ({ ...p, cls: cls[p.label] })) }));
  const html = stackBars(rows, { label: 'x' }), svg = svgs(html)[0];
  for (const [name, c] of Object.entries(cls)) {
    assert.match(html, new RegExp(`<span><i class="bl-s-${c}"></i>${name}</span>`), `${name} in the key`);
    assert.deepEqual([...new Set(segments(svg).filter(s => s.title.includes(`${name}:`)).map(s => s.cls))], [c], `${name} in the bars`);
  }
});

test('stackBars: max sets the axis, a row with a link opens it from outside the image, and a part shows its tooltip', () => {
  const html = stackBars(SLOW, { label: 'x', max: 2 * 47820 });
  const svg = svgs(html)[0];
  assert.ok(rowWidth(svg, '#161') < 640 * 0.55, 'half the axis when max is twice the longest');
  assert.equal(linksOutsideSvg(wide(html)), 1);
  assert.match(wide(html), /<a href="https:\/\/github\.com\/x\/pull\/161"/);
  assert.ok(tips(html).includes('#161 Moss waves back · Merge wait: 13 h 6 min'));
});

test('stackBars: a row\'s whole label sits above its bar across the row, on up to 2 lines, and is never cut while it fits', () => {
  // 51 characters: one line on a desktop, two on a phone
  const title = '#171 The hunter judges the Long set by its walk job';
  const html = stackBars([{ ...SLOW[0], label: title }, SLOW[1]], { label: 'x' });
  for (const svg of svgs(html)) {
    const lines = [...svg.matchAll(/<text [^>]*class="bl-rowlabel"[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
    assert.equal(lines.slice(0, -1).join(' '), title, 'the whole title, word for word');
    assert.ok(lines.length - 1 <= 2, `${lines.length - 1} lines`);
    assert.equal(lines.at(-1), '#140 Shop sells hats');
    const W = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]), size = W === 360 ? 15 : 11;
    for (const l of lines) assert.ok(l.length * size * 0.58 <= W - 8, `"${l}" fits the row`);
  }
  const long = stackBars([{ ...SLOW[0], label: `${title} ${title} ${title}` }], { label: 'x' });
  const cut = [...svgs(narrow(long))[0].matchAll(/class="bl-rowlabel"[^>]*>([^<]*)</g)].map(m => m[1]);
  assert.equal(cut.length, 2);
  assert.match(cut[1], /…$/, 'past 2 lines it ends in an ellipsis');
});

test('stackBars: no rows, or one with no parts, draws no NaN', () => {
  isImage(stackBars([], { label: 'None' }), 'None');
  isImage(stackBars([SLOW[2]], { label: 'A push' }), 'A push');
});

// A week of deploys, one of which went red after going live and was green again 16 minutes later.
const T0 = Date.parse('2026-09-30T04:00:00Z'), H = 3600000;
const DEPLOYS = [
  { at: T0 + 10 * H, title: '30 Sept 14:00 · a1b2c3d' }, { at: T0 + 30 * H, title: '1 Oct 10:00 · b61152e · failed', failed: true, recovered: T0 + 30 * H + 16 * 60000 },
  { at: T0 + 50 * H, title: 'c3d4e5f' }, { at: new Date(T0 + 90 * H).toISOString(), title: 'd4e5f6a' }, { at: T0 + 150 * H, title: 'e5f6a7b' },
];

test('strip: a grey tick for every deploy, a failure in the status colour with a "!" and a bar to its recovery, each with its tooltip', () => {
  const html = strip(DEPLOYS, { label: '5 deploys, 30 Sept – 6 Oct, 1 failed', from: T0, to: T0 + 7 * 24 * H });
  isImage(html, '5 deploys, 30 Sept – 6 Oct, 1 failed');
  for (const svg of svgs(html)) {
    assert.equal(count(/<line [^>]*class="bl-tick bl-s-before"/g, svg), 4);
    assert.equal(count(/<line [^>]*class="bl-tick bl-s-fail"/g, svg), 1);
    assert.equal(count(/>!<\/text>/g, svg), 1, 'failure never rests on colour alone');
    assert.equal(count(/<rect [^>]*class="bl-recover bl-s-fail"/g, svg), 1);
    everyMarkTitled(svg, 'bl-tick');
    everyMarkTitled(svg, 'bl-recover');
    assert.doesNotMatch(svg, /<a /);
  }
  assert.ok(tips(html).includes('1 Oct 10:00 · b61152e · failed · green in 16 min'));
  assert.match(html, /<div class="bl-legend">.*Deploy.*Failed.*Until green/);
});

test('strip: the recovery bar runs from the failure to the moment it was green again, and no deploys, or one, draws no NaN', () => {
  const svg = svgs(strip(DEPLOYS, { label: 'x', from: T0, to: T0 + 7 * 24 * H }))[0];
  const fail = Number(/<line x1="([\d.]+)"[^>]*class="bl-tick bl-s-fail"/.exec(svg)[1]);
  const bar = /<rect x="([\d.]+)" [^>]*width="([\d.]+)"[^>]*class="bl-recover/.exec(svg);
  assert.equal(Number(bar[1]), fail);
  assert.ok(Number(bar[2]) >= 2, 'a short recovery stays visible');
  isImage(strip([], { label: 'No deploys' }), 'No deploys');
  isImage(strip([DEPLOYS[1]], { label: 'One deploy' }), 'One deploy');
});

test('strip, compact: one small strip for a headline tile, ticks and the red mark with its "!", and no key or dates', () => {
  const html = strip(DEPLOYS, { label: '5 deploys, 1 failed', from: T0, to: T0 + 7 * 24 * H, compact: true });
  isImage(html, '5 deploys, 1 failed');
  assert.equal(svgs(html).length, 1);
  const svg = svgs(html)[0];
  assert.match(svg, /viewBox="0 0 \d+ 40"/, 'about 40 px tall');
  assert.equal(count(/class="bl-tick bl-s-before"/g, svg), 4);
  assert.equal(count(/class="bl-tick bl-s-fail"/g, svg), 1);
  assert.equal(count(/>!</g, html), 1, 'the failure keeps its "!"');
  assert.doesNotMatch(html, /bl-legend|bl-chart-narrow/);
  assert.doesNotMatch(svg, /<text /, 'no dates or labels');
  isImage(strip([], { label: 'None', compact: true }), 'None');
});

// The tooltip script's own arithmetic: which mark the pointer means, and where the tooltip goes.
const box = (el, left, top, right, bottom) => ({ el, left, top, right, bottom });

test('tooltip: the pointer means the mark it is on, the smallest when marks nest, or the nearest within reach', () => {
  const column = box('column', 100, 0, 140, 200), dot = box('dot', 116, 96, 124, 104), far = box('far', 300, 50, 308, 58);
  assert.equal(nearest([column, dot, far], 120, 100), 'dot', 'a dot inside a day column wins');
  assert.equal(nearest([column, dot, far], 105, 20), 'column');
  assert.equal(nearest([dot, far], 130, 100), 'dot', '6 px away is within reach');
  assert.equal(nearest([dot, far], 200, 100), null, 'too far from every mark');
  assert.equal(nearest([], 0, 0), null);
});

test('tooltip: it sits above the pointer, inside the window, and below it when there is no room above', () => {
  assert.deepEqual(place(100, 30, 500, 300, 1440, 900), { left: 450, top: 258 });
  assert.equal(place(100, 30, 20, 300, 390, 844).left, 8, 'kept off the left edge');
  assert.equal(place(100, 30, 385, 300, 390, 844).left, 282, 'and the right');
  assert.equal(place(100, 30, 200, 20, 390, 844).top, 36, 'below the pointer near the top');
});

test('tooltip: a first tap on a chart shows the tooltip, even after the tap focused the day\'s link, and a second tap on the same mark follows the link', () => {
  assert.equal(tapStep(null, 'col', true), 'show');
  assert.equal(tapStep('col', 'col', true), 'follow');
  assert.equal(tapStep('col', 'next col', true), 'show');
  assert.equal(tapStep('dot', 'dot', false), 'show', 'with no link under it, a tap only shows');
  assert.equal(tapStep('col', null, false), 'hide', 'a tap away from every mark hides it');
});

test('layout loads the scripts a page asks for, and no others', () => {
  const page = scripts => layout({ title: 'Delivery', active: 'delivery', body: '<p>x</p>', scripts });
  assert.match(page(['/hq/hq-charts.js']), /<script src="\/hq\/hq-charts\.js" defer><\/script>/);
  assert.doesNotMatch(page(undefined), /hq-charts\.js/);
});

// Noor's review of the Problems prototype, finding 2: a chart's values sat in titles and data-tip only, which a screen
// reader never reaches. numbers() is the same values as a table behind a disclosure, which a page puts under a chart.
test("numbers() gives a chart's values as a table a screen reader reaches, behind a disclosure", () => {
  const t = numbers({ caption: 'Gate reds per 100 gate runs', head: ['Week of', 'real break', 'flaky'], rows: [['5 Oct', 3, 1.5], ['12 Oct', null, 0]] });
  assert.match(t, /^<details class="bl-numbers"><summary>The numbers<\/summary><table class="hq-table">/);
  assert.match(t, /<caption>Gate reds per 100 gate runs<\/caption>/);
  assert.match(t, /<th scope="col">real break<\/th>/);
  assert.match(t, /<tr><th scope="row">5 Oct<\/th><td class="num">3<\/td><td class="num">1.5<\/td><\/tr>/);
  assert.match(t, /<th scope="row">12 Oct<\/th><td class="num">–<\/td>/, 'a missing value says so');
  assert.match(numbers({ head: ['a'], rows: [['<b>']] }), /&lt;b&gt;/);
});
