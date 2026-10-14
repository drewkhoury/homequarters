// The pipeline, from hq/pipeline.json, for the Testing page's first tab. Two drawings of the same data: a compact
// one that wraps to fit the page, and a full one in SVG that Expand opens as a canvas to zoom and pan (hq.js).
import { esc } from '../lib/page.mjs';
import { info } from '../lib/ui.mjs';
import { catalogue } from '../lib/catalogue.mjs';
import { loadPipeline, lastResult } from '../lib/pipeline.mjs';
import { layerButton } from './layers.mjs';

const WHERE = { ci: 'CI', laptop: 'Laptop', container: 'Container' };
const ago = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (!(s >= 0)) return '';
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const time = s => (s < 1 ? 'under 1 s' : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const link = (f, extra) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ where: f.where, branch: f.branch, ...extra })) if (v) q.set(k, v);
  return `/testing?${q}`;
};

// What a step or part shows: its test files, and its last result in each place the filter allows.
function facts(s, files, runs, f) {
  const tests = files.filter(x => (s.sets || []).includes(x.set) || (s.tests || []).includes(x.name));
  const results = (s.results || []).filter(x => !f.where || x.where === f.where).map(want => ({ want, got: lastResult(runs, want) }));
  return { tests, results };
}

// ── the compact view ─────────────────────────────────────────────────────────────────────────────────────────────────

function resultLine({ want, got }) {
  const label = WHERE[want.where] || want.where;
  if (!got) return `<li><span class="hq-where">${esc(label)}</span><span class="hint">no runs</span></li>`;
  const ok = got.task.status === 'pass';
  return `<li><span class="hq-where">${esc(label)}</span><a class="hq-res ${ok ? 'pass' : 'fail'}" href="/runs/${encodeURIComponent(got.run.id)}" title="${esc(`${label}: ${ok ? 'passed' : 'failed'} ${ago(got.run.when)}, took ${time(got.task.seconds)}`)}">${ok ? 'pass' : 'FAIL'}</a></li>`;
}

function card(s, files, runs, f, L, part = false) {
  const { tests, results } = facts(s, files, runs, f);
  const set = (s.sets || [])[0], task = (s.results || [])[0] && s.results[0].task;
  const links = [
    tests.length && `<a href="${esc(link(f, { tab: 'tests', set: (s.sets || []).length === 1 ? set : '' }))}">${tests.length} test${tests.length === 1 ? '' : 's'}</a>`,
    task && `<a href="${esc(link(f, { tab: 'runs', task }))}">runs</a>`,
  ].filter(Boolean).join('');
  const parts = s.parts ? `<div class="hq-subflow">${s.parts.map(p => card(p, files, runs, f, L, true)).join('')}</div>` : '';
  const kinds = L && s.layers && !s.parts ? s.layers.map(id => L.layers.find(l => l.id === id)).filter(Boolean) : [];
  return `<div class="${part ? 'hq-substep' : 'hq-step'}${s.planned ? ' planned' : ''}${s.parts ? ' wide' : ''}">
    <div class="hq-step-title"><b>${esc(s.title)}</b>${s.what ? info(s.what, `About ${s.title}`) : ''}</div>
    ${s.planned ? `<a class="hq-planned" href="/backlog#${esc(s.planned)}" title="Not built yet: ${esc(s.planned)}">planned</a>` : ''}
    ${kinds.length ? `<div class="hq-step-kinds">${kinds.map(l => layerButton(l)).join('')}</div>` : ''}
    ${results.length ? `<ul class="hq-step-results">${results.map(resultLine).join('')}</ul>` : ''}
    ${parts}${links ? `<div class="hq-step-links">${links}</div>` : ''}</div>`;
}

// ── the full drawing, in SVG ─────────────────────────────────────────────────────────────────────────────────────────

// Words into lines of at most n characters.
export function wrapText(text, n) {
  const lines = [];
  let line = '';
  for (const w of String(text || '').split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + w).length > n) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}

const W = 210, GAP = 46, PAD = 14, LINE = 17, PART_W = 180;

// One box's lines as [text, class]: the title, the words, the tests, and each result.
function boxLines(s, files, runs, f) {
  const { tests, results } = facts(s, files, runs, f);
  const lines = [[s.title, 't']];
  if (s.planned) lines.push([`Not built yet · ${s.planned}`, 'p']);
  for (const l of wrapText(s.what, s.parts ? 70 : 28)) lines.push([l, 'w']);
  if (tests.length) lines.push([`${tests.length} test file${tests.length === 1 ? '' : 's'}`, 'n']);
  for (const { want, got } of results) {
    lines.push([`${WHERE[want.where] || want.where}: ${got ? `${got.task.status === 'pass' ? 'pass' : 'FAIL'}, ${time(got.task.seconds)}` : 'no runs'}`, got ? (got.task.status === 'pass' ? 'ok' : 'bad') : 'n']);
  }
  return lines;
}

