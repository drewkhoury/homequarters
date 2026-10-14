// The little HQ does in the browser; every page works without it.

// Code: #L10-L20 lights a range of lines, and a shift-click on a line number extends the one lit to a range
const code = document.querySelector('.hq-code[data-file]');
if (code) {
  const light = () => {
    for (const r of code.querySelectorAll('tr.hl')) r.classList.remove('hl');
    const m = /^#L(\d+)(?:-L?(\d+))?$/.exec(location.hash);
    if (!m) return;
    const a = +m[1], b = +(m[2] || m[1]);
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) { const r = document.getElementById('L' + n); if (r) r.classList.add('hl'); }
    const first = document.getElementById('L' + Math.min(a, b));
    if (first) first.scrollIntoView({ block: 'center' });
  };
  code.addEventListener('click', e => {
    const a = e.target.closest('.ln a');
    const m = /^#L(\d+)/.exec(location.hash);
    if (!a || !e.shiftKey || !m) return;
    e.preventDefault();
    history.replaceState(null, '', `#L${m[1]}-L${a.textContent}`);
    light();
  });
  addEventListener('hashchange', light);
  light();
  // Until the page has loaded, the browser keeps scrolling to the #L anchor itself, which puts the line at the top, and
  // a markdown file's saved view (Code or Split, further down) only shows the line after this. So it is centred again
  // once the load is done.
  if (document.readyState !== 'complete') addEventListener('load', light, { once: true });
}

