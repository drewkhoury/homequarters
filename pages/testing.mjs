// The Testing page: Pipeline, Tests and Runs as tabs over one filter (where the runs happened, and which branch),
// which every link on the page carries. A test opens to its runs, and a run to its tests.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { esc, urlPath, layout } from '../lib/page.mjs';
import { info, dataTable } from '../lib/ui.mjs';
import { catalogue } from '../lib/catalogue.mjs';
import { allRuns, flakes, resultsByFile, fileForCase, kindLabel, ago } from '../lib/runs.mjs';
import { safePath } from '../lib/paths.mjs';
import { gitInfo } from '../lib/outside.mjs';
import { pipelineView } from './pipeline.mjs';
import { loadLayers, layersPath, layerOf } from '../lib/layers.mjs';
import { layerCards, layerModals, layerButton } from './layers.mjs';

export const when = iso => { const d = new Date(iso); return isNaN(d) ? '?' : d.toLocaleString('sv-SE', { hour12: false }).slice(0, 16); };
export const secs = s => (s < 1 ? 'under 1 s' : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const commitOf = i => (i.commit ? `${i.commit}${i.dirty ? '+' : ''}` : '?');
const WHERE = [['', 'Anywhere'], ['laptop', 'Laptop'], ['container', 'Container'], ['ci', 'CI']];
// A set's title is its name, capitalised; the sets are the project's own (tests.sets).
const SET_TITLE = new Proxy({ helper: 'Helpers' }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k ? k[0].toUpperCase() + k.slice(1) : k) });
const plainLog = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''); // eslint-disable-line no-control-regex

// The shared filter, read from the page's address: where the runs happened and which branch they tested.
export function readFilter(params) {
  const where = WHERE.some(([k]) => k && k === params.get('where')) ? params.get('where') : '';
  return { where, branch: params.get('branch') || '' };
}
// A run by its id. A link to a run that ended in the last second names one the store has not looked for yet, so a miss
// looks at the folders again before it is a 404.
const runById = (cache, id, source) => {
  const find = runs => runs.find(x => x.id === id && (!source || x.source === source));
  return find(allRuns(cache)) || find(allRuns(cache, { maxAge: 0 }));
};
export const filterRuns = (runs, f) => runs.filter(r => (!f.where || (r.info.where || r.source) === f.where) && (!f.branch || r.info.branch === f.branch));

// A link to the Testing page that keeps the filter, with some parameters changed ('' drops one).
export function testingLink(f, extra = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ where: f.where, branch: f.branch, ...extra })) if (v) q.set(k, v);
  const s = q.toString();
  return `/testing${s ? '?' + s : ''}`;
}

function filterBar(f, tab, extra, branch) {
  const seg = (key, options) => `<div class="seg" role="group" aria-label="${key === 'where' ? 'Where' : 'Branch'}">${options.map(([v, label]) =>
    `<a class="seg-opt" href="${esc(testingLink({ ...f, [key]: v }, { tab: tab === 'pipeline' ? '' : tab, ...extra }))}"${f[key] === v ? ' aria-current="true"' : ''}>${esc(label)}</a>`).join('')}</div>`;
  const branches = [['', 'All branches'], ...(branch && branch !== 'main' ? [[branch, 'This branch']] : []), ['main', 'main']];
  return `<div class="hq-filterbar">${seg('where', WHERE)}${seg('branch', branches)}${info('These choices apply on every tab. Laptop is a run on this machine, Container is a run inside a test container, CI is a run on a CI runner. "This branch" means ' + (branch || 'the checked-out branch') + '.', 'About the filter')}</div>`;
}

// Screenshots by file name, newest first: ~/.cache/questkeep/shots/<run>/, once the tests save there
// (docs/backlog/next/commit-skill-and-shots.md), and the container's .shots/.
function screenshots(repo, cache) {
  const found = new Map();
  const add = (dir, url) => {
    let names = [];
    try { names = readdirSync(dir).filter(n => n.endsWith('.png')); } catch { return; }
    for (const n of names) {
      let t = 0; try { t = statSync(join(dir, n)).mtimeMs; } catch { /* gone */ }
      if (!found.has(n)) found.set(n, []);
      found.get(n).push({ url: url + encodeURIComponent(n), t });
    }
  };
  const shots = join(cache, 'shots');
  if (existsSync(shots)) for (const run of readdirSync(shots)) add(join(shots, run), `/cache/shots/${encodeURIComponent(run)}/`);
  add(join(repo, '.shots'), '/raw/.shots/');
  for (const list of found.values()) list.sort((a, b) => b.t - a.t);
  return found;
}

