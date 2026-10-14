// The Backlog board in the browser: a card opens its item in a dialog (the address keeps #its-name, so a link to it
// opens it too), and the bar above the board narrows the cards by words, type and who asked. Without this script
// each card is a link to the item's own page.
(function () {
  const dialog = document.querySelector('.bl-dialog');
  const body = dialog && dialog.querySelector('.bl-dialog-body');

  // Each item's popup is fetched once, when it is first opened or hovered, and kept for the page's life.
  const parts = new Map();
  const fetchPart = slug => {
    if (!parts.has(slug)) parts.set(slug, fetch(`/backlog/${encodeURIComponent(slug)}?part=1`).then(r => (r.ok ? r.text() : null), () => null));
    return parts.get(slug);
  };
  async function open(slug, push = true) {
    if (!dialog) return false;
    const html = await fetchPart(slug);
    if (html == null) { parts.delete(slug); return false; }
    body.innerHTML = html;
    if (!dialog.open) dialog.showModal();
    body.scrollTop = 0;
    if (push && location.hash !== `#${slug}`) history.pushState(null, '', `#${slug}`);
    return true;
  }
  function close() { if (dialog && dialog.open) dialog.close(); }

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-open]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    if (a.closest('.bl-dialog') && !a.classList.contains('bl-ref')) return;
    if (!dialog) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    open(a.dataset.open).then(ok => { if (!ok && href) location.href = href; });
  });
  document.addEventListener('pointerover', e => { const a = e.target.closest && e.target.closest('.bl-card[data-open]'); if (a) fetchPart(a.dataset.open); });
  if (dialog) {
    dialog.addEventListener('close', () => { if (location.hash) history.pushState(null, '', location.pathname + location.search); });
    // a click on the backdrop, outside the dialog's box, closes it
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  }
  const fromHash = () => { const s = decodeURIComponent(location.hash.slice(1)); if (s) open(s, false); else close(); };
  window.addEventListener('popstate', fromHash);
  fromHash();

  // ---- filters ----
  const bar = document.querySelector('.bl-filters');
  if (!bar) return;

  // Cards across: how many cards sit side by side in each column, kept in this browser
  const across = bar.querySelector('.bl-across input'), acrossOut = bar.querySelector('.bl-across output'), boardEl = document.querySelector('.bl-board');
  // Down first: each column fills its first sub-column to the bottom of the screen, then the next, and takes only as
  // many sub-columns as its cards need, up to the slider's number: every card is one height, so the count that fits
  // in a screen is known. When a column has more than that many screens of cards, it splits them evenly and runs
  // longer than the screen instead of growing more sub-columns. Each column's width follows its own count, and a
  // card keeps its width.
  const COL_W = n => 220 * n + 8 * (n - 1) + 20;
  function flowDown() {
    if (boardEl.classList.contains('bl-chainview')) return; // the chain view lays the board out itself
    const most = +(boardEl.style.getPropertyValue('--bl-across') || 1), widths = [];
    for (const col of boardEl.querySelectorAll('.bl-col')) {
      const box = col.querySelector('.bl-cards'), cards = [...box.querySelectorAll('.bl-card:not([hidden])')];
      box.classList.remove('bl-down', 'bl-even');
      box.style.height = '';
      let n = 1;
      if (most > 1 && cards.length) {
        const scroller = document.fullscreenElement || null;
        const top = box.getBoundingClientRect().top + (scroller ? scroller.scrollTop : scrollY), screen = Math.max(280, innerHeight - top - 20);
        const perCol = Math.max(1, Math.floor((screen + 8) / (cards[0].offsetHeight + 8)));
        n = Math.min(most, Math.ceil(cards.length / perCol));
        if (n > 1) {
          box.style.setProperty('--bl-across', n);
          box.classList.add('bl-down');
          if (cards.length <= n * perCol) box.style.height = `${screen}px`; else box.classList.add('bl-even');
        }
      }
      col.dataset.across = n;
      widths.push(n);
    }
    boardEl.style.gridTemplateColumns = most > 1 ? widths.map(n => `minmax(${COL_W(n)}px, ${n}fr)`).join(' ') : '';
  }
  let queued = false;
  const reflow = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; flowDown(); }); };
  addEventListener('resize', reflow);
  window.hqBoard = { reflow };

  // Full screen: the filters and the board take the whole screen; Esc, or the button again, brings the page back.
  const wrap = document.querySelector('.bl-boardwrap'), fullBtn = bar.querySelector('[data-full]');
  if (!wrap.requestFullscreen) fullBtn.hidden = true;
  fullBtn.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : wrap.requestFullscreen()).catch(() => {}));
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === wrap;
    fullBtn.textContent = on ? 'Exit full screen' : 'Full screen';
    fullBtn.setAttribute('aria-pressed', String(on));
    reflow();
  });
  // a card's popup opens inside the full-screen board, so it shows above it
  const dlg = document.querySelector('.bl-dialog');
  if (dlg) document.addEventListener('fullscreenchange', () => { (document.fullscreenElement === wrap ? wrap : document.querySelector('.hq-main') || document.body).appendChild(dlg); });
  const setAcross = n => { boardEl.style.setProperty('--bl-across', n); across.value = n; acrossOut.textContent = n; reflow(); };
  try { setAcross(Math.min(4, Math.max(1, +localStorage.getItem('hq.board.across') || 1))); } catch { setAcross(1); }
  across.addEventListener('input', () => { setAcross(+across.value); try { localStorage.setItem('hq.board.across', across.value); } catch { /* not kept */ } });
  const q = bar.querySelector('.bl-q'), who = bar.querySelector('.bl-who select'), shown = bar.querySelector('.bl-shown');
  const chips = [...bar.querySelectorAll('[data-filter-type]')];
  const cards = [...document.querySelectorAll('.bl-card')];
  function apply() {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const types = chips.filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.dataset.filterType);
    let n = 0;
    for (const c of cards) {
      const ok = words.every(w => c.dataset.text.includes(w)) && (!types.length || types.includes(c.dataset.type)) && (!who.value || c.dataset.who === who.value);
      c.hidden = !ok;
      if (ok) n++;
    }
    for (const col of document.querySelectorAll('.bl-col')) {
      col.querySelector('[data-count]').textContent = col.querySelectorAll('.bl-card:not([hidden])').length;
    }
    reflow();
    const filtered = words.length || types.length || who.value;
    shown.textContent = filtered ? `${n} of ${cards.length} cards` : '';
  }
  q.addEventListener('input', apply);
  who.addEventListener('change', apply);
  for (const c of chips) c.addEventListener('click', () => { c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true')); apply(); });
})();