// Show in Finder: the one thing HQ does rather than reads, so it goes to the server as a POST with JSON
const say = (() => {
  let box, timer;
  return text => {
    if (!box) { box = document.createElement('div'); box.className = 'hq-toast'; box.setAttribute('role', 'status'); document.body.append(box); }
    box.textContent = text; box.classList.add('show');
    clearTimeout(timer); timer = setTimeout(() => box.classList.remove('show'), 2600);
  };
})();
document.addEventListener('click', async e => {
  const b = e.target.closest('.hq-reveal');
  if (!b) return;
  try {
    const r = await fetch('/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: b.dataset.root, path: b.dataset.path }) });
    say((await r.json()).message);
  } catch { say('HQ did not answer. Is make hq still running?'); }
});

// For each line of code, and each heading of a doc, a small bar on hover: open that line in the editor, on GitHub,
// or show the file in Finder. The element holding the lines carries the links with {line} to fill in. The bar lives
// inside the hovered line itself, so it can only ever show there.
for (const host of document.querySelectorAll('[data-editor]')) {
  const bar = document.createElement('span');
  bar.className = 'hq-linebar';
  bar.innerHTML = '<a data-k="editor">Editor</a><a data-k="github" target="_blank" rel="noopener">GitHub</a>' +
    '<button type="button" class="hq-reveal">Finder</button>';
  Object.assign(bar.querySelector('.hq-reveal').dataset, { root: host.dataset.root, path: host.dataset.path });
  if (!host.dataset.github) bar.querySelector('[data-k=github]').remove();
  host.addEventListener('mouseover', e => {
    const row = e.target.closest('tr[id^="L"], [data-line]');
    if (!row || !host.contains(row) || row.contains(bar)) return;
    const line = row.id ? row.id.slice(1) : row.dataset.line;
    for (const a of bar.querySelectorAll('a')) a.href = host.dataset[a.dataset.k].replace('{line}', line);
    (row.querySelector('td.tx') || row).append(bar);
  });
  host.addEventListener('mouseleave', () => bar.remove());
}

// GitHub: the open tab loads when it is first shown, the chip in the header says whether gh works, and the bar says
// how old the open tab's answers are. Refresh asks GitHub again for the open tab and the chip.
const ghParts = document.querySelectorAll('.hq-gh-part');
if (ghParts.length) {
  const updated = document.querySelector('[data-updated]'), button = document.querySelector('[data-refresh]');
  const chip = document.querySelector('[data-health]'), chipText = document.querySelector('[data-health-text]'), chipBody = document.querySelector('[data-health-body]');
  const loadedAt = new Map();
  const parts = document.querySelectorAll('.hq-gh-part [data-load-part]'); // the Dashboard's CI now and Actions minutes
  let open = [...ghParts].find(p => !p.hidden).dataset.part;
  const ago = () => {
    const t = loadedAt.get(open);
    if (!t) return;
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    updated.textContent = `Updated ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`} ago`;
  };
  const get = async (name, fresh, wait) => {
    const r = await fetch(`/github/part/${name}${fresh ? '?fresh=1' : wait ? '?wait=1' : ''}`);
    if (!r.ok) throw new Error(`HQ answered ${r.status}`);
    return r.json();
  };
  const failed = e => `<p class="hq-problem"><span class="hq-mark bad">!</span> Could not load this. ${e.message === 'Failed to fetch' ? 'HQ did not answer. Is make hq still running?' : e.message}</p>`;
  // quiet: an update in the background (auto-refresh, or the newer answer behind a stale one) with no loading line
  const load = async (name, fresh, quiet = false, wait = false) => {
    const sec = document.querySelector(`.hq-gh-part[data-part="${name}"]`), body = sec.querySelector('.hq-gh-body');
    if (!quiet) {
      sec.setAttribute('aria-busy', 'true'); sec.classList.add('loading');
      if (fresh || !loadedAt.has(name)) body.insertAdjacentHTML('afterbegin', '<p class="hq-loading">Loading…</p>');
      if (name === open) { button.disabled = true; updated.textContent = 'Loading…'; }
    }
    let again = false;
    try {
      const d = await get(name, fresh, wait);
      body.innerHTML = d.html; window.hqTables(body);
      const n = document.querySelector(`[data-count="${name}"]`);
      if (n) n.textContent = d.count == null ? '' : d.count;
      sec.classList.toggle('failed', !d.ok);
      loadedAt.set(name, d.at);
      again = !!d.refreshing;
    } catch (e) { if (!quiet) { body.innerHTML = failed(e); sec.classList.add('failed'); } }
    sec.classList.remove('loading'); sec.setAttribute('aria-busy', 'false');
    if (name === open) { button.disabled = false; if (loadedAt.has(name)) ago(); else updated.textContent = 'Nothing loaded.'; }
    // what came back was old: show it now, and the new answer as soon as GitHub gives it
    if (again) load(name, false, true, true);
  };
  const health = async (fresh, quiet = false) => {
    if (!quiet) { chip.dataset.state = 'checking'; chipText.textContent = 'checking…'; }
    try {
      const d = await get('health', fresh, quiet);
      chipBody.innerHTML = d.html;
      chip.dataset.state = d.ok ? 'ok' : 'bad';
      chipText.textContent = d.ok ? 'OK' : (d.problem || 'problem');
    } catch (e) { chipBody.innerHTML = failed(e); chip.dataset.state = 'bad'; chipText.textContent = 'no answer'; }
  };
  const show = name => {
    open = name;
    for (const p of ghParts) p.hidden = p.dataset.part !== name;
    for (const t of document.querySelectorAll('.hq-tabs [data-tab]')) { const on = t.dataset.tab === name; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); }
    history.replaceState(null, '', `?tab=${name}`);
    if (!loadedAt.has(name)) load(name, false); else ago();
  };
  document.querySelector('.hq-tabs').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) { e.preventDefault(); show(t.dataset.tab); } });
  button.addEventListener('click', () => {
    for (const k of [...loadedAt.keys()]) if (k !== open) loadedAt.delete(k);
    load(open, true); health(true);
    if (open === 'dashboard') for (const el of parts) loadPart(el, true);
  });
  setInterval(ago, 1000);
  // every minute while this tab is on screen, ask for anything that has gone old (the server decides: 30 s, or
  // 10 minutes for billing); nothing while the tab is hidden, and a look straight away when it comes back
  const tick = () => {
    if (document.hidden) return;
    load(open, false, true, true); health(false, true);
    if (open === 'dashboard') for (const el of parts) loadPart(el, false, true);
  };
  let timer = setInterval(tick, 60000);
  document.addEventListener('visibilitychange', () => { clearInterval(timer); if (!document.hidden) { tick(); timer = setInterval(tick, 60000); } });
  health(false);
  load(open, false);
  // CI now and the minutes load with the Dashboard, the first time it is shown
  const once = () => { if (open === 'dashboard') for (const el of parts) if (!el.dataset.at) loadPart(el, false); };
  once();
  document.querySelector('.hq-tabs').addEventListener('click', () => setTimeout(once));
}

// storage can be off (a private window); HQ works without it, it just forgets
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } },
};

// The file tree: open the folders a person left open, and remember only what they open or close themselves. The folders
// on the way to the current file start open (tree.mjs) and a group can hide folders; neither is remembered, or every
// folder once passed through would open on every page (27 September).
for (const tree of document.querySelectorAll('.hq-ftree')) {
  // v2: the list kept before 27 September holds every folder a group or a page ever opened, so it starts again
  const key = `hq-tree-open:v2:${tree.dataset.tree}`, open = new Set(store.get(key, []));
  for (const d of tree.querySelectorAll('details')) if (open.has(d.dataset.path)) d.open = true;
  let byHand = null; // the folder a click or a key on its name is about to open or close
  tree.addEventListener('click', e => { const s = e.target.closest('summary'); byHand = s ? s.parentElement : null; }, true);
  tree.addEventListener('keydown', e => { const s = e.target.closest('summary'); byHand = s && (e.key === 'Enter' || e.key === ' ') ? s.parentElement : null; }, true);
  tree.addEventListener('toggle', e => {
    const d = e.target;
    if (d !== byHand) return;
    byHand = null;
    if (d.open) open.add(d.dataset.path); else open.delete(d.dataset.path);
    store.set(key, [...open]);
  }, true);
  const on = tree.querySelector('a.on');
  if (on) {
    const t = tree.getBoundingClientRect(), r = on.getBoundingClientRect();
    if (r.top < t.top || r.bottom > t.bottom) tree.scrollTop += r.top - t.top - tree.clientHeight / 3;
  }
}

// Long lines wrap by default; the button turns that off, and the choice is kept
for (const toggle of document.querySelectorAll('.hq-wrap-toggle')) {
  const views = document.querySelectorAll('.hq-code');
  const apply = on => { for (const v of views) v.classList.toggle('wrap', on); toggle.setAttribute('aria-pressed', String(on)); };
  apply(store.get('hq-wrap', true));
  toggle.addEventListener('click', () => { const on = toggle.getAttribute('aria-pressed') !== 'true'; store.set('hq-wrap', on); apply(on); });
}

// A markdown file on the Code page: switch between Code, Preview and Split without leaving, and keep the choice.
// In Split the two sides scroll together: each rendered heading knows its line, so the two scroll positions are
// matched heading to heading, and in between by how far along the stretch between two headings you are.
const mdview = document.querySelector('.hq-mdview');
if (mdview) {
  const buttons = document.querySelectorAll('.hq-views [data-view]');
  const show = view => {
    mdview.dataset.view = view;
    for (const b of buttons) if (b.dataset.view === view) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  };
  if (!mdview.hasAttribute('data-asked')) show(store.get('hq-md-view', 'preview'));
  for (const b of buttons) b.addEventListener('click', e => { e.preventDefault(); show(b.dataset.view); store.set('hq-md-view', b.dataset.view); });

  const codePane = mdview.querySelector('.hq-pane-code'), preview = mdview.querySelector('.hq-pane-preview');
  // pairs of scroll positions that belong together, top to bottom
  const pairs = () => {
    const list = [[0, 0]], top = (el, pane) => el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    for (const h of preview.querySelectorAll('[data-line]')) {
      const row = document.getElementById('L' + h.dataset.line);
      if (row) list.push([top(row, codePane), top(h, preview)]);
    }
    list.push([codePane.scrollHeight - codePane.clientHeight, preview.scrollHeight - preview.clientHeight]);
    return list.filter((p, i, a) => i === 0 || (p[0] > a[i - 1][0] && p[1] >= a[i - 1][1]));
  };
  const follow = (from, side) => {
    const list = pairs(), y = from.scrollTop;
    let i = 0;
    while (i < list.length - 2 && list[i + 1][side] <= y) i++;
    const [a, b] = [list[i], list[i + 1] || list[i]], span = b[side] - a[side];
    const t = span > 0 ? (y - a[side]) / span : 0;
    return a[1 - side] + t * (b[1 - side] - a[1 - side]);
  };
  let leader = null, quiet;
  const sync = (from, to, side) => () => {
    if (mdview.dataset.view !== 'split' || (leader && leader !== from)) return;
    leader = from; clearTimeout(quiet); quiet = setTimeout(() => { leader = null; }, 120);
    to.scrollTop = follow(from, side);
  };
  codePane.addEventListener('scroll', sync(codePane, preview, 0), { passive: true });
  preview.addEventListener('scroll', sync(preview, codePane, 1), { passive: true });
}

// A markdown file's sections (home.mjs sectionRail). The rail's tick for the section being read is lit as you scroll:
// the last whose heading has passed a line near the top (the middle in the Code view, where a jump centres its line).
// Hovering the rail or tabbing into it opens the card of names, and leaving closes it; the header's button opens it to
// stay until a click elsewhere. Esc closes it, and so does choosing a link. The links follow the view: a heading's line
// in Code, the heading itself otherwise. A section jumped to stays lit while its heading is on screen, so one near the
// end of the file is not passed over for the last.
const sectionRail = document.querySelector('.hq-rail');
if (sectionRail) {
  const rail = sectionRail, button = document.querySelector('.hq-sections'), view = () => (mdview ? mdview.dataset.view : 'preview');
  const ticks = [...rail.querySelectorAll('.hq-rail-ticks a')], items = [...rail.querySelectorAll('.hq-rail-list a')];
  let pinned = false, lit = -1, chosen = -1, queued = false;
  const open = (on, pin = false) => {
    pinned = on && (pin || pinned);
    rail.classList.toggle('open', on);
    if (button) button.setAttribute('aria-expanded', String(on));
  };
  const aim = () => {
    const code = view() === 'code';
    for (const a of [...ticks, ...items]) a.setAttribute('href', code && a.dataset.line ? `#L${a.dataset.line}` : `#${a.dataset.id}`);
  };
  const target = a => document.getElementById(view() === 'code' && a.dataset.line ? `L${a.dataset.line}` : a.dataset.id);
  const light = () => {
    queued = false;
    const pane = view() === 'split' ? mdview.querySelector('.hq-pane-preview') : null;
    const tops = items.map(a => { const el = target(a); return el && el.offsetParent ? el.getBoundingClientRect().top : null; });
    const line = view() === 'code' ? innerHeight / 2 : (pane ? pane.getBoundingClientRect().top : 0) + 96;
    const atEnd = pane ? pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2 : innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    if (chosen >= 0 && !(tops[chosen] != null && tops[chosen] >= 0 && tops[chosen] < innerHeight)) chosen = -1;
    const at = chosen >= 0 ? chosen : hqMath.currentSection(tops, line, atEnd);
    if (at === lit) return;
    lit = at;
    ticks.forEach((t, i) => t.classList.toggle('on', i === at));
    items.forEach((a, i) => (i === at ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(light); } };

  // with the card open, the tick under the pointer lights its section's name there, so running the pointer down the
  // strip shows where each tick goes before it is clicked
  const peek = i => items.forEach((a, j) => a.classList.toggle('peek', j === i));
  const strip = rail.querySelector('.hq-rail-ticks');
  if (strip) {
    strip.addEventListener('pointerover', e => { const a = e.target.closest('a'); peek(a ? ticks.indexOf(a) : -1); });
    strip.addEventListener('pointerleave', () => peek(-1));
  }
  // leaving the rail closes the card a moment later, so a pointer that cuts a corner on its way to the card keeps it
  let closing = 0;
  rail.addEventListener('pointerenter', () => { clearTimeout(closing); open(true); });
  rail.addEventListener('pointerleave', () => { clearTimeout(closing); closing = setTimeout(() => { if (!pinned) open(false); }, 250); });
  rail.addEventListener('focusin', () => open(true));
  rail.addEventListener('focusout', e => { if (!rail.contains(e.relatedTarget)) open(false); });
  rail.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a) return;
    chosen = (a.closest('.hq-rail-ticks') ? ticks : items).indexOf(a);
    // a section's heading may be pinned at the top already, where the browser sees nothing to scroll to, so the jump
    // goes to the start of its section (home.mjs, sectionsOf)
    const el = target(a), sec = el && el.parentElement && el.parentElement.classList.contains('hq-sec') && el === el.parentElement.firstElementChild ? el.parentElement : null;
    if (sec) { e.preventDefault(); sec.scrollIntoView({ block: 'start' }); history.replaceState(null, '', `#${a.dataset.id}`); }
    open(false); queue();
  });
  if (button) button.addEventListener('click', () => {
    if (rail.classList.contains('open')) { open(false); return; }
    open(true, true);
    (items[lit] || items[0]).focus({ preventScroll: true });
  });
  document.addEventListener('click', e => { if (pinned && !rail.contains(e.target) && !(button && button.contains(e.target))) open(false); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !rail.classList.contains('open')) return;
    const inside = rail.contains(document.activeElement);
    open(false);
    if (inside) { if (button && button.offsetParent) button.focus({ preventScroll: true }); else document.activeElement.blur(); }
  });
  // the view switch (above) has already changed the view by the time its click reaches the document
  document.addEventListener('click', e => { if (e.target.closest('.hq-views [data-view]')) { chosen = -1; aim(); queue(); } });
  addEventListener('scroll', queue, { passive: true, capture: true });
  addEventListener('resize', queue);
  aim(); light();
}