const result = (o, f) => o
  ? { html: `<a class="hq-res ${o.status}" href="/runs/${encodeURIComponent(o.run)}" title="${esc(`${when(o.when)}, ${o.commit || '?'}${o.dirty ? '+' : ''}`)}">${o.status === 'pass' ? 'pass' : 'FAIL'} <span>${secs(o.seconds)}</span></a>`, f: o.status === 'pass' ? 'pass' : 'FAIL', v: o.status }
  : { html: '<span class="hint">no runs</span>', f: 'no runs', v: 'z' };

function testsTab({ repo, cache }, runs, f, params, L) {
  const files = catalogue(repo), by = resultsByFile(runs, files), shots = screenshots(repo, cache);
  const flakyFiles = new Map();
  for (const x of flakes(runs)) { const file = fileForCase(x.task, x.test, files); if (file) flakyFiles.set(file.path, [...(flakyFiles.get(file.path) || []), x]); }
  const wheres = f.where ? [f.where] : ['laptop', 'container', 'ci'];
  const columns = [
    { key: 'test', label: 'Test', filter: 'text', w: 'lg' },
    { key: 'set', label: 'Set', filter: 'chips', w: 'sm', preset: params.get('set') ? SET_TITLE[params.get('set')] : null },
    ...(L ? [{ key: 'layer', label: 'Kind', filter: 'chips', w: 'md' }] : []),
    { key: 'proves', label: 'What it proves', filter: 'text', sort: false, wrap: true },
    ...wheres.map(w => ({ key: w, label: WHERE.find(([k]) => k === w)[1], filter: 'chips', w: 'sm' })),
    { key: 'last', label: 'Last 12', sort: false, w: 'md' },
    { key: 'flaky', label: 'Flaky', filter: 'chips', w: 'sm', preset: params.get('flaky') ? 'flaky' : null },
  ];
  const rows = files.map(file => {
    const obs = by.get(file.path) || [], fl = flakyFiles.get(file.path), h = file.fields;
    const what = h ? [['Proves', h.proves], ['Why it exists', h.why], ['Runs in', h.runsIn], ['Takes', h.takes], ['Run it when', h.runWhen]].filter(([, v]) => v)
      .map(([k, v]) => `<b>${k}:</b> ${esc(v)}`).join('<br>') + (file.description ? `<br>${esc(file.description)}` : '') : esc(file.description);
    const pics = file.shots.filter(n => shots.has(n)).map(n => `<a href="${shots.get(n)[0].url}" target="_blank" rel="noopener">${esc(n)}</a>`);
    const cells = {
      test: { html: `<a href="${esc(testingLink(f, { tab: 'runs', test: file.name }))}" title="Its runs">${esc(file.name)}</a> <a class="hq-codelink" href="/code/${urlPath(file.path)}" title="${esc(file.path)}" aria-label="Code for ${esc(file.name)}">code</a>`, v: file.name, f: file.name },
      set: { html: esc(SET_TITLE[file.set]), f: SET_TITLE[file.set] },
      layer: (() => { const l = L && layerOf(L.layers, file.path); return l ? { html: layerButton(l), f: l.name } : { html: '', f: 'none' }; })(),
      // three lines at most, with the whole text on hover (and in the filter's search)
      proves: { html: `<div class="hq-desc hq-clamp3"${what ? ` title="${esc(h ? [['Proves', h.proves], ['Why it exists', h.why], ['Runs in', h.runsIn], ['Takes', h.takes], ['Run it when', h.runWhen]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).concat(file.description ? [file.description] : []).join('\n') : file.description)}"` : ''}>${what || '<span class="hint">No description yet.</span>'}</div>${pics.length ? `<div class="hq-shots">${pics.join(' ')}</div>` : ''}`, f: `${file.description} ${h ? Object.values(h).join(' ') : ''}` },
      last: obs.slice(0, 12).reverse().map(o => `<a class="hq-dot ${o.status}" href="/runs/${encodeURIComponent(o.run)}" title="${esc(`${o.status} ${when(o.when)} ${o.where} ${o.commit || '?'}${o.dirty ? '+' : ''} ${secs(o.seconds)}`)}"></a>`).join(''),
      flaky: fl ? { html: `<span class="tag hq-flaky" title="${esc(fl.map(x => `${x.test} on ${x.commit}`).join('\n'))}">flaky</span>`, f: 'flaky' } : { html: '', f: 'steady' },
    };
    for (const w of wheres) cells[w] = file.set === 'helper' ? { html: '', f: 'not run' } : result(obs.find(o => o.where === w));
    return { cells, attrs: { id: `t-${file.name}` } };
  });
  return dataTable({ id: 'tests', columns, rows, empty: 'No test files found.' });
}

