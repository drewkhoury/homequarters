// The sums hq.js does about the screen, kept apart so the node tests can check them: where a popover goes so it stays
// on screen, how many filter chips fit on one row, the pipeline canvas's zoom, fit and mini map, and which section of
// a markdown file is being read. A plain script: the page loads it before hq.js, and node imports it; either way it sets
// globalThis.hqMath.
(function () {
  // Where to put a popover of size tip beside the anchor's rectangle, inside a viewport of vw × vh, `gap` away.
  // Below the anchor if it fits, else above if that fits better; lined up with the anchor's left edge, moved left
  // to stay inside, and never past the left edge. Answers { top, left, side } in viewport pixels (position: fixed).
  function place(anchor, tip, vw, vh, gap = 8, margin = 8) {
    const below = anchor.bottom + gap, above = anchor.top - gap - tip.height;
    const roomBelow = vh - margin - below, roomAbove = above - margin;
    const side = tip.height <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above';
    let top = side === 'below' ? below : above;
    top = Math.max(margin, Math.min(top, vh - margin - tip.height));
    let left = anchor.left;
    if (left + tip.width > vw - margin) left = anchor.right - tip.width; // flip to end at the anchor's right edge
    left = Math.max(margin, Math.min(left, vw - margin - tip.width));
    return { top, left, side };
  }

  // How many chips of these widths fit on one row of `available` pixels with `gap` between, leaving room for a
  // "+N more" button of width `more` when not all of them fit. At least one is always shown.
  function fitChips(widths, available, gap, more) {
    let used = 0;
    for (let i = 0; i < widths.length; i++) used += (i ? gap : 0) + widths[i];
    if (used <= available) return widths.length;
    let n = 0; used = 0;
    while (n < widths.length && used + (n ? gap : 0) + widths[n] + gap + more <= available) { used += (n ? gap : 0) + widths[n]; n++; }
    return Math.max(1, n);
  }

  // The pipeline canvas: a view is { x, y, k } (pan in screen pixels, scale). Zoom by `by` keeping the point under
  // (px, py) still; fit a W × H drawing into a sw × sh stage; and turn a point on the mini map (mw × mh, drawing
  // scaled to fit) into the view that centres the stage on that point.
  const clampK = k => Math.min(6, Math.max(0.15, k));
  function zoomAt(v, px, py, by) {
    const k = clampK(v.k * by);
    return { x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k), k };
  }
  function fit(W, H, sw, sh, pad = 0.94) {
    const k = clampK(Math.min(sw / W, sh / H, 1.6) * pad);
    return { x: (sw - W * k) / 2, y: (sh - H * k) / 2, k };
  }
  // the part of the drawing the stage shows, in drawing units
  const visible = (v, sw, sh) => ({ x: -v.x / v.k || 0, y: -v.y / v.k || 0, w: sw / v.k, h: sh / v.k });
  function centreOn(v, wx, wy, sw, sh) { return { x: sw / 2 - wx * v.k, y: sh / 2 - wy * v.k, k: v.k }; }
  const miniToWorld = (mx, my, W, H, mw, mh) => { const s = Math.min(mw / W, mh / H); return [mx / s, my / s]; };

  // A table's filters (hq.js). The values a column's menu offers: each once, most common first, then by name, with how
  // many rows hold it; a blank is no value.
  function menuValues(values) {
    const n = new Map();
    for (const v of values) if (v) n.set(v, (n.get(v) || 0) + 1);
    return [...n].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  // Whether a row stays: every word of the search is somewhere in its searchable text, in any case, and each column
  // whose menu has values chosen holds one of them. row: { text, vals: { col: value } }; sets: { col: Set }.
  function rowMatches(row, { query, sets }) {
    const text = (row.text || '').toLowerCase();
    if (query && !query.toLowerCase().split(/\s+/).filter(Boolean).every(w => text.includes(w))) return false;
    return Object.entries(sets || {}).every(([col, set]) => !set.size || set.has((row.vals || {})[col]));
  }
  // What the bar says about the rows shown.
  const showing = (shown, total) => (shown === total ? `All ${total}` : shown ? `Showing ${shown} of ${total}` : `None of ${total} match`);
  // A markdown file's section rail: which section is being read. tops are where each section's heading is, in window
  // pixels, top to bottom, null for one not shown. The answer is the last whose heading has reached `line`, or the last
  // shown when the reader is at the end of the document, or -1 above the first.
  function currentSection(tops, line, atEnd = false) {
    let at = -1;
    tops.forEach((t, i) => { if (t != null && (atEnd || t <= line)) at = i; });
    return at;
  }
  globalThis.hqMath = { place, fitChips, zoomAt, fit, visible, centreOn, miniToWorld, menuValues, rowMatches, showing, currentSection };
})();
