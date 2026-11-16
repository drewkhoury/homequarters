// The Delivery page: how fast and how safely changes reach users, from hq dora's ~/.cache/questkeep/dora/dora.json
// (hq/dora.mjs works it out; hq/lib/dora.mjs says what each figure means). It reads as a product, top to bottom: a
// header with the repo and the period, four figures (Deploys and Lead time for speed, Failed deploys and Rework for
// stability), the pull requests waiting on the reader, then one full-width section per figure with its chart, the
// pipeline, and one closed drawer, Method, that holds the definitions and QuestKeep's own plumbing. Every string
// follows the copy sheet: labels are nouns, numbers are exact, and a caveat is said once. No list on the page runs past
// 5 rows: ?list=deploys|changes|failures|reds[&day=yyyy-mm-dd] is the drill-down that holds each full list, and each
// day on a chart links to it.
// When the file is older than STALE_MIN, or on Refresh, the page starts hq/dora.mjs in the background (no git fetch:
// HQ never fetches on its own), answers at once with the figures it has and says it is updating. It writes dora.json
// only: the dated copies are the nightly's and hq dora's, which fetch main first. With no file at all it waits for
// Refresh, so a test or the demo never starts a fetch.
import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, layout } from '../lib/page.mjs';
import { info, dataTable } from '../lib/ui.mjs';
import { dayKey, dayStart, addDays, VERSION, projectNotes, countingSettings, BLIND_SPOTS } from '../lib/dora.mjs';
import { dayChart, hbars, spark, dotPlot, partsBar, stackBars, strip, duration as dur } from '../lib/charts.mjs';

// the project's figures block: project since version 4, questkeep in files written before
const proj = w => w.project || w.questkeep;
export const STALE_MIN = 30;
// when this HQ applied its manifest: figures counted by other settings and written before then are refreshed once
const STARTED = Date.now();
// the zone's name as the period line gives it: New York time, UTC
const zoneName = tz => (!tz || /^(Etc\/)?(UTC|GMT)$/.test(tz) ? 'UTC' : `${tz.split('/').pop().replace(/_/g, ' ')} time`);
// With about 4 deploys a day, one day is noise, so the shortest period is a week
const RANGES = [['7d', '7 days'], ['30d', '30 days']];
const LISTS = { deploys: 'Deploys', changes: 'Changes', failures: 'Failed deploys', reds: 'Red attempts' };
// A figure on fewer values than this carries a dotted count: one more value could move it a long way
const SMALL = 10;
// Lists on the page stop here; the drill-down holds the rest
const SHOWN = 5;
const MARK = '<span class="hq-mark bad" aria-label="Failed">!</span>';
const SMALL_TIP = 'Fewer than 10: one more could move this a lot';
// What each figure counts, said once: in its ⓘ and again under Method
const DEFINE = {
  deploys: 'Deploys that changed what users get: the app\'s files, rules or indexes. Same-app redeploys aren\'t counted.',
  lead: 'From a pull request\'s last push, or a direct push to main, to live.',
  failed: 'A deploy fails when its live check, or the deploy job after sending, goes red.',
  green: 'From a failed deploy going live to the next deploy whose live check passed.',
  live: 'After each deploy a browser opens the live site. A follow-up is the first later commit that names the failed run.',
  gate: 'The tests every pull request runs before it can merge.',
  reds: 'Red gate attempts out of every attempt that finished. A run that went red and was run again counts its red attempt, though it ended green.',
  flake: 'A test that passed and failed on the same commit. "By the rerun": found when a red gate reran its failing tests.',
  waiting: 'Open pull requests, oldest first. One whose title matches a merged pull request is probably stale.',
};

// One refresh at a time, whoever asks. Nothing waits for it: a page shows what is on disk and says it is updating.
let running = null, lastError = null;
export function refresh(ctx, run = execFile) {
  if (!running) {
    running = new Promise(res => run(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'dora.mjs'), '--no-fetch-git', '--no-daily', '--quiet'],
      { cwd: ctx.repo, env: { ...process.env, HQ_CACHE: ctx.cache }, timeout: 5 * 60000 }, err => res(err ? String(err.message).split('\n')[0] : null)))
      .then(err => { lastError = err; return err; })
      .finally(() => { running = null; });
  }
  return running;
}

export function readDora(cache) {
  const f = join(cache, 'dora', 'dora.json');
  try { return { data: JSON.parse(readFileSync(f, 'utf8')), at: statSync(f).mtimeMs }; } catch { return { data: null, at: null }; }
}

// ---- Formatting: one way to write each kind of value ----

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
// a rate a day: one decimal under 10, whole numbers from 10
const rate = r => (r >= 10 ? String(Math.round(r)) : String(Math.round(r * 10) / 10));
const pct = r => `${Math.round(r * 100)}%`;
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
const dayName = key => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const span = (a, b) => (a === b ? dayName(a) : `${dayName(a)} – ${dayName(b)}`);
// a time on the page's clock, the zone its days are cut in: 30 Sept 04:52
const when = (iso, tz) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.hour}:${p.minute}`;
};
const at = (iso, tz) => ({ html: iso ? esc(when(iso, tz)) : '<span class="hint">–</span>', v: iso || '' });
const ago = (ms, now) => { const m = Math.round((now - ms) / 60000); return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 2160 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const short = sha => esc(String(sha || '').slice(0, 7));
const link = (url, text, cls = '') => url ? `<a href="${esc(url)}"${cls ? ` class="${cls}"` : ''} target="_blank" rel="noopener">${text}</a>` : text;
const tag = (text, kind = 'neutral', title = '') => `<span class="tag tag-${kind}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2)) : null; };
// a count, with a dotted underline and its reason when it is small
const counted = (n, one, many) => (n < SMALL ? `<span class="dv-n" title="${SMALL_TIP}">${esc(plural(n, one, many))}</span>` : esc(plural(n, one, many)));
const commitUrl = (runUrl, sha) => runUrl ? runUrl.replace(/\/actions\/runs\/.*$/, `/commit/${sha}`) : null;
const href = (range, list, day) => `/delivery?range=${range}&amp;list=${list}${day ? `&amp;day=${day}` : ''}`;
// the same link unescaped, for the charts, which escape what they are given
const rawHref = (...a) => href(...a).replace(/&amp;/g, '&');
const RUNNER = { hosted: 'GitHub', laptop: 'Laptop' };
const CAUSE = { test: 'Test', infra: 'Machine', filing: 'Machine', experiment: 'Experiment' };
// Red attempts with a failing test first, then the machine, then experiments, each newest first
const CAUSE_ORDER = ['test', 'infra', 'filing', 'experiment'];
const byCause = reds => [...reds].sort((x, y) => CAUSE_ORDER.indexOf(x.cause) - CAUSE_ORDER.indexOf(y.cause) || (x.at < y.at ? 1 : -1));
const inWindow = (iso, w) => iso && iso >= w.from && iso < w.to;
// the day of the project's note whose since key names one of Delivery's dates (hq.json, delivery.countingChanges)
const sinceDate = (f, key) => f.countingChanges.find(c => c.since === key)?.date || null;

// ---- The period and its record ----