function runsTab({ repo }, runs, f, params) {
  const files = catalogue(repo);
  const test = params.get('test'), task = params.get('task');
  const file = test ? files.find(x => x.name === test) : null;
  let list = runs, per = null;
  if (file) {
    per = new Map((resultsByFile(runs, [file]).get(file.path) || []).map(o => [o.run, o]));
    list = runs.filter(r => per.has(r.id));
  }
  if (task) list = list.filter(r => r.tasks.some(t => t.id === task || t.id === `docker-${task}`));
  // Most useful first: did it pass, what ran, when. Opening the tab plainly shows the gates, long sets, deploys and soaks,
  // and leaves out the quick unit and rules runs agents make many times an hour; the bar says so and one click shows all.
  const MEANINGFUL = ['Gate', 'Gate (container)', 'Deploy gate', 'Long set', 'Long set (container)', 'Deploy long set', 'Soak'];
  const columns = [
    { key: 'result', label: 'Result', filter: 'chips', w: 'sm' },
    ...(file ? [{ key: 'this', label: test, filter: 'chips', w: 'sm' }] : []),
    { key: 'kind', label: 'What', filter: 'chips', w: 'md', preset: file || task ? null : MEANINGFUL },
    { key: 'when', label: 'When', w: 'sm' },
    { key: 'branch', label: 'Branch', filter: 'chips', w: 'lg' },
    { key: 'time', label: 'Time', num: true, w: 'sm' },
    { key: 'failed', label: 'Failed', filter: 'text' },
    { key: 'who', label: 'Who', filter: 'chips', w: 'sm' },
    { key: 'where', label: 'Where', filter: 'chips', w: 'sm' },
    { key: 'commit', label: 'Commit', filter: 'text', w: 'sm' },
  ];
  const now = Date.now();
  const rows = list.map(r => {
    const failed = r.tasks.filter(t => t.id !== 'rerun').flatMap(t => { const x = t.cases.filter(c => c.status === 'fail').map(c => c.name); return x.length ? x : t.status === 'fail' ? [`${t.id} (see its log)`] : []; });
    const total = r.tasks.reduce((s, t) => s + t.seconds, 0), kind = kindLabel(r.info.kind);
    const cells = {
      when: { html: `<a href="/runs/${encodeURIComponent(r.id)}" title="${esc(when(r.when))}">${esc(ago(r.when, now))}</a>`, v: r.when },
      kind: { html: esc(kind), f: kind }, who: esc(r.info.who || '?'), where: esc(r.info.where || r.source),
      branch: esc(r.info.branch || '?'), commit: `<code>${esc(commitOf(r.info))}</code>`,
      result: { html: `<span class="hq-res ${r.ok ? 'pass' : 'fail'}">${r.ok ? 'pass' : 'FAIL'}</span>`, f: r.ok ? 'pass' : 'FAIL' },
      time: { html: `<span title="${esc(r.tasks.map(t => `${t.id} ${secs(t.seconds)}`).join(', '))}">${secs(total)}</span>`, v: total },
      failed: failed.map(x => `<span class="fail">${esc(x)}</span>`).join(', '),
    };
    if (file) cells.this = result(per.get(r.id));
    return { cells };
  });
  const about = file ? `<p class="hq-scope">Runs of <b>${esc(test)}</b> <a class="hint" href="${esc(testingLink(f, { tab: 'runs' }))}">show all runs</a></p>`
    : task ? `<p class="hq-scope">Runs with the <b>${esc(task)}</b> step <a class="hint" href="${esc(testingLink(f, { tab: 'runs' }))}">show all runs</a></p>` : '';
  return about + dataTable({ id: 'runs', columns, rows, empty: 'No runs match. With devpipe installed, every test run is recorded; hq ci-fetch brings the CI runs.' });
}