// Ties between cards: hovering or tabbing onto a card outlines what blocks it (amber, "blocks this") and what waits on
// it (blue, "waits on this"), fainter further along a chain, and fades the rest. A note by the pointer draws the whole
// chain as a small map, each card with its column and where it is now (on screen, above or below, off to one side of
// the board, or hidden by the filters), so a tie nobody can see still shows. F lines the chain up on the board;
// Esc puts the board back as it was.
(function () {
  const board = document.querySelector('.bl-board');
  if (!board) return;
  const wrap = document.querySelector('.bl-boardwrap') || document.body;
  const cards = [...board.querySelectorAll('.bl-card[data-slug]')];
  const bySlug = new Map(cards.map(c => [c.dataset.slug, c]));
  const list = (c, key) => (c.dataset[key] || '').split(' ').filter(Boolean);
  // every card reachable from `slug` by following `key`, each with how many steps away it is
  const walk = (slug, key) => {
    const seen = new Map(), todo = [[slug, 0]];
    while (todo.length) {
      const [s, d] = todo.shift();
      const c = bySlug.get(s);
      for (const next of c ? list(c, key) : []) if (!seen.has(next) && next !== slug) { seen.set(next, d + 1); todo.push([next, d + 1]); }
    }
    return seen;
  };
  const titleOf = s => bySlug.get(s)?.dataset.title || s;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colOf = c => c && c.closest('.bl-col');

  // The chain around a card: each card's step (below 0 it must finish first, above 0 it waits) and the ties between
  // them. Steps are pushed apart until every tie runs left to right, so a card that blocks another one also blocking
  // this card sits further left than both.
  function chainOf(slug) {
    const up = walk(slug, 'blockers'), down = walk(slug, 'blocks');
    const steps = new Map([[slug, 0], ...[...up].map(([s, d]) => [s, -d]), ...[...down].map(([s, d]) => [s, d])]);
    const ties = new Map();
    for (const s of steps.keys()) {
      const c = bySlug.get(s);
      if (!c) continue;
      for (const b of list(c, 'blocks')) if (steps.has(b)) ties.set(`${s} ${b}`, [s, b]);
      for (const a of list(c, 'blockers')) if (steps.has(a)) ties.set(`${a} ${s}`, [a, s]);
    }
    for (let i = 0; i < steps.size; i++) {
      let moved = false;
      for (const [a, b] of ties.values()) {
        if (steps.get(a) < steps.get(b)) continue;
        if (a !== slug && steps.get(b) <= 0) steps.set(a, steps.get(b) - 1); else if (b !== slug) steps.set(b, steps.get(a) + 1);
        moved = true;
      }
      if (!moved) break;
    }
    return { slug, steps, ties: [...ties.values()], up, down };
  }

  // Where a card is right now, in a few words, and whether it can be seen.
  function whereIs(c) {
    if (c.hidden && !board.classList.contains('bl-chainview')) return { text: 'hidden by your filter', seen: false };
    const r = c.getBoundingClientRect(), b = board.getBoundingClientRect();
    const left = Math.max(b.left, 0), right = Math.min(b.right, innerWidth), mid = (r.left + r.right) / 2;
    const side = mid > right ? 'off to the right' : mid < left ? 'off to the left' : '';
    const screens = d => { const n = Math.max(1, Math.round(d / innerHeight)); return n === 1 ? 'a screen' : `${n} screens`; };
    const vert = r.bottom <= 0 ? `${screens(-r.top)} up` : r.top >= innerHeight ? `${screens(r.bottom - innerHeight)} down` : '';
    return { text: [side, vert].filter(Boolean).join(', ') || 'on screen', seen: !side && !vert };
  }

  // The note's map: one column per step, a box per card, and arrows from what has to finish first.
  function mapHtml(ch) {
    const layers = new Map();
    for (const [s, k] of ch.steps) { if (!layers.has(k)) layers.set(k, []); layers.get(k).push(s); }
    let seen = 0;
    const node = s => {
      const c = bySlug.get(s), k = ch.steps.get(s), self = s === ch.slug;
      const w = self ? null : whereIs(c), parked = colOf(c)?.dataset.col === 'parked' && k < 0;
      if (w && w.seen) seen++;
      return `<div class="bl-mapnode" data-node="${esc(s)}" data-rel="${self ? 'self' : k < 0 ? 'up' : 'down'}"${w && !w.seen ? ' data-away' : ''}>
        <span class="bl-mapnode-title">${esc(titleOf(s))}</span>
        <span class="bl-mapnode-where">${self ? 'this card' : `${esc(colOf(c)?.getAttribute('aria-label') || '')} · ${esc(w.text)}`}</span>${parked ? '<span class="bl-mapnode-warn">parked: nobody plans this yet</span>' : ''}</div>`;
    };
    const cols = [...layers.keys()].sort((a, b) => a - b).map(k => `<div class="bl-maplayer">${layers.get(k).map(node).join('')}</div>`).join('');
    return `<div class="bl-map">${cols}<svg class="bl-maplines" aria-hidden="true"></svg></div>
      <p class="bl-mapfoot"><span>${seen} of ${ch.steps.size - 1} on screen · arrows run from what has to finish first</span><span><kbd>F</kbd> lines them up</span></p>`;
  }
  const ARROW = id => `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M1 1.5L9 5L1 8.5z"/></marker></defs>`;
  // The arrows between boxes. Each box's arrows leave and arrive spread along its edge, in the order of the boxes at
  // their other ends, so a card with two ties sends two lines rather than one that splits. Between columns a line
  // leaves and arrives level and bends in between; within one column it goes out of the right edges and round, the
  // longer ones further out, so it never crosses the cards between them.
  function arrows(ties, rectOf, id) {
    const mid = r => r.top + r.height / 2;
    const spread = (r, i, n) => (n < 2 ? mid(r) : r.top + r.height * (0.3 + (0.4 * i) / (n - 1)));
    const outs = new Map(), ins = new Map();
    for (const t of ties) { (outs.get(t[0]) || outs.set(t[0], []).get(t[0])).push(t); (ins.get(t[1]) || ins.set(t[1], []).get(t[1])).push(t); }
    const loops = ties.filter(([a, b]) => { const p = rectOf(a), q = rectOf(b); return !(q.left >= p.right - 4 || p.left >= q.right - 4); })
      .sort((x, y) => Math.abs(mid(rectOf(x[0])) - mid(rectOf(x[1]))) - Math.abs(mid(rectOf(y[0])) - mid(rectOf(y[1]))));
    // in the order of the other ends, except that loops nest: the one reaching further leaves and arrives outermost
    const key = (t, end) => (loops.includes(t) ? -1 : 1) * mid(rectOf(t[end]));
    for (const l of outs.values()) l.sort((x, y) => key(x, 1) - key(y, 1));
    for (const l of ins.values()) l.sort((x, y) => key(x, 0) - key(y, 0));
    return ARROW(id) + ties.map(t => {
      const [a, b] = t, p = rectOf(a), q = rectOf(b);
      const y1 = spread(p, outs.get(a).indexOf(t), outs.get(a).length), y2 = spread(q, ins.get(b).indexOf(t), ins.get(b).length);
      const loop = loops.indexOf(t);
      if (loop >= 0) {
        const x1 = p.right + 2, x2 = q.right + 4, out = Math.max(p.right, q.right) + 44 + 22 * loop; // the curve reaches about three quarters of the way out
        return `<path d="M${x1} ${y1}C${out} ${y1} ${out} ${y2} ${x2} ${y2}" marker-end="url(#${id})"/>`;
      }
      const rightward = q.left >= p.right - 4, x1 = rightward ? p.right + 2 : p.left - 2, x2 = rightward ? q.left - 4 : q.right + 4;
      const dx = Math.max(18, Math.abs(x2 - x1) * 0.6) * (rightward ? 1 : -1);
      return `<path d="M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}" marker-end="url(#${id})"/>`;
    }).join('');
  }
  // boxes measured against an origin, so the lines can be drawn in that box's own space
  const within = (el, o, dx = 0, dy = 0) => { const r = el.getBoundingClientRect(); return { left: r.left - o.left + dx, right: r.right - o.left + dx, top: r.top - o.top + dy, bottom: r.bottom - o.top + dy, width: r.width, height: r.height }; };
  function drawMapLines(ch) {
    const map = note.querySelector('.bl-map'), svg = note.querySelector('.bl-maplines');
    if (!map || !svg) return;
    const o = map.getBoundingClientRect(), box = s => note.querySelector(`[data-node="${CSS.escape(s)}"]`);
    svg.setAttribute('viewBox', `0 0 ${o.width} ${o.height}`);
    const ties = ch.ties.filter(([a, b]) => box(a) && box(b)), rects = new Map();
    const rectOf = s => rects.get(s) || rects.set(s, within(box(s), o)).get(s);
    svg.innerHTML = arrows(ties, rectOf, 'bl-maparrow');
  }

  const note = document.createElement('div');
  note.className = 'bl-relnote'; note.hidden = true; note.setAttribute('role', 'tooltip');
  // inside the board's wrapper, so it shows in full screen too
  wrap.appendChild(note);
  let on = null;

  function show(c) {
    if (on === c) return;
    clear();
    const ch = chainOf(c.dataset.slug);
    if (ch.steps.size < 2) return;
    on = c;
    board.classList.add('bl-relating');
    c.classList.add('rel-self');
    for (const [s, d] of ch.up) bySlug.get(s)?.classList.add('rel-up', d > 1 ? 'rel-far' : 'rel-near');
    for (const [s, d] of ch.down) bySlug.get(s)?.classList.add('rel-down', d > 1 ? 'rel-far' : 'rel-near');
    note.innerHTML = mapHtml(ch);
    note.hidden = false;
    drawMapLines(ch);
    if (pointer) follow(pointer); else { const r = c.getBoundingClientRect(); placeNote(r.left, r.bottom + 8, r.top - 8); }
  }
  // The note sits just below and right of the pointer and moves with it, flipping to the other side near the window's
  // edges; from the keyboard it sits under the focused card.
  function placeNote(x, below, above) {
    const w = note.offsetWidth, h = note.offsetHeight;
    note.style.left = `${Math.max(8, x + w + 8 > innerWidth ? x - w - 16 : x)}px`;
    note.style.top = `${below + h + 8 < innerHeight ? below : Math.max(8, above - h)}px`;
  }
  let pointer = null;
  const follow = p => { if (!note.hidden) placeNote(p.x + 16, p.y + 20, p.y - 12); };
  function clear() {
    if (!on) return;
    on = null;
    board.classList.remove('bl-relating');
    for (const c of cards) c.classList.remove('rel-self', 'rel-up', 'rel-down', 'rel-near', 'rel-far');
    note.hidden = true;
  }
  board.addEventListener('pointerover', e => { pointer = { x: e.clientX, y: e.clientY }; const c = e.target.closest('.bl-card[data-slug]'); if (c) show(c); });
  board.addEventListener('pointermove', e => { pointer = { x: e.clientX, y: e.clientY }; follow(pointer); });
  board.addEventListener('pointerleave', clear);
  board.addEventListener('pointerout', e => { if (e.relatedTarget && !e.relatedTarget.closest?.('.bl-card')) clear(); });
  board.addEventListener('focusin', e => { pointer = null; const c = e.target.closest('.bl-card[data-slug]'); if (c) show(c); });
  board.addEventListener('focusout', clear);
  // from the keyboard the note is placed under the card, which a scroll moves: it goes until the next card is focused
  addEventListener('scroll', () => { if (!pointer) note.hidden = true; }, { passive: true, capture: true });

  // ---- the chain lined up on the board ----
  // Only the chain's cards show, whatever the filters say, each at the top of its own column in chain order, with
  // arrows between them and a bar that names the chain. Esc or the bar's button puts the board back: the filters were
  // never touched, and the scroll comes back to where it was.
  const bar = document.createElement('div');
  bar.className = 'bl-chainbar'; bar.hidden = true; bar.setAttribute('role', 'status');
  board.before(bar);
  const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  lines.setAttribute('class', 'bl-chainlines'); lines.setAttribute('aria-hidden', 'true');
  board.append(lines);
  let view = null;
  function drawBoardLines() {
    if (!view) return;
    const o = board.getBoundingClientRect();
    lines.setAttribute('width', board.scrollWidth); lines.setAttribute('height', board.scrollHeight);
    const rects = new Map(), rectOf = s => rects.get(s) || rects.set(s, within(bySlug.get(s), o, board.scrollLeft, board.scrollTop)).get(s);
    lines.innerHTML = arrows(view.ch.ties.filter(([a, b]) => bySlug.has(a) && bySlug.has(b)), rectOf, 'bl-chainarrow');
  }
  function lineUp(slug) {
    if (!bySlug.has(slug)) return;
    const ch = chainOf(slug);
    if (ch.steps.size < 2) return;
    clear();
    const scroller = document.fullscreenElement;
    const back = view ? view.back : { x: scrollX, y: scrollY, left: board.scrollLeft, top: scroller ? scroller.scrollTop : 0, cols: board.style.gridTemplateColumns };
    if (view) for (const c of cards) { delete c.dataset.chain; c.style.order = ''; }
    view = { ch, back };
    board.classList.add('bl-chainview');
    const lowest = Math.min(...ch.steps.values());
    for (const [s, k] of ch.steps) { const c = bySlug.get(s); if (c) { c.dataset.chain = s === slug ? 'self' : k < 0 ? 'up' : 'down'; c.style.order = String(k - lowest); } }
    const used = [...board.querySelectorAll('.bl-col')].filter(col => col.querySelector('.bl-card[data-chain]')).length;
    board.style.gridTemplateColumns = `repeat(${used}, minmax(240px, 300px))`;
    bar.innerHTML = `<span><b>The chain of</b> ${esc(titleOf(slug))}</span><span class="hint">${ch.steps.size} cards · arrows run from what has to finish first${board.querySelector('.bl-card[data-chain][hidden]') ? ' · your filters are set aside' : ''}</span>
      <button type="button" class="btn btn-secondary" data-leave>Back to the board</button><span class="hint">or Esc</span>`;
    bar.hidden = false;
    board.scrollLeft = 0;
    requestAnimationFrame(() => { bar.scrollIntoView({ block: 'start' }); drawBoardLines(); });
  }
  function leave() {
    if (!view) return;
    const { back } = view;
    view = null;
    board.classList.remove('bl-chainview');
    for (const c of cards) { delete c.dataset.chain; c.style.order = ''; }
    lines.innerHTML = '';
    bar.hidden = true;
    board.style.gridTemplateColumns = back.cols;
    if (window.hqBoard) window.hqBoard.reflow();
    requestAnimationFrame(() => { scrollTo(back.x, back.y); board.scrollLeft = back.left; if (document.fullscreenElement) document.fullscreenElement.scrollTop = back.top; });
  }
  bar.addEventListener('click', e => { if (e.target.closest('[data-leave]')) leave(); });
  addEventListener('resize', () => requestAnimationFrame(drawBoardLines));
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) || document.querySelector('dialog[open]')) return;
    if ((e.key === 'f' || e.key === 'F') && on) { e.preventDefault(); lineUp(on.dataset.slug); }
    else if (e.key === 'Escape' && view) { e.preventDefault(); leave(); }
  });
  // an item's popup offers Show the chain; on the board it lines the chain up here, and a link to /backlog?chain=<item>
  // opens the board that way
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-chain-of]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    const d = a.closest('dialog');
    if (d && d.open) d.close();
    lineUp(a.dataset.chainOf);
  });
  const asked = new URLSearchParams(location.search).get('chain');
  if (asked) requestAnimationFrame(() => lineUp(asked));
})();