// Info icons: the text shows beside the icon on hover, focus or a tap, in one popover kept in the body with fixed
// positioning, so no scrolling box or page edge can cut it off (hqMath.place picks the spot). Inside an open popup it
// moves into that popup, since a modal dialog sits above everything in the body.
const infoTip = (() => {
  let box = null, owner = null;
  const show = icon => {
    if (!box) { box = document.createElement('div'); box.className = 'hq-floattip'; box.setAttribute('role', 'tooltip'); box.id = 'hq-floattip'; }
    const host = icon.closest('dialog[open]') || document.body;
    if (box.parentNode !== host) host.append(box);
    owner = icon;
    box.textContent = icon.querySelector('.hq-tip').textContent;
    box.hidden = false;
    const r = icon.getBoundingClientRect(), p = hqMath.place(r, { width: box.offsetWidth, height: box.offsetHeight }, innerWidth, innerHeight);
    box.style.top = `${p.top}px`; box.style.left = `${p.left}px`; box.dataset.side = p.side;
    icon.setAttribute('aria-describedby', box.id);
  };
  const hide = icon => { if (box && (!icon || icon === owner) && !(owner && owner.classList.contains('open'))) { box.hidden = true; owner = null; } };
  const close = () => { for (const o of document.querySelectorAll('.hq-info.open')) { o.classList.remove('open'); o.setAttribute('aria-expanded', 'false'); } if (box) box.hidden = true; owner = null; };
  return { show, hide, close };
})();
document.addEventListener('pointerover', e => { const i = e.target.closest && e.target.closest('.hq-info'); if (i) infoTip.show(i); });
document.addEventListener('pointerout', e => { const i = e.target.closest && e.target.closest('.hq-info'); if (i && !i.contains(e.relatedTarget)) infoTip.hide(i); });
document.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('.hq-info')) infoTip.show(e.target); });
document.addEventListener('focusout', e => { if (e.target.matches && e.target.matches('.hq-info')) infoTip.hide(e.target); });
document.addEventListener('click', e => {
  const icon = e.target.closest('.hq-info');
  if (!icon) { infoTip.close(); return; }
  const on = !icon.classList.contains('open');
  infoTip.close();
  if (on) { icon.classList.add('open'); icon.setAttribute('aria-expanded', 'true'); infoTip.show(icon); }
});
addEventListener('scroll', () => infoTip.close(), { passive: true, capture: true });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') infoTip.close();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.hq-info')) { e.preventDefault(); e.target.click(); }
});