// The days a period's charts and sparklines draw: from the record's first day, so no width goes on days with nothing
// to count, and none at all for a period the record does not reach
function daysOf(f, from, to, recordFrom) {
  if (!recordFrom) return [];
  const first = dayKey(Math.max(Date.parse(from), Date.parse(recordFrom)), f.tz), last = dayKey(Date.parse(to) - 1, f.tz), out = [];
  for (let k = first; k <= last; k = addDays(k, 1)) out.push(k);
  return out;
}
function period(f, w) {
  const now = daysOf(f, w.from, w.to, w.recordFrom), before = daysOf(f, w.prev.from, w.prev.to, w.prev.recordFrom);
  const by = new Map(f.series.days.map(d => [d.day, d]));
  // the record's first day, when it falls inside the period before, is said once in the period bar; when it falls
  // inside this one, the range starts there and the bar says there is no earlier data
  const starts = w.prev.recordFrom && w.prev.recordFrom > w.prev.from ? w.prev.recordFrom : null;
  return { now, before, by, range: now.length ? span(now[0], now.at(-1)) : span(dayKey(Date.parse(w.from), f.tz), dayKey(Date.parse(w.to) - 1, f.tz)),
    recordFrom: starts ? dayKey(Date.parse(starts), f.tz) : null, prior: `Prior ${w.days} days` };
}

// ---- The four figures ----

// A comparison chip, only when dora.json says the comparison is fair: an arrow for the direction, green when it went
// the good way, and the prior figure in words
function chip(c, better, words, grey = '') {
  if (c && !c.ok && grey && c.reason !== 'No earlier data') return `<span class="dv-chip same" title="${esc(c.reason)}">${esc(grey)}</span>`;
  if (!c || !c.ok) return '';
  const up = c.now > c.before, same = c.now === c.before, good = same ? 'same' : up === (better === 'up') ? 'good' : 'bad';
  return `<span class="dv-chip ${good}" title="${esc(words)}">${same ? '=' : up ? '▲' : '▼'} ${esc(words)}</span>`;
}

// Each figure: its group, label, ⓘ, value, one line of detail, the comparison chip and a sparkline across the period
// before and this one.
function figures(f, w, p) {
  const P = w.portable, PP = w.prev.portable, days = [...p.before, ...p.now];
  const trend = (get, what, fmt = v => String(v)) => {
    const values = days.map(k => { const d = p.by.get(k); return d ? get(d, k) : null; }), last = values.findLastIndex(v => v != null);
    return spark(values, { before: p.before.length, label: `${what} per day, ${days.length ? span(days[0], days.at(-1)) : p.range}${last >= 0 ? `; ${fmt(values[last])} on ${dayName(days[last])}` : ''}`,
      title: (v, i) => `${dayName(days[i])}: ${fmt(v)}`, beforeName: p.prior, nowName: p.range });
  };
  const d = P.deploys, dc = d.compare;
  const deploys = { id: 'deploys', group: 'speed', label: 'Deploys', about: DEFINE.deploys, value: String(d.n),
    sub: d.n ? `${rate(dc?.now ?? d.perDay)} a day` : '', chip: chip(dc, 'up', `${p.prior}: ${rate(dc?.before ?? 0)} a day`, `${rate(dc?.before ?? 0)} a day in the ${lower(p.prior)}`),
    spark: trend(x => x.deploys.player, 'Deploys') };

  const l = P.leadTime;
  const lead = { id: 'lead', group: 'speed', label: 'Lead time', about: DEFINE.lead, value: l.n ? dur(l.median) : '–', unit: l.n > 1 ? 'median' : '',
    sub: !l.n ? 'No changes went live' : l.n < SMALL ? counted(l.n, 'change') : `p90 ${esc(dur(l.p90))} · ${esc(plural(l.n, 'change'))}`,
    chip: chip(l.compare, 'down', `${p.prior}: ${dur(l.compare?.before)}`, l.compare?.before != null ? `${dur(l.compare.before)} in the ${lower(p.prior)}` : ''), spark: trend(x => x.leadSec.median, 'Median lead time', dur) };

  const fd = P.failedDeploys, rec = P.recovery.items, done = rec.filter(r => r.sec != null), open = rec.length - done.length;
  const failed = { id: 'failed', group: 'stability', label: 'Failed deploys', about: DEFINE.failed, red: open > 0,
    value: fd.of ? `${open ? `${MARK} ` : ''}${fd.n} of ${fd.of < SMALL ? `<span class="dv-n" title="${SMALL_TIP}">${fd.of}</span>` : fd.of}` : '–', html: true,
    sub: !fd.of ? 'No deploys' : '',
    chip: chip(fd.compare, 'down', `${p.prior}: ${PP.failedDeploys.n} of ${PP.failedDeploys.of}`, `${PP.failedDeploys.n} of ${PP.failedDeploys.of} in the ${lower(p.prior)}`),
    spark: trend(x => x.failed, 'Failed deploys') };

  // Time to green rests on a handful of events at most, so it is never compared; its chart is the period's deploys
  // with each red and the time until the next green one
  const m = median(done.map(r => r.sec)), prevDone = PP.recovery.items.filter(r => r.sec != null);
  const green = { id: 'green', group: 'stability', label: 'Time to green', about: DEFINE.green, red: open > 0, html: true,
    value: !rec.length ? '–' : !done.length ? `${MARK} Red now` : esc(dur(m)), unit: done.length > 1 ? 'median' : '',
    sub: !rec.length ? 'Nothing went red' : !done.length ? esc(`${open} waiting for a passing deploy`) : `${counted(rec.length, 'red')}${open ? ` · ${MARK} ${open} still red` : ''}`,
    chip: w.prev.recordFrom ? `<span class="dv-chip same" title="Too few to compare">${esc(`${p.prior}: ${prevDone.length ? dur(median(prevDone.map(r => r.sec))) : 'none red'}`)}</span>` : '',
    spark: liveStrip(f, w, p, { compact: true }) };
  return [deploys, lead, failed, green];
}

function hero(list) {
  const tile = a => `<div class="dv-tile" data-id="${a.id}"><div class="dv-tile-head"><span class="dv-label">${esc(a.label)}</span> ${info(a.about, `About ${a.label}`)}</div>
    <div class="dv-figure"><span class="dv-value${a.red ? ' dv-red' : ''}">${a.html ? a.value : esc(a.value)}</span>${a.unit ? ` <span class="dv-unit">${esc(a.unit)}</span>` : ''}</div>
    <div class="dv-sub">${a.sub || ''}</div>${a.chip ? `<div class="dv-cmp">${a.chip}</div>` : ''}${a.spark ? `<div class="dv-spark">${a.spark}</div>` : ''}</div><!--/tile-->`;
  const group = (id, title) => `<section class="dv-group" aria-labelledby="dv-g-${id}"><h2 id="dv-g-${id}">${title}</h2><div class="dv-tiles">${list.filter(a => a.group === id).map(tile).join('')}</div></section>`;
  return `<div class="dv-hero" id="dv-figures">${group('speed', 'Speed')}${group('stability', 'Stability')}</div>`;
}

// ---- The sections ----

const section = (id, title, inner, { about, aside = '', count = '' } = {}) => `<section class="dv-sec" id="${id}" aria-labelledby="${id}-h"><div class="dv-sec-head"><h2 id="${id}-h">${esc(title)}</h2>${count ? `<span class="dv-count">${count}</span>` : ''}${about ? info(about, `About ${title}`) : ''}${aside}</div>${inner}</section>`;
const more = (url, text) => `<a class="dv-more" href="${url}">${esc(text)} →</a>`;

function waitingSection(f, now) {
  const list = f.waiting || [];
  // the age hq dora measured, plus the time since it measured it
  const since = Math.max(0, (now - Date.parse(f.generatedAt)) / 1000);
  const checks = c => (c === 'pass' ? tag('Checks passed', 'good') : c === 'fail' ? `${MARK} ${tag('Checks failed', 'bad')}` : c === 'pending' ? tag('Checks running') : tag('No checks'));
  const row = x => `<li>${link(x.url, `#${x.pr}`)} <span class="dv-title">${esc(x.title)}</span> <span class="dv-age">${esc(dur(x.ageSec + since))}</span> ${checks(x.checks)}${x.stale ? ` ${tag('Probably stale', 'neutral', `#${x.stale.pr} merged with the same title`)}` : ''}</li>`;
  const all = list.length > SHOWN && list[0].url ? `<a class="dv-more" href="${esc(list[0].url.replace(/\/pull\/\d+$/, '/pulls'))}" target="_blank" rel="noopener">All ${list.length} open on GitHub →</a>` : '';
  return section('dv-waiting', 'Waiting on you', list.length ? `<ul class="dv-rows">${list.slice(0, SHOWN).map(row).join('')}</ul>${all}` : '<p class="dv-empty">Nothing waiting on you</p>',
    { about: DEFINE.waiting, count: list.length ? String(list.length) : '' });
}

