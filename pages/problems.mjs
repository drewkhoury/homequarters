// The Problems page: the problem register as HQ shows it (docs/plans/problem-register.md). Observations are worked out
// from the run store, the lock log and hq dora each time the register is read; entries come from fix commits, notes
// and backfill and own the observations they explain; what no entry owns is unexplained. Overview tells a period's
// story, Trends the whole register week by week, Tests what each test costs and has caught, Test slot the time agents
// waited, List every entry and group. Each entry has a page of its own, and every view downloads as JSON.
// The figures come from hq/lib/problem-view.mjs and the charts from HQ's shared hq/lib/charts.mjs, each with its numbers
// in a table under it, as Noor's review asked. A colour means one thing across the page: the causes of a red are
// bl-s-real, bl-s-flaky and bl-s-infra, with not known as bl-s-unknown's dashed outline, the test slot is bl-s-now, a product bug that reached players is bl-s-fail, and
// who found a problem is bl-s-find1 to 4, one hue in shades, each named in a legend.
import { readFileSync } from 'node:fs';
import { localMinute } from '../lib/when.mjs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { esc, layout, urlPath } from '../lib/page.mjs';
import { info, dataTable } from '../lib/ui.mjs';
import { dayChart, dotPlot, hbars, numbers, duration } from '../lib/charts.mjs';
import { KIND, STAGE, DISPOSITIONS, GUARD_TYPES, EFFECTS, FACTOR, CONFIDENCE } from '../lib/problems.mjs';
import { allRuns } from '../lib/runs.mjs';
import { catalogue } from '../lib/catalogue.mjs';
import { readRegister, resultKeysOf, causeFolders } from '../lib/problem-register.mjs';
import { folderStamps } from '../lib/facts.mjs';
import { jsonLines } from '../lib/json-lines.mjs';
import { testKeyer } from '../lib/problem-observations.mjs';
import { testResults } from '../lib/problem-derive.mjs';
import { privacyContext } from '../lib/problem-privacy.mjs';
import { RANGES, windowOf, overview, trends, slot, testsView, exportJSON, entryOut, guardText, FINDER_GROUPS } from '../lib/problem-view.mjs';

// A snapshot is read again once a minute at most, unless the run store has a new run
const DAY = 86400000, TTL = 60000;

// ---- The register: a page answers from the snapshot it has, and the next is read after the response ----

// The first read, a read asked for (?fresh=1) and a read for another checkout happen at once. Otherwise a new runs list
// from the run store or a snapshot past TTL queues one read with later(), which runs after the response is sent, and
// the page answers from the snapshot it has. That read waits on the disk without holding the thread, so pages asked
// while it reads are answered too.
let snap = null, queued = null;
export function snapshot({ repo, cache }, { fresh = false, now = Date.now(), later = setImmediate } = {}) {
  const key = `${repo}\n${cache}`;
  if (fresh || !snap || snap.key !== key) return (snap = readSnapshot({ repo, cache }, key, now));
  if (queued !== key && (now - snap.readAt >= TTL || allRuns(cache, { now }) !== snap.runs)) {
    queued = key;
    later(async () => {
      // a read that fails keeps the snapshot the page has, and the next page queues another. The red runs' folders are
      // stamped first without holding the thread (thousands of logs), so pages asked meanwhile are answered.
      try {
        const at = Date.now(), files = catalogue(repo), runs = allRuns(cache, { now: at });
        const stamps = await folderStamps(causeFolders(runs, { cache, files }));
        const next = readSnapshot({ repo, cache }, key, at, stamps);
        if (snap && snap.key === key) snap = next;
      } catch (e) { console.error(`hq: the problem register could not be read again: ${e && e.message}`); }
      finally { queued = null; }
    });
  }
  return snap;
}
function readSnapshot({ repo, cache }, key, now, stamps = null) {
  const runs = allRuns(cache, { now }), lock = jsonLines(join(cache, 'lock', 'log.jsonl')), files = catalogue(repo);
  // the Tests tab reads the browser tests' results, from the records the register makes
  const browser = files.filter(f => f.set === 'gate' || f.set === 'after').map(f => f.name);
  const reg = readRegister({ repo, cache, runs, lock, files, now, resultKeys: browser, stamps });
  const diffs = new Map();
  const fileSame = (file, a, b) => {
    const k = `${file} ${a} ${b}`;
    if (!diffs.has(k)) diffs.set(k, spawnSync('git', ['diff', '--quiet', a, b, '--', file], { cwd: repo }).status === 0);
    return diffs.get(k);
  };
  return { key, readAt: now, reg, runs, lock, files, results: testResults(runs, { keyOf: testKeyer(files), keep: resultKeysOf(reg.entries, browser) }), fileSame, ctx: privacyContext({ cache }) };
}

// ---- Words and small pieces ----

