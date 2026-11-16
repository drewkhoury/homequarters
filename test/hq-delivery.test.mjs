// Proves: the Delivery page (pages/delivery.mjs), from figures made of the real runs in fixtures/dora, leads with
// four figures as labels and values, marks a small sample, compares with the days before only when that is fair,
// lists the pull requests waiting on the reader, keeps the project's own words out of its headlines, keeps every list
// under six rows outside the drill-down, and never blocks on a refresh or starts a fetch of its own.
// Why: Drew rejected a Delivery page that was a data dump; and a test or the demo opening the page must not reach
// GitHub, so the refresh takes a stand-in for execFile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { compute, summarise, configureDelivery } from '../lib/dora.mjs';
import { QK_DELIVERY } from './fixtures/delivery.mjs';
configureDelivery(QK_DELIVERY); // the fixtures are QuestKeep's runs, with its job and step names
import { deliveryPage, STALE_MIN } from '../pages/delivery.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = join(here, '..', '..');
const fixture = name => JSON.parse(readFileSync(join(here, 'fixtures', 'dora', `${name}.json`), 'utf8'));
const runs = fixture('runs'), jobs = fixture('jobs');
const MAIN = runs.filter(r => r.path.endsWith('deploy.yml') && r.event === 'push').map(r => r.head_sha);
const git = { changed: () => true, contains: (a, b) => MAIN.indexOf(b) <= MAIN.indexOf(a) };
const NOW = Date.parse('2026-10-06T12:00:00Z');
// The figures as make dora would write them at `asOf`. The fixtures' record starts on 30 September, so at NOW the 7
// days run from 29 September with 9 player-facing deploys, 3 timed changes and the one red live check, and the 7 days
// before hold no record at all. Two days later the red has left the window; by late November nothing is in it.
const doraAt = asOf => summarise(compute({ runs, jobsOf: (id, a) => jobs[`${id}-${a}`], logs: new Map(Object.entries(fixture('logs')).map(([k, v]) => [Number(k), v])),
  pulls: fixture('pulls'), lock: fixture('lock'), commits: fixture('commits'), git }),
{ asOf, repo: 'owner/questkeep', sources: { runs: { status: 'read', n: runs.length, through: '2026-10-06T04:59:17Z' }, hostingReleases: { status: 'unread', reason: 'needs a Firebase login' } } });
// The open pull requests in fixtures/dora/waiting.json, as make dora saw them at 18:00 on 6 October: #1 and #179 have
// merged twins, #157's checks failed, #179's and #199's passed.
const wfx = fixture('waiting');
const waiting = summarise(compute({ runs: wfx.runs, jobsOf: () => [], pulls: wfx.merged, openPulls: wfx.open, git }), { asOf: Date.parse('2026-10-06T18:00:00Z'), sources: {} }).waiting;
const dora = { ...doraAt(NOW), waiting };
const window7 = f => f.windows.find(w => w.id === '7d');

// The same figures with more of everything a list on the page could show: 9 extra pull request reds and 6 extra red live
// checks inside the 7 days, so a list that is not capped at 5 rows would run past it.
function crowded() {
  const f = structuredClone(dora), red = f.items.prReds[0], failed = f.items.failures.find(x => x.released);
  for (let i = 1; i <= 9; i++) f.items.prReds.push({ ...red, run: 900000 + i, at: `2026-10-0${1 + (i % 4)}T12:0${i}:00Z`, url: red.url.replace(/\d+$/, String(900000 + i)) });
  for (let i = 1; i <= 6; i++) f.items.failures.push({ ...failed, run: 800000 + i, at: `2026-10-0${1 + (i % 4)}T13:0${i}:00Z`, explainedBy: null });
  return f;
}

