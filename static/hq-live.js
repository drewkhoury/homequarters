// A run as it happens (hq/pages/live.mjs), kept current in the browser: the log's new lines appended to the pane,
// which follows the end unless you have scrolled up (then "Jump to the end" brings it back); the tests redrawn as the
// log says more; the elapsed time counting; and a banner when the run ends. Clicking a test jumps to its part of the
// log. The stream is /runs/<id>/live/stream, which only reads the log and the lock.
(function () {
  const dataEl = document.getElementById('lv-data');
  if (!dataEl) return;
  const data = JSON.parse(dataEl.textContent);
  const pane = document.querySelector('.lv-pane'), list = document.querySelector('.lv-list'), endBtn = document.querySelector('.lv-end');
  const banner = document.querySelector('.lv-banner'), totalsEl = document.querySelector('.lv-totals');
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const secs = s => (s == null ? '' : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
  const ago = ms => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${(s / 3600).toFixed(1)} h`; };
  const WORD = { waiting: 'waiting', running: 'running', passed: 'passed', failed: 'failed', notrun: 'not run' };
  const PHASE = { unit: 'Unit tests are running.', rules: 'Rules tests are running.', browser: 'Browser tests are running in their lanes; their results print together when every lane has finished.', finishing: 'Finishing: the leak check and the emulators shutting down.', running: 'Running.' };

  // ---- the log pane: follow the end unless the reader has scrolled up ----
  const atEnd = () => pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
  let follow = true;
  pane.scrollTop = pane.scrollHeight;
  pane.addEventListener('scroll', () => { follow = atEnd(); endBtn.hidden = follow; });
  endBtn.addEventListener('click', () => { pane.scrollTop = pane.scrollHeight; follow = true; endBtn.hidden = true; });
  let lineCount = pane.children.length;
  function append(htmlLines) {
    const frag = document.createDocumentFragment();
    for (const h of htmlLines) { const d = document.createElement('div'); d.className = 'lv-l'; d.id = `lv-${lineCount++}`; d.innerHTML = h || ' '; frag.appendChild(d); }
    pane.appendChild(frag);
    if (follow) pane.scrollTop = pane.scrollHeight; else endBtn.hidden = false;
  }

  // ---- the tests ----
  let runningSince = Date.now(); // when the page last saw a test finish: running rows count from there
  function row(t) {
    return `<li class="lv-test" data-state="${esc(t.state)}"${t.line != null ? ` data-line="${t.line}"` : ''}><span class="lv-dot" aria-hidden="true"></span><span class="lv-name">${esc(t.name)}</span>` +
      `<span class="lv-state">${esc(WORD[t.state] || t.state)}${t.timeLimit ? ', hit its time limit' : ''}</span><span class="lv-secs"${t.state === 'running' ? ' data-running' : ''}>${esc(t.state === 'running' ? ago(runningSince) : secs(t.seconds))}</span>` +
      `${t.excerpt ? `<pre class="lv-excerpt">${esc(t.excerpt.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))}</pre>` : ''}</li>`; // eslint-disable-line no-control-regex
  }
  let lastDone = -1;
  function drawTests(p) {
    const done = p.totals.passed + p.totals.failed;
    if (done !== lastDone) { runningSince = Date.now(); lastDone = done; }
    if (p.mode === 'counts') {
      list.innerHTML = `<p class="lv-counts"><b>${p.totals.passed}</b> passed · <b class="${p.totals.failed ? 'fail' : ''}">${p.totals.failed}</b> failed${p.summary ? ` · of ${p.summary.tests}` : p.phase === 'running' ? ' so far' : ''}</p>` + p.tests.filter(t => t.state === 'failed').map(row).join('');
    } else if (p.mode === 'tests') list.innerHTML = p.tests.map(row).join('');
    totalsEl.textContent = p.mode === 'tests' ? `${p.totals.passed} passed · ${p.totals.failed} failed · ${p.totals.running + p.totals.waiting} to go` : '';
    const phase = banner.querySelector('.lv-phase');
    if (phase) phase.textContent = PHASE[p.phase] || '';
  }
  list.addEventListener('click', e => {
    const li = e.target.closest('.lv-test[data-line]');
    const target = li && document.getElementById(`lv-${li.dataset.line}`);
    if (!target) return;
    pane.scrollTop = target.offsetTop - pane.offsetTop - 8;
    follow = atEnd(); endBtn.hidden = follow;
    target.classList.add('lv-flash'); setTimeout(() => target.classList.remove('lv-flash'), 1200); // cap: the flash fades after it has been seen
  });

  // ---- the clock ----
  const tick = () => {
    for (const el of document.querySelectorAll('[data-elapsed]')) el.textContent = ago(+el.dataset.elapsed);
    for (const el of document.querySelectorAll('.lv-secs[data-running]')) el.textContent = ago(runningSince);
  };
  let clock = data.live ? setInterval(tick, 1000) : null; // cap: a clock on screen counts seconds

  // ---- the stream ----
  if (!data.live) return;
  if (banner && !banner.querySelector('.lv-phase')) { const s = document.createElement('span'); s.className = 'lv-phase'; banner.appendChild(s); }
  (async function stream() {
    let r;
    try { r = await fetch(`/runs/${encodeURIComponent(data.runId)}/live/stream?task=${encodeURIComponent(data.task)}&from=${data.offset}`); } catch { return; }
    if (!r.ok || !r.body) return;
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        let e; try { e = JSON.parse(buf.slice(0, i)); } catch { e = null; }
        buf = buf.slice(i + 1);
        if (!e) continue;
        if (e.type === 'lines') append(e.html);
        else if (e.type === 'at') data.offset = e.offset;
        else if (e.type === 'tests') drawTests(e.progress);
        else if (e.type === 'done') {
          clearInterval(clock); clock = null;
          const ok = e.ok;
          banner.dataset.state = ok === false ? 'failed' : 'passed';
          banner.innerHTML = `Finished: <b>${ok === false ? 'failed' : ok ? 'passed' : 'done'}</b> · <a href="/runs/${encodeURIComponent(data.runId)}">the run's results</a>`;
          document.title = document.title.replace('Running now', 'Run');
        }
      }
    }
  })();
})();