const TABS = [['overview', 'Overview'], ['trends', 'Trends'], ['tests', 'Tests'], ['slot', 'Test slot'], ['list', 'List']];
const RANGED = new Set(['overview', 'tests', 'slot', 'list']);
const STATUS = { open: 'Open', fixing: 'Fixing', closed: 'Closed', dropped: 'Dropped', merged: 'Merged' };
const FAMILY = { flaky: 'flaky reds', real: 'real breaks', 'passed-alone': 'passed when rerun alone', infra: 'reds naming no test', resource: 'ran out of memory', wait: 'waits behind another run', takeover: 'take-overs', refused: 'refused takes', 'pr-wait': 'pull requests waiting on you', 'shared-cause': 'one error in several tests' };
// a group's words: for one error line shared by several tests, which tests, since the line alone does not say
const familyOf = g => (g.family === 'shared-cause' && g.tests ? `one error in ${g.tests.length} tests: ${g.tests.join(', ')}` : FAMILY[g.family] || g.family);
// a value for the shell, in single quotes: an error line holds spaces and quotes of its own (Juno)
const shellWord = v => `'${String(v).replace(/'/g, `'\\''`)}'`;
const when = iso => (iso ? localMinute(iso) ?? '' : '');
const dayOf = iso => when(iso).slice(0, 10);
const shortDay = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
// v sorts as text: the stores write their own offsets (git -04:00, the run store Z), so each is read back as UTC
const utc = iso => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? '' : new Date(t).toISOString(); };
const at = iso => ({ html: iso ? `<span title="${esc(iso)}">${esc(when(iso))}</span>` : '<span class="hint">none</span>', v: utc(iso) });
const dur = min => (min == null ? '–' : min < 90 ? `${Math.round(min)} min` : `${(min / 60).toFixed(min < 600 ? 1 : 0)} h`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const share = (a, b) => (b ? `${Math.round((a / b) * 100)}% (${a} of ${b})` : 'none yet');
const kindTag = k => (k ? `<span class="pr-kind" data-kind="${esc(k)}">${esc(KIND[k] ? KIND[k].label : k)}</span>` : '<span class="pr-kind">No kind yet</span>');
const stageLabel = s => (STAGE[s] ? STAGE[s].label : s || 'not said');
const entryLink = p => `<a href="/problems/${urlPath(p.id)}">${esc(p.title || p.id)}</a>`;
const groupHref = g => `/problems/group/${encodeURIComponent(g.sig)}/${encodeURIComponent(g.family)}`;
const groupLink = g => `<a href="${esc(groupHref(g))}">${esc(g.sig)}</a> <span class="hint">${esc(familyOf(g))}</span>`;
const panel = (title, about, inner, cls = '') => `<section class="card bl-panel ${cls}"><h2 class="pr-h">${esc(title)}</h2>${about ? `<p class="hint pr-about">${esc(about)}</p>` : ''}${inner}</section>`;
const tile = (value, labelText, about, beforeText) => `<div class="bl-stat"><b>${esc(value)}</b><span>${esc(labelText)}${about ? info(about, `About ${labelText}`) : ''}</span>${beforeText ? `<span class="hint">${esc(beforeText)}</span>` : ''}</div>`;
const lateMark = '<span class="pr-late">late</span>';

// ---- Overview ----

function overviewTab(s, w, live) {
  const o = overview(s.reg, w, { live });
  const b = o.before, was = (f, fmt = String) => (b ? `${fmt(f(b))} in the ${w.days} days before` : null);
  const top = o.costliest[0];
  const prRead = s.reg.sources.prRead;
  const story = `<p class="pr-story">In the last ${esc(w.label.toLowerCase())} the stores saw reds that cost about ${esc(dur(o.machineMinutes))} of machine time, agents waited ${esc(dur(o.slot.minutes))} for the test slot behind another run, and ${prRead ? `pull requests waited on you for ${esc(dur(o.waitingOnYou.minutes))} of the clock` : 'pull requests waiting on you are not read yet'}.${top ? ` The costliest was ${top.entry ? entryLink(top.entry) : groupLink(top.group)}, at ${esc(dur(top.minutes))}.` : ''} ${o.unexplained.alive ? `${plural(o.unexplained.alive, 'group of observations is', 'groups of observations are')} still alive with no entry explaining ${o.unexplained.alive === 1 ? 'it' : 'them'}.` : 'Every observation still alive has an entry.'}</p>`;
  const tiles = `<div class="bl-stats">
    ${tile(String(o.unexplained.alive), 'unexplained, still alive', 'Groups of observations (reds of one test, waits for the slot, pull requests waiting) seen in the last week that no entry owns. An entry is written by a fix commit, a note or backfill.')}
    ${tile(share(o.caughtBeforeMerge.caught, o.caughtBeforeMerge.of), 'of product bugs caught before the merge', 'Product bugs found by the agent, a test, a gate, a reviewer or you in review, against all product bugs opened in the period whose finder is known.', was(x => share(x.caughtBeforeMerge.caught, x.caughtBeforeMerge.of)))}
    ${tile(dur(o.machineMinutes), 'machine time on reds', 'Every red in the period priced at its own run\'s minutes, each run once, owned or not. Reds on a dirty tree are left out.', was(x => x.machineMinutes, dur))}
    ${tile(dur(o.slot.minutes), 'agents waited for the slot', `${o.slot.waits} waits behind another session, agent or worktree's run, from the lock log. Waits behind the same agent's own run are the queue working.`, was(x => x.slot.minutes, dur))}
    ${prRead ? tile(dur(o.waitingOnYou.minutes), `waiting on you, ${plural(o.waitingOnYou.prs, 'pull request')}`, 'Clock time during which at least one pull request had gone green and waited for its merge, from hq dora\'s own figures. Several waiting at once count once.', was(x => x.waitingOnYou.minutes, dur)) : tile('not read yet', 'waiting on you', 'Pull request waits come from hq dora\'s own figures, dora/changes.json, which its next pass writes.')}
  </div>${b ? '' : `<p class="hint">No comparison with the ${w.days} days before: the register starts on 24 September, so that period holds no data.</p>`}`;
  const groups = o.unexplained.list;
  const unexplained = groups.length ? dataTable({ id: 'pr-unexplained', columns: [
    { key: 'sig', label: 'Signature', filter: 'text', wrap: true }, { key: 'what', label: 'What the stores saw', filter: 'chips', w: 'lg' },
    { key: 'state', label: 'State', filter: 'chips', w: 'sm' }, { key: 'n', label: 'Seen', num: true, w: 'xs' }, { key: 'cost', label: 'Machine time', num: true, w: 'md' },
    { key: 'wait', label: 'Waited', num: true, w: 'sm' }, { key: 'last', label: 'Last seen', w: 'md' },
  ], rows: groups.map(g => ({ cells: {
    sig: { html: `<a href="${esc(groupHref(g))}">${esc(g.sig)}</a>`, v: g.sig, f: g.sig }, what: { html: esc(familyOf(g)), f: familyOf(g) },
    state: { html: esc(g.state), f: g.state }, n: { html: String(g.count), v: g.count },
    cost: { html: esc(dur(g.machineMinutes)), v: g.machineMinutes ?? 0 }, wait: { html: esc(dur(g.waitMinutes)), v: g.waitMinutes ?? 0 }, last: at(g.lastSeen),
  } })) }) + (o.unexplained.more ? `<p class="hint">And ${plural(o.unexplained.more, 'group')} more, the List tab has them all: <a href="${esc(`/problems?${new URLSearchParams({ tab: 'list', range: w.range })}`)}">every unexplained group</a>.</p>` : '') : '<p class="hint">Every observation in the period has an entry.</p>';
  const costliest = o.costliest.length ? `<ol class="pr-top">${o.costliest.map(x => `<li>${x.entry ? `${entryLink(x.entry)}` : `${groupLink(x.group)} <span class="pr-flag">no entry</span>`} <span class="hint">${esc(dur(x.minutes))}, ${plural(x.times, 'time')}</span></li>`).join('')}</ol>`
    : '<p class="hint">No red cost machine time in the period.</p>';
  const escapes = o.escapes.length ? `<table class="hq-table pr-escapes"><thead><tr><th scope="col">Should have been caught by</th><th scope="col">Was found by</th><th scope="col" class="num">Entries</th><th scope="col">Which</th></tr></thead><tbody>${o.escapes.slice(0, 8).map(x =>
    `<tr><td>${esc(stageLabel(x.shouldHaveCaughtAt))}</td><td>${esc(stageLabel(x.foundAt))}</td><td class="num">${x.entries.length}</td><td>${x.entries.slice(0, 3).map(entryLink).join('<br>')}${x.entries.length > 3 ? `<br><span class="hint">and ${x.entries.length - 3} more</span>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="hint">Nothing in the period was found later than it should have been, or no entry says where it should have been caught.</p>';
  const back = o.cameBack.length ? `<ul class="pr-back">${o.cameBack.slice(0, 8).map(p => `<li>${kindTag(p.kind)} ${entryLink(p)} <span class="hint">closed ${esc(dayOf(p.closedAt))}, seen again ${esc(dayOf(p.cameBack))}${p.filedAgainAs ? `, filed again as <a href="/problems/${urlPath(p.filedAgainAs)}">${esc(titleOf(s, p.filedAgainAs))}</a>` : ''}</span>${p.filedAgainAs ? '' : ' <b class="pr-flag">not filed again</b>'}</li>`).join('')}</ul>`
    : '<p class="hint">Nothing closed came back in the period.</p>';
  const shareOf = n => (o.findersKnown ? ` (${Math.round((n / o.findersKnown) * 100)}%)` : '');
  const finders = hbars(o.finders.map(f => ({ label: f.label, n: f.n, text: `${f.n}${shareOf(f.n)}` })), `Who found the ${o.findersKnown} entries opened in the period that say who`)
    + numbers({ head: ['Who found it', 'Entries', 'Share'], rows: o.finders.map(f => [f.label, f.n, o.findersKnown ? `${Math.round((f.n / o.findersKnown) * 100)}%` : null]) });
  return `${story}${tiles}<div class="bl-charts">
    ${panel(`Unexplained, ${w.label.toLowerCase()}`, 'Observations no entry owns, grouped by signature and by what the stores saw. A group seen in the last week is alive. Each wants a fix commit with a Kind: trailer, or a note.', unexplained, 'dv-wide')}
    ${panel(`Costliest, ${w.label.toLowerCase()}`, 'Machine time on each entry\'s and each unexplained group\'s reds in the period, each run once.', costliest)}
    ${panel(`Who found them, ${w.label.toLowerCase()}`, `The entries opened in the period by who found them, from Found-by or the stage. ${o.findersKnown} of ${o.opened} say who.`, finders)}
    ${panel(`Found later than they should have been, ${w.label.toLowerCase()}`, 'Each pair is the stage that should have caught a problem and the stage that did. A pair that keeps coming up names the test or check to add.', escapes)}
    ${panel(`Came back, ${w.label.toLowerCase()}`, 'Closed entries seen again after their fix: a red on a commit holding the fix, a reopen, or a later entry of the same kind and signature. The ones nobody filed again come first.', back)}
  </div>`;
}

// ---- Trends ----

function trendsTab(s) {
  const t = trends(s.reg, { runs: s.runs, now: s.readAt }).weeks;
  const week = x => shortDay(Date.parse(x.weekOf)) + (Date.parse(x.through) < Date.parse(x.weekOf) + 6 * 86400000 ? ' (so far)' : ''), r1 = v => (v == null ? null : Math.round(v * 10) / 10);
  const per = (x, k) => r1(x.per100 && x.per100[k]);
  const reds = dayChart(t.map(x => ({ day: x.weekOf, real: per(x, 'code'), flaky: per(x, 'flaky'), infra: per(x, 'infra'), unknown: per(x, 'unknown') })),
    [{ key: 'real', cls: 'real', label: 'real break', bar: true }, { key: 'flaky', cls: 'flaky', label: 'flaky', bar: true }, { key: 'infra', cls: 'infra', label: 'tooling', bar: true }, { key: 'unknown', cls: 'unknown', label: 'not known', bar: true }],
    { label: 'Gate reds per 100 gate runs each week, by cause', narrow: true })
    + numbers({ caption: 'Each column is a week, from the day named', head: ['Week of', 'gate runs', 'real break', 'flaky', 'tooling', 'not known'], rows: t.map(x => [week(x), x.gateRuns, per(x, 'code'), per(x, 'flaky'), per(x, 'infra'), per(x, 'unknown')]) });
  const changes = (s.reg.changes || []).filter(c => c.path === 'pr' && c.mergedAt && c.split && [c.split.runnerWaitSec, c.split.slotWaitSec, c.split.gateSec].every(Number.isFinite));
  const push = changes.length ? dotPlot(changes.map(c => ({ day: c.mergedAt.slice(0, 10), v: c.split.runnerWaitSec + c.split.slotWaitSec + c.split.gateSec, title: `#${c.pr}: ${duration(c.split.runnerWaitSec + c.split.slotWaitSec + c.split.gateSec)}` })),
    { label: 'Push to gate result for each pull request, by the day it merged', names: { median: 'Daily median' } })
    + numbers({ head: ['Week of', 'pull requests', 'median', '90th percentile'], rows: t.map(x => [week(x), x.pushToResultMin.n, x.pushToResultMin.median == null ? null : dur(x.pushToResultMin.median), x.pushToResultMin.p90 == null ? null : dur(x.pushToResultMin.p90)]) })
    : '<p class="hint">Not read yet: hq dora writes dora/changes.json, each change\'s own figures, from its next pass.</p>';
  const bugs = dayChart(t.map(x => ({ day: x.weekOf, bugs: x.productBugsAfterMerge.per10PRs })), [{ key: 'bugs', cls: 'fail', label: 'product bugs found after the merge, per 10 merged pull requests', bar: true }],
    { label: 'Product bugs found after the merge per 10 merged pull requests, each week', narrow: true })
    + numbers({ head: ['Week of', 'merged pull requests', 'product bugs after the merge', 'per 10', ...Object.values(EFFECTS)], rows: t.map(x => [week(x), x.mergedPRs, x.productBugsAfterMerge.n, x.productBugsAfterMerge.per10PRs, ...Object.keys(EFFECTS).map(e => x.productBugsAfterMerge.byEffect[e])]) });
  const who = dayChart(t.map(x => ({ day: x.weekOf, ...x.finderShares })), FINDER_GROUPS.map((g, i) => ({ key: g.key, cls: `find${i + 1}`, label: `% ${g.label.toLowerCase()}`, bar: true })),
    { label: 'Who found each week\'s entries, as a share of those that say who', narrow: true })
    + numbers({ head: ['Week of', ...FINDER_GROUPS.map(g => g.label), 'say who'], rows: t.map(x => [week(x), ...FINDER_GROUPS.map(g => (x.findersKnown ? `${x.finders[g.key]} (${Math.round(x.finderShares[g.key])}%)` : null)), x.findersKnown]) });
  const anyBugs = s.reg.entries.some(p => p.kind === 'product-bug');
  const last = t.at(-1) || { gateRuns: 0, per100: null };
  const story = `<p class="pr-story">The register starts on 24 September. Counts of problems rise with the work, so the first chart divides by it. The last week ran ${plural(last.gateRuns, 'full gate')}${last.per100 ? `, and ${r1(Object.values(last.per100).reduce((a, b) => a + b, 0))} in every 100 went red` : ''}.</p>`;
  return `${story}<div class="bl-charts pr-charts">
    ${panel('Gate reds per 100 gate runs, each week', 'Full, clean gate runs on the laptop and CI, each week from the day named. A red run counts once, by its worst cause: tooling, else a real break, else not known, else flaky. An entry judged from the run gives its cause; otherwise tooling is a red naming no test, a real break failed again when rerun, flaky passed on the same commit or when rerun alone, and not known was never rerun, as almost no red was before 11 October.', reds)}
    ${panel('Who found them, each week', 'Each week\'s entries by who found them, from Found-by or the stage, as a share of those that say who: the counts rise with the work. More found by tests and agents, fewer by you, is the direction to want.', who)}
    ${panel('Push to gate result', 'For each pull request, from its gate being queued to its result, the wait for the runner and the test slot included, from hq dora\'s figures. The line is each day\'s median.', push)}
    ${panel('Product bugs found after the merge, per 10 merged pull requests', 'Product-bug entries found by the merge\'s deploy, the production smoke test, the nightly long set, you after the merge, or players.', anyBugs ? bugs : '<p class="hint">Not drawn yet: no entry has the kind Product bug, which fix commits give with Kind: product-bug from 11 October.</p>')}
  </div>`;
}

// ---- Tests ----

function testsTab(s, w) {
  const rows = testsView(s.reg, { files: s.files, results: s.results, fileSame: s.fileSame, w });
  const ran = rows.filter(r => r.runs), caught = ran.filter(r => r.catches.length);
  const story = `<p class="pr-story">In the last ${esc(w.label.toLowerCase())} ${plural(ran.length, 'gate or long-set test')} ran, for ${esc(dur(ran.reduce((n, r) => n + r.minutes, 0)))} in all, and ${plural(caught.length, 'test')} caught a break: red at least twice on one commit, then green on a later one, the test file unchanged.</p>`;
  return `${story}${panel(`Every gate and long-set test, ${w.label.toLowerCase()}`, 'Runs, minutes, catches and reds are its own, in the period; Last catch reaches back past it, to the latest ever. A catch never counts a red-first commit, since that changes the test, and dirty trees are not seen, so catches are a lower bound. A test that guards saved data stays in the gate whatever its catches.', dataTable({ id: 'pr-tests', columns: [
    { key: 'test', label: 'Test', filter: 'text', w: 'lg' }, { key: 'set', label: 'Set', filter: 'chips', w: 'sm' },
    { key: 'runs', label: 'Runs', num: true, w: 'xs' }, { key: 'min', label: 'Time', num: true, w: 'sm' }, { key: 'catches', label: 'Catches', num: true, w: 'xs' },
    { key: 'last', label: 'Last catch, ever', w: 'md' }, { key: 'flaky', label: 'Flaky reds', num: true, w: 'md' }, { key: 'alone', label: 'Passed alone', num: true, w: 'md' },
    { key: 'never', label: 'Never rerun', num: true, w: 'md' }, { key: 'proves', label: 'What it guards', wrap: true },
  ], rows: rows.map(r => ({ cells: {
    test: { html: `<a href="/code/${urlPath(r.path)}">${esc(r.test)}</a>`, v: r.test, f: r.test }, set: { html: esc(r.set), f: r.set },
    runs: { html: String(r.runs), v: r.runs }, min: { html: esc(dur(r.minutes)), v: r.minutes }, catches: { html: String(r.catches.length), v: r.catches.length },
    last: at(r.lastCatch), flaky: { html: String(r.flakyReds), v: r.flakyReds }, alone: { html: String(r.passedAlone), v: r.passedAlone },
    never: { html: String(r.neverRerun), v: r.neverRerun }, proves: { html: `<div class="hq-desc hq-clamp3" title="${esc(r.proves)}">${esc(r.proves)}</div>`, f: r.proves },
  } })).sort((a, b) => b.cells.runs.v - a.cells.runs.v) }), 'dv-wide')}`;
}

// ---- Test slot ----

function slotTab(s, w) {
  const days = slot(s.reg, { lock: s.lock, now: s.readAt, w }).days;
  const sum = k => days.reduce((n, d) => n + d[k], 0);
  const label = d => shortDay(Date.parse(d.day));
  const story = `<p class="pr-story">In the last ${esc(w.label.toLowerCase())} agents waited ${esc(dur(sum('waitMinutes')))} for the test slot behind another run, over ${plural(sum('waits'), 'wait')}. At the most, ${Math.max(0, ...days.map(d => d.atOnce))} runs held or waited for it at once.</p>`;
  return `${story}<div class="bl-stats">
      ${tile(dur(sum('waitMinutes')), 'waited behind another run', 'From the lock log: each wait to the take that ended it, behind a run that was not the same agent\'s in the same worktree.')}
      ${tile(String(sum('gaveUp') + sum('left')), 'waits that gave up or left', 'A wait that ran out of HQ_SLOT_WAIT minutes, or stopped before its turn. A wait killed outright leaves no line.')}
      ${tile(String(sum('refused')), 'takes refused', 'Takes under HQ_SLOT_WAIT=0 that found the slot busy.')}
      ${tile(String(sum('takeovers')), 'take-overs', 'A run took the slot from a holder whose process had gone.')}
    </div><div class="bl-charts pr-charts">
      ${panel(`Minutes waited behind another run, each day, ${w.label.toLowerCase()}`, 'Agents waiting, not machine time: a different clock.', dayChart(days.map(d => ({ day: d.day, m: d.waitMinutes })), [{ key: 'm', cls: 'now', label: 'minutes waited', bar: true }], { label: 'Minutes agents waited for the test slot each day', narrow: true })
        + numbers({ head: ['Day', 'minutes waited', 'waits', 'gave up', 'left', 'refused', 'take-overs'], rows: days.map(d => [label(d), d.waitMinutes, d.waits, d.gaveUp, d.left, d.refused, d.takeovers]) }))}
      ${panel(`The most runs at once, each day, ${w.label.toLowerCase()}`, 'Runs holding or waiting for the slot at the same moment. About four builders at once is where gates started to fail on load.', dayChart(days.map(d => ({ day: d.day, n: d.atOnce })), [{ key: 'n', cls: 'now', label: 'runs at once', bar: true }], { label: 'The most runs holding or waiting for the test slot at once each day', narrow: true })
        + numbers({ head: ['Day', 'runs at once'], rows: days.map(d => [label(d), d.atOnce]) }))}
    </div>`;
}

// ---- List ----

function listTab(s, w, live) {
  const inW = t => t >= w.from && t <= w.to;
  const ps = s.reg.entries.filter(p => (!live || p.record !== 'backfill') && (inW(Date.parse(p.openedAt)) || (p.observations || []).some(o => inW(Date.parse(o.when || o.at)))));
  const story = `<p class="pr-story">${plural(ps.length, 'entry', 'entries')} opened or seen in the last ${esc(w.label.toLowerCase())}${live ? ', backfill left out' : ''}, and ${plural(s.reg.unexplained.length, 'group')} of observations no entry owns.</p>`;
  const table = dataTable({ id: 'pr-list', columns: [
    { key: 'title', label: 'Problem', filter: 'text', wrap: true }, { key: 'kind', label: 'Kind', filter: 'chips', w: 'md' }, { key: 'status', label: 'Status', filter: 'chips', w: 'sm' },
    { key: 'found', label: 'Found at', filter: 'chips', w: 'md' }, { key: 'seen', label: 'Seen', num: true, w: 'xs' }, { key: 'cost', label: 'Cost', num: true, w: 'sm' },
    { key: 'last', label: 'Last seen', w: 'md' }, { key: 'record', label: 'Record', filter: 'chips', w: 'sm' },
  ], rows: ps.map(p => ({ cells: {
    title: { html: `${entryLink(p)}${p.late ? ` ${lateMark}` : ''}${p.cameBack ? ' <span class="pr-flag">came back</span>' : ''}`, v: p.title, f: `${p.title} ${p.signature || ''}` },
    kind: { html: kindTag(p.kind), f: p.kind ? KIND[p.kind].label : 'No kind yet' }, status: { html: esc(STATUS[p.status] || p.status), f: STATUS[p.status] || p.status },
    found: { html: esc(stageLabel(p.foundAt)), f: stageLabel(p.foundAt) }, seen: { html: String((p.observations || []).length), v: (p.observations || []).length },
    cost: { html: p.notMeasured ? '<span class="hint">not measured</span>' : esc(dur(p.machineMinutes || p.waitMinutes)), v: p.machineMinutes || p.waitMinutes || 0 },
    last: at(p.lastSeen || p.openedAt), record: { html: esc(p.record || ''), f: p.record || '' },
  } })).sort((a, b) => b.cells.last.v.localeCompare(a.cells.last.v)), empty: 'No entries in this period.' });
  const groups = dataTable({ id: 'pr-groups', columns: [
    { key: 'sig', label: 'Signature', filter: 'text', wrap: true }, { key: 'what', label: 'What the stores saw', filter: 'chips', w: 'lg' }, { key: 'state', label: 'State', filter: 'chips', w: 'sm' },
    { key: 'n', label: 'Seen', num: true, w: 'xs' }, { key: 'last', label: 'Last seen', w: 'md' },
  ], rows: s.reg.unexplained.map(g => ({ cells: { sig: { html: `<a href="${esc(groupHref(g))}">${esc(g.sig)}</a>`, v: g.sig, f: g.sig }, what: { html: esc(familyOf(g)), f: familyOf(g) },
    state: { html: esc(g.state), f: g.state }, n: { html: String(g.count), v: g.count }, last: at(g.lastSeen) } })), empty: 'Every observation has an entry.' });
  return `${story}${panel(`Entries, ${w.label.toLowerCase()}`, 'From fix commits (their Kind:, Found-at: and Found-by: trailers), notes and backfill.', table, 'dv-wide')}${panel('Unexplained groups, the whole register', 'What no entry owns.', groups, 'dv-wide')}`;
}

// ---- The page ----

const PAGE_ABOUT = 'The problem register: everything that went wrong in the work, from a red test to a wait for the test slot. Observations are worked out from the run store, the lock log and hq dora each time the page is read. Entries add judgement: fix commits make them from their trailers, notes and backfill add the rest. docs/plans/problem-register.md says how it all fits.';
const COPY_SCRIPT = `<script>document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copy-json]'); if (!b) return;
  const was = b.textContent;
  try { const r = await fetch(b.dataset.copyJson); await navigator.clipboard.writeText(await r.text()); b.textContent = 'Copied'; } catch { b.textContent = 'Could not copy'; }
  setTimeout(() => { b.textContent = was; }, 1600);
});</script>`;
const exportButtons = (url, about) => `<span class="pr-export"><a class="btn btn-secondary" href="${esc(url)}${url.includes('?') ? '&amp;' : '?'}download=1">Download JSON</a><button type="button" class="btn btn-ghost" data-copy-json="${esc(url)}">Copy JSON</button>${info(about, 'About the JSON')}</span>`;
function freshness(s) {
  const src = s.reg.sources;
  return `<p class="hint pr-fresh">Read ${esc(when(new Date(s.readAt).toISOString()))}: ${plural(src.runs, 'run')}, ${plural(src.lockLines, 'lock log line')}, ${plural(src.events, 'event')} in the register, ${plural(src.gitEntries, 'entry', 'entries')} from git, ${src.prWaits ? plural(src.prWaits, 'pull request wait') : 'no pull request waits yet (hq dora writes them)'}${s.reg.notPlaced.length ? `, <b>${plural(s.reg.notPlaced.length, 'event')} not placed</b>` : ''}. <a href="?fresh=1">Read again</a></p>`;
}

export function problemsPage(ctx, params = new URLSearchParams()) {
  const s = snapshot(ctx, { fresh: params.has('fresh') });
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview';
  const range = RANGES.some(([k]) => k === params.get('range')) ? params.get('range') : '7d', live = params.get('record') === 'live';
  const w = windowOf(range, s.readAt, s.reg.start);
  const q = (over = {}) => `?${new URLSearchParams({ tab, range, ...(live ? { record: 'live' } : {}), ...over })}`;
  const controls = RANGED.has(tab) ? `<div class="hq-filterbar"><div class="seg" role="group" aria-label="Period">${RANGES.map(([k, l]) => `<a class="seg-opt" href="${esc(q({ range: k }))}"${k === range ? ' aria-current="true"' : ''}>${esc(l)}</a>`).join('')}</div>`
    + (tab === 'overview' || tab === 'list' ? `<div class="seg" role="group" aria-label="Which entries">${[['all', 'All entries'], ['live', 'Live only']].map(([k, l]) => `<a class="seg-opt" href="${esc(`?${new URLSearchParams({ tab, range, ...(k === 'live' ? { record: 'live' } : {}) })}`)}"${(live ? 'live' : 'all') === k ? ' aria-current="true"' : ''}>${esc(l)}</a>`).join('')}</div>${info('Backfilled entries were made on 11 October from another session\'s sort of 226 red gates, and carry record: backfill. Live only leaves them out of what counts entries; costs stay the period\'s.', 'About backfill')}` : '')
    + '</div>' : '<p class="hint">Trends always covers the whole register, from 24 September.</p>';
  const exportUrl = `/problems/export.json?${new URLSearchParams({ range, ...(live ? { record: 'live' } : {}) })}`;
  const head = `<div class="hq-pagehead"><h1>Problems${info(PAGE_ABOUT, 'About this page')}</h1>${exportButtons(exportUrl, `Everything this page shows for ${w.label.toLowerCase()}${live ? ', live entries only' : ''}, as one JSON file: the fixed values and what each means, the Overview, every Trends week, the test slot's days, each entry with what the reader worked out, the unexplained groups and any event not placed. Text the privacy check refuses is withheld. For an agent, or to keep.`)}</div>
    <nav class="hq-tabs" aria-label="Problems">${TABS.map(([k, l]) => `<a href="${esc(q({ tab: k }))}"${k === tab ? ' class="on" aria-current="page"' : ''}>${l}</a>`).join('')}</nav>${controls}${freshness(s)}`;
  const body = tab === 'trends' ? trendsTab(s) : tab === 'tests' ? testsTab(s, w) : tab === 'slot' ? slotTab(s, w) : tab === 'list' ? listTab(s, w, live) : overviewTab(s, w, live);
  return layout({ title: 'Problems', active: 'problems', wide: true, body: STYLE + head + body + COPY_SCRIPT, scripts: ['/hq/hq-charts.js'] });
}

export function exportView(ctx, params = new URLSearchParams()) {
  const s = snapshot(ctx);
  const range = RANGES.some(([k]) => k === params.get('range')) ? params.get('range') : '7d';
  return exportJSON(s.reg, { w: windowOf(range, s.readAt, s.reg.start), ctx: s.ctx, now: s.readAt, live: params.get('record') === 'live', runs: s.runs, lock: s.lock });
}

// ---- One entry, and one unexplained group ----

const byId = (s, id) => s.reg.entries.find(p => p.id === id);
const titleOf = (s, id) => (byId(s, id) || {}).title || id;
// an event's field as words: a time in local time, a long list of runs as how many
const fieldText = (k, v) => (Array.isArray(v) ? (k === 'runs' && v.length > 3 ? `${v.length} runs, the first ${v[0]}` : v.join(', ')) : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? when(v) : String(v));
export function entryJSON(ctx, id) {
  const s = snapshot(ctx), p = byId(s, id);
  return p ? guardText({ about: { what: 'One entry of the problem register, with what the reader worked out and the observations it owns.', readAt: new Date(s.readAt).toISOString() }, entry: entryOut(p, { withObservations: true }) }, s.ctx) : null;
}

export function problemPage(ctx, id) {
  const s = snapshot(ctx), p0 = byId(s, id);
  if (!p0) return null;
  const p = guardText(p0, s.ctx);
  const facts = [
    ['Kind', p.kind ? `${kindTag(p.kind)} <span class="hint">${esc(KIND[p.kind].about)}</span>` : '<span class="hint">no kind yet: a fix commit gives one with its Kind: trailer</span>'],
    ['Mode', p.mode ? esc(p.mode) : '<span class="hint">not given</span>'],
    ['Status', p.mergedInto ? `Merged into <a href="/problems/${urlPath(p.mergedInto)}">${esc(titleOf(s, p.mergedInto))}</a>` : `${esc(STATUS[p.status] || p.status)}${p.disposition ? ` <span class="hint">${esc(DISPOSITIONS[p.disposition])}</span>` : ''}`],
    ['Signature', p.signature ? `<code>${esc(p.signature)}</code>` : '<span class="hint">none: it owns no observations</span>'],
    ['Evidence', p.evidence ? `<code>${esc(p.evidence)}</code>` : '<span class="hint">none</span>'],
    ['Found', `${esc(stageLabel(p.foundAt))}${(p.foundBy || []).length ? `, by ${esc(p.foundBy.join(', '))}` : ''}${p.late ? ` ${lateMark} <span class="hint">should have been caught by ${esc(stageLabel(p.shouldHaveCaughtAt))}</span>` : ''}`],
    ['Opened', `${esc(when(p.openedAt))}${p.seenFrom ? ` <span class="hint">first seen ${esc(when(p.seenFrom))}</span>` : ''}${p.openedBy ? ` <span class="hint">by ${esc(p.openedBy)}</span>` : ''}`],
    ...(p.closedAt ? [['Closed', esc(when(p.closedAt))]] : []),
    ['Players', p.playerFacing === true ? `Player-facing${p.effect ? `: ${esc(EFFECTS[p.effect])}` : ''}` : p.playerFacing === false ? 'Not player-facing' : '<span class="hint">not said</span>'],
    ['Factors', (p.factors || []).length ? p.factors.map(f => `<span class="bl-chip">${esc(FACTOR[f] ? FACTOR[f].label : f)}</span>`).join(' ') : '<span class="hint">none given</span>'],
    ['Cause', p.confidence ? esc(CONFIDENCE[p.confidence]) : '<span class="hint">not said</span>'],
    ['Guard', p.guard ? `<code>${esc(p.guard)}</code>${p.guardType ? ` <span class="hint">${esc(GUARD_TYPES[p.guardType])}</span>` : ''}` : '<span class="hint">none given</span>'],
    ['Fix', p.fix ? `<a href="/repo/commit/${esc(p.fix)}"><code>${esc(String(p.fix).slice(0, 8))}</code></a>${p.fixHeld ? ` <span class="hint">${esc({ held: 'held', checking: `checking the fix: ${p.cleanRuns ?? 0} of ${p.cleanNeeded ?? '?'} clean runs, over ${p.cleanDays ?? 0} days`, 'came-back': 'came back' }[p.fixHeld])}</span>` : ''}` : '<span class="hint">none</span>'],
    ['Record', `${esc(p.record || '')}${p.source === 'git' ? ' <span class="hint">from a fix commit</span>' : ''}${p.backlog ? ` <span class="hint">closed ${esc(p.backlog)}</span>` : ''}`],
    ...(p.cameBack ? [['Came back', esc(when(p.cameBack))]] : []),
  ];
  const obs = (p0.observations || []).map(o => ({ cells: {
    at: at(o.when || o.at), what: { html: esc(o.type === 'red' ? FAMILY[{ flaky: 'flaky', 'never-rerun': 'real', 'red-twice': 'real', 'passed-alone': 'passed-alone', infra: 'infra', resource: 'resource' }[o.class]] || o.class : FAMILY[o.type === 'pr-wait' ? 'pr-wait' : 'wait']), f: o.class || o.type },
    ref: { html: o.run ? `<a href="/runs/${encodeURIComponent(o.run)}">${esc(o.run)}</a>` : o.pr ? `#${esc(o.pr)}` : esc(o.worktree || ''), v: o.run || String(o.pr || '') },
    branch: { html: esc(o.branch || ''), f: o.branch || '' }, cost: { html: esc(o.type === 'red' ? dur(o.minutes) : `${dur(o.minutes)} waiting`), v: o.minutes || 0 },
    flags: { html: [o.starved ? 'starved run' : '', o.partial ? 'partial run' : ''].filter(Boolean).map(t => `<span class="pr-flag">${esc(t)}</span>`).join(' ') || '<span class="hint">none</span>', f: o.starved ? 'starved' : '' },
  } }));
  const events = (p.events || []).length ? `<ol class="pr-timeline">${p.events.map(e => `<li><span class="when">${esc(when(e.at))}</span><span class="ev">${esc(e.ev)}</span><span>${esc(e.by || '')}${e.into ? ` into <a href="/problems/${urlPath(e.into)}">${esc(titleOf(s, e.into))}</a>` : ''}${e.fields && !Array.isArray(e.fields) && Object.keys(e.fields).length ? `<ul class="pr-ev-fields">${Object.entries(e.fields).map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(fieldText(k, v))}</li>`).join('')}</ul>` : ''}</span></li>`).join('')}</ol>`
    : '<p class="hint">No events: this entry comes from a fix commit in git, which is its record.</p>';
  const body = `${STYLE}<div class="pr-detail">
    <p class="hint pr-crumbs"><a href="/problems?tab=list">Problems</a> · ${esc(p.id)} ${exportButtons(`/problems/${urlPath(p.id)}.json`, 'This entry as JSON: its fields, what the reader worked out, every observation it owns and its events.')}</p>
    <div class="pr-title">${kindTag(p.kind)}<h1>${esc(p.title || p.id)}</h1></div>
    ${(p.missing || []).length ? `<section class="card bl-panel pr-missing"><h2 class="pr-h">Still to say</h2><p class="hint">Found by ${esc(stageLabel(p.foundAt))}, so it needs where it should have been caught: hq problem set ${esc(p.id)} --should-have-caught-at &lt;stage&gt;.</p></section>` : ''}
    <div class="bl-stats">${tile(String(obs.length), 'observations it owns')}${tile(p.notMeasured ? 'not measured' : dur(p.machineMinutes), 'machine time')}${p.waitMinutes ? tile(dur(p.waitMinutes), 'waiting') : ''}${tile(dayOf(p.firstSeen) || 'not seen', 'first seen')}${tile(dayOf(p.lastSeen) || 'not seen', 'last seen')}</div>
    <div class="bl-charts">
      ${panel('The entry', '', `<dl class="bl-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`)}
      ${panel('Events', 'Every line of the events file for this entry, oldest first.', events)}
      ${panel('The observations it owns', 'Matched from the stores by its signature and kind, from a week before it was first seen to its fix, and any after the fix that make it come back.', dataTable({ id: 'pr-obs', columns: [
        { key: 'at', label: 'When', w: 'md' }, { key: 'what', label: 'What', filter: 'chips', w: 'lg' }, { key: 'ref', label: 'Run or pull request', w: 'lg' },
        { key: 'branch', label: 'Branch', filter: 'chips', w: 'lg' }, { key: 'cost', label: 'Cost', num: true, w: 'sm' }, { key: 'flags', label: 'Notes', filter: 'chips', w: 'md' },
      ], rows: obs, empty: 'It owns no observations.' }), 'dv-wide')}
    </div></div>`;
  return layout({ title: p.title || p.id, active: 'problems', wide: true, body: body + COPY_SCRIPT });
}

export function groupPage(ctx, sig, family) {
  const s = snapshot(ctx), g = s.reg.unexplained.find(x => x.sig === sig && x.family === family);
  if (!g) return null;
  const newest = [...g.observations].sort((a, b) => Date.parse(b.when || b.at) - Date.parse(a.when || a.at));
  const rows = newest.map(o => ({ cells: {
    at: at(o.when || o.at), ref: { html: o.run ? `<a href="/runs/${encodeURIComponent(o.run)}">${esc(o.run)}</a>` : o.pr ? `#${esc(o.pr)}` : esc([o.agent, o.session].filter(Boolean).join(', ')), v: o.run || String(o.pr || '') },
    branch: { html: esc(o.branch || o.worktree || ''), f: o.branch || o.worktree || '' }, cost: { html: esc(dur(o.minutes)), v: o.minutes || 0 },
  } }));
  const body = `${STYLE}<div class="pr-detail"><p class="hint pr-crumbs"><a href="/problems?tab=list">Problems</a> · unexplained</p>
    <div class="pr-title"><h1>${esc(g.sig)}</h1><span class="hint">${esc(familyOf(g))}, ${esc(g.state)}</span></div>
    <p class="pr-story">${plural(g.count, 'observation')} no entry owns, first ${esc(dayOf(g.firstSeen))}, last ${esc(dayOf(g.lastSeen))}. A fix commit with a Kind: trailer and this signature, or a note (hq problem note --signature ${esc(shellWord(g.sig))}), would explain them.</p>
    ${panel('Each one', '', dataTable({ id: 'pr-group', columns: [{ key: 'at', label: 'When', w: 'md' }, { key: 'ref', label: 'Run, pull request or who waited', w: 'lg' }, { key: 'branch', label: 'Branch or worktree', filter: 'chips', w: 'lg' }, { key: 'cost', label: 'Cost', num: true, w: 'sm' }], rows }), 'dv-wide')}</div>`;
  return layout({ title: g.sig, active: 'problems', wide: true, body });
}

