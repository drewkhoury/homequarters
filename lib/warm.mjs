// The warm-up hq serve runs once it listens: Home, then each page Home's nav links, then the Testing tabs that read the
// most, one request at a time, so the run store, the catalogue, the problem register and each page's kept answers are
// read before the person's first click. Pages a manifest turns off are not in the nav, and a plugin's pages are. A page
// that fails is passed over; nothing is printed, and a person's own request is answered in turn like any other.

const EXTRA = ['/testing?tab=tests', '/testing?tab=runs'];

// The same-site pages a page's nav links, in order: [href], from <nav class="hq-nav" ...>...</nav>.
export function navPages(html) {
  const nav = /<nav class="hq-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(String(html || ''));
  if (!nav) return [];
  return [...new Set([...nav[1].matchAll(/href="(\/[^"#]*)"/g)].map(m => m[1].replace(/&amp;/g, '&')))].filter(h => !h.startsWith('//'));
}

// Asks url for each page in turn. get: fetch's shape, for the tests. Answers [{ path, status, ms }], status null when
// the request failed.
export async function warmUp(url, { get = fetch, extra = EXTRA } = {}) {
  const done = [];
  const one = async path => {
    const t = Date.now();
    try { const r = await get(url + path); const text = await r.text(); done.push({ path, status: r.status, ms: Date.now() - t }); return text; }
    catch { done.push({ path, status: null, ms: Date.now() - t }); return ''; }
  };
  const home = await one('/');
  for (const path of [...navPages(home), ...extra]) if (!done.some(d => d.path === path)) await one(path);
  return done;
}
