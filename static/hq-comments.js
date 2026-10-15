// Comments on any HQ page, kept in this browser only. Select some text and press Comment, or comment on the whole
// page; the Comments button lists them all, copies them as text to paste into Claude, and clears them. They are
// cleared after the time chosen in the list (never, to start with). Nothing leaves the browser except what you copy.
//
// A comment stays where it was made, as in a shared document: its words are highlighted, a marker in the right margin
// shows it, and clicking either opens it under the words. Each comment keeps the words it was made on and a little
// text either side, so the highlight finds the right place again after a reload, or when a backlog item's popup
// opens; hqanchor.js does the matching. A comment whose words are no longer on its page is detached: it stays in the
// list, marked so. Everything floating (the Comment button, the write box, a comment's card, the markers) is placed
// in the page's own coordinates, so it scrolls with the words, and inside the backlog's popup while that is open.
(function () {
  const KEY = 'hq.comments', KEEP = 'hq.comments.keep', FLASH = 'hq.comments.flash', PLACE = 'hq.comments.button', DAY = 86400000;
  const PLACES = [['right', 'Bottom right'], ['left', 'Bottom left'], ['tucked', 'Tucked away']];
  const store = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } },
  };
  const keepDays = () => store.get(KEEP, 0); // 0: never, until someone picks a time in the list
  const load = () => {
    const keep = keepDays(), all = store.get(KEY, []);
    const live = keep ? all.filter(c => Date.now() - c.at < keep * DAY) : all;
    if (live.length !== all.length) store.set(KEY, live);
    return live;
  };
  const save = list => { store.set(KEY, list); render(); schedule(); };
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const el = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const when = at => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const OURS = '.hqc-pick, .hqc-box, .hqc-card, .hqc-margin, .hqc-panel, .hqc-pill';

  // ---- where things are ----

  // What floating things are placed in: the open modal dialog holding `node` (the backlog's popup), else the page.
  // Anything outside an open modal dialog cannot be clicked while it is open.
  const hostOf = node => {
    const d = node && (node.nodeType === 1 ? node : node.parentElement)?.closest('dialog');
    if (d && d.open && d.matches(':modal')) return d;
    return [...document.querySelectorAll('dialog[open]')].filter(x => x.matches(':modal') && !x.classList.contains('hqc-panel')).pop() || document.body;
  };
  // A point on screen in the coordinates of `host`, for position: absolute inside it. The page's are the document's;
  // a dialog's count from its padding box and scroll with its content.
  function toHost(pt, host) {
    if (host === document.body) return { top: pt.top + scrollY, left: pt.left + scrollX };
    const r = host.getBoundingClientRect();
    return { top: pt.top - r.top - host.clientTop + host.scrollTop, left: pt.left - r.left - host.clientLeft + host.scrollLeft };
  }
  // The visible box of `host` on screen, to keep floating things inside it.
  const hostBox = host => (host === document.body ? { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: innerHeight } : host.getBoundingClientRect());

  // Places `node` inside `host` beside the screen rectangle `rect`: below it, or above when there is no room below.
  // Inside a popup it is fixed to the screen instead, since the popup scrolls and would cut off anything near its
  // edges; a fixed box escapes that, and scrolling places it again (relayout).
  function placeBy(node, rect, host, { alignRight = true } = {}) {
    host.appendChild(node);
    node.hidden = false;
    const fixed = host !== document.body;
    node.style.position = fixed ? 'fixed' : '';
    const box = fixed ? { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: innerHeight } : hostBox(host), w = node.offsetWidth, h = node.offsetHeight;
    const left = Math.max(box.left + 8, Math.min(alignRight ? rect.right - w : rect.left, box.right - w - 8));
    const top = rect.bottom + 6 + h > box.bottom && rect.top - h - 6 > box.top ? rect.top - h - 6 : rect.bottom + 6;
    const p = fixed ? { top, left } : toHost({ top, left }, host);
    node.style.top = `${p.top}px`; node.style.left = `${p.left}px`;
  }

  // Where a selection or the page is: the file, the line in the code view, the backlog item, its title, the address.
  function whereOf(node) {
    const n = node && (node.nodeType === 1 ? node : node.parentElement);
    const fileEl = n && n.closest('[data-path]:not(button):not(a)');
    const row = n && n.closest('tr[id^="L"]');
    const head = n && n.closest('.bl-detail');
    const title = head ? (head.querySelector('.bl-detail-title, h1')?.textContent || '').trim() : document.title.replace(/ · (QuestKeep )?HQ$/, '');
    const slug = head && head.dataset.slug ? head.dataset.slug : '';
    const hash = slug ? `#${slug}` : location.hash;
    return { file: fileEl ? fileEl.dataset.path : '', line: row ? +row.id.slice(1) : null, slug, title, page: location.pathname + location.search + hash };
  }

  // The text a comment can sit on, one piece per text node: what is on show, less HQ's own furniture (line numbers,
  // heading anchors, these comments' own cards and markers), since a selection never includes those.
  const SKIP = `.ln, .hq-anchor, [aria-hidden="true"], script, style, template, textarea, select, ${OURS}`;
  function textPieces(root) {
    const out = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n; (n = walk.nextNode());) out.push(n);
    return out;
  }
  // Where a comment is saved from: the item's popup, the file, else the page's main part.
  const rootOf = node => (node.nodeType === 1 ? node : node.parentElement).closest('.bl-detail, [data-path]:not(button):not(a), main, dialog');

  // A little of the text either side of a selection, from the same pieces the highlight is found in later.
  function around(range, root) {
    let before = '', after = '';
    for (const n of textPieces(root)) {
      if (n === range.startContainer) before += n.data.slice(0, range.startOffset);
      else if (range.comparePoint(n, n.length) < 0) before += n.data;
      if (n === range.endContainer) after += n.data.slice(range.endOffset);
      else if (range.comparePoint(n, 0) > 0) after += n.data;
    }
    return { prefix: before.slice(-48), suffix: after.slice(0, 48) };
  }

  // The elements a comment's words are looked for in on this page, or none when it belongs to another page.
  function containersFor(c) {
    if (c.slug) return [...document.querySelectorAll(`.bl-detail[data-slug="${CSS.escape(c.slug)}"]`)];
    if (c.file) return [...document.querySelectorAll(`[data-path="${CSS.escape(c.file)}"]:not(button):not(a)`)];
    const [path] = String(c.page || '').split('#');
    return path === location.pathname + location.search ? [document.querySelector('main')].filter(Boolean) : [];
  }

  // ---- highlights ----

  const BAD_PARENT = /^(TR|TBODY|THEAD|TFOOT|TABLE|UL|OL|DL|COLGROUP)$/;
  // Wraps each covered part of a text node in a mark for the comment.
  function wrap(nodes, ranges, id) {
    for (const r of ranges) {
      let n = nodes[r.piece];
      if (!n || !n.parentNode || BAD_PARENT.test(n.parentNode.nodeName)) continue;
      if (!n.data.slice(r.start, r.end).trim()) continue;
      if (r.end < n.length) n.splitText(r.end);
      if (r.start > 0) n = n.splitText(r.start);
      const m = document.createElement('mark');
      m.className = 'hqc-mark'; m.dataset.comment = id;
      n.parentNode.insertBefore(m, n);
      m.appendChild(n);
    }
  }
  function unwrap(id) {
    for (const m of document.querySelectorAll(`mark.hqc-mark[data-comment="${CSS.escape(id)}"]`)) {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      parent.normalize();
    }
  }
  const marksOf = id => [...document.querySelectorAll(`mark.hqc-mark[data-comment="${CSS.escape(id)}"]`)];

  // What each comment is on this page: 'here' (highlighted), 'detached' (its page, but its words are gone), or
  // 'elsewhere' (another page). The list shows it.
  const state = new Map();
  let pendingFlash = null;
  try { pendingFlash = sessionStorage.getItem(FLASH); sessionStorage.removeItem(FLASH); } catch { /* none */ }

  function apply() {
    const list = load(), ids = new Set(list.map(c => c.id));
    for (const m of document.querySelectorAll('mark.hqc-mark')) if (!ids.has(m.dataset.comment)) unwrap(m.dataset.comment);
    for (const c of list) {
      if (!c.quote) { state.set(c.id, 'page'); continue; }
      if (marksOf(c.id).length) { state.set(c.id, 'here'); continue; }
      const roots = containersFor(c);
      if (!roots.length) { state.set(c.id, 'elsewhere'); continue; }
      let found = false;
      for (const root of roots) {
        const nodes = textPieces(root);
        const row = c.line ? root.querySelector(`tr#L${c.line}`) : null;
        const near = row ? nodes.findIndex(n => row.contains(n)) : -1;
        const ranges = globalThis.hqAnchor.locate(nodes.map(n => n.data), c, { near: near >= 0 ? near : null });
        if (ranges) { wrap(nodes, ranges, c.id); found = true; }
      }
      state.set(c.id, found ? 'here' : 'detached');
    }
    observer.takeRecords();
    layout();
    if (pendingFlash && marksOf(pendingFlash).length) { const id = pendingFlash; pendingFlash = null; flash(id); }
    if (panel.open) render();
  }

  // ---- markers in the margin, and the card that opens a comment ----

  const card = el('<div class="hqc-card" hidden role="dialog" aria-label="Comment"></div>');
  let cardIds = [];

  // Whether a mark can be seen: not scrolled out of a box that scrolls on its own (a pane of the split markdown view,
  // the code view's horizontal scroll), up to the page or the popup it is in.
  function inView(mark, host) {
    const m = mark.getBoundingClientRect();
    for (let e = mark.parentElement; e && e !== host && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/auto|scroll|hidden/.test(cs.overflowY + cs.overflowX)) {
        const r = e.getBoundingClientRect();
        if (m.bottom < r.top || m.top > r.bottom || m.right < r.left || m.left > r.right) return false;
      }
    }
    return true;
  }

  // One marker per line with comments on it, in the right margin of what the comment is on.
  function layout() {
    for (const m of document.querySelectorAll('.hqc-margin')) m.remove();
    const byHost = new Map();
    for (const c of load()) {
      const mark = marksOf(c.id).find(m => m.getClientRects().length && inView(m, hostOf(m)));
      if (!mark) continue;
      const host = hostOf(mark), root = mark.closest('.bl-detail, [data-path], main') || mark.parentElement;
      const r = mark.getBoundingClientRect(), box = hostBox(host), edge = Math.min(root.getBoundingClientRect().right + 6, box.right - 30);
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host).push({ id: c.id, top: r.top, edge });
    }
    for (const [host, items] of byHost) {
      for (const row of globalThis.hqAnchor.groupRows(items)) {
        const edge = Math.min(...items.filter(i => row.ids.includes(i.id)).map(i => i.edge));
        const b = el(`<button type="button" class="hqc-margin" data-ids="${esc(row.ids.join(' '))}" aria-label="${row.ids.length === 1 ? 'A comment' : `${row.ids.length} comments`} here">${row.ids.length}</button>`);
        host.appendChild(b);
        const p = toHost({ top: row.top, left: edge }, host);
        b.style.top = `${p.top}px`; b.style.left = `${p.left}px`;
      }
    }
    if (!card.hidden) placeCard();
  }

  function cardHtml(ids) {
    const list = load();
    return ids.map(id => list.find(c => c.id === id)).filter(Boolean).map(c => `<div class="hqc-card-one" data-id="${esc(c.id)}">
      <p class="hqc-card-text">${esc(c.text)}</p>
      <div class="hqc-card-foot"><span class="hint">${esc(when(c.at))}</span>
        <button type="button" class="btn btn-ghost" data-edit>Edit</button><button type="button" class="btn btn-ghost hqc-danger" data-delete>Delete</button></div></div>`).join('');
  }
  function placeCard() {
    const mark = cardIds.map(id => marksOf(id).find(m => m.getClientRects().length)).find(Boolean);
    if (!mark) { closeCard(); return; }
    placeBy(card, mark.getBoundingClientRect(), hostOf(mark), { alignRight: false });
  }
  function openCard(ids) {
    const same = !card.hidden && ids.join(' ') === cardIds.join(' ');
    closeCard();
    if (same) return;
    cardIds = ids;
    card.innerHTML = cardHtml(ids);
    for (const id of ids) for (const m of marksOf(id)) m.classList.add('open');
    placeCard();
  }
  function closeCard() {
    card.hidden = true;
    for (const m of document.querySelectorAll('mark.hqc-mark.open')) m.classList.remove('open');
    cardIds = [];
  }
  card.addEventListener('click', e => {
    const one = e.target.closest('.hqc-card-one');
    if (!one) return;
    const id = one.dataset.id;
    if (e.target.closest('[data-delete]')) {
      unwrap(id);
      save(load().filter(c => c.id !== id));
      cardIds = cardIds.filter(x => x !== id);
      if (cardIds.length) { card.innerHTML = cardHtml(cardIds); placeCard(); } else closeCard();
    } else if (e.target.closest('[data-edit]')) {
      const c = load().find(x => x.id === id);
      one.querySelector('.hqc-card-text').outerHTML = `<form class="hqc-edit"><textarea class="input" rows="3" aria-label="Edit the comment">${esc(c ? c.text : '')}</textarea>
        <div class="hqc-row"><button type="button" class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary">Save</button></div></form>`;
      one.querySelector('[data-edit]').hidden = true;
      one.querySelector('textarea').focus();
    } else if (e.target.closest('[data-cancel]')) { card.innerHTML = cardHtml(cardIds); placeCard(); }
  });
  card.addEventListener('submit', e => {
    e.preventDefault();
    const one = e.target.closest('.hqc-card-one'), text = one.querySelector('textarea').value.trim();
    if (text) save(load().map(c => (c.id === one.dataset.id ? { ...c, text } : c)));
    card.innerHTML = cardHtml(cardIds); placeCard();
  });
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.matches('textarea')) { e.preventDefault(); e.target.form.requestSubmit(); }
    // Escape closes the card, not the popup around it
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCard(); }
  });

  // Scrolls to a comment's words, flashes them and opens it.
  function flash(id) {
    const m = marksOf(id)[0];
    if (!m) return false;
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    for (const x of marksOf(id)) { x.classList.remove('flash'); void x.offsetWidth; x.classList.add('flash'); }
    openCard([id]);
    return true;
  }

  // ---- the Comment button by a selection, and the box to write in ----
  const pick = el('<button type="button" class="hqc-pick" hidden>Comment</button>');
  const box = el(`<form class="hqc-box" hidden><p class="hqc-quote"></p><textarea class="input" rows="3" placeholder="Your comment" aria-label="Your comment"></textarea>
    <div class="hqc-row"><span class="hint">Return saves, Shift+Return for a new line</span><button type="button" class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary">Save</button></div></form>`);
  let pending = null, pendingRect = null;

  document.addEventListener('mouseup', e => {
    if (e.target.closest(`${OURS}, input, textarea, select`)) return;
    setTimeout(() => { // cap: the selection settles after mouseup
      const sel = getSelection(), text = sel && String(sel).trim();
      if (!text || !sel.rangeCount || !sel.anchorNode || !sel.anchorNode.parentElement?.closest('main, dialog')) { pick.hidden = true; return; }
      const range = sel.getRangeAt(0), root = rootOf(sel.anchorNode);
      pending = { quote: text.slice(0, 600), ...(root ? around(range, root) : {}), ...whereOf(sel.anchorNode) };
      pendingRect = range.getBoundingClientRect();
      placeBy(pick, pendingRect, hostOf(sel.anchorNode));
    }, 0);
  });
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('.hqc-pick')) pick.hidden = true;
    if (!card.hidden && !e.target.closest('.hqc-card, .hqc-margin, mark.hqc-mark')) closeCard();
  });
  // the button's place is read before it hides: a hidden element measures as all zeros, which put the box in the corner
  pick.addEventListener('click', () => { const at = pick.getBoundingClientRect(); pick.hidden = true; if (pending) openBox(pending, at, hostOf(pick)); });
  // Clicking a highlight or a margin marker opens its comments, unless the click ended a selection.
  document.addEventListener('click', e => {
    const marker = e.target.closest('.hqc-margin');
    if (marker) return openCard(marker.dataset.ids.split(' '));
    const m = e.target.closest('mark.hqc-mark');
    if (m && getSelection().isCollapsed) openCard([m.dataset.comment]);
  });

  function openBox(where, rect, host) {
    pending = where;
    box.querySelector('.hqc-quote').textContent = where.quote ? `“${where.quote.length > 160 ? where.quote.slice(0, 160) + '…' : where.quote}”` : `On ${where.file || where.page}`;
    box.querySelector('textarea').value = '';
    placeBy(box, rect, host);
    box.querySelector('textarea').focus({ preventScroll: true });
  }
  box.addEventListener('submit', e => {
    e.preventDefault();
    const text = box.querySelector('textarea').value.trim();
    if (text && pending) save([...load(), { id: newId(), at: Date.now(), text, ...pending }]);
    box.hidden = true; pending = null; getSelection().removeAllRanges();
  });
  box.querySelector('[data-cancel]').addEventListener('click', () => { box.hidden = true; pending = null; });
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); box.requestSubmit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); box.hidden = true; }
  });

  // ---- the Comments button and its list ----
  const pill = el('<button type="button" class="hqc-pill" aria-haspopup="dialog">Comments <b>0</b></button>');
  const panel = el(`<dialog class="hqc-panel" aria-label="Your comments"><div class="hqc-head"><h2>Your comments</h2><button type="button" class="btn btn-ghost" data-close aria-label="Close">Close</button></div>
    <p class="hint">Kept in this browser only, on this address. Copy them into Claude, then clear them.</p>
    <div class="hqc-actions"><button type="button" class="btn btn-primary" data-copy>Copy for Claude</button><button type="button" class="btn btn-secondary" data-terminal>Open in Claude</button>
      <button type="button" class="btn btn-secondary" data-askabout>Chat about these</button><button type="button" class="btn btn-ghost" data-here>Comment on this page</button>
      <label class="hint">Clear after <select class="input" data-keep><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="0">never</option></select></label>
      <button type="button" class="btn btn-ghost hqc-danger" data-clear>Clear all</button></div>
    <div class="hqc-place"><span class="hint">The Comments button</span><div class="seg hq-spans" role="group" aria-label="Where the Comments button sits">${PLACES.map(([k, l]) =>
      `<button type="button" class="seg-opt" data-place="${k}">${l}</button>`).join('')}</div></div>
    <p class="hqc-said" aria-live="polite"></p><div class="hqc-list"></div></dialog>`);
  document.body.append(pill, panel);

  const groupOf = c => (c.file ? `${c.file}${c.title && !c.title.endsWith(c.file) ? ` (${c.title})` : ''}` : `Page ${c.page} (${c.title})`);
  function grouped(list) {
    const m = new Map();
    for (const c of [...list].sort((a, b) => a.at - b.at)) { const k = groupOf(c); if (!m.has(k)) m.set(k, []); m.get(k).push(c); }
    return m;
  }
  const on = c => (c.quote ? `On ${c.line ? `line ${c.line}, ` : ''}“${c.quote.replace(/\s+/g, ' ')}”` : c.line ? `On line ${c.line}` : 'On the whole');

  function asText(list) {
    const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    let out = `Comments from HQ (${list.length}), ${day}. File paths are from the repo root.\n`;
    for (const [k, cs] of grouped(list)) {
      out += `\n${k}\n`;
      for (const c of cs) out += `- ${on(c)}: ${c.text.replace(/\n+/g, ' ')}\n`;
    }
    return out;
  }

  const TAG = { here: '<span class="hqc-tag">on this page</span>', detached: '<span class="hqc-tag detached" title="Its words are no longer on its page">detached</span>' };
  function render() {
    const list = load();
    pill.querySelector('b').textContent = list.length;
    pill.classList.toggle('has', list.length > 0);
    panel.querySelector('[data-keep]').value = String(keepDays());
    for (const b of panel.querySelectorAll('[data-copy], [data-clear], [data-terminal], [data-askabout]')) b.disabled = !list.length;
    panel.querySelector('.hqc-list').innerHTML = list.length ? [...grouped(list)].map(([k, cs]) => `<section><h3>${esc(k)}</h3><ul>${cs.map(c => `<li>
      <a class="hqc-where" href="${esc(c.page)}" data-id="${esc(c.id)}">${esc(on(c))}</a>${TAG[state.get(c.id)] || ''}<p>${esc(c.text)}</p>
      <span class="hint">${esc(when(c.at))}</span>
      <button type="button" class="btn btn-ghost hqc-del" data-del="${esc(c.id)}" aria-label="Delete this comment">Delete</button></li>`).join('')}</ul></section>`).join('')
      : '<p class="hint">No comments yet. Select text on any page and press Comment.</p>';
  }
  const say = t => { panel.querySelector('.hqc-said').innerHTML = t; };

  // Where the button sits, so it can move off whatever it covers: either bottom corner, or tucked into a thin tab on
  // the right edge (one click still opens the list). Kept in this browser.
  function place(where = store.get(PLACE, 'tucked')) {
    if (!PLACES.some(([k]) => k === where)) where = 'tucked';
    pill.dataset.place = where;
    pill.title = where === 'tucked' ? 'Your comments' : '';
    for (const b of panel.querySelectorAll('[data-place]')) b.setAttribute('aria-pressed', String(b.dataset.place === where));
  }
  place();
  panel.querySelector('.hqc-place').addEventListener('click', e => { const b = e.target.closest('[data-place]'); if (b) { store.set(PLACE, b.dataset.place); place(); } });
  pill.addEventListener('click', () => { render(); say(''); panel.showModal(); });
  panel.addEventListener('click', async e => {
    if (e.target === panel || e.target.closest('[data-close]')) return panel.close();
    const where = e.target.closest('.hqc-where');
    if (where && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      // on this page: close the list and go to the words; elsewhere: go there, and flash them once it has loaded
      const id = where.dataset.id, [path, hash = ''] = where.getAttribute('href').split('#');
      if (path !== location.pathname + location.search) { try { sessionStorage.setItem(FLASH, id); } catch { /* not kept */ } return; }
      e.preventDefault();
      panel.close();
      if (hash && location.hash !== `#${hash}`) { pendingFlash = id; location.hash = hash; return; }
      if (!flash(id)) { pendingFlash = id; schedule(); }
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) { unwrap(del.dataset.del); return save(load().filter(c => c.id !== del.dataset.del)); }
    if (e.target.closest('[data-here]')) { panel.close(); return openBox({ quote: '', ...whereOf(document.querySelector('.hq-md, [data-path]:not(button):not(a), main')) }, pill.getBoundingClientRect(), document.body); }
    if (e.target.closest('[data-copy]')) {
      const list = load();
      try { await navigator.clipboard.writeText(asText(list)); say(`Copied ${list.length}. <button type="button" class="btn btn-ghost hqc-danger" data-clear-copied>Clear these now</button>`); }
      catch { say('The browser would not copy. Select the text below instead.'); panel.querySelector('.hqc-list').innerHTML = `<pre class="hqc-text">${esc(asText(list))}</pre>`; }
      panel.dataset.copied = list.map(c => c.id).join(' ');
      return;
    }
    if (e.target.closest('[data-terminal]') && window.hqClaude) {
      const list = load(), st = await window.hqClaude.status();
      if (st && !st.canOpen) return say('Open in Claude works on macOS only for now. Copy for Claude, then paste into claude.');
      const msg = await window.hqClaude.openInTerminal(asText(list));
      panel.dataset.copied = list.map(c => c.id).join(' ');
      const keys = st && st.billing && st.billing.set.length ? ` ${esc(st.billing.set.join(', '))} is set where HQ runs; if the Terminal has it too, it asks before starting, since it would bill API credits.` : '';
      return say(`${esc(msg)}${keys} <button type="button" class="btn btn-ghost hqc-danger" data-clear-copied>Clear these now</button>`);
    }
    if (e.target.closest('[data-askabout]') && window.hqClaude) { panel.close(); return window.hqClaude.askAbout(asText(load())); }
    if (e.target.closest('[data-clear-copied]')) {
      const ids = new Set((panel.dataset.copied || '').split(' '));
      for (const id of ids) unwrap(id);
      save(load().filter(c => !ids.has(c.id)));
      return say('Cleared the ones you copied.');
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      // a second press confirms, since the dialog cannot ask
      if (clear.dataset.armed) { for (const c of load()) unwrap(c.id); save([]); delete clear.dataset.armed; clear.textContent = 'Clear all'; return say('Cleared.'); }
      clear.dataset.armed = '1'; clear.textContent = `Clear all ${load().length}? Press again`;
    }
  });
  panel.querySelector('[data-keep]').addEventListener('change', e => { store.set(KEEP, +e.target.value); render(); schedule(); });

  // ---- keeping the highlights and markers up to date ----

  // New content (a popup filled, a page part loaded) gets its highlights; anything that moves the words moves the
  // markers. Once per frame at most, and never for this script's own changes.
  let queued = false;
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; apply(); }); } }
  const ours = n => (n.nodeType === 1 ? n.matches('mark.hqc-mark') || !!n.closest(OURS) : !!(n.parentElement && n.parentElement.closest(`${OURS}, mark.hqc-mark`)));
  const observer = new MutationObserver(records => {
    if (records.some(r => ![...r.addedNodes, ...r.removedNodes].every(ours))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  let relaying = false;
  const relayout = () => { if (!relaying) { relaying = true; requestAnimationFrame(() => { relaying = false; layout(); }); } };
  addEventListener('scroll', relayout, { capture: true, passive: true });
  addEventListener('resize', relayout);
  // a dialog opening or closing (the backlog popup) changes which markers can show
  document.addEventListener('close', relayout, true);

  window.hqComments = { whereOf, asText, load, reapply: schedule };
  render();
  apply();
})();
