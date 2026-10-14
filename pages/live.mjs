// A run as it happens: /runs/<id>/live. At the top what is running, where, for whom and for how long; then every test
// the run will report, filling in as the log says (waiting, running, passed with its seconds, failed with the end of
// its output); and the log itself, coloured, following its end unless you scroll up. hq-live.js keeps it all current
// from /runs/<id>/live/stream. A run that has already finished is shown the same way, from its file, without the
// stream. HQ only reads: nothing here starts, stops or waits on a run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esc, layout } from '../lib/page.mjs';
import { info } from '../lib/ui.mjs';
import { makeSets } from '../lib/catalogue.mjs';
import { parseProgress, expectedTests, ansiToHtml, stripAnsi, runTasks, liveNow, isLive, finishedRun, safeId, folderTime, liveStream as streamOf } from '../lib/live.mjs';

export { liveNow };
import { runInfoLine } from '../lib/runs.mjs';

// The stream for /runs/<id>/live/stream?task=&from=: what the log gains, as NDJSON (hq/lib/live.mjs).
export const liveStream = (ctx, runId, task, from) => streamOf(ctx, runId, task, from, { sets: sets(ctx.repo) });

const sets = repo => { try { return makeSets(readFileSync(join(repo, 'Makefile'), 'utf8')); } catch { return {}; } };
const secs = s => (s == null ? '' : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const ago = ms => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`; };
const STATE_WORD = { waiting: 'waiting', running: 'running', passed: 'passed', failed: 'failed', notrun: 'not run' };
const LONG_LINE = 1500; // the container's script line is several KB; shown cut, whole on hover

// One row per test in the smart view. hq-live.js draws the same rows from the stream; this is the first drawing.
export function testRows(p) {
  if (p.mode === 'counts') {
    const s = p.summary;
    return `<p class="lv-counts"><b>${p.totals.passed}</b> passed · <b class="${p.totals.failed ? 'fail' : ''}">${p.totals.failed}</b> failed${s ? ` · of ${s.tests}` : p.phase === 'running' ? ' so far' : ''}</p>` +
      p.tests.filter(t => t.state === 'failed').map(row).join('');
  }
  if (p.mode === 'plain') return '<p class="hint">This kind of log has no test markers HQ knows; the log is below.</p>';
  return p.tests.map(row).join('');
}
function row(t) {
  return `<li class="lv-test" data-state="${esc(t.state)}"${t.line != null ? ` data-line="${t.line}"` : ''}>
    <span class="lv-dot" aria-hidden="true"></span><span class="lv-name">${esc(t.name)}</span>
    <span class="lv-state">${esc(STATE_WORD[t.state] || t.state)}${t.timeLimit ? ', hit its time limit' : ''}</span><span class="lv-secs">${esc(secs(t.seconds))}</span>
    ${t.excerpt ? `<pre class="lv-excerpt">${esc(stripAnsi(t.excerpt))}</pre>` : ''}</li>`;
}
const PHASE = { unit: 'Unit tests are running.', rules: 'Rules tests are running.', browser: 'Browser tests are running in their lanes; their results print together when every lane has finished.', finishing: 'Finishing: the leak check and the emulators shutting down.', running: 'Running.' };

export function logHtml(text) {
  return text.replace(/\n$/, '').split('\n').map((l, i) => {
    const long = l.length > LONG_LINE;
    return `<div class="lv-l" id="lv-${i}"${long ? ` title="${esc(stripAnsi(l).slice(0, 4000))}"` : ''}>${ansiToHtml(long ? `${l.slice(0, LONG_LINE)}…` : l) || ' '}</div>`;
  }).join('');
}

export function livePage(ctx, runId, params = new URLSearchParams()) {
  const id = safeId(runId);
  const tasks = id ? runTasks(ctx.cache, id) : [];
  if (!tasks.length) return null;
  const t = tasks.find(x => x.task === params.get('task')) || tasks[0];
  let text = '';
  try { text = readFileSync(t.file, 'utf8'); } catch { return null; }
  const live = isLive(ctx, id), plain = stripAnsi(text), infoLine = runInfoLine(plain) || {};
  const p = parseProgress(text, { expected: expectedTests(plain, infoLine.kind, sets(ctx.repo)), live });
  const now = liveNow(ctx), holder = live ? now.run : null, done = finishedRun(ctx, id);
  const started = folderTime(id) || Date.parse(holder?.since) || Date.now();
  const ok = done ? (done.tasks || []).filter(x => !x.skipped).every(x => x.status === 'PASS') : p.finished === 'passed';
  const banner = live ? `<div class="lv-banner" data-state="live"><span class="lv-pulse" aria-hidden="true"></span>Running for <b data-elapsed="${started}">${esc(ago(started))}</b>${p.phase ? ` · ${esc(PHASE[p.phase] || '')}` : ''}</div>`
    : `<div class="lv-banner" data-state="${ok ? 'passed' : 'failed'}">Finished: <b>${ok ? 'passed' : 'failed'}</b>${done ? ` · <a href="/runs/${encodeURIComponent(id)}">the run's results</a>` : ''}</div>`;
  const head = [infoLine.kind || t.task, infoLine.branch && `${infoLine.branch}@${infoLine.commit || '?'}${infoLine.dirty ? '+' : ''}`, infoLine.where, (holder && holder.who) || infoLine.who, infoLine.lanes && `${infoLine.lanes} lane${infoLine.lanes === 1 ? '' : 's'}`]
    .filter(Boolean).map(esc).join(' · ');
  const taskTabs = tasks.length > 1 ? `<nav class="hq-tabs lv-tasks" aria-label="Logs in this run">${tasks.map(x => `<a href="?task=${encodeURIComponent(x.task)}"${x === t ? ' class="on" aria-current="page"' : ''}>${esc(x.task)}</a>`).join('')}</nav>` : '';
  const data = { runId: id, task: t.task, offset: Buffer.byteLength(text), live, started };
  const body = `<p class="hq-crumbs"><a href="/testing?tab=runs">Runs</a> <span class="sep">/</span> ${esc(id)}${live ? ' <span class="sep">/</span> live' : ''}</p>
    <div class="hq-pagehead"><h1>${live ? 'Running now' : 'Run'}${info('Read from the run\'s log as it is written, and from the lock that says who holds the test slot. HQ only watches: it never starts, stops or waits on a run. In a container the browser tests print their results together at the end, so until then they all show as running.', 'About this page')}</h1></div>
    <p class="lv-head">${head}</p>${banner}${taskTabs}
    <div class="lv-grid">
      <section class="lv-tests card" aria-label="Tests"><h2>Tests <span class="hint lv-totals"></span></h2><ol class="lv-list">${testRows(p)}</ol></section>
      <section class="lv-log card" aria-label="The log"><div class="lv-loghead"><h2>Log</h2><span class="hint">${esc(t.task)}.log</span><button type="button" class="btn btn-ghost lv-end" hidden>Jump to the end</button></div>
        <div class="lv-pane" tabindex="0">${logHtml(text)}</div></section>
    </div>
    <script type="application/json" id="lv-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
    <script src="/hq/hq-live.js" defer></script>`;
  return layout({ title: live ? 'Running now' : `Run ${id}`, active: 'testing', body, wide: true });
}

// Home's line about the run holding the slot, or '' when nothing runs.
export function liveCard(ctx) {
  const { run, folder } = liveNow(ctx);
  if (!run) return '';
  const since = Date.parse(run.since);
  const link = folder ? `<a href="/runs/${encodeURIComponent(folder)}/live">watch</a>` : '<span class="hint">its log has not started</span>';
  return `<section class="card hq-card lv-card"><div class="hq-card-head"><span class="kicker"><span class="lv-pulse" aria-hidden="true"></span>Running now</span></div>
    <p class="lv-cardline"><b>${esc(run.target || 'a run')}</b> on <code>${esc(run.branch || '?')}</code> for ${esc(run.who)}, <span data-elapsed="${since}">${esc(ago(since))}</span> · ${link}</p></section>`;
}
