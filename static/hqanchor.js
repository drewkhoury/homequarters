// Finding a comment's words on the page again (hq-comments.js), kept apart so the node tests can check it. The page's
// text arrives as pieces, one per text node in document order; a comment remembers the words it was made on (the
// quote) and a little of the text either side (prefix and suffix). Whitespace is ignored when matching, since a
// selection spanning table cells or lines comes back with tabs and newlines the page's text does not have, and the
// other way round. A plain script: the page loads it before hq-comments.js, and node imports it; either way it sets
// globalThis.hqAnchor.
(function () {
  const WS = /\s/;
  const strip = s => String(s || '').replace(/\s+/g, '');

  // The pieces joined with their whitespace left out, and for each character kept, which piece and offset it came from.
  function flatten(pieces) {
    let text = '';
    const at = [];
    pieces.forEach((p, i) => {
      for (let o = 0; o < p.length; o++) if (!WS.test(p[o])) { text += p[o]; at.push([i, o]); }
    });
    return { text, at };
  }

  // How many characters of `want` agree with the text running back from `end` (for a prefix) or on from `start`
  // (for a suffix). The closer to the quote they agree, the more they count.
  function agreeBack(text, end, want) {
    let n = 0;
    for (let i = want.length - 1, j = end - 1; i >= 0 && j >= 0 && want[i] === text[j]; i--, j--) n++;
    return n;
  }
  function agreeOn(text, start, want) {
    let n = 0;
    for (let i = 0, j = start; i < want.length && j < text.length && want[i] === text[j]; i++, j++) n++;
    return n;
  }

  // Where the quote is among the pieces, as the part of each piece it covers: [{ piece, start, end }] with end not
  // included, or null when it is not there (the comment is detached). With more than one match, the one whose
  // surroundings agree best with the prefix and suffix wins; on a tie, the one nearest the piece `near` (the code
  // view's line), else the first.
  function locate(pieces, anchor, { near = null } = {}) {
    const q = strip(anchor && anchor.quote);
    if (!q) return null;
    const { text, at } = flatten(pieces);
    const pre = strip(anchor.prefix), suf = strip(anchor.suffix);
    const nearAt = near == null ? null : at.findIndex(([p]) => p >= near);
    let best = null;
    for (let from = text.indexOf(q); from >= 0; from = text.indexOf(q, from + 1)) {
      const score = agreeBack(text, from, pre) + agreeOn(text, from + q.length, suf);
      const dist = nearAt == null || nearAt < 0 ? 0 : Math.abs(from - nearAt);
      if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { from, score, dist };
    }
    if (!best) return null;
    const first = at[best.from], last = at[best.from + q.length - 1];
    const out = [];
    for (let i = first[0]; i <= last[0]; i++) {
      out.push({ piece: i, start: i === first[0] ? first[1] : 0, end: i === last[0] ? last[1] + 1 : pieces[i].length });
    }
    return out;
  }

  // Markers in the margin, one per line: tops within `gap` pixels of each other share one, which shows how many.
  // Takes [{ id, top }] and answers [{ top, ids }] from the top down.
  function groupRows(items, gap = 8) {
    const rows = [];
    for (const it of [...items].sort((a, b) => a.top - b.top)) {
      const row = rows[rows.length - 1];
      if (row && it.top - row.top <= gap) row.ids.push(it.id); else rows.push({ top: it.top, ids: [it.id] });
    }
    return rows;
  }

  globalThis.hqAnchor = { strip, locate, groupRows };
})();