export function testingPage(ctx, params) {
  const f = readFilter(params), tab = ['tests', 'runs'].includes(params.get('tab')) ? params.get('tab') : 'pipeline';
  const branch = (gitInfo(ctx.repo) || {}).branch;
  const runs = filterRuns(allRuns(ctx.cache), f);
  const keep = tab === 'tests' ? { set: params.get('set') || '', flaky: params.get('flaky') || '' } : tab === 'runs' ? { test: params.get('test') || '', task: params.get('task') || '' } : {};
  const tabs = [['pipeline', 'Pipeline'], ['tests', 'Tests'], ['runs', 'Runs']].map(([k, label]) =>
    `<a href="${esc(testingLink(f, { tab: k === 'pipeline' ? '' : k }))}"${k === tab ? ' aria-current="page" class="on"' : ''}>${label}</a>`).join('');
  const notes = {
    pipeline: `How a change gets to production. Each step shows its tests and how they did last time. Dashed steps are planned and not built yet. ${ctx.m?.tests?.pipeline ? ctx.m.tests.pipeline.replace(`${ctx.repo}/`, '') : 'The pipeline file'} describes it.`,
    tests: 'Every test file, which set it is in, and its last result in each place. The dots are the last 12 runs, oldest on the left. A test is flaky when it passes and fails on the same commit with no uncommitted changes. Click a test for its runs.',
    runs: 'Every recorded run, newest first: the runs devpipe recorded on this machine, and the CI runs hq ci-fetch brought. A + after a commit means it had uncommitted changes. Click a run for its tests.',
  };
  // the kinds of test, when the repo has tests/layers.json (a branch from before it has none)
  const L = loadLayers(ctx.m?.tests?.layers ?? null);
  const content = tab === 'tests' ? testsTab(ctx, runs, f, params, L) : tab === 'runs' ? runsTab(ctx, runs, f, params) : pipelineView(ctx, runs, f, L);
  const dash = tab === 'runs' && existsSync(join(ctx.cache, 'runs', 'report.html')) ? ' <a class="hint" href="/cache/runs/report.html" target="_blank" rel="noopener">devpipe&#39;s report</a>' : '';
  const body = `<div class="hq-pagehead"><h1>Testing${info(notes[tab], 'About this tab')}</h1>${dash}</div>
    ${L ? layerCards(L) : ''}
    <nav class="hq-tabs" aria-label="Testing">${tabs}</nav>
    ${filterBar(f, tab, keep, branch)}
    <div class="hq-tabpanel">${content}</div>
    ${L ? layerModals(L, catalogue(ctx.repo)) : ''}`;
  return layout({ title: 'Testing', active: 'testing', body, wide: true });
}