function deploysSection(f, w, range, p) {
  const P = w.portable, rows = p.now.map(k => ({ day: k, player: p.by.get(k)?.deploys.player ?? 0 }));
  const before = p.before.length ? p.before.map(k => ({ day: k, player: p.by.get(k)?.deploys.player ?? 0 })) : undefined;
  const busiest = rows.reduce((b, r) => (!b || r.player > b.player ? r : b), null);
  // the days the project's notes mark (hq.json's delivery.countingChanges[].mark)
  const marks = f.countingChanges.filter(c => c.mark).map(c => ({ day: c.date, label: c.mark })).filter(m => rows.some(r => r.day === m.day));
  const label = P.deploys.n ? `Deploys per day, ${p.range}: ${P.deploys.n}${busiest?.player ? `, busiest ${dayName(busiest.day)} with ${busiest.player}` : ''}.${before ? ` ${p.prior}: ${w.prev.portable.deploys.n}.` : ''}` : `Deploys per day, ${p.range}: none.`;
  const chart = dayChart(rows, [{ key: 'player', label: 'deploys', cls: 'now', bar: true }], { label, before, beforeLabel: p.prior, marks, href: day => rawHref(range, 'deploys', day), narrow: true });
  const unknown = P.deploys.unknown ? `<p class="hint">${P.deploys.unknown === 1 ? '1 unclassified deploy' : `${P.deploys.unknown} unclassified deploys`} not shown</p>` : '';
  const latest = f.items.deploys.filter(d => inWindow(d.liveAt, w) && d.playerFacing === true).slice(-SHOWN).reverse();
  const rows2 = latest.length ? `<h3>Latest deploys</h3><ul class="dv-rows">${latest.map(d => `<li><span>${esc(when(d.liveAt, f.tz))}</span> ${link(d.url, short(d.sha))} ${d.smoke === 'failure' ? `${MARK} ${tag('Failed', 'bad')}` : d.smoke === 'success' ? tag('Passed', 'good') : ''}</li>`).join('')}</ul>` : '';
  return section('dv-deploys', 'Deploys per day', `<div class="dv-split"><div>${chart}${unknown}</div><div>${rows2}${P.deploys.n ? more(href(range, 'deploys'), P.deploys.n === 1 ? '1 deploy' : `All ${P.deploys.n} deploys`) : ''}</div></div>`);
}

const STAGE = { queue: 'Queue', slot: 'Queue', gate: 'Gate', mergeWait: 'Merge wait', toLive: 'To live', reruns: 'Re-runs' };
const STAGE_ORDER = ['Queue', 'Gate', 'Merge wait', 'To live', 'Re-runs'];
const partsOf = x => [
  { label: 'Queue', v: (x.runnerWaitSec || 0) + (x.slotWaitSec || 0) }, { label: 'Gate', v: x.gateSec || 0 }, { label: 'Merge wait', v: x.greenToMergeSec || 0 },
  { label: 'To live', v: x.mergeToLiveSec || 0 }, { label: 'Re-runs', v: x.otherSec || 0 },
];

