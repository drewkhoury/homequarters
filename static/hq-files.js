// A folder on the Code page in the browser: the Icons · List · Gallery switch is kept per browser, and moving between
// views or through the gallery swaps the view in place instead of loading the page again. Without this script each
// is a plain link and works the same, one page load at a time.
(function () {
  const KEY = 'hq.folder.view', VIEWS = ['icons', 'list', 'gallery'];
  const store = {
    get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
    set: v => { try { localStorage.setItem(KEY, v); } catch { /* not kept */ } },
  };

  // Fetches `url` and puts its `selector` in place of this page's, keeping the address in step.
  async function swap(url, selector) {
    let doc;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    } catch { location.href = url; return null; }
    const fresh = doc.querySelector(selector), old = document.querySelector(selector);
    if (!fresh || !old) { location.href = url; return null; }
    old.replaceWith(fresh);
    history.replaceState(null, '', url);
    // the List view's sorting and filters (hq.js) start on the new table
    if (typeof window.hqTables === 'function') window.hqTables(fresh);
    return fresh;
  }

  // The view this browser last chose, when the address does not ask for one.
  const view = document.querySelector('.hqf-folderview');
  const want = store.get();
  if (view && !view.hasAttribute('data-asked') && VIEWS.includes(want) && want !== view.dataset.as) swap(`?as=${want}`, '.hqf-folderview');

  function showCurrent() {
    const on = document.querySelector('.hqf-strip-item.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  showCurrent();

  document.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    const v = e.target.closest('.hqf-views a[data-as]');
    if (v) { e.preventDefault(); store.set(v.dataset.as); swap(v.href, '.hqf-folderview').then(showCurrent); return; }
    const s = e.target.closest('.hqf-strip a[data-sel]');
    if (s) { e.preventDefault(); swap(s.href, '.hqf-gallery').then(showCurrent); }
  });

  // Left and right move through the gallery, as they do in Finder.
  document.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    const items = [...document.querySelectorAll('.hqf-strip a[data-sel]')];
    if (!items.length) return;
    const i = items.findIndex(a => a.classList.contains('on'));
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))];
    if (!next || next === items[i]) return;
    e.preventDefault();
    swap(next.href, '.hqf-gallery').then(showCurrent);
  });
})();
