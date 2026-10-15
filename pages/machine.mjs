// The Machine page: what this computer is doing now (load, memory, pressure, power, the busiest programs), the software
// HQ or the project's Makefile may use, with versions and logins, and what HQ found in the repo: the manifest it read with
// its warnings, or with none, the manifest hq setup would propose. Everything here is read; the person adds the manifest
// to the repo themselves.
import { esc, layout } from '../lib/page.mjs';
import { info, dataTable } from '../lib/ui.mjs';
import { hostInfo } from '../lib/machine.mjs';
import { scanSoftware, scanRepo, proposeManifest, MAKE_SNIPPET } from '../lib/scan.mjs';
import { FILE, SCHEMA } from '../lib/manifest.mjs';

let softwareKept = null; // asked once a minute at most: a dozen version calls take a second or two
const KEEP_MS = 60000;
async function software() {
  if (softwareKept && Date.now() - softwareKept.at < KEEP_MS) return softwareKept.list;
  const list = await scanSoftware();
  softwareKept = { at: Date.now(), list };
  return list;
}

const mb = n => (n == null ? '' : `${Math.round(n)} MB`);
const pct = n => (n == null ? '' : `${Math.round(n)}%`);

function hardwareCard(h) {
  const rows = [
    ['Load', h.load1 != null ? `${h.load1} now, ${h.load5} over 5 minutes, on ${h.cores} cores` : 'unknown'],
    ['Memory', h.memFreePct != null ? `${pct(h.memFreePct)} free, pressure ${h.pressure || 'unknown'}` : 'unknown'],
    ['Swap', h.swap ? `${mb(h.swap.usedMB)} of ${mb(h.swap.totalMB)}` : 'unknown'],
    ['Power', h.power ? `${h.power.source === 'ac' ? 'mains' : 'battery'}${h.power.percent != null ? `, ${h.power.percent}%` : ''}${h.power.lowPower ? ', low power mode' : ''}` : 'unknown'],
    ['Thermal', h.therm ? (h.therm.thermal ? `throttled (${h.therm.thermal})` : 'normal') : 'unknown'],
    ['Busiest', (h.top || []).map(t => `${t.name} ${t.cpu}%`).join(', ') || 'unknown'],
  ];
  return `<section class="card hq-card"><div class="hq-card-head"><span class="kicker">This computer</span>${info('The same block each recorded run keeps, so a slow or flaky run can be explained afterwards. hq machine prints it.', 'About these readings')}</div>
    <dl class="bl-facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>`;
}

function softwareTable(list) {
  const columns = [
    { key: 'id', label: 'Tool', filter: 'text', w: 'sm' },
    { key: 'found', label: 'Found', filter: 'chips', w: 'sm' },
    { key: 'version', label: 'Version', w: 'sm' },
    { key: 'login', label: 'Login or engine', w: 'md' },
    { key: 'about', label: 'Used for', w: 'lg' },
  ];
  const rows = list.map(s => ({ cells: { id: s.id, found: s.found ? 'yes' : 'no', version: s.version || (s.found ? 'present' : ''), login: s.login || s.engine || '', about: s.about }, attrs: { 'data-found': s.found ? 'yes' : 'no' } }));
  return dataTable({ id: 'software', columns, rows, empty: 'Nothing looked for.' });
}

function manifestCard(ctx, scan) {
  const m = ctx.m;
  const warnings = ctx.warnings || [];
  const failed = ctx.pluginsFailed || [];
  const on = Object.entries(m.features).filter(([, v]) => v).map(([k]) => k);
  const head = m.present
    ? `<p>${esc(FILE)} read, schema ${m.schemaVersion}${m.schemaVersion > SCHEMA ? ` (this HQ knows schema ${SCHEMA})` : ''}. On: ${on.length ? on.map(esc).join(', ') : 'nothing beyond the baseline'}. Cache: <code>${esc(m.cache)}</code>.</p>`
    : warnings.some(w => w.includes('is not valid JSON'))
      ? `<p>${esc(FILE)} is in the repo but could not be read, so these are the baseline pages until it parses. Below is what <code>hq setup</code> found and the manifest it would propose.</p>`
      : `<p>No ${esc(FILE)} in the repo, so these are the baseline pages. Below is what <code>hq setup</code> found and the manifest it would propose; add it to the repo root yourself.</p>`;
  const warn = warnings.length ? `<ul class="hq-warnlist">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
  const plug = `${ctx.plugins.length ? `<p>Plugins: ${ctx.plugins.map(p => `<a href="/${esc(p.path)}">${esc(p.label)}</a>`).join(', ')}.</p>` : ''}${failed.length ? `<ul class="hq-warnlist">${failed.map(f => `<li>plugin left out: <code>${esc(f.file)}</code>: ${esc(f.why)}</li>`).join('')}</ul>` : ''}`;
  const found = scan.found.length ? `<ul class="hq-found">${scan.found.map(f => `<li><code>${esc(f.rel)}</code> ${f.key ? `<span class="hint">→ ${esc(f.key)}</span>` : ''} ${esc(f.note)}</li>`).join('')}</ul>` : '<p class="hint">Nothing HQ recognises beyond the files themselves.</p>';
  const proposal = m.present ? '' : `<h2>Proposed ${esc(FILE)}</h2><pre class="hq-pre">${esc(JSON.stringify(proposeManifest(scan), null, 2))}</pre><h2>Make lines to add</h2><pre class="hq-pre">${esc(MAKE_SNIPPET)}</pre>`;
  return `<section class="card hq-card"><div class="hq-card-head"><span class="kicker">The manifest</span>${info('hq.json at the repo root says what HQ may read. HQ reads no folder it does not name. Every key is optional; a missing key turns its page off.', 'About the manifest')}</div>
    ${head}${warn}${plug}<h2>In the repo</h2>${found}${scan.remote ? `<p>GitHub remote: <code>${esc(scan.remote)}</code></p>` : ''}${proposal}</section>`;
}

export async function machinePage(ctx) {
  const [h, list] = await Promise.all([Promise.resolve(hostInfo()), software()]);
  const scan = scanRepo(ctx.repo);
  const body = `<div class="hq-pagehead"><h1>Machine${info('This computer, the software on it, and what HQ was given to read. The baseline: it works for any git repo.', 'About this page')}</h1></div>
    <div class="hq-machine">
      ${hardwareCard(h)}
      <section class="card hq-card"><div class="hq-card-head"><span class="kicker">Software</span>${info('Each tool asked for its version once a minute at most. A login is shown where the tool can say.', 'About this table')}</div>${softwareTable(list)}</section>
      ${manifestCard(ctx, scan)}
    </div>`;
  return layout({ title: 'Machine', active: 'machine', body, wide: true });
}