function leadSection(f, w, range, p) {
  const l = w.portable.leadTime, q = proj(w);
  const points = f.items.changes.filter(c => inWindow(c.liveAt, w) && c.totalSec != null)
    .map(c => ({ day: dayKey(Date.parse(c.liveAt), f.tz), v: c.totalSec, title: `${c.pr ? `#${c.pr}` : short(c.sha)} ${c.title || ''}: ${dur(c.totalSec)}` }));
  const weekly = (w.leadBand || []).some(b => b.days > 1);
  const label = l.n ? `Lead time per change, ${p.range}: median ${dur(l.median)}${l.p90 != null ? `, p90 ${dur(l.p90)}` : ''}, ${plural(l.n, 'change')}.` : `Lead time per change, ${p.range}: none.`;
  // a week's median and p90 lie across each of its days, so the line steps a week at a time
  const band = (w.leadBand || []).filter(b => b.median != null).flatMap(b => Array.from({ length: b.days || 1 }, (_, i) => ({ day: addDays(b.day, i), median: b.median, p90: b.p90 })));
  const chart = dotPlot(points, { label, days: p.now, band,
    ref: l.n ? { v: l.median, label: `Median ${dur(l.median)}` } : null, dayHref: day => rawHref(range, 'changes', day), names: { median: weekly ? 'Weekly median' : 'Daily median', p90: 'p90' } });

  // where the period's hours went, by stage, with the wait to merge drawn in the accent
  const hours = new Map();
  for (const s of w.stageShare || []) hours.set(STAGE[s.stage], (hours.get(STAGE[s.stage]) || 0) + (s.sec || 0));
  const total = [...hours.values()].reduce((a, b) => a + b, 0);
  const stages = total ? `<h3>Lead time by stage</h3>${partsBar(STAGE_ORDER.map(k => ({ label: k, v: hours.get(k) || 0 })), { focus: 'Merge wait', share: true,
    label: `Lead time by stage, ${p.range}: ${STAGE_ORDER.filter(k => hours.get(k)).map(k => `${lower(k)} ${pct(hours.get(k) / total)}`).join(', ')}.` })}` : '';

  const t = q.typical, runner = t && f.items.changes.find(c => c.sha === t.sha)?.runner;
  const name = c => (c.pr ? `#${c.pr}` : short(c.sha || f.items.changes.find(x => x.url === c.url)?.sha));
  const typical = t && t.split ? `<div class="dv-median"><span class="dv-median-k">Median change</span> ${link(t.url, name(t))} ${runner ? `<span>${RUNNER[runner]}</span> ` : ''}<b>${esc(dur(t.totalSec))}</b></div>` +
    partsBar(partsOf(t.split).filter(x => x.v / t.totalSec >= 0.02), { focus: 'Merge wait', label: `${name(t)}, the median change: ${dur(t.totalSec)}. ${partsOf(t.split).filter(x => x.v).map(x => `${x.label} ${dur(x.v)}`).join(', ')}.` }) : '';

  const slow = q.slowest || [], prs = slow.filter(c => c.split && c.split.greenToMergeSec != null);
  const sum = (xs, get) => xs.reduce((a, c) => a + get(c), 0), waited = sum(prs, c => c.split.greenToMergeSec);
  const slowSay = prs.length ? `${slow.length} slowest: ${dur(waited)} of ${dur(sum(slow, c => c.totalSec))} waiting to merge` : '';
  const PARTS = [['Gate', 'gateSec', 'mute'], ['Merge wait', 'greenToMergeSec', 'now'], ['To live', 'mergeToLiveSec', 'mute2']];
  const bars = slow.length ? stackBars(slow.map(c => ({ label: `${name(c)} ${c.title || ''}`, total: c.totalSec, href: c.url,
    parts: c.split ? PARTS.map(([label, k, cls]) => ({ label, v: c.split[k] || 0, cls })) : [],
    tip: `${name(c)}: ${dur(c.totalSec)}.${c.split ? ` ${PARTS.map(([label, k]) => `${label} ${dur(c.split[k] || 0)}`).join(', ')}.` : ' Direct push · no breakdown'}` })),
  { label: `Slowest changes, ${p.range}: ${slow.map(c => `${name(c)} ${dur(c.totalSec)}`).join(', ')}.` }) : '';
  const n = f.items.changes.filter(c => inWindow(c.liveAt, w)).length;
  const slowest = slow.length ? `<h3>Slowest</h3>${slowSay ? `<p class="dv-say">${esc(slowSay)}</p>` : ''}${bars}` : '';
  return section('dv-lead', 'Lead time by change', `<div class="dv-split"><div>${chart}${slowest}</div><div>${stages.replace('<h3>', '<h3 class="dv-first">')}${typical}${n ? more(href(range, 'changes'), n === 1 ? '1 change' : `All ${n} changes`) : ''}</div></div>`);
}

const failedIn = (f, w) => f.items.failures.filter(x => inWindow(x.at, w) && x.released && x.playerFacing === true);
const recoveryOf = (f, run) => f.items.recoveries.find(r => r.failedRun === run);

// The period's deploys along a line of time, each failed one marked, with a bar until the next green one
function liveStrip(f, w, p, opts = {}) {
  const tz = f.tz, failed = failedIn(f, w), reds = new Map(failed.map(x => [`${x.run}-${x.attempt}`, x]));
  const deploys = f.items.deploys.filter(d => inWindow(d.liveAt, w) && d.playerFacing === true);
  const events = deploys.map(d => {
    const x = reds.get(`${d.run}-${d.attempt}`), r = x && recoveryOf(f, x.run);
    return { at: d.liveAt, title: `${when(d.liveAt, tz)} · ${short(d.sha)}${x ? ' · failed' : ''}`, failed: !!x, recovered: r && r.restoredAt };
  });
  const first = failed[0], r0 = first && recoveryOf(f, first.run), firstDay = first && dayName(dayKey(Date.parse(first.at), tz));
  const label = `${plural(deploys.length, 'deploy')}, ${p.range}, ${!failed.length ? 'none failed.' : failed.length === 1 ? `1 failed: ${firstDay}${r0?.sec != null ? `, green in ${dur(r0.sec)}` : ''}.` : `${failed.length} failed, the first on ${firstDay}.`}`;
  return strip(events, { label, from: p.now[0] ? dayStart(p.now[0], tz) : Date.parse(w.from), to: w.to, ...opts });
}

function liveSection(f, w, range, p) {
  const P = w.portable, tz = f.tz, failed = failedIn(f, w), recOf = run => recoveryOf(f, run);
  const row = x => {
    const r = recOf(x.run), e = x.explainedBy;
    return `<li>${MARK} <span>${esc(when(x.at, tz))}</span> · ${link(x.url, short(x.sha))} · <span>${x.kind === 'smoke' ? 'Live check' : 'Deploy job'}</span>` +
      `${r ? ` · <span>${r.sec != null ? `green in ${esc(dur(r.sec))}` : 'still red'}</span>` : ''}` +
      ` <span class="dv-follow">${e ? `Follow-up ${link(commitUrl(x.url, e.sha), short(e.sha))} · ${esc(e.subject)}` : 'No follow-up yet'}</span></li>`;
  };
  const rows = failed.length ? `<ul class="dv-rows dv-fails">${failed.slice(0, 3).map(row).join('')}</ul>${failed.length > 3 ? more(href(range, 'failures'), `All ${failed.length} failed deploys`) : ''}` : '';
  const apart = P.failedDeploys.apart ? `<p class="hint">+${P.failedDeploys.apart} ${P.failedDeploys.apart === 1 ? 'failure after a same-app redeploy' : 'failures after same-app redeploys'}, not counted</p>` : '';
  const rw = P.rework;
  const bugs = rw.status === 'none' ? 'No fix commits' : rw.status === 'untagged' ? `None tagged yet (0 of ${plural(rw.fixes, 'fix', 'fixes')})`
    : `${rw.n} · ${rw.tagged < SMALL ? `<span class="dv-n" title="${SMALL_TIP}">${rw.tagged}</span>` : rw.tagged} of ${rw.fixes} fixes tagged`;
  return section('dv-live', 'Live checks', `<div class="dv-split"><div>${liveStrip(f, w, p)}</div><div>${rows || '<p class="dv-empty">No failed deploys</p>'}${apart}</div></div>
    <div class="dv-line"><span class="dv-line-k">Fixes to what users get</span>${info('fix: commits marked Player-facing: yes. Most are caught in review before release, so this counts fixes to the app, not bugs a player saw.', 'About fixes to what users get')}<span>${bugs}</span></div>`, { about: DEFINE.live });
}

function pipelineSection(f, w, range, p) {
  const c = proj(w).cost, pc = proj(w.prev).cost, tz = f.tz;
  const figure = (label, value, unit, sub, title = '') => `<div class="dv-stat"><span class="dv-stat-k"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span><div class="dv-figure"><span class="dv-value">${esc(value)}</span>${unit ? ` <span class="dv-unit">${esc(unit)}</span>` : ''}</div>${sub ? `<div class="dv-sub">${sub}</div>` : ''}</div>`;
  // gate time is a machine figure: given for the runner the period ended on, never compared across a change of runner
  let time;
  const move = sinceDate(f, 'laptop-gate');
  if (c.mixed) {
    const name = c.gateSecByRunner.laptop ? 'Laptop' : 'GitHub', s = c.gateSecByRunner.laptop || c.gateSecByRunner.hosted;
    time = figure('Gate time', dur(s.median), `median · ${name}`, `${counted(s.n, 'run')}${move && name === 'Laptop' ? `, Laptop since ${esc(dayName(move))}` : ''}`);
  } else if (c.gateSec) {
    const name = RUNNER[c.runners[0]] || '';
    const prior = pc.reason === 'different runner' ? `${p.prior} on ${name === 'Laptop' ? 'GitHub' : 'Laptop'}` : pc.reason || !pc.gateSec ? 'No earlier data' : `${p.prior}: ${dur(pc.gateSec.median)}`;
    time = figure('Gate time', dur(c.gateSec.median), `median · ${name}`, `${counted(c.gateSec.n, 'run')} · ${esc(prior)}`);
  } else time = figure('Gate time', '–', '', c.reason ? esc(c.reason.charAt(0).toUpperCase() + c.reason.slice(1)) : 'No gate runs');
  const pr = c.prReds || { n: 0, of: 0, cause: {} };
  const cause = { test: pr.cause.test || 0, machine: (pr.cause.infra || 0) + (pr.cause.filing || 0), experiment: pr.cause.experiment || 0 };
  const reds = figure('Red attempts', pr.of ? `${pr.n} of ${pr.of}` : '–', '', pr.of ? `Test ${cause.test} · <span title="A runner that never started, or a failed filing of the result">Machine ${cause.machine}</span> · Experiment ${cause.experiment}` : 'No gate runs', DEFINE.reds);
  const flake = figure('Flake rate', c.flakesPer100 == null ? '–' : String(c.flakesPer100), c.flakesPer100 == null ? '' : 'per 100 runs',
    c.flakesPer100 == null ? 'No runs recorded' : `${c.flakes ? `${plural(c.flakes, 'test')}${c.flakesByRerun ? `, ${c.flakesByRerun} by the rerun` : ''} · ` : ''}${plural(c.testRuns, 'run')}`, DEFINE.flake);

  const rows = p.now.map(k => { const r = p.by.get(k)?.gates.red || {}; return { day: k, test: r.test || 0, machine: (r.infra || 0) + (r.filing || 0), experiment: r.experiment || 0 }; });
  const chart = dayChart(rows, [
    { key: 'test', label: 'Test', cls: 'now', bar: true },
    { key: 'machine', label: 'Machine', cls: 'amber', bar: true },
    { key: 'experiment', label: 'Experiment', cls: 'ghost', bar: true },
  ], { label: pr.n ? `Red attempts per day, ${p.range}: ${pr.n}. Test ${cause.test}, machine ${cause.machine}, experiment ${cause.experiment}.` : `Red attempts per day, ${p.range}: none.`, href: day => rawHref(range, 'reds', day), narrow: true });

  const all = byCause(f.items.prReds.filter(r => inWindow(r.at, w))), shown = all.filter(r => r.cause !== 'experiment'), exp = all.length - shown.length;
  const causeTag = r => (r.cause === 'test' ? tag('Test', 'bad') : tag(CAUSE[r.cause] || r.cause));
  const latest = all.length ? `<h3>Latest red attempts</h3>${shown.length ? `<ul class="dv-rows">${shown.slice(0, SHOWN).map(r => `<li><span>${esc(when(r.at, tz))}</span> ${causeTag(r)} ${link(r.url, esc(r.branch), 'dv-title')}</li>`).join('')}</ul>` : ''}` +
    (exp ? `<p class="hint">${exp === 1 ? '1 experiment' : `${exp} experiments`} not shown</p>` : '') + (all.length > Math.min(SHOWN, shown.length) ? more(href(range, 'reds'), `All ${all.length} red attempts`) : '') : '';
  return section('dv-pipeline', 'Pipeline', `<div class="dv-stats">${time}${reds}${flake}</div><div class="dv-split"><div>${chart}</div><div>${latest.replace('<h3>Latest red attempts</h3>', '<h3 class="dv-first">Latest red attempts</h3>')}</div></div>`, { about: DEFINE.gate, aside: '<a class="dv-aside" href="/testing">Testing page →</a>' });
}

// ---- Method: definitions, counting changes, blind spots, sources and QuestKeep's own plumbing ----

function sourcesTable(sources, tz) {
  const label = { runs: 'Actions runs', logs: 'decide\'s logs', deployments: 'Production deployments', pulls: 'Pull requests', pullsOpen: 'Open pull requests', hostingReleases: 'Hosting releases', lockLog: 'Test slot log', testRuns: 'Recorded test runs', git: 'git' };
  const status = s => (s === 'read' ? tag('Read', 'good') : s === 'missing' ? tag('Missing', 'bad') : tag('Not collected'));
  return dataTable({ id: 'dv-sources', columns: [
    { key: 'source', label: 'Source', w: 'lg' }, { key: 'status', label: 'Status', w: 'sm' }, { key: 'held', label: 'Holds', wrap: true },
  ], rows: Object.entries(sources).map(([k, s]) => ({ cells: {
    source: `${esc(s.label || label[k] || 'Source')}${s.reason ? info(s.reason, `About ${s.label || label[k] || 'this source'}`) : ''}`,
    status: { html: status(s.status), f: s.status },
    held: esc([s.n != null ? `${s.n}${s.of != null ? ` of ${s.of}` : ''}` : '', s.through ? `through ${when(s.through, tz)}` : '', s.note || '', s.ref || '', s.coverageText || ''].filter(Boolean).join(' · ') || '–'),
  } })) });
}

function method(f, w, range) {
  const q = proj(w), c = q.cost, ls = q.leadSplit, tz = f.tz;
  const terms = [['Deploy', DEFINE.deploys], ['Lead time', DEFINE.lead], ['Failed deploy', DEFINE.failed], ['Time to green', DEFINE.green],
    ['Live check', DEFINE.live], ['Gate', DEFINE.gate], ['Red attempts', DEFINE.reds], ['Flake', DEFINE.flake]];
  const shifts = f.countingChanges.filter(x => x.date >= w.prev.from.slice(0, 10) && x.date < w.to.slice(0, 10));
  const pushes = hbars([{ label: 'Skipped', n: q.rows[5] }, { label: 'Reused gate', n: q.rows[6] }, { label: 'Ran gate', n: q.rows[7] }], `Pushes to main: ${q.rows[5]} skipped, ${q.rows[6]} reused a gate, ${q.rows[7]} ran the gate.`);
  const skipped = sinceDate(f, 'skipped-redeploys');
  const perRunner = k => ls.byRunner ? Object.entries(ls.byRunner).map(([r, v]) => `${RUNNER[r]} ${dur(v[k]?.median)}`).join(' · ') : ls[k] ? dur(ls[k].median) : '–';
  const sw = c.slotWait, delayed = f.items.changes.filter(x => inWindow(x.liveAt, w) && x.split?.slotWaitSec > 0).length;
  const slot = !sw || !sw.gates ? '' : sw.waited ? `Test slot waits: ${sw.waited} of ${sw.gates} Laptop runs${sw.sec ? ` · median ${dur(sw.sec.median)}` : ''} · ${delayed ? `${delayed} delayed a live change` : 'none delayed a live change'}` : `Test slot waits: 0 of ${sw.gates} Laptop runs`;
  const byRunner = c.gateSecByRunner || (c.gateSec ? { [c.runners[0]]: c.gateSec } : null);
  const gates = byRunner ? Object.entries(byRunner).map(([r, s]) => ({ label: RUNNER[r], n: s.median, text: dur(s.median) })) : [];
  const load = l => [l.pressure && `pressure ${l.pressure}`, l.load1 != null && `load ${l.load1}`, l.pagingMBps && `paging ${Math.round((l.pagingMBps.compressed || 0) + (l.pagingMBps.swapIn || 0))} MB/s`].filter(Boolean).join(' · ') || '–';
  const loaded = byCause(f.items.prReds.filter(r => inWindow(r.at, w) && r.runner === 'laptop' && r.load && r.cause !== 'experiment')).slice(0, SHOWN);
  const hints = [c.gateReused ? `Reused Laptop gates: ${c.gateReused}` : '', c.pipelineReds ? `Deploy jobs red before sending: ${c.pipelineReds}` : ''].filter(Boolean);
  return `<details class="dv-method" data-reference><summary><h2>Method</h2></summary><div class="dv-method-body">
    <h3>Definitions</h3><dl class="dv-terms">${terms.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <h3>Counting changes</h3><ul class="dv-notes">${shifts.map(x => `<li><b>${esc(dayName(x.date))}</b> ${esc(x.what)}</li>`).join('') || '<li class="hint">None in this period</li>'}</ul>
    ${f.blindSpots.length ? `<h3>Not counted</h3><ul class="dv-notes">${f.blindSpots.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    <h3>Sources</h3>${sourcesTable(f.sources, tz)}
    <h3>Pushes to main</h3>${info('Each Deploy run skips when live already serves its tree, reuses a gate that passed on that tree, or runs the gate.', 'About pushes to main')}
    ${pushes}<p class="hint">Same-app redeploys: ${q.identicalRedeploys}${skipped ? ` · skipped since ${esc(dayName(skipped))}` : ''}</p>
    <h3>Queue</h3><p>Runner wait, median: ${esc(perRunner('runnerWaitSec'))}</p>${slot ? `<p>${esc(slot)}</p>` : ''}
    <h3>Gate time by runner</h3>${info('Median for passing pull requests. GitHub ran the gate in two halves until 3 Oct; the Laptop runs it whole.', 'About gate time by runner')}
    ${gates.length ? hbars(gates, `Median gate time: ${gates.map(g => `${g.label} ${g.text}`).join(', ')}.`) : '<p class="hint">No passing gate runs</p>'}
    ${hints.map(h => `<p class="hint">${esc(h)}</p>`).join('')}
    <h3>Laptop red attempts and load</h3>
    ${loaded.length ? `<ul class="dv-rows">${loaded.map(r => `<li><span>${esc(when(r.at, tz))}</span> ${link(r.url, esc(r.branch), 'dv-title')} <span class="hint">${esc(load(r.load))}</span></li>`).join('')}</ul>` : '<p class="hint">No load readings</p>'}
    ${more(href(range, 'reds'), 'All red attempts with load')}
    <p><a href="/code/docs/decisions/2026-10-06-make-dora-counts-delivery.md">Decision record →</a></p>
    ${f.writtenLate ? '<p class="hint">Written late: the nightly run was missed.</p>' : ''}
  </div></details>`;
}

// ---- The full lists ----

function deploysList(items, w, tz) {
  return dataTable({ id: 'dv-deploys-t', columns: [
    { key: 'live', label: 'Live', w: 'md' }, { key: 'commit', label: 'Commit', w: 'sm' }, { key: 'type', label: 'Type', filter: 'chips', w: 'sm' },
    { key: 'runner', label: 'Runner', filter: 'chips', w: 'sm' }, { key: 'check', label: 'Live check', filter: 'chips', w: 'sm' },
  ], rows: items.filter(d => inWindow(d.liveAt, w)).map(d => ({ cells: {
    live: at(d.liveAt, tz), commit: link(d.url, short(d.sha)),
    type: d.playerFacing === false ? { html: tag('Same app'), f: 'Same app' } : d.playerFacing ? { html: tag('New', 'good'), f: 'New' } : { html: tag('Unknown'), f: 'Unknown' },
    runner: RUNNER[d.runner] || esc(d.runner), check: d.smoke === 'failure' ? { html: `${MARK} ${tag('Failed', 'bad')}`, f: 'Failed' } : d.smoke === 'success' ? 'Passed' : esc(d.smoke || ''),
  } })), empty: 'No deploys' });
}

function changesList(items, w, tz) {
  const part = (c, k) => ({ html: c.split?.[k] != null ? dur(c.split[k]) : '', v: c.split?.[k] ?? -1 });
  return dataTable({ id: 'dv-changes-t', columns: [
    { key: 'change', label: 'Change', w: 'sm' }, { key: 'title', label: 'Title', filter: 'text', w: 'lg', wrap: true }, { key: 'live', label: 'Live', w: 'md' },
    { key: 'total', label: 'Lead time', num: true, w: 'sm' }, { key: 'gate', label: 'Gate', num: true, w: 'sm' }, { key: 'merge', label: 'Merge wait', num: true, w: 'sm' },
  ], rows: items.filter(c => inWindow(c.liveAt, w)).map(c => ({ cells: {
    change: link(c.url, c.pr ? `#${c.pr}` : short(c.sha)), title: esc(c.title || ''), live: at(c.liveAt, tz),
    total: { html: c.totalSec != null ? dur(c.totalSec) : '', v: c.totalSec ?? -1 }, gate: part(c, 'gateSec'), merge: part(c, 'greenToMergeSec'),
  } })), empty: 'No changes went live' });
}

