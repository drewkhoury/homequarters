// A minimap beside a conversation's transcript, as an editor draws one beside a file: the whole page drawn small, your
// prompts as purple blocks, Claude's writing as grey lines as long as its paragraphs, tool calls as short blue marks
// (edits amber, failures red), and a box for the part on screen. Click or drag in it to move there; hovering shows the
// nearest prompt. It is drawn from the page itself, so it follows tool calls being opened and closed.
(function () {
  const wrap = document.querySelector('.cv-read');
  if (!wrap) return;
  const tr = wrap.querySelector('.cv-transcript'), mm = wrap.querySelector('.cv-minimap');
  const canvas = mm.querySelector('canvas'), view = mm.querySelector('.cv-mm-view'), tip = mm.querySelector('.cv-mm-tip');
  const EDITS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
  let marks = [], scale = 1, trTop = 0;

  const color = name => getComputedStyle(mm).getPropertyValue(name).trim() || '#888';

  // What to draw: each prompt, each block Claude wrote (a paragraph, a list item, a code block, a heading), and each
  // tool call, with its place on the page.
  function collect() {
    trTop = tr.getBoundingClientRect().top + scrollY;
    marks = [];
    const at = el => { const r = el.getBoundingClientRect(); return { y: r.top + scrollY - trTop, h: r.height }; };
    for (const el of tr.querySelectorAll('.cv-you, .cv-claude > *, details.cv-tool')) {
      const p = at(el);
      if (!p.h) continue;
      if (el.matches('.cv-you')) marks.push({ ...p, kind: 'you', text: [...el.childNodes].filter(n => !n.classList?.contains('cv-when')).map(n => n.textContent).join('').trim() });
      else if (el.matches('details.cv-tool')) {
        const name = el.querySelector('summary b')?.textContent || '';
        marks.push({ ...p, kind: el.classList.contains('error') ? 'error' : EDITS.test(name) ? 'edit' : 'tool', open: el.open });
      } else marks.push({ ...p, kind: el.matches('pre') ? 'code' : 'text', len: el.textContent.length });
    }
  }

  function draw() {
    const total = Math.max(1, tr.offsetHeight), h = mm.clientHeight, w = mm.clientWidth;
    scale = Math.min(h / total, 0.2);
    const dpr = devicePixelRatio || 1, ch = Math.max(1, Math.round(total * scale));
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(ch * dpr);
    canvas.style.height = `${ch}px`;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, ch);
    const c = { you: color('--mm-you'), text: color('--mm-text'), code: color('--mm-code'), tool: color('--mm-tool'), edit: color('--mm-edit'), error: color('--mm-error') };
    const LINE = 20; // about one line of text on the page
    for (const m of marks) {
      const y = m.y * scale, mh = Math.max(1, m.h * scale);
      if (m.kind === 'you') { g.fillStyle = c.you; g.fillRect(0, y, w, Math.max(2, mh)); continue; }
      if (m.kind === 'tool' || m.kind === 'edit' || m.kind === 'error') {
        g.fillStyle = c[m.kind]; g.fillRect(10, y, w * 0.35, Math.max(1.5, Math.min(mh, 3)));
        if (m.open && mh > 4) { g.fillStyle = c.code; g.fillRect(14, y + 3, w * 0.55, mh - 3); }
        continue;
      }
      // text and code as lines: as many as the block has on the page, the last one as long as what is left over
      const lines = Math.max(1, Math.round(m.h / LINE)), step = mh / lines, per = Math.max(1, (m.len || 60) / lines);
      g.fillStyle = m.kind === 'code' ? c.code : c.text;
      for (let i = 0; i < lines; i++) {
        const frac = m.kind === 'code' ? 0.3 + ((i * 37) % 60) / 100 : i === lines - 1 ? Math.min(1, per / 90 * 0.8 + 0.15) : 0.85 + ((i * 13) % 15) / 100;
        g.fillRect(4, y + i * step, (w - 8) * frac, Math.max(0.8, step * 0.55));
      }
    }
    placeView();
  }

  function placeView() {
    const top = Math.max(0, scrollY - trTop) * scale, bottom = Math.max(0, Math.min(tr.offsetHeight, scrollY + innerHeight - trTop)) * scale;
    view.style.top = `${top}px`;
    view.style.height = `${Math.max(6, bottom - top)}px`;
    view.hidden = bottom <= 0;
  }

  // Click or drag: the point under the pointer comes to the middle of the screen.
  const go = e => { const y = e.clientY - canvas.getBoundingClientRect().top; scrollTo({ top: trTop + y / scale - innerHeight / 2 }); };
  mm.addEventListener('pointerdown', e => {
    e.preventDefault(); go(e);
    const move = ev => go(ev), up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  mm.addEventListener('pointermove', e => {
    const y = (e.clientY - canvas.getBoundingClientRect().top) / scale;
    const you = marks.filter(m => m.kind === 'you' && m.y <= y + 4).pop();
    if (!you) { tip.hidden = true; return; }
    tip.textContent = you.text.length > 140 ? `${you.text.slice(0, 140)}…` : you.text;
    tip.hidden = false;
    tip.style.top = `${Math.min(e.clientY - mm.getBoundingClientRect().top, mm.clientHeight - tip.offsetHeight)}px`;
  });
  mm.addEventListener('pointerleave', () => { tip.hidden = true; });

  let queued = false;
  const redraw = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; collect(); draw(); }); };
  new ResizeObserver(redraw).observe(tr);
  new ResizeObserver(redraw).observe(mm);
  addEventListener('scroll', () => requestAnimationFrame(placeView), { passive: true });
  redraw();
})();