// { svg, width, height, boxes } for the whole pipeline: a row per path, a box per step, parts inside their step.
export function pipelineSvg(pipeline, files, runs, f) {
  const text = (x, y, [t, c]) => `<text x="${x}" y="${y}" class="${c}">${esc(t)}</text>`;
  const placed = [];
  let y = 20, width = 0, out = '';
  for (const path of pipeline.paths) {
    out += `<text x="20" y="${y + 16}" class="h">${esc(path.title)}</text>`;
    y += 36;
    let x = 20, rowH = 0;
    const boxes = path.steps.map(s => {
      const lines = boxLines(s, files, runs, f);
      const parts = (s.parts || []).map(p => boxLines(p, files, runs, f));
      const partH = parts.length ? Math.max(...parts.map(l => l.length)) * LINE + PAD * 2 : 0;
      const w = parts.length ? parts.length * PART_W + (parts.length - 1) * 12 + PAD * 2 : W;
      const h = lines.length * LINE + PAD * 2 + (parts.length ? partH + 8 : 0);
      rowH = Math.max(rowH, h);
      return { s, lines, parts, partH, w, h };
    });
    boxes.forEach((b, i) => {
      if (i) out += `<path class="arrow" d="M${x - GAP + 6} ${y + 30}h${GAP - 14}m-7 -6l7 6-7 6"/>`;
      out += `<rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="10" class="box${b.s.planned ? ' planned' : ''}"/>`;
      b.lines.forEach((l, j) => { out += text(x + PAD, y + PAD + 12 + j * LINE, l); });
      let px = x + PAD;
      const py = y + PAD + b.lines.length * LINE + 4;
      for (const lines of b.parts) {
        out += `<rect x="${px}" y="${py}" width="${PART_W}" height="${b.partH}" rx="7" class="part"/>`;
        lines.forEach((l, j) => { out += text(px + 12, py + PAD + 12 + j * LINE, l); });
        px += PART_W + 12;
      }
      placed.push({ title: b.s.title, x, y, w: b.w, h: b.h, planned: !!b.s.planned });
      x += b.w + GAP;
    });
    width = Math.max(width, x - GAP + 20);
    y += rowH + 40;
  }
  return { width, height: y, boxes: placed, svg: `<svg xmlns="http://www.w3.org/2000/svg" class="hq-pipesvg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}"><g data-world><g id="pipe-content">${out}</g></g></svg>` };
}

// The first tab of the Testing page. runs are already filtered; a filter on where drops the other places' results.
export function pipelineView(ctx, runs, f, L = null) {
  const repo = ctx.repo, pipeline = loadPipeline(ctx.m?.tests?.pipeline), files = catalogue(repo);
  if (!pipeline) return `<p class="hint">No pipeline file. Name one in hq.json under <code>tests.pipeline</code> to draw how a change reaches production here.</p>`;
  const full = pipelineSvg(pipeline, files, runs, f);
  const rows = pipeline.paths.map(p => `<section class="hq-path"><h2>${esc(p.title)}</h2>
    <div class="hq-flow">${p.steps.map(s => `<div class="hq-flowstep">${card(s, files, runs, f, L)}</div>`).join('')}</div></section>`).join('');
  return `<div class="hq-pipe-tools"><button type="button" class="btn btn-secondary" data-expand>
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Expand</button></div>
    ${rows}
    <div class="hq-canvas" hidden role="dialog" aria-modal="true" aria-label="The pipeline, full size">
      <div class="hq-canvas-bar"><b>Pipeline</b><span class="hint">Scroll to zoom, drag to move, arrow keys to pan, + and − to zoom, 0 to fit, Esc to close.</span>
        <button type="button" class="btn btn-ghost" data-zoom="in" aria-label="Zoom in">+</button><button type="button" class="btn btn-ghost" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" class="btn btn-ghost" data-zoom="fit">Fit</button><button type="button" class="btn btn-secondary" data-close>Close</button></div>
      <div class="hq-canvas-stage" tabindex="0" aria-label="The pipeline drawing">${full.svg}
        <svg class="hq-minimap" viewBox="0 0 ${full.width} ${full.height}" aria-label="Mini map: click or drag to move the view"><rect class="bg" width="${full.width}" height="${full.height}"/><use href="#pipe-content"/><rect class="view" x="0" y="0" width="0" height="0"/></svg>
      </div>
    </div>`;
}