function failuresList(failures, recoveries, w, tz) {
  return dataTable({ id: 'dv-failures-t', columns: [
    { key: 'at', label: 'Failed at', w: 'md' }, { key: 'commit', label: 'Commit', w: 'sm' }, { key: 'check', label: 'Check', filter: 'chips', w: 'sm' },
    { key: 'green', label: 'Time to green', num: true, w: 'sm' }, { key: 'follow', label: 'Follow-up', wrap: true },
  ], rows: failures.filter(f => inWindow(f.at, w)).map(f => {
    const r = recoveries.find(x => x.failedRun === f.run);
    return { cells: {
      at: at(f.at, tz), commit: link(f.url, short(f.sha)), check: f.kind === 'smoke' ? 'Live check' : 'Deploy job',
      green: r ? { html: r.sec != null ? dur(r.sec) : 'Still red', v: r.sec ?? -1 } : { html: '', v: -1 },
      follow: f.explainedBy ? `${link(commitUrl(f.url, f.explainedBy.sha), short(f.explainedBy.sha))} · ${esc(f.explainedBy.subject)}` : '',
    } };
  }), empty: 'No failed deploys' });
}

function redsList(reds, w, tz) {
  const load = l => !l ? '<span class="hint">–</span>' : esc([l.pressure && `pressure ${l.pressure}`, l.load1 != null && `load ${l.load1}`, l.pagingMBps && `paging ${Math.round((l.pagingMBps.compressed || 0) + (l.pagingMBps.swapIn || 0))} MB/s`].filter(Boolean).join(' · ') || '–');
  return dataTable({ id: 'dv-reds-t', columns: [
    { key: 'at', label: 'When', w: 'md' }, { key: 'branch', label: 'Branch', filter: 'text', w: 'lg' }, { key: 'cause', label: 'Cause', filter: 'chips', w: 'sm' },
    { key: 'runner', label: 'Runner', filter: 'chips', w: 'sm' }, { key: 'load', label: 'Load' },
  ], rows: reds.filter(r => inWindow(r.at, w)).map(r => ({ cells: {
    at: at(r.at, tz), branch: link(r.url, esc(r.branch)), cause: { html: r.cause === 'test' ? tag('Test', 'bad') : tag(CAUSE[r.cause] || r.cause), f: CAUSE[r.cause] || r.cause },
    runner: RUNNER[r.runner] || esc(r.runner), load: load(r.load),
  } })), empty: 'No red attempts' });
}