// The Hunter tab's Start a pass: Open in Claude with { hunt: true }. The server picks the folder and the first message,
// so the button sends nothing else.
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-hunt-start]');
  if (!b || b.disabled) return;
  const said = document.querySelector('[data-hunt-said]');
  b.disabled = true;
  let msg;
  try {
    const r = await fetch('/claude/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hunt: true }) });
    msg = (await r.json().catch(() => ({}))).message || `HQ answered ${r.status}`;
  } catch { msg = 'HQ did not answer. Is make hq still running?'; }
  if (said) said.textContent = msg;
  b.disabled = false;
});

// The Hunter tab: a pass's details open under its row; how many of a deck's cards are answered in this browser; and
// what a pass's buttons do, each through the server, which finds the pass by the date the button carries.
const huntPost = async (path, body) => {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, ...(await r.json().catch(() => ({ message: `HQ answered ${r.status}` }))) };
  } catch { return { ok: false, message: 'HQ did not answer. Is make hq still running?' }; }
};
const huntSay = (date, text) => { const el = document.querySelector(`[data-hunt-said-for="${CSS.escape(date)}"]`); if (el) el.textContent = text; };
for (const el of document.querySelectorAll('[data-deck-answered]')) {
  let n = 0;
  try { n = Object.keys(JSON.parse(localStorage.getItem(`qk-deck:${el.dataset.deckAnswered}`) || '{}').answers || {}).length; } catch { /* none kept */ }
  el.textContent = n ? `${n} of ${el.dataset.total} answered here` : 'none answered yet';
}
// the confirm for Stop and Clean up: a title, text and lists built here as text, and the button that goes ahead
function huntConfirm({ title, parts, ok }) {
  const d = document.querySelector('.hunt-dialog');
  if (!d) return Promise.resolve(window.confirm(title));
  d.querySelector('#hunt-dialog-title').textContent = title;
  const box = d.querySelector('.hunt-dialog-text');
  box.replaceChildren(...parts.map(p => {
    if (typeof p === 'string') { const el = document.createElement('p'); el.textContent = p; return el; }
    const h = document.createElement('h4'); h.className = 'dk-h'; h.textContent = p.head;
    const ul = document.createElement('ul'); ul.className = 'hunt-planlist';
    for (const x of p.list) { const li = document.createElement('li'); const b = document.createElement('code'); b.textContent = x.what; li.append(b, ` ${x.why}`); ul.append(li); }
    if (!p.list.length) { const li = document.createElement('li'); li.className = 'hint'; li.textContent = p.none; ul.append(li); }
    const wrap = document.createElement('div'); wrap.append(h, ul); return wrap;
  }));
  const go = d.querySelector('.hunt-dialog-ok');
  go.textContent = ok || 'Go ahead'; go.hidden = !ok;
  d.returnValue = '';
  d.showModal();
  return new Promise(done => d.addEventListener('close', () => done(d.returnValue === 'ok'), { once: true }));
}
document.addEventListener('click', async e => {
  const open = e.target.closest('.hunt-open');
  if (open) {
    const row = document.getElementById(open.getAttribute('aria-controls')), on = open.getAttribute('aria-expanded') !== 'true';
    open.setAttribute('aria-expanded', String(on)); if (row) row.hidden = !on;
    return;
  }
  const b = e.target.closest('[data-hunt-take], [data-hunt-stop], [data-hunt-clean]');
  if (!b || b.disabled) return;
  const date = b.dataset.date;
  b.disabled = true;
  try {
    if ('huntTake' in b.dataset) {
      huntSay(date, (await huntPost('/claude/open', { pass: 'take', date })).message || '');
    } else if ('huntStop' in b.dataset) {
      const yes = await huntConfirm({ title: `Stop the ${date} pass?`, ok: 'Stop the pass', parts: [
        `Its Claude${b.dataset.pid ? ` (pid ${b.dataset.pid}${b.dataset.tty ? `, in the Terminal tab on ${b.dataset.tty}` : ''})` : ''} stops now, mid-step. hq/hunt.mjs checks it is that pass's Claude first, and refuses otherwise.`,
        'Left behind: its worktrees, hunt/ branches and claims stay as they are, and any pull request it opened stays open. Clean up shows what can go once it has stopped, and you can continue its conversation from Go to its Terminal.'] });
      if (yes) { huntSay(date, 'Stopping…'); const r = await huntPost('/hunt/manage', { action: 'stop', date }); huntSay(date, r.message || (r.ok ? 'Stopped.' : 'Not stopped.')); }
    } else {
      huntSay(date, 'Reading what clean up would do…');
      const plan = await huntPost('/hunt/manage', { action: 'plan', date });
      if (!plan.ok) { huntSay(date, plan.message || 'Clean up said no.'); return; }
      huntSay(date, '');
      const yes = await huntConfirm({ title: `Clean up after the ${date} pass?`, ok: plan.remove.length ? `Remove ${plan.remove.length}` : '', parts: [
        plan.remove.length ? 'These go. Each is safe to remove for the reason beside it.' : 'Nothing can go yet: everything this pass left is still needed, for the reasons below.',
        { head: 'Removed', list: plan.remove.map(x => ({ what: `${x.kind} ${x.what}`, why: x.why })), none: 'nothing' },
        { head: 'Kept', list: plan.keep.map(x => ({ what: x.branch || x.what, why: x.why })), none: 'nothing' }] });
      if (yes) {
        huntSay(date, 'Cleaning up…');
        const r = await huntPost('/hunt/manage', { action: 'cleanup', date });
        const done = (r.done || []).filter(x => x.done).length, failed = (r.done || []).filter(x => !x.done);
        huntSay(date, r.message && !r.done ? r.message : `Removed ${done}${failed.length ? `; could not remove ${failed.map(x => `${x.what} (${x.error || 'refused'})`).join(', ')}` : ''}; kept ${(r.keep || []).length}.`);
      }
    }
  } finally { b.disabled = false; }
});

