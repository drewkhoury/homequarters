// Chat on every HQ page: a read-only claude that answers questions about the page you are on, the code and the docs,
// and Open in Claude, which sends your comments, or continues a conversation, in a new Terminal running claude.
//
// The panel lies over the right of the page, floats as a window you drag and resize, or fills the window. Closed, it leaves a tab on the right edge; the \ key opens and closes it when you are not typing. How it sits and
// the conversation are kept in this browser, so both survive moving between pages. How claude runs (installed, who
// pays) comes in the page itself (#hq-claude-info), so opening a page asks HQ for nothing.
(function () {
  const HERE = 'hq.chat.here';
  const LOG = 'hq.ask.log', SESSION = 'hq.ask.session', VIEW = 'hq.chat.view', LIMITS = 'hq.chat.limits', FOLLOW = 'hq.chat.follow', FORK = 'hq.chat.fork', MAX_LOG = 40;
  const store = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } },
  };
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = n => Number(n || 0).toLocaleString('en-GB');
  const pct = x => (x == null ? '?' : `${Math.round(x * 100)}%`);
  // HQ's "i": the explaining shows on hover, focus or a tap (hq.js), so a line can stay short
  const infoIcon = (text, label = 'More') => `<span class="hq-info" tabindex="0" role="button" aria-label="${esc(label)}" aria-expanded="false"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 7v4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="4.6" r=".95" fill="currentColor"/></svg><span class="hq-tip" role="tooltip">${esc(text)}</span></span>`;
  const post = (path, body, signal) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const info = (() => { try { return JSON.parse(document.getElementById('hq-claude-info').textContent); } catch { return null; } })();
  const TERM = info?.terminal || 'Terminal';
  // buttons other pages render (the Conversations page) say Terminal; they say which one opens
  const nameButtons = root => { for (const b of root.querySelectorAll('[data-resume]')) if (/Terminal$/.test(b.textContent)) b.textContent = b.textContent.replace(/Terminal$/, TERM); };
  document.addEventListener('DOMContentLoaded', () => nameButtons(document));

  // ---- how the panel sits ----
  // Over lies on the right of the page, wide enough that answers need little scrolling. (Push, which narrowed the page
  // to make room, is gone: too many pages looked wrong squeezed; a saved Push opens as Over.)
  const view = Object.assign({ mode: 'over', open: true, overWidth: 880, float: { x: null, y: 90, w: 520, h: 620 } }, store.get(VIEW, {}));
  if (!['over', 'float', 'full'].includes(view.mode)) view.mode = 'over';
  const widthKey = () => 'overWidth';
  const saveView = () => store.set(VIEW, view);

  const panel = document.createElement('aside');
  panel.className = 'hqa-panel';
  panel.setAttribute('aria-label', 'Chat');
  panel.innerHTML = `<div class="hqa-grip" aria-hidden="true"></div>
    <div class="hqa-head"><h2>Chat</h2>
      <div class="seg hq-spans hqa-modes" role="group" aria-label="How the panel sits">${[['over', 'Over'], ['float', 'Float'], ['full', 'Full']].map(([k, l]) =>
        `<button type="button" class="seg-opt" data-mode="${k}">${l}</button>`).join('')}</div>
      <button type="button" class="btn btn-ghost hqa-hide" data-close title="Close (\\)" aria-label="Close the chat">Close</button></div>
    <div class="hqa-status"><span class="hqa-bill"></span><span class="hqa-session" hidden></span></div>
    <div class="hqa-log" aria-live="polite"></div>
    <div class="hqa-follow" hidden></div>
    <form class="hqa-form"><div class="hqa-context"></div><textarea class="input" rows="3" placeholder="Ask about this page, the code or the docs. Return sends, Shift+Return for a new line." aria-label="Your message"></textarea>
      <div class="hqa-row"><span class="hqa-spacer"></span>
        <button type="button" class="btn btn-ghost" data-new>New chat</button><button type="button" class="btn btn-secondary" data-stop hidden>Stop</button><button class="btn btn-primary" data-send>Send</button></div></form>
    <details class="hqa-limits" hidden></details>`;
  const peek = document.createElement('button');
  peek.type = 'button'; peek.className = 'hqa-peek'; peek.textContent = 'Chat'; peek.title = 'Open the chat (\\)';
  document.body.append(panel, peek);
  const log = panel.querySelector('.hqa-log'), form = panel.querySelector('form'), box = form.querySelector('textarea');
  const bill = panel.querySelector('.hqa-bill'), limits = panel.querySelector('.hqa-limits'), sessionBar = panel.querySelector('.hqa-session');
  let running = null;

  function place() {
    const open = view.open;
    panel.hidden = !open; peek.hidden = open;
    document.body.classList.toggle('hqa-full', open && view.mode === 'full'); // the page behind stops scrolling, so only the chat does
    document.body.style.setProperty('--hqa-width', `${view[widthKey()]}px`);
    panel.dataset.mode = view.mode;
    for (const b of panel.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === view.mode));
    if (view.mode === 'float') {
      const f = view.float, w = Math.min(f.w, innerWidth - 16), h = Math.min(f.h, innerHeight - 16);
      const x = Math.max(8, Math.min(f.x ?? innerWidth - w - 24, innerWidth - w - 8)), y = Math.max(8, Math.min(f.y, innerHeight - h - 8));
      Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    } else Object.assign(panel.style, { left: '', top: '', width: '', height: '' });
  }
  const setOpen = open => { view.open = open; saveView(); place(); if (open) { renderLog(); box.focus(); } };
  peek.addEventListener('click', () => setOpen(true));
  panel.querySelector('[data-close]').addEventListener('click', () => setOpen(false));
  panel.querySelector('.hqa-modes').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) { view.mode = b.dataset.mode; saveView(); place(); } });
  document.addEventListener('keydown', e => {
    if (e.key !== '\\' || e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault(); setOpen(!view.open);
  });
  addEventListener('resize', () => { if (view.mode === 'float' && view.open) place(); });

  // A wheel or trackpad scroll over the chat never moves the page behind it: it scrolls whatever inside the panel can
  // still scroll that way (the conversation, the message box), and otherwise nothing.
  const canScroll = (el, dy) => {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight) return false;
    return dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  };
  panel.addEventListener('wheel', e => {
    for (let el = e.target; el && el !== panel; el = el.parentElement) if (canScroll(el, e.deltaY)) return;
    e.preventDefault();
  }, { passive: false });

  // Float: drag by the header. Push and Over: drag the left edge to change the width. Float's size comes from the
  // browser's own resize corner and is kept when it changes.
  function drag(handle, onMove) {
    handle.addEventListener('pointerdown', e => {
      if (e.button || e.target.closest('button, input, select, textarea, a')) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, f: { ...view.float }, width: view[widthKey()] };
      const move = ev => onMove(ev.clientX - start.x, ev.clientY - start.y, start);
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); saveView(); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
  }
  drag(panel.querySelector('.hqa-head'), (dx, dy, s) => { if (view.mode !== 'float') return; view.float.x = (s.f.x ?? innerWidth - s.f.w - 24) + dx; view.float.y = s.f.y + dy; place(); });
  drag(panel.querySelector('.hqa-grip'), (dx, _, s) => { if (view.mode === 'float' || view.mode === 'full') return; view[widthKey()] = Math.max(320, Math.min(innerWidth - 120, s.width - dx)); place(); });
  new ResizeObserver(() => {
    if (view.mode !== 'float' || panel.hidden) return;
    const r = panel.getBoundingClientRect();
    if (Math.abs(r.width - view.float.w) > 2 || Math.abs(r.height - view.float.h) > 2) { view.float.w = Math.round(r.width); view.float.h = Math.round(r.height); saveView(); }
  }).observe(panel);

  // ---- how claude runs, from the page ----
  // One short line: who pays and what claude may do, with the rest behind the "i". What stops Chat is spelled out.
  function showBill(extra = '') {
    let state = 'ok', html = `<span class="hqa-dot"></span>Your subscription · reads only${infoIcon('claude runs with your subscription login (claude.ai), in this repo, with only the Read, Grep and Glob tools: it can read files and nothing else.', 'How Chat runs')}`;
    if (!info) { state = 'bad'; html = 'This page does not say how claude runs. Reload it.'; }
    else if (!info.installed) { state = 'bad'; html = 'claude is not installed, or not on the PATH HQ was started with.'; }
    else if (!info.billing.ok) { state = 'bad'; html = `<b>${esc(info.billing.blocked.join(', '))} is set where HQ runs,</b> so claude would bill that cloud account. Chat is off until HQ starts without it.`; }
    else if (info.billing.stripped.length) {
      const keys = info.billing.stripped.join(' and ');
      state = 'warn'; html = `<span class="hqa-dot"></span>Your subscription · ${esc(keys)} left out${infoIcon(`${keys} ${info.billing.stripped.length > 1 ? 'are' : 'is'} set where HQ runs, which would bill API credits. HQ leaves ${info.billing.stripped.length > 1 ? 'them' : 'it'} out of the claude it runs, so Chat uses your subscription login. A claude you start yourself in that shell would still use ${info.billing.stripped.length > 1 ? 'them' : 'it'}.`, 'About the key')}`;
    }
    bill.dataset.state = state; bill.innerHTML = html + extra;
    bill.closest('.hqa-status').dataset.state = state;
    form.querySelector('[data-send]').disabled = state === 'bad';
  }

  // ---- your plan's usage, from the last answer (claude reports it with each one) ----
  const until = t => { if (!t) return ''; const d = new Date(t * 1000), now = new Date(); const same = d.toDateString() === now.toDateString();
    return d.toLocaleString('en-GB', same ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }); };
  const meter = (label, used, resets) => `<div class="hqa-meter"><span class="hqa-meter-k">${esc(label)}</span>
    <span class="hqa-meter-bar"><i style="width:${Math.min(100, Math.round((used || 0) * 100))}%"${used > 0.8 ? ' data-high' : ''}></i></span><b>${pct(used)}</b><span class="hint">${resets ? `resets ${esc(until(resets))}` : ''}</span></div>`;
  // One line, "Plan used: 5-hour 4% · week 4%", and more opens the meters, when each resets and when it was read.
  function showLimits(l = store.get(LIMITS, null)) {
    if (!l) return;
    limits.hidden = false;
    const high = (l.fiveHour || 0) > 0.8 || (l.week || 0) > 0.8;
    limits.innerHTML = `<summary${high || l.overage ? ' data-high' : ''}>Plan used: 5-hour ${pct(l.fiveHour)} · week ${pct(l.week)}${l.overage ? ' · paid extra usage on' : ''}<span class="hqa-more"></span></summary>
      <div class="hqa-limits-more">${meter('5-hour window', l.fiveHour, l.fiveHourResets)}${meter('This week', l.week, l.weekResets)}
        <span class="hint">Read from claude's last answer, at ${esc(new Date(l.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}.</span></div>`;
  }

  // ---- the conversation ----
  // The conversation's id, short, with a menu: continue it in a terminal, copy the command, see and copy its file. A
  // conversation followed from another folder is not offered to continue: the terminal opens in this checkout, where
  // claude cannot find it.
  function renderSession() {
    const id = store.get(SESSION, null), f = store.get(FOLLOW, null);
    sessionBar.hidden = !id;
    if (!id) return;
    const away = !!f && !f.done && f.session === id && !!f.elsewhere;
    const file = info ? `${info.sessions}/${id}.jsonl` : `${id}.jsonl`;
    sessionBar.innerHTML = `<code title="Conversation ${esc(id)}">${esc(id.slice(0, 8))}</code>
      <details class="hq-menu hqa-menu"><summary class="btn btn-ghost" aria-label="This conversation" title="This conversation">⋯</summary><div class="hq-menu-list" role="menu">
        ${away ? '' : `<button type="button" role="menuitem" data-resume="${esc(id)}">Continue in ${esc(TERM)}</button>`}
        <button type="button" role="menuitem" data-copy-path="claude --resume ${esc(id)}">Copy the resume command</button>
        <button type="button" role="menuitem" data-copy-path="${esc(file)}">Copy the file's path</button>
        <span class="off hqa-menu-path" title="${esc(file)}">${esc(file.replace(/^\/Users\/[^/]+/, '~'))}</span></div></details>`;
  }
  function renderLog() {
    const items = store.get(LOG, []);
    log.innerHTML = items.length ? items.map(m => m.role === 'you'
      ? `<div class="hqa-you">${esc(m.text)}${m.via ? `<span class="hint">${esc(m.via)}</span>` : m.where ? `<span class="hint">on ${esc(m.where)}</span>` : ''}</div>`
      : `<div class="hqa-claude${m.error ? ' error' : ''}">${m.html || esc(m.text)}${m.meta ? `<span class="hint">${esc(m.meta)}</span>` : ''}</div>`).join('')
      : '<p class="hint">Ask what a function does, why a test exists, or what a backlog item would touch. Claude reads the repo to answer and changes nothing. To make changes, continue the chat in a Terminal, or send your comments with Open in Claude.</p>';
    log.scrollTop = log.scrollHeight;
    renderSession();
  }
  const remember = m => store.set(LOG, [...store.get(LOG, []), m].slice(-MAX_LOG));

  // What is sent with a message about where you are: the file (or page) in front of you, shown above the box so it is
  // plain what Claude will be told. The x leaves it out, until you add it back.
  const contextBox = panel.querySelector('.hqa-context');
  // The thing in front of you, most specific first: an open popup's file (a backlog item), the file the Code page shows,
  // else the page.
  function contextNow() {
    if (!store.get(HERE, true)) return null;
    const page = location.pathname + location.search + location.hash;
    const holder = document.querySelector('dialog[open]:not(.hqc-panel) [data-path]') || document.querySelector('.hq-codemain [data-path], .hq-md[data-path], .hq-code[data-path]');
    if (!holder) return { file: '', title: document.title.replace(/ · (QuestKeep )?HQ$/, ''), page };
    const title = holder.closest('.bl-detail')?.querySelector('.bl-detail-title')?.textContent.trim() || document.title.replace(/ · (QuestKeep )?HQ$/, '');
    return { file: holder.dataset.path, title, page };
  }
  // Drawn again only when it changes: pressing the x focuses it, focus redraws, and a redrawn x never gets the click.
  let contextShown = '';
  const showContext = html => { if (html !== contextShown) { contextShown = html; contextBox.innerHTML = html; } };
  function renderContext() {
    const w = contextNow();
    if (!w) { showContext(`<span class="hint">Not telling Claude which page you're on.</span> <button type="button" class="hqa-linkbtn" data-here-on>Include it</button>`); return; }
    const what = w.file || w.page;
    showContext(`<span class="hint">Claude will know you're on</span> <span class="hqa-pill" title="${esc(`${what}${w.title && w.title !== what ? ` (${w.title})` : ''}. Claude is told this with your message, so "this" means it, and reads the file if it needs to.`)}"><code>${esc(what)}</code><button type="button" data-here-off aria-label="Leave this out">×</button></span>`);
  }
  contextBox.addEventListener('click', e => {
    if (e.target.closest('[data-here-off]')) { store.set(HERE, false); renderContext(); }
    if (e.target.closest('[data-here-on]')) { store.set(HERE, true); renderContext(); }
  });
  // a popup opening or closing changes what you are looking at
  new MutationObserver(() => renderContext()).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  addEventListener('popstate', renderContext);
  panel.addEventListener('focusin', renderContext);

  async function send(question) {
    const where = contextNow();
    remember({ role: 'you', text: question, where: where ? (where.file || where.page) : '' });
    renderLog();
    const live = document.createElement('div');
    live.className = 'hqa-claude live'; live.innerHTML = '<span class="hqa-working">Thinking…</span>';
    log.appendChild(live);
    const ctl = new AbortController();
    running = ctl;
    form.querySelector('[data-stop]').hidden = false; form.querySelector('[data-send]').disabled = true;
    // the answer so far, as HQ renders it every few pieces; drawn once for each read, however many arrived in it
    let text = '', html = '', drawn = '', done = null, error = '';
    const read = [];
    try {
      const fork = store.get(FORK, false);
      const r = await post('/claude/ask', { question, session: store.get(SESSION, null), fork, ...(where || {}) }, ctl.signal);
      if (!r.ok) error = (await r.json().catch(() => ({}))).message || `HQ answered ${r.status}`;
      else {
        const reader = r.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buf += dec.decode(value, { stream: true });
          for (let i; (i = buf.indexOf('\n')) >= 0;) {
            const e = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
            if (e.type === 'start') { store.set(SESSION, e.session); store.set(FORK, false); followBar(); if (!e.bill.subscription) showBill(` <b>This answer used ${esc(e.bill.text)}.</b>`); }
            else if (e.type === 'text') { text += e.text; if (e.html != null) html = e.html; }
            else if (e.type === 'tools') { read.push(...e.uses); if (e.html != null) html = e.html; if (!text) live.innerHTML = `<span class="hqa-working">${esc(read.slice(-3).map(t => `${t.name} ${t.on}`).join(' · '))}</span>`; }
            else if (e.type === 'limits') { const l = { ...e, at: Date.now() }; store.set(LIMITS, l); showLimits(l); }
            else if (e.type === 'done') { done = e; store.set(SESSION, e.session); }
            else if (e.type === 'error') error = e.message;
          }
          if (html !== drawn) { drawn = html; live.innerHTML = html; }
          log.scrollTop = log.scrollHeight;
        }
      }
    } catch (e) { error = e.name === 'AbortError' ? 'Stopped.' : `HQ did not answer: ${e.message}`; }
    running = null;
    form.querySelector('[data-stop]').hidden = true; form.querySelector('[data-send]').disabled = false;
    live.remove();
    if (done && !done.error) {
      const t = done.tokens || {}, tin = (t.in || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
      const meta = [`${Math.round(done.ms / 100) / 10} s`, read.length && `${read.length} tool call${read.length === 1 ? '' : 's'}`,
        `${num(tin)} tokens in${t.cacheRead ? ` (${num(t.cacheRead)} from cache)` : ''}, ${num(t.out)} out`].filter(Boolean).join(' · ');
      remember({ role: 'claude', text: done.text, html: done.html, meta });
    } else remember({ role: 'claude', text: error || (done && done.text) || 'No answer.', error: true });
    renderLog();
  }

  panel.querySelector('[data-new]').addEventListener('click', () => { stopFollow(); store.set(FORK, false); store.set(LOG, []); store.set(SESSION, null); renderLog(); followBar(); });
  panel.querySelector('[data-stop]').addEventListener('click', () => running && running.abort());
  form.addEventListener('submit', e => { e.preventDefault(); const q = box.value.trim(); if (!q || running) return; box.value = ''; grow(); send(q); });
  // the box grows with what is typed, up to about eight lines, instead of a resize grip of its own
  const grow = () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight + 2, 190)}px`; };
  box.addEventListener('input', grow);
  // Return sends; Shift+Return is a new line (and Return while an input method is composing is left to it)
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });

  // Continue in Terminal, from the panel or any page (the Conversations page has one per conversation), and the
  // session file's path to the clipboard.
  async function openTerminal(body) {
    const r = await post('/claude/open', body).catch(() => null);
    if (!r) return 'HQ did not answer.';
    return (await r.json().catch(() => ({}))).message || `HQ answered ${r.status}`;
  }
  document.addEventListener('click', async e => {
    const res = e.target.closest('[data-resume]');
    if (res) {
      res.disabled = true;
      const msg = await openTerminal({ resume: res.dataset.resume, ...(res.dataset.cwd ? { cwd: res.dataset.cwd } : {}) });
      const label = res.textContent, opened = /Opened/.test(msg);
      res.title = msg; res.textContent = opened ? `Opened in ${TERM}` : 'Could not open';
      // the panel follows the conversation in the terminal: its own, or any other, which it takes over once HQ can follow it
      if (opened && res.dataset.resume === store.get(SESSION, null)) startFollow(res.dataset.resume);
      else if (opened) startFollow(res.dataset.resume, { take: true, title: res.dataset.title || '' });
      setTimeout(() => { res.textContent = label; res.disabled = false; }, 2500); // cap: the button's label goes back after it has been read
      return;
    }
    const cp = e.target.closest('[data-copy-path]');
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copyPath); cp.textContent = 'Copied'; } catch { cp.textContent = 'Copy failed'; } }
  });

  // ---- following the conversation in a terminal ----
  // After Continue in iTerm, the terminal's claude writes this conversation, and the panel shows its turns as they
  // land (HQ reads them from the transcript, /claude/follow). The panel sends nothing meanwhile, so the transcript has
  // one writer. Branch off here chats on in a copy (claude's --fork-session); once the terminal's claude has ended,
  // Continue here picks the conversation up in the browser again. Where the panel had read to is kept, so moving
  // between pages misses nothing. Continuing another conversation (from the Conversations page) makes the panel follow
  // that one instead, from its end, with a link to the turns before. One filed under another folder (a worktree's) can
  // be followed but not carried on here, since Chat's claude runs in this checkout: it offers only Stop following.
  const followBox = panel.querySelector('.hqa-follow');
  let following = null;
  function followBar() {
    const f = store.get(FOLLOW, null), fork = store.get(FORK, false);
    const on = !!f && !f.done;
    box.disabled = on;
    form.querySelector('[data-send]').disabled = on || bill.dataset.state === 'bad';
    box.placeholder = on ? `Following in ${TERM}.${f.elsewhere ? '' : ' Branch off to chat here on a copy.'}` : 'Ask about this page, the code or the docs. Return sends, Shift+Return for a new line.';
    followBox.hidden = !on && !fork;
    if (fork && !on) { followBox.dataset.state = 'fork'; followBox.innerHTML = `Your next message starts a copy of this conversation. ${esc(TERM)} keeps the original.`; return; }
    if (!on) return;
    const ended = f.ended && (f.seenRunning || Date.now() - f.since > 30000), away = !!f.elsewhere;
    const elsewhere = 'It was started in another folder, so Chat cannot carry it on here.';
    followBox.dataset.state = ended ? 'ended' : 'on';
    followBox.innerHTML = ended
      ? (away ? `The ${esc(TERM)} session has ended. ${elsewhere} <button type="button" class="btn btn-secondary" data-follow-stop>Stop following</button>`
        : `The ${esc(TERM)} session has ended. <button type="button" class="btn btn-primary" data-follow-take>Continue here</button>`)
      : `<span class="hqa-follow-text"><span class="hqa-follow-live"></span> Following this conversation in ${esc(TERM)}. New turns show here as they happen.${away ? ` ${elsewhere}` : ''}</span><span class="hqa-follow-tool hint">${esc(f.tool || '')}</span>
        ${away ? '' : '<button type="button" class="btn btn-secondary" data-follow-fork>Branch off here</button>'}<button type="button" class="btn btn-ghost" data-follow-stop>Stop following</button>`;
  }
  const saveFollow = patch => { const f = { ...store.get(FOLLOW, {}), ...patch }; store.set(FOLLOW, f); return f; };
  function stopFollow(patch = { done: true }) { if (following) following.abort(); following = null; saveFollow(patch); followBar(); }
  function startFollow(id, more = {}) {
    if (following) { following.abort(); following = null; }
    if (more.take && running) running.abort();
    store.set(FOLLOW, { session: id, offset: null, since: Date.now(), seenRunning: false, ended: false, done: false, ...more });
    followBar();
    if (more.take && !view.open) setOpen(true);
    connect();
  }
  // The panel takes over the conversation it now follows. Its first line says which, what it held before, and where
  // the turns before this moment are.
  function take(f) {
    const old = store.get(SESSION, null), id = f.session, page = c => `/conversations/${encodeURIComponent(c)}`;
    const name = f.title ? `“${esc(f.title)}”` : `conversation <code>${esc(id.slice(0, 8))}</code>`;
    const from = old && old !== id ? `Switched from conversation <a href="${page(old)}"><code>${esc(old.slice(0, 8))}</code></a> to ${name}` : `Following ${name}`;
    store.set(FORK, false); store.set(SESSION, id);
    store.set(LOG, [{ role: 'claude', text: '', html: `<p>${from}, continued in ${esc(TERM)}. Its turns show here from now on; the ones before are on <a href="${page(id)}">its page</a>.</p>` }]);
    saveFollow({ take: false });
    renderLog();
  }
  // Stop following a conversation filed under another folder: the panel lets it go, so the next message starts a new chat.
  function letGo() {
    stopFollow(); store.set(SESSION, null);
    remember({ role: 'claude', text: 'Stopped following. Your next message starts a new chat.' });
    renderLog();
  }
  async function connect() {
    const f = store.get(FOLLOW, null);
    if (!f || f.done || following) return;
    const ctl = new AbortController();
    following = ctl;
    try {
      const r = await fetch(`/claude/follow?session=${encodeURIComponent(f.session)}${f.offset != null ? `&from=${f.offset}` : ''}`, { signal: ctl.signal });
      // a refused follow of one filed elsewhere lets it go too, so the next message cannot resume it in this checkout
      if (!r.ok) { const m = (await r.json().catch(() => ({}))).message || `HQ answered ${r.status}`; remember({ role: 'claude', text: `Could not follow: ${m}`, error: true }); if (f.elsewhere) letGo(); else { stopFollow(); renderLog(); } return; }
      if (f.take) take(f);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (let i; (i = buf.indexOf('\n')) >= 0;) {
          const e = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
          if (e.type === 'at') saveFollow({ offset: e.offset });
          else if (e.type === 'filed') { saveFollow({ elsewhere: !e.here }); followBar(); renderSession(); }
          else if (e.type === 'you') { remember({ role: 'you', text: e.text, via: `in ${TERM}` }); saveFollow({ tool: '' }); renderLog(); }
          else if (e.type === 'claude') { remember({ role: 'claude', text: e.text, html: e.html, meta: `in ${TERM}` }); saveFollow({ tool: '' }); renderLog(); }
          else if (e.type === 'tool') { saveFollow({ tool: `${e.name} ${e.on}` }); const t = followBox.querySelector('.hqa-follow-tool'); if (t) t.textContent = `${e.name} ${e.on}`; }
          else if (e.type === 'running') { saveFollow({ seenRunning: true, ended: false }); followBar(); }
          else if (e.type === 'ended') { saveFollow({ ended: true }); followBar(); }
        }
      }
    } catch { /* stopped, or the page is going */ }
    if (following === ctl) following = null;
  }
  followBox.addEventListener('click', e => {
    if (e.target.closest('[data-follow-stop]')) { if (store.get(FOLLOW, {}).elsewhere) letGo(); else stopFollow(); }
    else if (e.target.closest('[data-follow-take]')) stopFollow();
    else if (e.target.closest('[data-follow-fork]')) { store.set(FORK, true); stopFollow(); box.focus(); }
  });

  // From the comments list: chat about them here, or open them in a new Terminal.
  const chatAbout = text => { setOpen(true); box.value = `${text}\nWhat do you make of these? Say what you would change for each.`; box.focus(); };
  window.hqClaude = { chatAbout, askAbout: chatAbout, openInTerminal: text => openTerminal({ text }), status: async () => info };

  showBill();
  showLimits();
  nameButtons(document);
  place();
  if (view.open) renderLog();
  followBar();
  connect();
  renderContext();
})();