function drillDown(f, w, range, list, day, p) {
  const tz = f.tz, record = w.prev.recordFrom || w.recordFrom;
  const first = record ? dayKey(Date.parse(record), tz) : null;
  const within = day ? { from: new Date(dayStart(day, tz)).toISOString(), to: new Date(dayStart(addDays(day, 1), tz)).toISOString() } : w;
  const title = `${LISTS[list]} · ${day ? dayName(day) : p.range}`;
  const days = `<nav class="dv-days" aria-label="Days"><a class="dv-day" href="${href(range, list)}"${day ? '' : ' aria-current="true"'}>All</a>${p.now.map(k => `<a class="dv-day" href="${href(range, list, k)}"${k === day ? ' aria-current="true"' : ''}>${esc(dayName(k))}</a>`).join('')}</nav>`;
  let summary = '', table;
  if (day && (!first || day < first)) table = `<p class="dv-empty">${first ? `No record before ${esc(dayName(first))}` : 'No record yet'}</p>`;
  else {
    const inSpan = (xs, k) => xs.filter(x => inWindow(x[k], within));
    if (list === 'deploys') {
      const all = inSpan(f.items.deploys, 'liveAt'), d = all.filter(x => x.playerFacing === true), same = all.filter(x => x.playerFacing === false).length;
      summary = `${plural(d.length, 'deploy')} · ${d.filter(x => x.smoke === 'failure').length} failed${same ? ` · ${plural(same, 'same-app redeploy')}` : ''}`;
      table = deploysList(f.items.deploys, within, tz);
    } else if (list === 'changes') {
      const c = inSpan(f.items.changes, 'liveAt'), m = median(c.filter(x => x.totalSec != null).map(x => x.totalSec));
      summary = `${plural(c.length, 'change')}${m != null ? ` · median ${dur(m)}` : ''}`;
      table = changesList(f.items.changes, within, tz);
    } else if (list === 'failures') {
      summary = plural(inSpan(f.items.failures, 'at').length, 'failed deploy');
      table = failuresList(f.items.failures, f.items.recoveries, within, tz);
    } else {
      const r = inSpan(f.items.prReds, 'at'), n = k => r.filter(x => CAUSE[x.cause] === k).length;
      summary = `${plural(r.length, 'red attempt')} · Test ${n('Test')} · Machine ${n('Machine')} · Experiment ${n('Experiment')}`;
      table = redsList(f.items.prReds, within, tz);
    }
  }
  return { title, body: `<a class="dv-back" href="/delivery?range=${range}">← Delivery</a>
    <div class="dv-head" id="dv-top" tabindex="-1"><div class="dv-name"><h1>${esc(title)}</h1></div></div>
    ${summary ? `<p class="dv-summary">${esc(summary)}</p>` : ''}${days}<section class="dv-sec dv-list" id="dv-list">${table}</section>` };
}

