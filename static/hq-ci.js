// A CI run's page in the browser: while the run goes, it asks HQ for the run's card again every 10 seconds (HQ keeps
// GitHub's answer for that long, so this asks GitHub no more often) and swaps it in; it stops when the run has finished
// or the tab is hidden, and starts again when the tab comes back.
(function () {
  const box = document.querySelector('.ci-live');
  if (!box) return;
  let timer = null;
  const running = () => document.querySelector('.ci-live')?.dataset.status !== 'completed';
  async function refresh() {
    timer = null;
    if (document.hidden || !running()) return;
    try {
      const r = await fetch(`${location.pathname}?part=1`);
      if (r.ok) { const t = document.createElement('template'); t.innerHTML = (await r.text()).trim(); const next = t.content.firstElementChild; if (next) document.querySelector('.ci-live').replaceWith(next); }
    } catch { /* HQ went away; try again next time */ }
    schedule();
  }
  const schedule = () => { if (!timer && running() && !document.hidden) timer = setTimeout(refresh, 10000); }; // cap: GitHub's answer is kept 10 s, so sooner shows nothing new
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  schedule();
})();
