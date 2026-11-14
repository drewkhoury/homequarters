// CI as it happens: a part for the GitHub page's dashboard and Home (the runs going now, each job's steps, and for the
// step that runs the tests an estimate of which test it is on), and a page per run, /ci/<run id>, that refreshes itself
// while the run goes. Read-only: HQ only asks GitHub, through gh, what it already shows on its own Actions page.
import { esc, layout } from '../lib/page.mjs';
import { info } from '../lib/ui.mjs';
import { runGh } from '../lib/github.mjs';
import { storedCiRuns } from '../lib/runs.mjs';
import { ciNow, runWithJobs, describeRun, planFor, stepName, span, timeOf, setOf } from '../lib/ci-live.mjs';

const LIMIT = 'GitHub hands over a job\'s log only when the job ends, so which test CI is on cannot be read while it runs. The test named here is an estimate: the tests in the order CI runs them, with their times from the last CI runs that make ci-history downloaded, scaled to how long this step usually takes.';

const ago = ms => (ms == null ? '' : span((Date.now() - ms) / 1000));
const RESULT = { success: 'passed', failure: 'failed', cancelled: 'cancelled', skipped: 'skipped', timed_out: 'timed out' };
const resultWord = r => (r.status === 'completed' ? RESULT[r.conclusion] || r.conclusion || 'finished' : r.status === 'in_progress' ? 'running' : r.status);

// The estimate's line: "probably on smoke-sync (12 of 24), 1 min 5 s in", or why there is none.
function estimateLine(e) {
  if (!e) return '';
  if (!e.known) return `<p class="ci-est hint">No CI history here to estimate which test it is on. <code>make ci-history</code> downloads it.</p>`;
  if (!e.name) return '';
  const what = e.group ? `the ${esc(e.name)}` : `<b>${esc(e.name)}</b>`;
  const tail = e.over ? `, and running ${span(e.into)} longer than this step usually takes (${span(e.expected)})` : ` (${e.index + 1} of ${e.of}), ${span(e.into)} into it`;
  return `<p class="ci-est">Probably on ${what}${tail}. ${info(`${LIMIT} From the last ${e.runs} CI run${e.runs === 1 ? '' : 's'} of the ${e.set === 'after' ? 'long set' : 'gate'}.`, 'How this is estimated')}</p>`;
}

function stepsList(job) {
  return `<ol class="ci-steps">${job.steps.map(s => `<li data-state="${esc(s.state)}"${s.conclusion ? ` data-result="${esc(s.conclusion)}"` : ''}>
    <span class="ci-dot" aria-hidden="true"></span><span class="ci-step">${esc(s.name)}</span>
    <span class="ci-time">${s.state === 'running' ? `running ${span(s.seconds)}` : s.state === 'queued' ? 'waiting' : s.state === 'skipped' ? 'skipped' : span(s.seconds)}${s.state === 'done' && s.conclusion && s.conclusion !== 'success' ? ` · ${esc(RESULT[s.conclusion] || s.conclusion)}` : ''}</span></li>`).join('')}</ol>`;
}

function runCard(r, { full = false } = {}) {
  const jobs = r.jobs.map(j => `<section class="ci-job"><h4><span>${esc(j.name)}</span> <span class="ci-res" data-result="${esc(j.status === 'completed' ? j.conclusion : j.status)}">${esc(resultWord(j))}</span></h4>
    ${j.estimate ? estimateLine(j.estimate) : ''}${full || j.status !== 'completed' ? stepsList(j) : ''}</section>`).join('');
  return `<article class="ci-run" data-status="${esc(r.status)}">
    <header class="ci-head"><a class="ci-title" href="/ci/${esc(r.databaseId)}">${esc(r.workflowName)}: ${esc(r.displayTitle)}</a>
      <span class="ci-res" data-result="${esc(r.status === 'completed' ? r.conclusion : r.status)}">${esc(resultWord(r))}</span></header>
    <p class="ci-meta hint"><code>${esc(r.headBranch)}</code> · ${esc(String(r.headSha || '').slice(0, 7))} · ${esc(r.event)}${r.elapsed != null ? ` · ${r.status === 'completed' ? 'took' : 'running for'} ${span(r.elapsed)}` : ''} · <a href="${esc(r.url)}" target="_blank" rel="noopener">on GitHub</a></p>
    ${jobs || '<p class="hint">No jobs have started yet.</p>'}</article>`;
}