// Tables: click a column's name to sort by it (again to reverse). Above the table, one search box looks through the
// columns marked for it (every word must be there), and a menu for each column of labels lists its values, most common
// first, with a count; ticking values keeps the rows that hold one of them. The bar says how many rows show. A cell cut
// short shows its whole text on hover. Pages that add tables later (GitHub) call hqTables on what they added.
function hqTables(root = document) {
  for (const table of root.querySelectorAll('table.hq-dt:not([data-ready])')) {
    table.dataset.ready = '1';
    const scroll = table.closest('.hq-scroll'), prev = scroll && scroll.previousElementSibling;
    const bar = prev && prev.classList.contains('hq-dt-bar') ? prev : null;
    const body = table.tBodies[0], rows = [...body.rows], foot = table.tFoot;
    rows.forEach((r, i) => { r.dataset.i = i; });
    const cell = (r, col) => r.querySelector(`td[data-col="${CSS.escape(col)}"]`);
    const valueOf = (r, col, key) => { const c = cell(r, col); return c ? (c.dataset[key] ?? c.textContent.trim()) : ''; };
    const search = bar && bar.querySelector('.hq-dt-search'), searchCols = search ? search.dataset.cols.split(' ') : [];
    const facts = new Map(rows.map(r => [r, { text: searchCols.map(c => valueOf(r, c, 'f')).join(' '), vals: {} }]));
    const sets = {}, status = bar && bar.querySelector('.hq-dt-status'), clear = bar && bar.querySelector('.hq-dt-clear');
    const apply = () => {
      const query = search ? search.value.trim() : '';
      let shown = 0;
      for (const r of rows) { const ok = hqMath.rowMatches(facts.get(r), { query, sets }); r.hidden = !ok; shown += ok; }
      foot.hidden = shown > 0;
      if (status) status.textContent = hqMath.showing(shown, rows.length);
      if (clear) clear.hidden = !query && Object.values(sets).every(x => !x.size);
    };
    const menus = bar ? [...bar.querySelectorAll('.hq-dt-menu')] : [];
    for (const menu of menus) {
      const col = menu.dataset.col, set = sets[col] = new Set(menu.dataset.preset ? menu.dataset.preset.split('\n') : []);
      for (const r of rows) facts.get(r).vals[col] = valueOf(r, col, 'f');
      const list = menu.querySelector('.hq-dt-list'), n = menu.querySelector('.hq-dt-n');
      menu.hqMark = () => { n.hidden = !set.size; n.textContent = set.size; menu.classList.toggle('on', set.size > 0); };
      for (const { value, count } of hqMath.menuValues(rows.map(r => facts.get(r).vals[col]))) {
        const label = document.createElement('label'), box = document.createElement('input'), name = document.createElement('span'), num = document.createElement('span');
        box.type = 'checkbox'; box.checked = set.has(value); name.textContent = value; name.title = value; num.className = 'hint'; num.textContent = count;
        box.addEventListener('change', () => { if (box.checked) set.add(value); else set.delete(value); menu.hqMark(); apply(); });
        label.append(box, name, num); list.append(label);
      }
      menu.hqMark();
    }
    if (search) search.addEventListener('input', apply);
    if (clear) clear.addEventListener('click', () => {
      if (search) search.value = '';
      for (const menu of menus) { sets[menu.dataset.col].clear(); for (const x of menu.querySelectorAll('input')) x.checked = false; menu.hqMark(); }
      apply();
    });
    // the whole text of a cell cut short, on hover
    table.addEventListener('mouseover', e => {
      const td = e.target.closest('td.nw');
      if (td && !td.title && td.scrollWidth > td.clientWidth + 1) td.title = td.textContent.trim().replace(/\s+/g, ' ');
    });
    const heads = [...table.tHead.rows[0].cells];
    heads.forEach((th, i) => {
      const button = th.querySelector('.hq-sort');
      if (!button) return;
      button.addEventListener('click', () => {
        const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        for (const h of heads) if (h.hasAttribute('aria-sort')) h.setAttribute('aria-sort', 'none');
        th.setAttribute('aria-sort', dir);
        const col = body.rows[0] && body.rows[0].cells[i] ? body.rows[0].cells[i].dataset.col : null, num = th.dataset.sort === 'num';
        const key = r => { const v = valueOf(r, col, 'v'); return num ? (v === '' ? -Infinity : +v) : v.toLowerCase(); };
        const sorted = [...rows].sort((x, y) => { const p = key(x), q = key(y); return (p < q ? -1 : p > q ? 1 : +x.dataset.i - +y.dataset.i) * (dir === 'ascending' ? 1 : -1); });
        body.append(...sorted);
      });
    });
    apply();
  }
}
window.hqTables = hqTables;
hqTables();