// ---- The page ----

const STYLE = `<style>
.dv-page { --t1: 12px; --t2: 13px; --t3: 15px; --t4: 18px; --t5: 24px; --t6: 40px; font-size: var(--t2); padding-bottom: 72px; }
/* HQ's Comments pill and Chat tab sit over the right edge: the page keeps a gutter of the pill's width clear */
.hq-main:has(> .dv-page) { padding-top: 16px; padding-right: 136px; }
.dv-page .hq-info { margin: 0; flex: none; }
.dv-page h1, .dv-page h2, .dv-page h3 { margin: 0; line-height: 1.25; }
.dv-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 0 0 6px; }
.dv-name { display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; }
.hq-main .dv-name h1 { font-size: var(--t5); margin: 0; }
.dv-repo { margin-left: 8px; padding: 2px 10px; border-radius: 99px; border: 1px solid var(--color-divider); font-size: var(--t2); color: var(--color-neutral-300); }
.dv-fresh { margin-left: auto; display: flex; align-items: center; gap: 12px; font-size: var(--t2); color: var(--color-neutral-400); }
.dv-fresh .btn { padding: 4px 12px; font-size: var(--t2); min-height: 28px; }
.dv-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 0 0 16px; font-size: var(--t2); color: var(--color-neutral-300); }
.dv-bar .seg-opt { min-height: 28px; box-sizing: border-box; text-decoration: none; color: var(--color-neutral-300); font-size: var(--t2); padding: 5px 12px; }
.dv-bar .seg-opt[aria-current="true"] { color: var(--color-accent); box-shadow: inset 0 0 0 1px var(--color-accent); }
.dv-bar .dv-range { color: var(--color-neutral-400); }
.dv-hero { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--color-divider); border-radius: var(--radius-lg); background: var(--color-surface); }
.dv-group { min-width: 0; }
.dv-group + .dv-group { border-left: 1px solid var(--color-divider); }
.hq-main .dv-group > h2 { margin: 0; padding: 12px 20px 0; font-size: var(--t1); letter-spacing: .08em; text-transform: uppercase; color: var(--color-neutral-400); font-weight: 600; }
.dv-tiles { display: grid; grid-template-columns: 1fr 1fr; }
.dv-tile { padding: 8px 20px 16px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dv-tile + .dv-tile { border-left: 1px solid var(--color-divider); }
.dv-tile-head { display: flex; align-items: center; gap: 2px; }
.dv-label { font-size: var(--t3); font-weight: 500; color: var(--color-neutral-200); }
.dv-figure { display: flex; align-items: baseline; gap: 8px; }
.dv-value { font-size: var(--t6); line-height: 1.1; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.dv-unit { font-size: var(--t2); color: var(--color-neutral-400); }
.dv-red { color: #f0a6a6; }
.dv-sub { min-height: 18px; font-size: var(--t2); color: var(--color-neutral-300); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dv-n { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
.dv-cmp { margin-top: 2px; }
.dv-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 99px; font-size: var(--t1); font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--color-text) 8%, transparent); color: var(--color-neutral-200); }
.dv-chip.good { background: color-mix(in srgb, #0ca30c 18%, #232532); color: #8cc9a0; }
.dv-chip.bad { background: color-mix(in srgb, #d03b3b 18%, #232532); color: #f0a6a6; }
.dv-spark { margin-top: auto; padding-top: 8px; }
.dv-spark .bl-spark { width: 100%; height: auto; max-height: 56px; }
.dv-sec { margin-top: 16px; padding: 16px 20px 18px; border: 1px solid var(--color-divider); border-radius: var(--radius-lg); background: var(--color-surface); min-width: 0; }
.dv-sec-head { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.hq-main .dv-sec h2 { font-size: var(--t4); font-weight: 600; }
.dv-count { margin-left: 6px; padding: 0 8px; border-radius: 99px; background: color-mix(in srgb, var(--color-text) 9%, transparent); font-size: var(--t1); font-weight: 600; }
.hq-main .dv-sec h3 { font-size: var(--t3); font-weight: 500; margin: 20px 0 6px; padding-top: 14px; border-top: 1px solid var(--color-divider); }
.dv-aside { margin-left: auto; font-size: var(--t2); }
.dv-say { margin: 0 0 6px; font-size: var(--t2); color: var(--color-neutral-300); }
.dv-empty { margin: 4px 0; color: var(--color-neutral-300); }
.dv-rows { list-style: none; margin: 0; padding: 0; font-size: var(--t2); }
.dv-rows li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 8px 0; min-width: 0; }
.dv-rows li + li { border-top: 1px solid var(--color-divider); }
.dv-title { flex: 1 1 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-neutral-200); }
.dv-age { font-variant-numeric: tabular-nums; color: var(--color-neutral-300); min-width: 64px; text-align: right; }
.dv-fails li { align-items: baseline; }
.dv-follow { flex-basis: 100%; color: var(--color-neutral-300); padding-left: 30px; }
.dv-more { display: inline-block; margin-top: 10px; font-size: var(--t2); min-height: 24px; line-height: 24px; }
.dv-median { display: flex; align-items: baseline; gap: 12px; margin: 14px 0 4px; font-size: var(--t2); }
.dv-median-k { color: var(--color-neutral-400); }
.dv-median b { margin-left: auto; font-variant-numeric: tabular-nums; }
.dv-line { display: flex; align-items: center; gap: 4px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-divider); font-size: var(--t2); color: var(--color-neutral-300); }
.dv-line-k { color: var(--color-neutral-200); }
.dv-line > span:last-child { margin-left: 8px; }
.dv-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 4px 0 12px; }
.dv-stat { padding: 0 16px; display: grid; gap: 2px; align-content: start; }
.dv-stat:first-child { padding-left: 0; }
.dv-stat + .dv-stat { border-left: 1px solid var(--color-divider); }
.dv-stat-k { font-size: var(--t2); color: var(--color-neutral-400); }
.dv-stat .dv-value { font-size: var(--t5); }
.dv-method { margin-top: 16px; border: 1px solid var(--color-divider); border-radius: var(--radius-lg); background: var(--color-surface); }
.dv-method > summary { cursor: pointer; padding: 14px 20px; min-height: 24px; }
.dv-method > summary h2 { display: inline; font-size: var(--t3); }
.dv-method-body { padding: 0 20px 18px; }
.hq-main .dv-method h3 { display: inline-block; font-size: var(--t3); font-weight: 500; margin: 18px 0 6px; }
.dv-terms { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
.dv-terms dt { color: var(--color-neutral-200); }
.dv-terms dd { margin: 0; color: var(--color-neutral-300); }
.dv-notes { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
.dv-page .bl-hbar { grid-template-columns: 120px 1fr auto; }
.dv-back { display: inline-block; margin-bottom: 8px; min-height: 24px; line-height: 24px; }
.dv-summary { margin: 0 0 10px; font-size: var(--t3); color: var(--color-neutral-200); }
.dv-days { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; }
.dv-day { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border-radius: 99px; border: 1px solid var(--color-divider); font-size: var(--t2); text-decoration: none; color: var(--color-neutral-300); }
.dv-day[aria-current="true"] { color: var(--color-accent); border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
.dv-list { margin-top: 0; max-width: 1080px; }
.dv-split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 8px 32px; align-items: start; }
.dv-split > div:first-child .bl-chart { max-width: 760px; }
/* the side column is a page-sized container of its own, so its charts take their narrow render and keep their text at
   phone size or larger */
.dv-split > div:last-child { container: page / inline-size; min-width: 0; }
.hq-main .dv-split > div:last-child > h3:first-child, .hq-main .dv-sec h3.dv-first { margin-top: 0; padding-top: 0; border-top: 0; }
.dv-split .dv-rows li:first-child { padding-top: 0; }
.dv-state { max-width: 760px; }
@container page (max-width: 900px) {
  .dv-hero { grid-template-columns: minmax(0, 1fr); }
  .dv-split { grid-template-columns: minmax(0, 1fr); }
  .hq-main .dv-split > div:last-child > h3:first-child, .hq-main .dv-sec h3.dv-first { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--color-divider); }
  .dv-group + .dv-group { border-left: 0; border-top: 1px solid var(--color-divider); }
}
@container page (max-width: 700px) {
  .dv-tiles { grid-template-columns: minmax(0, 1fr); }
  .hq-main .dv-group > h2 { padding: 10px 14px 2px; }
  .dv-tile { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "head figure" "sub cmp"; align-items: center; gap: 0 10px; padding: 6px 14px 8px; }
  .dv-tile + .dv-tile { border-left: 0; border-top: 1px solid var(--color-divider); }
  .dv-tile-head { grid-area: head; } .dv-tile .dv-figure, .dv-stat .dv-figure { grid-area: figure; justify-self: end; } .dv-tile .dv-sub { grid-area: sub; min-height: 0; font-size: var(--t1); } .dv-cmp { grid-area: cmp; justify-self: end; margin: 0; }
  .dv-spark { display: none; }
  .dv-tile .dv-label { white-space: nowrap; }
  .dv-value { font-size: var(--t5); }
  .dv-sec { padding: 14px 14px 16px; }
  .dv-stats { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .dv-stat { padding: 0; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "k figure" "sub sub"; align-items: baseline; } .dv-stat + .dv-stat { border-left: 0; border-top: 1px solid var(--color-divider); padding-top: 10px; }
  .dv-stat-k { grid-area: k; } .dv-stat .dv-sub { grid-area: sub; }
  .dv-title { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; flex-basis: 100%; order: 5; }
  .dv-follow { padding-left: 0; }
  .dv-terms { grid-template-columns: minmax(0, 1fr); }
}
/* on a phone HQ's header scrolls away with the page and wraps its nav across the width, and the page keeps clear of
   the Chat tab at the right edge */
@media (max-width: 700px) {
  .hq-main:has(> .dv-page) { padding-inline: 16px 40px; }
  body:has(.dv-page) .hq-hdr { position: static; flex-wrap: wrap; row-gap: 6px; }
  body:has(.dv-page) .hq-nav { flex-basis: 100%; order: 3; gap: 2px; }
  body:has(.dv-page) .hq-nav a { padding: 4px 8px; }
  .dv-fresh { margin-left: 0; }
}
</style>`;
const REFRESH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
const ABOUT = 'How fast and how safely changes reach users. Figures come from hq dora; definitions are under Method.';