// a cache folder holding `data` as dora.json, written `ageMin` minutes before NOW, or none
const cacheWith = (t, ageMin, data = dora) => {
  const cache = mkdtempSync(join(tmpdir(), 'qk-delivery-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  if (ageMin != null) {
    mkdirSync(join(cache, 'dora'));
    const f = join(cache, 'dora', 'dora.json');
    writeFileSync(f, JSON.stringify(data));
    const when = (NOW - ageMin * 60000) / 1000; utimesSync(f, when, when);
  }
  return cache;
};
// a stand-in for execFile that records what it was asked to run and finishes at once
const spy = () => { const calls = []; const run = (cmd, args, opts, done) => { calls.push(args); done(null); }; return { calls, run }; };
const open = async (t, query = '', data = dora) => deliveryPage({ repo, cache: cacheWith(t, 5, data) }, new URLSearchParams(query), { now: NOW, run: spy().run });
const text = html => html.replace(/<style>[^]*?<\/style>/g, ' ').replace(/<\/?(a|span|b|i)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'').replace(/\s+/g, ' ');
// the page with its closed Method drawer cut out: the one place a fixed list (the sources) and QuestKeep's own words
// may sit
const mainOf = html => html.replace(/<details[^>]*data-reference[^]*?<\/details>/, '');
const tiles = html => [...html.matchAll(/<div class="dv-tile"[^>]*>([^]*?)<!--\/tile-->/g)].map(m => m[1]);
const section = (html, id) => (new RegExp(`<section[^>]*id="${id}"[^]*?</section>`).exec(html) || [''])[0];
// a run that has not finished, as a refresh of make dora can take minutes; finish() lets it end
const hang = () => { const calls = [], ends = []; return { calls, finish: () => ends.forEach(f => f(null)), run: (cmd, args, opts, done) => { calls.push(args); ends.push(done); } }; };

test('with no figures yet the page says so and what to run, and starts nothing', async t => {
  const s = spy();
  const html = await deliveryPage({ repo, cache: cacheWith(t, null) }, new URLSearchParams(), { now: NOW, run: s.run });
  assert.match(text(html), /No delivery data yet/);
  assert.match(html, /<code>hq dora<\/code>/);
  assert.equal(s.calls.length, 0);
});

test('old figures start one refresh in the background, without a git fetch, and show while it runs', async t => {
  const s = spy();
  const html = await deliveryPage({ repo, cache: cacheWith(t, STALE_MIN + 5) }, new URLSearchParams(), { now: NOW, run: s.run });
  assert.equal(s.calls.length, 1);
  assert.ok(s.calls[0].includes('--no-fetch-git'));
  assert.ok(s.calls[0].includes('--no-daily'), 'the dated copies are left to runs that fetched main');
  assert.equal(tiles(html).length, 4);
});

test('Refresh answers at once and says it is updating, however long make dora takes', async t => {
  const h = hang();
  const page = deliveryPage({ repo, cache: cacheWith(t, 5) }, new URLSearchParams('fresh=1'), { now: NOW, run: h.run });
  let timer;
  const html = await Promise.race([page, new Promise(res => { timer = setTimeout(() => res(null), 1000); })]); // cap: a page that waits for make dora loses the race
  clearTimeout(timer); // so node need not wait out the second once the page has answered
  h.finish();
  await page;
  assert.ok(html, 'the page answered while make dora was still running');
  assert.equal(h.calls.length, 1, 'the refresh started');
  assert.match(text(html), /Updated 5 min ago · refreshing…/);
  assert.equal(tiles(html).length, 4, 'the figures on disk show meanwhile');
});

test('in the demo nothing is refreshed, however old the figures', async t => {
  const s = spy();
  await deliveryPage({ repo, cache: cacheWith(t, STALE_MIN + 5), demo: {} }, new URLSearchParams('fresh=1'), { now: NOW, run: s.run });
  assert.equal(s.calls.length, 0);
});

test('figures from an older hq dora start a refresh and say so, instead of crashing', async t => {
  const { series, ...v1 } = dora, s = spy();
  const html = await deliveryPage({ repo, cache: cacheWith(t, 1, { ...v1, version: 1 }) }, new URLSearchParams(), { now: NOW, run: s.run });
  assert.doesNotMatch(html, /Something went wrong/);
  assert.match(text(html), /The saved figures are from an older hq dora/);
  assert.equal(s.calls.length, 1, 'one refresh starts even though the file is only a minute old');
});

test('the header names the repo, the period from the record\'s first day, New York time and when it was updated', async t => {
  const words = text(await open(t));
  assert.match(words, /\bquestkeep\b/);
  // the fixtures' record starts on 30 September, inside these 7 days, so the range starts there and nothing comes before
  assert.match(words, /30 Sept – 5 Oct · New York time · no earlier data/);
  assert.doesNotMatch(words, /too few to compare/i, 'a figure\'s own caveat stays on its tile');
  assert.match(words, /Updated 5 min ago/);
  assert.match(words, /Today: no deploys/);
});

test('four tiles in two groups, each a label and a value with no sentence', async t => {
  const html = await open(t);
  assert.match(text(html), /Speed Deploys .*Lead time .*Stability Failed deploys .*Time to green/);
  assert.doesNotMatch(html, /Rework/, 'fix: titles are a naming habit here, so Rework would mislead');
  const t4 = tiles(html);
  assert.equal(t4.length, 4);
  for (const tile of t4) {
    assert.match(tile, /class="dv-value"/);
    assert.match(tile, /role="img"/, 'each tile has its chart');
    assert.doesNotMatch(text(tile.replace(/<span class="hq-tip"[^]*?<\/span>/g, '')), /\w\.\s|\w\.$/, 'no sentence in a tile');
  }
  const seen = tile => text(tile.replace(/<span class="hq-tip"[^]*?<\/span>/g, ''));
  assert.match(seen(t4[0]), /Deploys 9 1\.5 a day/);
  assert.match(seen(t4[1]), /Lead time 12 min median 3 changes/);
  assert.match(seen(t4[2]), /Failed deploys 1 of 9/);
  assert.match(seen(t4[3]), /Time to green 16 min 1 red/);
});

test('a figure on fewer than 10 values carries its count with a dotted mark and the reason in its title', async t => {
  const html = await open(t);
  assert.match(html, /<span class="dv-n" title="Fewer than 10: one more could move this a lot">3 changes<\/span>/);
});

test('a comparison shows as a chip only when it is fair; with no earlier record the period bar says so once', async t => {
  const none = await open(t);
  assert.doesNotMatch(none, /class="dv-chip/);
  assert.equal((text(none).match(/no earlier data/gi) || []).length, 1);
  const fair = structuredClone(dora), w = window7(fair);
  w.portable.deploys.compare = { ok: true, now: 9.7, before: 4.4, reason: null };
  w.portable.leadTime.compare = { ok: true, now: 716, before: 2613, reason: null };
  w.prev.portable.leadTime.median = 2613;
  const html = await open(t, '', fair), [deploys, lead] = tiles(html);
  assert.match(deploys, /class="dv-chip good"[^>]*>▲ Prior 7 days: 4\.4 a day</);
  assert.match(lead, /class="dv-chip good"[^>]*>▼ Prior 7 days: 44 min</, 'a shorter lead time is the good direction');
});

test('a failed deploy that went green again is drawn plainly in its tile; one still red is marked', async t => {
  assert.doesNotMatch(tiles(await open(t))[2], /dv-red|hq-mark/);
  const still = structuredClone(dora), w = window7(still);
  for (const r of [...still.items.recoveries, ...w.portable.recovery.items]) Object.assign(r, { sec: null, restoredAt: null, restoredRun: null });
  const [, , failed, green] = tiles(await open(t, '', still));
  assert.match(failed, /dv-red/);
  assert.match(failed, /hq-mark bad/);
  const seen = text(green.replace(/<span class="hq-tip"[^]*?<\/span>/g, ''));
  assert.match(seen, /Time to green ! Red now/);
  assert.match(seen, /1 waiting for a passing deploy/);
});

test('a comparison too small to make shows the prior figure in a grey chip, with the reason in its title', async t => {
  // at 9 October the 7 days before hold 30 September and 1 October: 1 of 4 deploys failed, too few to compare
  const html = await open(t, '', { ...doraAt(Date.parse('2026-10-09T12:00:00Z')), waiting });
  assert.match(tiles(html)[2], /<span class="dv-chip same" title="Too few to compare">1 of 4 in the prior 7 days<\/span>/);
  assert.doesNotMatch(text(html), /too few to compare/i, 'the reason is a tooltip, not a line');
  assert.match(text(html), /2 Oct – 8 Oct · New York time · record from 30 Sept/);
});

test('Method defines its words once, without Rework, links the decision record and names every source', async t => {
  const f = structuredClone(dora);
  f.sources.pullsOpen = { status: 'read', n: 1, label: 'Open pull requests' };
  f.sources.nightly = { status: 'unread', label: 'Nightly copies' };
  const m = /<details[^>]*data-reference[^]*?<\/details>/.exec(await open(t, '', f))[0], words = text(m);
  assert.match(words, /Flake A test that passed and failed on the same commit\./);
  assert.match(m, />Decision record →</);
  assert.match(words, /Open pull requests/);
  assert.match(words, /Nightly copies Not collected –/, 'an empty cell says so');
  assert.doesNotMatch(m, />(pullsOpen|nightly)</, 'never a raw key');
});

// The Player-facing trailer says a fix changes what players get, and most are caught in review before release, so the
// line names what it counts rather than claiming players saw each bug (Nell, review of #281)
test('fixes to what players get says none are tagged yet, with the count of fixes', async t => {
  assert.match(text(section(await open(t), 'dv-live').replace(/<span class="hq-tip"[^]*?<\/span>/g, '')), /Fixes to what users get None tagged yet \(0 of 3 fixes\)/);
});

test('no number is hedged or given in decimal hours, and times follow New York\'s clock', async t => {
  const words = text(mainOf(await open(t)));
  assert.doesNotMatch(words, /\b(about|nearly|over|or longer|half|1 in 10)\b|\d\.\d h\b/i);
  assert.match(words, /1 h 52 min/, '#175 took 6691 s');
  assert.match(words, /30 Sept 04:52/, 'the red live check at 08:52 UTC');
});

test('Waiting on you lists the open pull requests oldest first, with age, checks and a stale mark', async t => {
  const sec = section(await open(t), 'dv-waiting'), words = text(sec);
  assert.match(words, /Waiting on you/);
  assert.deepEqual([...sec.matchAll(/pull\/(\d+)"/g)].map(m => Number(m[1])).filter(n => [1, 157, 179, 199].includes(n)), [1, 157, 179, 199]);
  assert.match(words, /#199 fix: a device whose own list is stuck far ahead comes back to today 54 min Checks passed/);
  assert.match(words, /#157 .*! Checks failed/);
  assert.match(sec, /title="#197 merged with the same title">Probably stale</);
  const empty = await open(t, '', { ...dora, waiting: [] });
  assert.match(text(section(empty, 'dv-waiting')), /Nothing waiting on you/);
});

test('the deploys chart has no same-app series; same-app redeploys are counted in Method from the note that dates the skip', async t => {
  const moved = structuredClone(dora);
  // the project's own note on the rule (delivery.countingChanges), moved a day, dating the skip by its since key
  moved.countingChanges = [{ date: '2026-10-04', what: 'Pushes that don\'t change served files stop deploying.', decision: null, since: 'skipped-redeploys' }];
  const html = await open(t, '', moved);
  assert.doesNotMatch(section(html, 'dv-deploys'), /Same-app|bl-s-ghost/);
  assert.match(text(html), /Same-app redeploys: 0 · skipped since 4 Oct/);
  assert.doesNotMatch(html, /October 2026/);
});

// Proves: the two dates Delivery gives in words, the day the gate moved to the Laptop and the day redeploys of a tree
// already live started being skipped, come from the notes whose since key names them, and from no decision file's
// name. Why: through 0.3.2 HQ found them by QuestKeep's decision names, so no other project could date them (0.3.3).
test('the Laptop and skipped-redeploy dates come from the notes that say since, and none from decision names', async t => {
  const at = { ...doraAt(Date.parse('2026-10-08T12:00:00Z')), waiting };
  const page = async notes => text(await open(t, '', { ...at, countingChanges: notes }));
  const laptop = { date: '2026-10-03', what: 'CI moved to the Laptop.', decision: null, since: 'laptop-gate' };
  const skip = { date: '2026-10-04', what: 'Pushes that don\'t change served files stop deploying.', decision: null, since: 'skipped-redeploys' };
  const both = await page([laptop, skip]);
  assert.match(both, /Gate time 5 min median · Laptop 3 runs, Laptop since 3 Oct/);
  assert.match(both, /skipped since 4 Oct/);
  const named = await page([{ ...laptop, since: undefined, decision: '2026-10-03-ci-on-the-laptop.md' },
    { ...skip, since: undefined, decision: '2026-10-05-deploy-only-when-served-files-change.md' }]);
  assert.match(named, /Gate time 5 min median · Laptop 3 runs/);
  assert.doesNotMatch(named, /Laptop since|skipped since/);
});

test('the deploys chart draws the period before as a dashed line where the record reaches it', async t => {
  const html = await open(t, '', { ...doraAt(Date.parse('2026-10-09T12:00:00Z')), waiting });
  assert.match(section(html, 'dv-deploys'), /class="bl-prior"/);
  assert.match(section(html, 'dv-deploys'), />Prior 7 days</);
  // each day's tooltip pairs it with the same day of the period before, in the copy sheet's words
  assert.match(section(html, 'dv-deploys'), /data-tip="8 Oct: 0 deploys · 1 Oct: 1"/);
});

test('lead time shows each change with its median and 90th percentile, its stages, and the slowest on one axis', async t => {
  const sec = section(await open(t), 'dv-lead'), words = text(sec);
  assert.match(sec, /aria-label="Lead time per change, 30 Sept – 5 Oct: median 12 min, 3 changes\."/);
  assert.match(words, /Lead time by stage/);
  assert.match(words, /Median change #132 Laptop 12 min/);
  assert.match(words, /Slowest/);
  assert.match(words, /3 slowest: [\d dhmin]+ of [\d dhmin]+ waiting to merge/);
  assert.match(words, /All 10 changes →/);
});

test('a failed deploy links to its follow-up, and the page never calls it a false alarm itself', async t => {
  const html = await open(t);
  assert.match(html, /href="https:\/\/github\.com\/example-org\/questkeep\/commit\/e6b4837829db97bbb97405f712dcf524224e93e6"[^>]*>e6b4837</);
  assert.match(text(html), /Follow-up e6b4837 · fix: deploys go green/);
  assert.doesNotMatch(text(html), /false alarm/i);
});

test('the latest red attempts put a failing test first and leave experiments out, with a count', async t => {
  const html = await open(t), at = s => html.indexOf(s);
  assert.ok(at('fix/flaky-unit-tests') > 0 && at('fix/flaky-unit-tests') < at('fix/modules-volume-per-lock'), 'the failing test comes before the machine');
  assert.ok(at('ci/laptop-runner-switch') > 0);
  assert.equal(at('exp/filing-parent-arm'), -1);
  assert.match(text(html), /1 experiment not shown/);
});

test('the red figure says it counts attempts, and what an attempt is', async t => {
  const pipeline = section(await open(t), 'dv-pipeline');
  assert.match(pipeline, /<span class="dv-stat-k" title="[^"]*every attempt[^"]*">Red attempts<\/span>/);
  assert.doesNotMatch(pipeline, />Red runs</);
});

test('gate time names its runner and is not compared across the move to the Laptop', async t => {
  const words = text(section(await open(t), 'dv-pipeline'));
  assert.match(words, /Gate time 5 min median · Laptop/);
  assert.doesNotMatch(words, /GitHub took|not compared/);
});

test('no headline holds a sentence or one of QuestKeep\'s own words', async t => {
  for (const q of ['', 'range=30d']) {
    const html = mainOf(await open(t, q));
    const heads = [...html.matchAll(/<h[1-3][^>]*>([^]*?)<\/h[1-3]>/g), ...html.matchAll(/<span class="dv-label">([^]*?)<\/span>/g)].map(m => text(m[1]).trim());
    assert.ok(heads.length >= 10, `found ${heads.length} headlines`);
    for (const h of heads) {
      assert.doesNotMatch(h, /\b(decide|rows?|gates?|slot|runners?|make dora)\b/i, h);
      assert.doesNotMatch(h, /[.?]$/, `a headline ends like a sentence: ${h}`);
      assert.ok(h.split(/\s+/).length <= 4, `a headline of more than 4 words: ${h}`);
    }
  }
});

test('no list on the page runs past 5 rows, and each long one links to its full list', async t => {
  const html = mainOf(await open(t, '', crowded()));
  for (const m of html.matchAll(/<(ul|ol|tbody)\b[^>]*>([^]*?)<\/\1>/g)) {
    const rows = (m[2].match(m[1] === 'tbody' ? /<tr\b/g : /<li\b/g) || []).length;
    assert.ok(rows <= 5, `a ${m[1]} with ${rows} rows: ${text(m[2]).slice(0, 80)}`);
  }
  assert.match(html, /href="\/delivery\?range=7d&amp;list=reds"[^>]*>All 16 red attempts →/);
  assert.match(html, /href="\/delivery\?range=7d&amp;list=failures"[^>]*>All 7 failed deploys →/);
});

test('the drill-down shows the whole list behind a figure, with a summary and a way back', async t => {
  const reds = await open(t, 'range=7d&list=reds', crowded());
  assert.equal((reds.match(/<tbody>[^]*?<\/tbody>/)[0].match(/<tr\b/g) || []).length, 16);
  assert.match(reds, /href="\/delivery\?range=7d"[^>]*>← Delivery</);
  assert.match(text(reds), /Red attempts · 30 Sept – 5 Oct/);
  const changes = await open(t, 'list=changes');
  assert.equal((changes.match(/<tbody>[^]*?<\/tbody>/)[0].match(/<tr\b/g) || []).length, 10, 'every change that went live in the 7 days, timed or not');
  assert.ok(changes.includes('pull/172'), 'a change links to its pull request');
  assert.doesNotMatch(changes, />Slot wait</);
  assert.ok((changes.match(/<th\b/g) || []).length <= 7, 'a list, not a spreadsheet');
});

test('a day\'s drill-down holds that day\'s deploys alone, with the day marked among the chips', async t => {
  // 5 October, Eastern, had three deploys; 3 October's are left out
  const html = await open(t, 'list=deploys&day=2026-10-05');
  for (const id of [37370455019, 37380538618, 37400367027]) assert.ok(html.includes(`actions/runs/${id}`), String(id));
  assert.ok(!html.includes('actions/runs/37107791344'), 'a deploy from another day');
  assert.match(text(html), /Deploys · 5 Oct/);
  const days = [...html.matchAll(/<a class="dv-day" href="\/delivery\?range=7d&amp;list=deploys&amp;day=(\d{4}-\d{2}-\d{2})"/g)].map(m => m[1]);
  assert.deepEqual(days, ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'], 'the record starts on 30 September');
  assert.match(html, /day=2026-10-05" aria-current="true"/);
});

test('a day before the record says so, rather than that it had nothing', async t => {
  assert.match(text(await open(t, 'list=deploys&day=2026-09-10')), /No record before 30 Sept/);
});

test('the 30 days start their charts on the record\'s first day, and a chart\'s day opens its list', async t => {
  const html = await open(t, 'range=30d');
  assert.ok(html.includes('list=deploys&amp;day=2026-09-30'));
  assert.ok(!html.includes('list=deploys&amp;day=2026-09-29'), 'a day before the record has no column');
  assert.match(text(html), /30 Sept – 5 Oct · New York time · no earlier data/);
});

test('headings run H1, H2, H3 in order, no ⓘ sits inside one, and a skip link leads past the header', async t => {
  for (const q of ['', 'list=changes']) {
    const html = await open(t, q);
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map(m => Number(m[1]));
    assert.equal(levels[0], 1, q);
    levels.forEach((l, i) => i && assert.ok(l <= levels[i - 1] + 1, `${q}: h${levels[i - 1]} then h${l}`));
    assert.doesNotMatch(html, /<h([1-6])\b[^>]*>(?:(?!<\/h\1>)[^])*hq-info/, `${q}: an ⓘ inside a heading`);
    const skip = /<a class="hq-skip" href="#([^"]+)">Skip to figures</.exec(html);
    assert.ok(skip, `${q}: a skip link`);
    assert.ok(html.includes(`id="${skip[1]}"`), `${q}: the skip link's target`);
  }
});

test('the period choice offers 7 and 30 days; yesterday is not a period', async t => {
  const html = await open(t, 'range=1d');
  assert.match(html, /href="\?range=7d"[^>]*aria-current="true"/, 'an unknown period falls back to 7 days');
  assert.match(html, /href="\?range=30d"/);
  assert.doesNotMatch(html, /Yesterday/);
});

test('the slot wait counts every Laptop gate run, and says none delayed a live change', async t => {
  const busy = structuredClone(dora);
  window7(busy).project.cost.slotWait = { gates: 62, waited: 8, sec: { n: 8, median: 172 } };
  assert.match(text(await open(t, '', busy)), /Test slot waits: 8 of 62 Laptop runs · median 3 min · none delayed a live change/);
});

test('the page loads the chart tooltips', async t => {
  assert.match(await open(t), /<script src="\/hq\/hq-charts\.js" defer><\/script>/);
});

// The rerun finds flakes that went unseen and adds no run, so the Flake rate rises the day it lands; the figure says how
// many of its flakes the rerun found, so the rise does not read as the tests getting worse.
test("the Flake rate says how many of its flakes the rerun found", async t => {
  const data = JSON.parse(JSON.stringify(dora));
  for (const w of data.windows) Object.assign((w.project || w.questkeep).cost, { flakes: 3, flakesByRerun: 2, testRuns: 40, flakesPer100: 7.5 });
  assert.match(text(section(await open(t, '', data), 'dv-pipeline')), /2 by the rerun/);
});

// Proves: the deploys chart marks the days of the project's notes that carry a mark, with the mark as the label, and
// draws nothing for a note without one, whatever its decision file is called. Why: through 0.3.2 a project with no
// marked note had the two marks HQ found by QuestKeep's decision names, which are one project's (0.3.3).
test('the deploys chart draws the marks the project\'s notes carry, and none from decision names', async t => {
  const marked = structuredClone(dora);
  marked.countingChanges = [{ date: '2026-10-02', what: 'The gate moved to a new runner.', decision: null, mark: 'New runner from here' },
    { date: '2026-10-03', what: 'CI moved to the Laptop.', decision: '2026-10-03-ci-on-the-laptop.md' }];
  const sec = section(await open(t, '', marked), 'dv-deploys');
  assert.match(sec, /New runner from here/);
  assert.doesNotMatch(sec, /Laptop CI from here/);
  const named = structuredClone(dora);
  named.countingChanges = [{ date: '2026-10-03', what: 'CI moved to the Laptop.', decision: '2026-10-03-ci-on-the-laptop.md' }];
  assert.doesNotMatch(section(await open(t, '', named), 'dv-deploys'), /Laptop CI from here/);
});

// Proves: Delivery takes the project's counting notes and its "Not counted" list from the manifest HQ started with,
// not from the copies dora.json saved, and names the zone its days are cut in from that zone, not New York.
// Why: on 15 November QuestKeep moved to 0.3.3 with notes that said since, and Delivery lost "skipped since" until make
// dora ran again, because it drew the notes dora.json had saved that morning. The list and the zone's name were
// QuestKeep's, written into the package.
test('the counting notes come from the manifest, not the copy dora.json saved', async t => {
  const what = 'Pushes that don\'t change served files stop deploying.';
  const saved = { ...structuredClone(dora), countingChanges: [{ date: '2026-10-04', what, decision: null }] };
  configureDelivery({ countingChanges: [{ date: '2026-10-04', what, decision: null, since: 'skipped-redeploys' }] });
  t.after(() => configureDelivery({ countingChanges: null }));
  assert.match(text(await open(t, '', saved)), /skipped since 4 Oct/);
});

test('Not counted lists the manifest\'s blind spots, and nothing of QuestKeep\'s without them', async t => {
  t.after(() => configureDelivery({ blindSpots: null }));
  configureDelivery({ blindSpots: ['Deploys made by hand.'] });
  const own = text(await open(t));
  assert.match(own, /Not counted Deploys made by hand\./);
  assert.doesNotMatch(own, /make deploy/);
  configureDelivery({ blindSpots: null });
  const none = text(await open(t));
  assert.doesNotMatch(none, /make deploy|Not counted/);
});

test('the period line names the zone the figures were cut in', async t => {
  const words = text(await open(t, '', { ...structuredClone(dora), tz: 'Europe/London' }));
  assert.match(words, /London time/);
  assert.doesNotMatch(words, /New York/);
  assert.match(text(await open(t, '', { ...structuredClone(dora), tz: 'UTC' })), /· UTC ·/);
});

// Proves: figures worked out with counting settings other than the manifest's (the user paths, workflows, jobs, steps
// or zone) start the background refresh that figures from an older hq dora start, and figures worked out
// with the same settings start none. Why: an edit to those keys changed nothing on Delivery until the next refresh
// that age alone set off.
test('figures worked out with other counting settings start a refresh, and the same settings start none', async t => {
  const other = { ...structuredClone(dora), settings: { ...dora.settings, userPaths: ['app'] } };
  const moved = spy(), same = spy();
  await deliveryPage({ repo, cache: cacheWith(t, 5, other) }, new URLSearchParams(), { now: NOW, run: moved.run });
  await deliveryPage({ repo, cache: cacheWith(t, 5, dora) }, new URLSearchParams(), { now: NOW, run: same.run });
  assert.equal(moved.calls.length, 1, 'a refresh for figures counted another way');
  assert.equal(same.calls.length, 0, 'none for figures counted this way');
});