// Kinds keep one hue each, on their tag only, always beside their name; charts use hq.css's .ch- colours by meaning.
const STYLE = `<style>
.dv-wide { grid-column: 1 / -1; }
/* charts are drawn 640 units wide (hq/lib/charts.mjs): two to a row keeps their words near the size they were drawn at */
.bl-charts.pr-charts { grid-template-columns: repeat(auto-fit, minmax(min(100%, 560px), 1fr)); }
.pr-story { font-size: 15px; line-height: 1.55; max-width: 880px; margin: 4px 0 14px; color: var(--color-neutral-200); }
.pr-h { font-size: 15px; margin: 0 0 4px; } .pr-about { margin: 0 0 10px; font-size: 12.5px; line-height: 1.45; max-width: 70ch; }
.pr-fresh { margin: 6px 0 12px; font-size: 12.5px; }
[data-kind="product-bug"] { --k: #3987e5; } [data-kind="test-failure"] { --k: #d95926; } [data-kind="flaky-test"] { --k: #199e70; }
[data-kind="slot-contention"] { --k: #c98500; } [data-kind="pr-pileup"] { --k: #d55181; } [data-kind="proof-churn"] { --k: #008300; }
[data-kind="tooling-breakage"] { --k: #9085e9; } [data-kind="agent-mistake"] { --k: #e66767; }
.pr-kind { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: var(--radius-sm); color: var(--color-text);
  background: color-mix(in srgb, var(--k, var(--color-neutral-500)) 26%, transparent); border-left: 3px solid var(--k, var(--color-neutral-500)); white-space: nowrap; }
.pr-late, .pr-flag { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 99px; border: 1px solid color-mix(in srgb, #f0a6a6 55%, transparent); color: #f0a6a6; }
.pr-escapes { width: 100%; font-size: 13px; } .pr-escapes td, .pr-escapes th { vertical-align: top; padding: 6px 8px; } .pr-escapes .num { text-align: right; font-variant-numeric: tabular-nums; }
.pr-top { margin: 0; padding-left: 20px; display: grid; gap: 8px; font-size: 13.5px; line-height: 1.45; }
.pr-back { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 13.5px; line-height: 1.45; }
.pr-export { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; } .pr-export .btn { font-size: 13px; padding: 5px 11px; }
.pr-crumbs { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pr-detail { display: grid; gap: 14px; max-width: 1200px; }
.pr-detail .bl-facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0; font-size: 13.5px; }
.pr-detail .bl-facts dt { color: var(--color-neutral-400); } .pr-detail .bl-facts dd { margin: 0; overflow-wrap: anywhere; }
.pr-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 6px 0 2px; } .pr-title h1 { margin: 0; font-size: 22px; }
.pr-timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 13px; }
.pr-ev-fields { list-style: none; margin: 4px 0 0; padding: 0; font-size: 13px; color: var(--color-neutral-300); } .pr-ev-fields b { font-weight: 600; color: var(--color-neutral-200); }
.pr-timeline > li { display: grid; grid-template-columns: 130px 90px 1fr; gap: 10px; align-items: baseline; }
.pr-timeline .when { color: var(--color-neutral-500); } .pr-timeline .ev { font-weight: 600; }
.pr-missing { border: 1px solid color-mix(in srgb, #f0c38a 50%, transparent); }
@container page (max-width: 700px) { .pr-timeline > li { grid-template-columns: 1fr; gap: 0; } .pr-detail .bl-facts { grid-template-columns: 1fr; } }
</style>`;
