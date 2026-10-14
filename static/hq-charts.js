// The HTML tooltip for HQ's charts (hq/lib/charts.mjs). A mark, or a day's link over a chart, carries its words in
// data-tip; this shows them on hover, on keyboard focus and on a tap, in place of the native <title>, which shows late
// and never on a phone. Escape or a tap elsewhere hides it. On a day's link, the first tap shows the tooltip and a
// second tap follows the link. A plain script: a page loads it through layout's scripts, and node imports it for its
// arithmetic; either way it sets globalThis.hqChartTip.
(function () {
  const REACH = 8; // px from a mark that still counts as on it, since a dot is 8 px across

  // Which mark the pointer means: the one it is on, the smallest when marks nest (a label inside a day's column), or
  // the nearest within reach. boxes are { el, left, top, right, bottom } in the window's px.
  function nearest(boxes, x, y, reach = REACH) {
    let best = null, bestD = Infinity, bestA = Infinity;
    for (const b of boxes) {
      const d = Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
      const a = (b.right - b.left) * (b.bottom - b.top);
      if (d > reach) continue;
      if (d < bestD || (d === bestD && a < bestA)) { best = b.el; bestD = d; bestA = a; }
    }
    return best;
  }

  // Where a w by h tooltip goes for a point at x, y: centred above it, 8 px inside the window, and below the point when
  // there is no room above.
  function place(w, h, x, y, vw, vh, gap = 12) {
    const left = Math.min(Math.max(8, x - w / 2), vw - w - 8);
    let top = y - h - gap;
    if (top < 8) top = Math.min(y + gap + 4, vh - h - 8);
    return { left, top };
  }

  // What a tap does, from the mark the last tap showed and the mark this one means: show it, follow the link under it
  // when the last tap already showed that mark, or hide the tooltip when the tap meant no mark. What keyboard focus
  // showed has no say, since a tap on a link focuses it before the tap arrives.
  function tapStep(tapped, el, onLink) {
    if (!el) return 'hide';
    return onLink && tapped === el ? 'follow' : 'show';
  }

  globalThis.hqChartTip = { nearest, place, tapStep };
  if (typeof document === 'undefined') return;

  // the part of a page one chart render covers; a hidden render's marks have no size and are never nearest
  const ROOTS = '.bl-chart-wide, .bl-chart-narrow, .bl-chart, svg.bl-spark';
  let tip = null, shown = null, tapped = null, touch = false;

  function start() {
    tip = document.createElement('div');
    tip.className = 'bl-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.append(tip);
    // with this running, the native titles step aside, so a mark shows one tooltip and not two
    for (const t of document.querySelectorAll('.bl-chart svg title, svg.bl-spark title')) t.remove();
    for (const a of document.querySelectorAll('.bl-hits a[title]')) a.removeAttribute('title');
  }

  function show(el, x, y) {
    const text = el && el.getAttribute('data-tip');
    if (!tip || !text) return hide();
    if (shown !== el) { tip.textContent = text; shown = el; }
    tip.hidden = false;
    const r = tip.getBoundingClientRect(), p = place(r.width, r.height, x, y, innerWidth, innerHeight);
    tip.style.left = `${p.left}px`;
    tip.style.top = `${p.top}px`;
  }
  function hide() {
    if (tip) tip.hidden = true;
    shown = null;
    tapped = null;
  }

  // the mark the pointer means inside one chart render, or else the day's link it is over
  function pick(target, x, y) {
    const root = target && target.closest ? target.closest(ROOTS) : null;
    if (!root) return null;
    const boxes = [...root.querySelectorAll('svg [data-tip]')].map(el => { const b = el.getBoundingClientRect(); return { el, left: b.left, top: b.top, right: b.right, bottom: b.bottom }; });
    return nearest(boxes, x, y) || target.closest('[data-tip]');
  }

  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const el = pick(e.target, e.clientX, e.clientY);
    if (el) show(el, e.clientX, e.clientY); else if (shown) hide();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', hide);
  document.addEventListener('pointerdown', e => { touch = e.pointerType === 'touch'; }, { passive: true });
  document.addEventListener('click', e => {
    if (!touch) return;
    const el = pick(e.target, e.clientX, e.clientY), step = tapStep(tapped, el, !!e.target.closest('a[href]'));
    if (step === 'hide') return hide();
    if (step === 'follow') return;
    e.preventDefault();
    show(el, e.clientX, e.clientY);
    tapped = el;
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el || !el.closest(ROOTS)) return hide();
    const b = el.getBoundingClientRect();
    show(el, b.left + b.width / 2, b.top);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  addEventListener('scroll', hide, { passive: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