// A pass's deck, answered here: hq/static/deck.js's engine, drawn in HQ's look by deck-hq.js. Two mounts of the one
// deck: the page, for looking through the cards, the list and the results, and Play the deck, the same cards one at a
// time in a full-screen modal. Both keep their answers under the deck's one localStorage key; each reads it again when
// the other hands over (opening the player, closing it), and only the one in front takes keys. Send to the pass hands
// the results to Open in Claude: to the pass's Terminal while it runs (the results are on the clipboard to paste), or
// as the first message of its conversation continued once it has ended.
(() => {
  const el = document.getElementById('hunt-deck'), data = document.getElementById('hunt-deck-data');
  if (!el || !data || !window.qkDeck || !window.qkDeckHq) return;
  const deck = JSON.parse(data.textContent);
  const dialog = document.getElementById('hunt-play'), playRoot = document.getElementById('hunt-play-deck');
  const send = !('send' in el.dataset) ? null : async (text, copied) => {
    const r = await fetch('/claude/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pass: 'answers', text, date: el.dataset.date }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.running && !copied) return 'Selected: press Cmd+C, then paste it into the pass';
    return j.message || `HQ answered ${r.status}`;
  };
  const onPage = window.qkDeck.mount(el, deck, { prefix: 'dk-', send, view: window.qkDeckHq, active: () => !(dialog && dialog.open) });
  if (!dialog || !playRoot || !window.qkDeckPlay) return;

  let player = null, opener = null, escInNote = false;
  // Send from the player says what happened on the page, once the player has closed
  const sendAndClose = !send ? null : async (text, copied) => {
    const said = await send(text, copied);
    close();
    const t = document.getElementById('dk-toast');
    if (t) { t.textContent = said; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 4000); } // cap: a toast shows for a moment, then goes
    return said;
  };
  function open(from) {
    opener = from || document.activeElement;
    dialog.showModal();
    if (!player) player = window.qkDeck.mount(playRoot, deck, { prefix: 'dm-', send: sendAndClose, view: window.qkDeckPlay, active: () => dialog.open });
    player.reload({ resume: true });
    (playRoot.querySelector('#dm-bAgree:not([hidden])') || playRoot.querySelector('.dm-head button')).focus();
  }
  function close() { if (dialog.open) dialog.close(); }
  dialog.addEventListener('close', () => {
    onPage.reload();
    if (opener && opener.isConnected) opener.focus();
  });
  // Esc in the note leaves the note, as on the page; anywhere else it closes the player
  dialog.addEventListener('keydown', e => { escInNote = e.key === 'Escape' && !!(e.target.closest && e.target.closest('textarea, input')); }, true);
  dialog.addEventListener('cancel', e => { if (escInNote) { e.preventDefault(); escInNote = false; } });
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-dm-open]');
    if (o) { e.preventDefault(); open(o); return; }
    if (e.target.closest('[data-dm-close]') && dialog.contains(e.target)) close();
  });
  // a link from the Hunter tab's Play the deck opens straight into the player
  if (new URLSearchParams(location.search).get('play') === '1') open(document.querySelector('[data-dm-open]'));
})();
