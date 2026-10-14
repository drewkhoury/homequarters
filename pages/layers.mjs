// The kinds of test on the Testing page: a row of cards, and one modal per kind with everything tests/layers.json says
// about it. Pipeline steps and rows of the Tests tab open the same modals (hq.js opens a <dialog> by its id).
import { esc, urlPath } from '../lib/page.mjs';
import { info } from '../lib/ui.mjs';
import { filesOf, isPlanned } from '../lib/layers.mjs';

const badge = l => (l.blocksDeploy ? '<span class="hq-badge stop">stops a deploy</span>' : '<span class="hq-badge report">reported only</span>');
const planned = l => (isPlanned(l) ? `<span class="hq-badge planned">${esc(l.status.replace(/^planned/i, 'not built yet'))}</span>` : '');

// A button that opens a layer's modal, for the Pipeline and the Tests tab.
export const layerButton = (l, label = l.name) =>
  `<button type="button" class="hq-layerlink${isPlanned(l) ? ' planned' : ''}" data-layer="${esc(l.id)}" aria-haspopup="dialog">${esc(label)}</button>`;

export function layerCards({ layers }) {
  return `<div class="hq-layers" aria-label="Kinds of test">${layers.map(l => `<button type="button" class="hq-layercard${isPlanned(l) ? ' planned' : ''}" data-layer="${esc(l.id)}" aria-haspopup="dialog">
    <b>${esc(l.name)}</b><span class="hq-layer-line">${esc(l.oneLine)}</span>
    <span class="hq-layer-foot"><span class="hint">CI: ${esc((l.time || {}).ci || '?')}</span>${isPlanned(l) ? planned(l) : badge(l)}</span></button>`).join('')}</div>`;
}

const NEEDS = [['app', 'The app'], ['emulators', 'Emulators'], ['browser', 'A browser'], ['network', 'The network']];

function need([key, label], value) {
  const yes = value !== false && value != null;
  return `<li class="${yes ? 'yes' : 'no'}"><span class="hq-need"><span aria-hidden="true">${yes ? '✓' : '–'}</span> ${esc(label)}: ${yes ? 'yes' : 'no'}</span>${typeof value === 'string' ? `<span class="hint">${esc(value)}</span>` : ''}</li>`;
}

function modal(l, files, places) {
  const list = filesOf(l, files);
  const where = id => places.find(p => p.id === id) || { name: id, about: '' };
  const time = ['laptop', 'container', 'ci'].map(id => `<div><dt>${esc(where(id).name)}${where(id).about ? info(where(id).about, `About ${where(id).name}`) : ''}</dt><dd>${esc((l.time || {})[id] || '?')}</dd></div>`).join('');
  return `<dialog class="hq-modal${isPlanned(l) ? ' planned' : ''}" id="layer-${esc(l.id)}" aria-labelledby="layer-${esc(l.id)}-title">
    <div class="hq-modal-head"><div><h2 id="layer-${esc(l.id)}-title">${esc(l.name)}</h2><p>${esc(l.oneLine)}</p></div>
      <div class="hq-modal-badges">${planned(l)}${badge(l)}<button type="button" class="btn btn-ghost hq-modal-close" data-close aria-label="Close">✕</button></div></div>
    <div class="hq-modal-body">
      <div class="hq-two"><section><h3>Proves</h3><p>${esc(l.proves)}</p></section><section class="hq-not"><h3>Does not prove</h3><p>${esc(l.doesNotProve)}</p></section></div>
      <section><h3>Needs</h3><ul class="hq-needs">${NEEDS.map(n => need(n, (l.needs || {})[n[0]])).join('')}</ul></section>
      <section><h3>Data</h3><p>${esc(l.data)}</p></section>
      <section><h3>How long</h3><dl class="hq-times">${time}</dl></section>
      <div class="hq-two"><section><h3>Where it runs</h3><ul>${(l.runsIn || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul></section>
        <section><h3>When to run it</h3><p>${esc(l.runWhen)}</p></section></div>
      <section><h3>Command</h3><div class="hq-command"><code>${esc(l.command)}</code><button type="button" class="btn btn-ghost hq-copy" data-copy="${esc(l.command)}">Copy</button></div></section>
      <section><h3>Test files <span class="hq-count">${list.length}</span></h3>${list.length
        ? `<ul class="hq-filelinks">${list.map(f => `<li><a href="/code/${urlPath(f.path)}">${esc(f.path)}</a></li>`).join('')}</ul>`
        : `<p class="hint">${isPlanned(l) ? 'None yet. This kind of test is not built.' : 'No files match.'}</p>`}</section>
    </div></dialog>`;
}

export const layerModals = ({ layers, places }, files) => layers.map(l => modal(l, files, places)).join('');