// The file tree's groups: show only App, Tests, Docs and so on. A folder with nothing left to show is hidden too.
const groupBar = document.querySelector('.hq-groups');
if (groupBar) {
  const tree = document.querySelector('.hq-ftree');
  const pick = id => {
    for (const b of groupBar.querySelectorAll('[data-group]')) b.setAttribute('aria-pressed', String(b.dataset.group === id));
    for (const li of tree.querySelectorAll('li[data-group]')) li.hidden = id !== 'all' && li.dataset.group !== id;
    for (const d of [...tree.querySelectorAll('details')].reverse()) {
      const any = [...d.querySelector('ul').children].some(li => !li.hidden);
      d.parentElement.hidden = !any; // folders stay as the person left them
    }
  };
  const asked = new URLSearchParams(location.search).get('group');
  pick(asked || store.get('hq-group', 'all'));
  groupBar.addEventListener('click', e => { const b = e.target.closest('[data-group]'); if (b) { store.set('hq-group', b.dataset.group); pick(b.dataset.group); } });
}

// The ⋯ menu closes when you choose from it, click elsewhere, or press Escape
document.addEventListener('click', e => {
  for (const m of document.querySelectorAll('details.hq-dt-menu[open]')) if (!m.contains(e.target)) m.open = false;
  for (const m of document.querySelectorAll('details.hq-menu[open]')) if (!m.contains(e.target) || e.target.closest('.hq-menu-list a, .hq-menu-list button:not(.hq-wrap-toggle)')) m.open = false;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') for (const m of document.querySelectorAll('details.hq-menu[open], details.hq-dt-menu[open]')) m.open = false; });

// The pipeline canvas, like a map: Expand opens the whole drawing. The wheel (or a trackpad pinch) zooms around the
// pointer, a drag pans, arrow keys pan, + and − zoom, 0 fits, Esc closes. The mini map in the corner shows the part
// in view; click or drag on it to move there. The sums are in hqMath.
const canvas = document.querySelector('.hq-canvas');
if (canvas) {
  const stage = canvas.querySelector('.hq-canvas-stage'), svg = stage.querySelector('svg.hq-pipesvg'), world = svg.querySelector('[data-world]');
  const mini = stage.querySelector('.hq-minimap'), frame = mini.querySelector('.view');
  const W = +svg.getAttribute('width'), H = +svg.getAttribute('height');
  svg.removeAttribute('viewBox'); svg.removeAttribute('width'); svg.removeAttribute('height');
  let v = { x: 0, y: 0, k: 1 }, opener = null;
  const size = () => { const r = stage.getBoundingClientRect(); return [r.width, r.height]; };
  const draw = () => {
    world.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`);
    const s = hqMath.visible(v, ...size());
    frame.setAttribute('x', s.x); frame.setAttribute('y', s.y); frame.setAttribute('width', s.w); frame.setAttribute('height', s.h);
  };
  const set = nv => { v = nv; draw(); };
  const fit = () => set(hqMath.fit(W, H, ...size()));
  const zoomAt = (px, py, by) => set(hqMath.zoomAt(v, px, py, by));
  const centre = () => size().map(n => n / 2);
  const open = () => { opener = document.activeElement; canvas.hidden = false; document.body.style.overflow = 'hidden'; fit(); stage.focus(); };
  const close = () => { canvas.hidden = true; document.body.style.overflow = ''; if (opener) opener.focus(); };
  document.querySelector('[data-expand]').addEventListener('click', open);
  canvas.querySelector('[data-close]').addEventListener('click', close);
  canvas.addEventListener('click', e => {
    const z = e.target.closest('[data-zoom]');
    if (!z) return;
    if (z.dataset.zoom === 'fit') fit(); else zoomAt(...centre(), z.dataset.zoom === 'in' ? 1.25 : 0.8);
  });
  document.addEventListener('keydown', e => {
    if (canvas.hidden) return;
    const pan = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[e.key];
    if (pan) { e.preventDefault(); set({ ...v, x: v.x + pan[0], y: v.y + pan[1] }); }
    else if (e.key === 'Escape') close();
    else if (e.key === '+' || e.key === '=') zoomAt(...centre(), 1.25);
    else if (e.key === '-' || e.key === '_') zoomAt(...centre(), 0.8);
    else if (e.key === '0') fit();
  });
  stage.addEventListener('wheel', e => {
    if (mini.contains(e.target)) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    // every scroll zooms around the pointer, as on a map; a pinch comes as a wheel with ctrlKey and zooms faster
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)));
  }, { passive: false });
  let gk = 1; // Safari reports a trackpad pinch as gesture events
  stage.addEventListener('gesturestart', e => { e.preventDefault(); gk = 1; });
  stage.addEventListener('gesturechange', e => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.scale / gk); gk = e.scale; });
  let drag = null;
  const miniMove = e => {
    const r = mini.getBoundingClientRect(), [wx, wy] = hqMath.miniToWorld(e.clientX - r.left, e.clientY - r.top, W, H, r.width, r.height);
    set(hqMath.centreOn(v, wx, wy, ...size()));
  };
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId);
    if (mini.contains(e.target)) { drag = { mini: true }; miniMove(e); return; }
    drag = { px: e.clientX, py: e.clientY, x: v.x, y: v.y }; stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.mini) miniMove(e); else set({ ...v, x: drag.x + e.clientX - drag.px, y: drag.y + e.clientY - drag.py });
  });
  const stop = () => { drag = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', stop); stage.addEventListener('pointercancel', stop);
  addEventListener('resize', () => { if (!canvas.hidden) draw(); });
}

// Fetch: the second thing HQ does rather than reads. A POST, like Show in Finder; the page reloads to show the counts.
for (const b of document.querySelectorAll('.hq-fetch')) {
  b.addEventListener('click', async () => {
    b.disabled = true; b.classList.add('busy');
    try {
      const r = await fetch('/git/fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const d = await r.json();
      say(d.message);
      if (r.ok) setTimeout(() => location.reload(), 400);
    } catch { say('HQ did not answer. Is make hq still running?'); }
    b.disabled = false; b.classList.remove('busy');
  });
}

// The kinds of test: a card, a Pipeline step or a test's kind opens that kind's modal. Esc closes it (the browser does
// that for a <dialog>), and so does a click outside it or on ✕. Copy puts the command on the clipboard.
document.addEventListener('click', e => {
  const open = e.target.closest('[data-layer]');
  if (open) { const d = document.getElementById(`layer-${open.dataset.layer}`); if (d && !d.open) { d.showModal(); d.querySelector('[data-close]').focus(); } return; }
  const dialog = e.target.closest('dialog.hq-modal');
  if (e.target.matches('dialog.hq-modal') || (dialog && e.target.closest('[data-close]'))) (dialog || e.target).close();
});
document.addEventListener('click', async e => {
  const b = e.target.closest('.hq-copy');
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; }
  catch { const r = document.createRange(); r.selectNodeContents(b.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); b.textContent = 'Selected'; }
  setTimeout(() => { b.textContent = 'Copy'; }, 1500);
});

// A part of the GitHub page loaded into any element marked data-load-part (the Actions minutes on the Dashboard and in
// Home's panel). data-mini asks for the short version. Its "Updated N min ago" counts from when GitHub answered.
async function loadPart(el, fresh, wait = false) {
  if (!el) return;
  const name = el.dataset.loadPart;
  if (el.dataset.at && !wait) el.classList.add('loading');
  let again = false;
  try {
    const r = await fetch(`/github/part/${name}${fresh ? '?fresh=1' : wait ? '?wait=1' : ''}`);
    if (!r.ok) throw new Error(`HQ answered ${r.status}`);
    const d = await r.json();
    // keep the span the switch was on across an update
    const span = el.querySelector('.hq-actions') && el.querySelector('.hq-actions').dataset.span;
    el.innerHTML = el.hasAttribute('data-mini') ? d.mini : d.html;
    if (span && span !== '7') { const b = el.querySelector(`button[data-span="${span}"]`); if (b) b.click(); }
    el.dataset.at = d.at;
    again = !!d.refreshing;
    window.hqTables(el);
  } catch (e) {
    if (!wait) el.innerHTML = `<p class="hq-problem">Could not load this. ${e.message === 'Failed to fetch' ? 'HQ did not answer. Is make hq still running?' : e.message}</p>`;
  }
  el.classList.remove('loading');
  partAges();
  if (again) loadPart(el, false, true);
}
function partAges() {
  for (const el of document.querySelectorAll('[data-load-part][data-at]')) {
    const s = Math.max(0, Math.round((Date.now() - +el.dataset.at) / 1000));
    const text = `Updated ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`} ago`;
    const label = el.querySelector(`[data-updated-for="${el.dataset.loadPart}"]`) || el.closest('section').querySelector(`[data-updated-for="${el.dataset.loadPart}"]`);
    if (label) label.textContent = text;
  }
}
setInterval(partAges, 5000);
for (const el of document.querySelectorAll('.hq-panel [data-load-part]')) loadPart(el, false);
// Home's panel also refreshes every minute while on screen
if (document.querySelector('.hq-panel [data-load-part]')) {
  setInterval(() => { if (!document.hidden) for (const el of document.querySelectorAll('.hq-panel [data-load-part]')) loadPart(el, false, true); }, 60000);
}

// Actions minutes: the switch picks today, 7 days, 30 days or this month, and the total, the chart's shading and
// the by-repo table all follow it
document.addEventListener('click', e => {
  // the section carries data-span too (for the chart's shading), so only a button counts as a choice
  const b = e.target.closest('button[data-span]');
  if (!b) return;
  const section = b.closest('.hq-actions');
  if (!section) return;
  section.dataset.span = b.dataset.span;
  for (const o of section.querySelectorAll('button[data-span]')) o.setAttribute('aria-pressed', String(o === b));
  for (const v of section.querySelectorAll('[data-span-value]')) v.hidden = v.dataset.spanValue !== b.dataset.span;
});

// The minutes chart: hovering (or focusing) a day shows its total and each repo's minutes beside the pointer
{
  let tip = null;
  const show = (g, x, y) => {
    if (!tip) { tip = document.createElement('div'); tip.className = 'hq-charttip'; tip.setAttribute('role', 'status'); document.body.append(tip); }
    const [head, ...rows] = g.dataset.tip.split('\n');
    tip.innerHTML = `<b></b>${rows.map(() => '<div></div>').join('')}`;
    tip.firstChild.textContent = head;
    rows.forEach((r, i) => { tip.children[i + 1].textContent = r; });
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(innerWidth - w - 8, x + 14) + scrollX}px`; tip.style.top = `${y + 14 + scrollY}px`;
    for (const o of document.querySelectorAll('.hq-actions-chart .day.on')) o.classList.remove('on');
    g.classList.add('on');
  };
  const hide = () => { if (tip) tip.hidden = true; for (const o of document.querySelectorAll('.hq-actions-chart .day.on')) o.classList.remove('on'); };
  document.addEventListener('pointermove', e => { const g = e.target.closest && e.target.closest('.hq-actions-chart .day'); if (g) show(g, e.clientX, e.clientY); else if (tip && !tip.hidden) hide(); });
  document.addEventListener('focusin', e => { const g = e.target.closest && e.target.closest('.hq-actions-chart .day'); if (g) { const r = g.getBoundingClientRect(); show(g, r.right, r.top); } });
  document.addEventListener('focusout', hide);
}