// A run and its tests.
export function runPage({ repo, cache }, id) {
  const r = runById(cache, id);
  if (!r) return null;
  const files = catalogue(repo), i = r.info;
  const report = r.report && existsSync(join(cache, r.report)) ? `/cache/${r.report.split('/').map(encodeURIComponent).join('/')}` : null;
  const logs = r.tasks.filter(t => r.source === 'laptop' && t.log).map(t => `<a href="/runs/${encodeURIComponent(r.id)}/log/${encodeURIComponent(t.id)}">${esc(t.id)} log</a>`);
  const rows = r.tasks.flatMap(t => (t.cases.length ? t.cases : [{ name: `${t.id} (no test results saved; see its log)`, status: t.status, seconds: t.seconds, none: true }]).map(c => {
    const file = c.none ? null : fileForCase(t.id, c.name, files);
    return { cells: {
      test: file ? { html: `<a href="${esc(testingLink({}, { tab: 'runs', test: file.name }))}" title="Its runs">${esc(c.name)}</a>`, v: c.name } : esc(c.name),
      file: file ? `<a class="hint" href="/code/${urlPath(file.path)}">${esc(file.name)}</a>` : '',
      step: esc(t.id),
      result: { html: `<span class="hq-res ${c.status === 'fail' ? 'fail' : 'pass'}">${c.status === 'fail' ? 'FAIL' : c.status}</span>${c.log ? ` <a class="hint" href="/runs/${encodeURIComponent(r.id)}/test/${encodeURIComponent(c.name)}${t.id === 'rerun' ? '?task=rerun' : ''}" title="This test's whole log">log</a>` : ''}`, f: c.status === 'fail' ? 'FAIL' : c.status },
      time: { html: secs(c.seconds), v: c.seconds },
    } };
  }));
  const columns = [{ key: 'test', label: 'Test', filter: 'text' }, { key: 'file', label: 'File', filter: 'text', w: 'lg' }, { key: 'step', label: 'Step', filter: 'chips', w: 'md' },
    { key: 'result', label: 'Result', filter: 'chips', w: 'sm' }, { key: 'time', label: 'Time', num: true, w: 'xs' }];
  const body = `<p class="hq-crumbs"><a href="/testing?tab=runs">Runs</a> <span class="sep">/</span> ${esc(when(r.when))}</p>
    <div class="hq-pagehead"><h1>${esc(i.kind || 'Run')} <span class="hq-res ${r.ok ? 'pass' : 'fail'}">${r.ok ? 'pass' : 'FAIL'}</span>${info(`${r.id}${r.command ? ` · ${r.command}` : ''}`, 'Run details')}</h1></div>
    <p class="hq-facts"><span>${esc(when(r.when))}</span><span>${esc(i.who || '?')}</span><span>${esc(i.where || r.source)}</span><span>${esc(i.branch || '?')} <code>${esc(commitOf(i))}</code></span>${i.lanes ? `<span>${esc(i.lanes)} lane${i.lanes === 1 ? '' : 's'}</span>` : ''}${i.attempt ? `<span>attempt ${esc(i.attempt)}</span>` : ''}
      ${logs.join('')}${report ? `<a href="${report}" target="_blank" rel="noopener">devpipe's report</a>` : ''}</p>
    ${dataTable({ id: 'cases', columns, rows })}`;
  return layout({ title: `Run ${when(r.when)}`, active: 'testing', body, wide: true });
}

// A log with numbered lines, the run-info and section lines picked out, and failures marked: a step's log, or one failed
// test's. crumb names it in the trail back to the run; plain is the cache path of the file as it is.
function logView(r, { title, crumb, real, plain }) {
  const lines = plainLog(readFileSync(real, 'utf8')).split('\n');
  const cls = l => (/^=== /.test(l) ? 'sec' : /\b(FAIL|ERR|Error|✖|not ok)\b/.test(l) ? 'bad' : '');
  const shown = lines.slice(0, 20000);
  const body = `<p class="hq-crumbs"><a href="/testing?tab=runs">Runs</a> <span class="sep">/</span> <a href="/runs/${encodeURIComponent(r.id)}">${esc(when(r.when))}</a> <span class="sep">/</span> ${esc(crumb)}</p>
    <div class="hq-filehead"><h1>${esc(title)}${lines.length > shown.length ? info(`Showing the first ${shown.length} of ${lines.length} lines.`, 'Cut short') : ''}</h1>
      <div class="hq-filehead-right"><details class="hq-menu"><summary class="btn btn-ghost" aria-label="More for this log">⋯</summary><div class="hq-menu-list" role="menu">
        <a role="menuitem" href="/cache/${plain.split('/').map(encodeURIComponent).join('/')}" target="_blank" rel="noopener">Plain text</a>
        <button type="button" role="menuitem" class="hq-wrap-toggle" aria-pressed="true">Wrap long lines</button></div></details></div></div>
    <div class="hq-code hq-log wrap"><table><tbody>${shown.map((l, n) => `<tr id="L${n + 1}" class="${cls(l)}"><td class="ln"><a href="#L${n + 1}">${n + 1}</a></td><td class="tx">${esc(l) || ' '}</td></tr>`).join('')}</tbody></table></div>`;
  return layout({ title: `${crumb} log`, active: 'testing', body, wide: true });
}

// A step's log, read from where devpipe keeps it inside the cache, never from the path the run.json names.
export function logPage({ cache }, id, task) {
  const r = runById(cache, id, 'laptop');
  const t = r && r.tasks.find(x => x.id === task);
  if (!t || !t.log) return null;
  const plain = `runs/runs/${id}/logs/${basename(t.log)}`, real = safePath(cache, plain);
  return real ? logView(r, { title: t.name, crumb: t.id, real, plain }) : null;
}

// One failed test's whole log, from the run's results folder (out in its run line), and only when that folder is
// inside the cache: a run line is a file on disk, so an out naming anywhere else opens nothing. task names the rerun
// (task=rerun) for a test red again there, whose log is its own; without it the log is the gate's.
export function testLogPage({ cache }, id, name, task = null) {
  const r = runById(cache, id, 'laptop');
  const c = r && r.tasks.filter(t => (task ? t.id === task : t.id !== 'rerun')).flatMap(t => t.cases).find(x => x.name === name && x.log);
  if (!c) return null;
  const plain = relative(cache, c.log).split(sep).join('/'), real = safePath(cache, plain);
  return real ? logView(r, { title: name, crumb: name, real, plain }) : null;
}
