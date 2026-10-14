// The search page: plain text across the code, the docs and the run logs, done in node (lib/search.mjs).
import { esc, urlPath, layout } from '../lib/page.mjs';
import { searchAll } from '../lib/search.mjs';

const mark = (h, q) => esc(h.text.slice(0, h.at)) + '<mark>' + esc(h.text.slice(h.at, h.at + q.length)) + '</mark>' + esc(h.text.slice(h.at + q.length));

export function searchPage({ repo, cache }, params) {
  const q = (params.get('q') || '').trim();
  const scopes = ['code', 'docs', 'logs'].filter(s => !params.has('in') || params.getAll('in').includes(s));
  const found = searchAll({ repo, cache, q, scopes });
  const group = (title, list, href) => list.length ? `<h2>${title} <span class="hint">${list.length} file${list.length === 1 ? '' : 's'}</span></h2>` + list.map(f =>
    `<section class="hq-hit"><div class="hq-hit-file"><a href="${href(f)}">${esc(f.path)}</a></div><div class="hq-code"><table><tbody>${f.hits.map(h =>
      `<tr><td class="ln"><a href="${href(f)}#L${h.line}">${h.line}</a></td><td class="tx">${mark(h, q)}</td></tr>`).join('')}</tbody></table></div></section>`).join('') : '';
  const count = found.code.length + found.docs.length + found.logs.length;
  const body = `<h1>Search</h1>
    <form class="hq-searchform" action="/search" method="get">
      <input class="input" name="q" value="${esc(q)}" placeholder="Search text" autofocus>
      ${['code', 'docs', 'logs'].map(s => `<label class="radio"><input type="checkbox" name="in" value="${s}"${scopes.includes(s) ? ' checked' : ''}> ${s === 'logs' ? 'run logs' : s}</label>`).join('')}
      <button class="btn btn-primary">Search</button>
    </form>
    ${q.length < 2 ? '<p class="hint">Type at least two characters. Case does not matter.</p>'
      : count ? `${found.truncated ? '<p class="hint">Showing the first 400 matching lines.</p>' : ''}
        ${group('Code', found.code, f => `/code/${urlPath(f.path)}`)}
        ${group('Docs', found.docs, f => `/code/${urlPath(f.path)}`)}
        ${group('Run logs', found.logs, f => `/runs/${encodeURIComponent(f.run)}/log/${encodeURIComponent(f.task)}`)}`
      : `<p>Nothing matches <code>${esc(q)}</code>.</p>`}`;
  return layout({ title: q ? `Search: ${q}` : 'Search', active: '', body, q });
}