export async function deliveryPage(ctx, params = new URLSearchParams(), { now = Date.now(), run } = {}) {
  const range = RANGES.some(([k]) => k === params.get('range')) ? params.get('range') : '7d';
  const list = Object.hasOwn(LISTS, params.get('list') || '') ? params.get('list') : null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') || '') ? params.get('day') : null;
  const got = readDora(ctx.cache);
  // a file from an older hq dora lacks what this page draws, so it is out of date however new it is
  const older = got.data && (got.data.version || 1) < VERSION;
  // figures counted by settings other than the manifest's, written before this HQ started; a file written since was
  // counted from hq.json as it is on disk, and refreshing it again would change nothing
  const recounted = got.data && got.data.settings && got.at < STARTED && JSON.stringify(got.data.settings) !== JSON.stringify(countingSettings(got.data.settings.tz));
  const stale = got.data && (older || recounted || now - got.at > STALE_MIN * 60000);
  // Refresh and old figures start one refresh in the background; nothing waits for it
  if ((params.has('fresh') || stale) && !ctx.demo) refresh(ctx, run);
  const updating = !!running;
  const problem = lastError; lastError = null;

  const page = (inner, title = 'Delivery') => layout({ title, active: 'delivery', wide: true, skip: { href: '#dv-top', label: 'Skip to figures' }, scripts: ['/hq/hq-charts.js'],
    body: `${STYLE}<div class="dv-page">${inner}</div>` });
  const note = problem ? `<p class="hq-problem hq-stalenote">${MARK} Refresh failed: ${esc(problem)} <span class="hint">Run hq dora for details.</span></p>` : '';
  const read = got.data ? `Updated ${ago(got.at, now)}${updating ? ' · refreshing…' : ''}` : updating ? 'Refreshing…' : '';
  // while a refresh runs, the page looks again shortly, without asking for another one
  const poll = updating ? `<script>setTimeout(() => location.replace('/delivery?range=${range}'), 10000);</script>` : '';
  const repoName = got.data?.repo ? String(got.data.repo).split('/').pop() : '';
  const head = `<div class="dv-head" id="dv-top" tabindex="-1"><div class="dv-name"><h1>Delivery</h1>${info(ABOUT, 'About Delivery')}${repoName ? `<span class="dv-repo">${esc(repoName)}</span>` : ''}</div>
    <div class="dv-fresh"><span>${esc(read)}</span><a class="btn btn-secondary" href="?range=${range}&amp;fresh=1">${REFRESH} Refresh</a></div></div>${poll}`;

  if (!got.data) return page(`${head}${note}<section class="dv-sec dv-state"><p><b>No delivery data yet.</b></p>
    <div class="hq-command"><code>hq dora</code></div><p class="hint">Or press Refresh. The first run takes a few minutes.</p></section>`);

  if (older) return page(`${head}${note}<section class="dv-sec dv-state"><p><b>Updating figures…</b> The saved figures are from an older hq dora.</p>
    <p class="hint">Reload in a minute, or run hq dora.</p></section>`);

  // the notes and the blind spots are the manifest's, drawn as they are now; dora.json's copies are the fallback for notes
  const f = { ...got.data, countingChanges: projectNotes() ?? got.data.countingChanges ?? [], blindSpots: BLIND_SPOTS || [] }, w = f.windows.find(x => x.id === range) || f.windows.find(x => x.id === '7d') || f.windows[0], p = period(f, w);
  if (list) { const d = drillDown(f, w, range, list, day, p); return page(`${note}${d.body}`, d.title); }

  const seg = `<div class="seg" role="group" aria-label="Period">${RANGES.map(([k, label]) => `<a class="seg-opt" href="?range=${k}"${k === range ? ' aria-current="true"' : ''}>${esc(label)}</a>`).join('')}</div>`;
  const why = w.prev.recordFrom ? '' : 'no earlier data';
  let today = '';
  if (f.today) {
    const n = (f.today.deploys || []).filter(d => d.playerFacing === true).length, r = (f.today.failures || []).filter(x => x.released).length;
    today = !n && !r ? 'Today: no deploys' : `Today: ${plural(n, 'deploy')} · ${r ? `${MARK} ${r} failed` : '0 failed'}`;
  }
  const bar = `<div class="dv-bar">${seg}<span class="dv-range">${esc([p.range, zoneName(f.tz), p.recordFrom ? `record from ${dayName(p.recordFrom)}` : '', why].filter(Boolean).join(' · '))}</span>${today ? `<span>${today}</span>` : ''}</div>`;
  const body = `${head}${note}${bar}${hero(figures(f, w, p))}${waitingSection(f, now)}${deploysSection(f, w, range, p)}${leadSection(f, w, range, p)}${liveSection(f, w, range, p)}${pipelineSection(f, w, range, p)}${method(f, w, range)}`;
  return page(body);
}