// The "CI running now" part: { html, mini, at }, as the GitHub page's parts answer. mini is Home's one line per run.
export async function ciNowPart(ctx) {
  const gh = ctx.gh || runGh;
  let now;
  try { now = await ciNow({ repo: ctx.repo, cache: ctx.cache, gh }); } catch (e) {
    const msg = `Could not ask GitHub: ${String(e.stderr || e.message || e).trim().split('\n').pop()}`;
    return { html: `<p class="hint">${esc(msg)}</p>`, mini: `<p class="hint">${esc(msg)}</p>`, at: Date.now() };
  }
  const recent = now.recent.slice(0, 5).map(r => `<li><a href="/ci/${esc(r.databaseId)}">${esc(r.workflowName)}: ${esc(r.displayTitle)}</a>
    <span class="ci-res" data-result="${esc(r.conclusion)}">${esc(resultWord(r))}</span> <span class="hint">${esc(ago(r.finished))} ago</span></li>`).join('');
  const html = `<div class="ci-now" data-ci-live="${now.going.length ? 'running' : 'idle'}">
    ${now.going.length ? now.going.map(r => runCard(r)).join('') : '<p class="hint">Nothing running on CI.</p>'}
    ${recent ? `<h4 class="ci-sub">Just finished</h4><ul class="ci-recent">${recent}</ul>` : ''}
    ${now.going.length ? `<p class="hint ci-limit">${esc('Steps are live. GitHub gives a job\'s log only when the job ends, so the test named is an estimate.')}</p>` : ''}</div>`;
  const mini = now.going.length
    ? `<ul class="ci-mini">${now.going.map(r => {
      const job = r.jobs.find(j => j.status !== 'completed') || r.jobs[0];
      const step = job && job.steps.find(s => s.state === 'running');
      const e = job && job.estimate;
      return `<li><a href="/ci/${esc(r.databaseId)}">${esc(r.workflowName)}</a> <code>${esc(r.headBranch)}</code> <span class="hint">${step ? `${esc(step.name)} ${span(step.seconds)}` : esc(resultWord(r))}${e && e.known && e.name && !e.group ? ` · probably ${esc(e.name)}` : ''}</span></li>`;
    }).join('')}</ul>`
    : `<p class="hint">Nothing running on CI.${now.recent[0] ? ` Last: ${esc(now.recent[0].workflowName)} ${esc(resultWord(now.recent[0]))} ${esc(ago(now.recent[0].finished))} ago.` : ''}</p>`;
  return { html, mini, at: now.at };
}

// /ci/<run id>: one run, all its jobs and steps. With ?part=1 only the run's card, which hq-ci.js fetches every few
// seconds while the run goes. Once it has finished it says how, links to it on GitHub, and to HQ's view of its test
// results when make ci-history has downloaded them.
export async function ciRunPage(ctx, runId, params = new URLSearchParams()) {
  if (!/^\d{1,20}$/.test(String(runId))) return null;
  const gh = ctx.gh || runGh, step = stepName(ctx.repo);
  let run;
  try { run = await runWithJobs({ repo: ctx.repo, gh, id: runId }); } catch { run = null; }
  if (!run || !run.databaseId) return null;
  const plans = {};
  const r = await describeRun(run, { step, plan: async (set, part) => (plans[`${set} ${part}`] ??= await planFor({ repo: ctx.repo, cache: ctx.cache, gh, set, part, step })) });
  const done = r.status === 'completed';
  // HQ's run for this attempt, whatever parts it uploaded; an attempt that uploaded nothing (only the filed job re-run)
  // shows the newest one before it
  const attempts = done ? storedCiRuns(ctx.cache).filter(x => String(x.info.run) === String(r.databaseId) && x.info.attempt <= (r.attempt || 1)) : [];
  const results = [...new Map(attempts.sort((a, b) => a.info.attempt - b.info.attempt).map(x => [x.info.kind, x.id])).values()];
  const end = done ? `<p class="ci-done">Finished ${esc(ago(timeOf(r.updatedAt)))} ago: <span class="ci-res" data-result="${esc(r.conclusion)}">${esc(resultWord(r))}</span>.
      <a href="${esc(r.url)}" target="_blank" rel="noopener">Open it on GitHub</a>${results.map(id => ` · <a href="/runs/${esc(id)}">its test results in HQ</a>`).join('')}${results.length ? '' : ' · <span class="hint">make ci-history downloads its test results</span>'}</p>` : '';
  const card = `<div class="ci-live" data-status="${esc(r.status)}">${end}${runCard(r, { full: true })}</div>`;
  if (params.has('part')) return card;
  const body = `<p class="hq-crumbs"><a href="/github">GitHub</a> <span class="sep">/</span> CI run ${esc(r.databaseId)}</p>
    <div class="hq-pagehead"><h1>${esc(r.workflowName)}: ${esc(r.displayTitle)}${info(LIMIT, 'What can be seen live')}</h1></div>
    <p class="hint">Steps come from GitHub as they run. ${done ? '' : 'This page refreshes every 10 seconds while the run goes.'}</p>
    ${card}<script src="/hq/hq-ci.js" defer></script>`;
  return layout({ title: `CI ${r.displayTitle}`, active: 'github', body });
}

export { setOf };
