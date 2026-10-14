// Markdown to HTML for Home, with links between docs kept working: a link to another .md file opens it rendered in
// HQ, a link to any other file in the repo opens it in the code viewer, and an image loads from the repo. Inline code
// that names a file in the repo, as the docs do with `docs/DATA.md` or `web/firebase.js`, becomes a link too.
import { Marked } from 'marked';
import { posix } from 'node:path';
import { esc, urlPath } from './page.mjs';
import { highlight } from './highlight.mjs';

// The repo path a link in the doc at `from` points to, or null when it leaves the repo. A leading / is the repo root.
export function resolveRepoPath(from, target) {
  const p = target.startsWith('/') ? posix.normalize(target.slice(1)) : posix.normalize(posix.join(posix.dirname(from), target));
  if (p === '..' || p.startsWith('../') || posix.isAbsolute(p)) return null;
  return p === '.' ? '' : p.replace(/\/$/, '');
}

// Where a link in a doc should go inside HQ. kind(p) answers 'file', 'dir' or null for a repo path. External links,
// mail links and anchors in the same doc are left as they are, and so is a link to a path that does not exist.
export function rewriteHref(href, from, kind) {
  if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return href;
  const m = /^([^#?]*)(\?[^#]*)?(#.*)?$/.exec(href);
  let target = m[1], hash = m[3] || '';
  try { target = decodeURIComponent(target); } catch { /* keep it as written */ }
  if (!target) return href;
  const p = resolveRepoPath(from, target);
  if (p === null) return href;
  const k = kind(p);
  if (k === 'file' && /\.md$/i.test(p)) return `/code/${urlPath(p)}${hash}`;
  if (k === 'file') return `/code/${urlPath(p)}${/^#L\d+/.test(hash) ? hash : ''}`;
  if (k === 'dir') return `/code/${urlPath(p)}`;
  return href;
}

// An image's source inside the repo is served from /raw/; anything else is left alone.
export function rewriteSrc(src, from, kind) {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return src;
  const p = resolveRepoPath(from, src.split(/[?#]/)[0]);
  return p !== null && kind(p) === 'file' ? `/raw/${urlPath(p)}` : src;
}

// GitHub's heading ids: lower case, punctuation dropped, spaces to hyphens, repeats numbered.
export function slugger() {
  const seen = new Map();
  return text => {
    const base = text.toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

// The source line of each heading, in order: '# Title' lines, and a line of text underlined with === or ---. Lines
// inside fenced code are skipped. Used to tie each rendered heading back to its line in the file.
export function headingLines(text) {
  const lines = text.split(/\r?\n/), out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue; }
    if (fence) continue;
    if (/^ {0,3}#{1,6}(\s|$)/.test(l)) out.push(i + 1);
    else if (/^ {0,3}(=+|-+)\s*$/.test(l) && i > 0 && lines[i - 1].trim() && !/^ {0,3}([#>*+-]|\d+[.)]|\|)/.test(lines[i - 1]) && out[out.length - 1] !== i) out.push(i);
  }
  return out;
}

// { html, headings: [{ depth, text, id, line }] } for the markdown text of the doc at repo path `from`. Each heading
// carries data-line, its line in the file, when the count of headings found in the source agrees with marked's.
// A file that opens with frontmatter (--- fields ---), as the backlog's items do, shows its fields as properties
// above the text. Left in, marked would read the closing --- as the underline of a heading.
export function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(String(text));
  if (!m) return { fields: null, body: String(text), lines: 0 };
  const fields = [];
  for (const line of m[1].split(/\r?\n/)) { const f = /^([\w-]+):\s*(.*)$/.exec(line); if (f) fields.push([f[1], f[2].trim()]); else if (line.trim() && fields.length) fields[fields.length - 1][1] += ` ${line.trim()}`; }
  return { fields, body: String(text).slice(m[0].length), lines: m[0].split('\n').length - 1 };
}

// The fields as a properties block: a quiet label and the value, the way the Backlog page's popup shows an item's
// facts. A backlog item's fields get the same chips as its card there: its type, who asked and when, the items that
// block it, its plan, and which stage it is in, with a link to it on the board.
const TYPE_LABEL = { bug: 'Bug', feature: 'Feature', chore: 'Chore', question: 'Question' };
const label = k => { const t = k.replace(/[-_]/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

function frontmatterProps(fields, from, kind) {
  const item = /^docs\/backlog\/(inbox|next|parked)\/([^/]+)\.md$/.exec(from);
  const fileLink = v => (/^[\w./-]+\.\w+$/.test(v) && kind(v) ? `<a href="${esc(rewriteHref('/' + v, from, kind))}"><code>${esc(v)}</code></a>` : null);
  const value = (k, v) => {
    if (item && k === 'type' && TYPE_LABEL[v]) return `<span class="bl-type" data-type="${esc(v)}">${TYPE_LABEL[v]}</span>`;
    if (item && k === 'asked') { const m = /^(.*?),\s*(\d{1,2} \w{3})$/.exec(v); return m ? `<span class="hq-person">${esc(m[1])}</span><span class="hint">${esc(m[2])}</span>` : esc(v); }
    if (item && k === 'blocked-by') return v.split(',').map(x => x.trim()).filter(Boolean).map(x => `<a class="hq-refchip" href="/backlog#${esc(encodeURIComponent(x))}">${esc(x)}</a>`).join('');
    return fileLink(v) || esc(v);
  };
  const rows = fields.map(([k, v]) => [label(k), value(k, v)]);
  if (item) rows.push(['Stage', `<span class="hq-stage">${esc(item[1])}</span><a class="hint" href="/backlog#${esc(encodeURIComponent(item[2]))}">open on the board</a>`]);
  return `<dl class="hq-props">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>\n`;
}

// Rendered markdown with each second-level section, its heading and what follows up to the next, in a section of its
// own, so a pinned heading (Home's preview) leaves the top when its section does. A heading inside a quote, a list, a
// table or a block of HTML is left where it is.
export function sectionsOf(html) {
  const cuts = [];
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)(blockquote|ul|ol|table|details|div)\b[^>]*>|<h2 /g)) {
    if (m[0] === '<h2 ') { if (depth === 0) cuts.push(m.index); }
    else depth = Math.max(0, depth + (m[1] ? -1 : 1));
  }
  if (!cuts.length) return html;
  const parts = [html.slice(0, cuts[0])];
  cuts.forEach((at, i) => parts.push(`<section class="hq-sec">${html.slice(at, cuts[i + 1] ?? html.length)}</section>`));
  return parts.join('');
}

// rawHtml: false shows any HTML in the text as text, for writing HQ did not author (Chat's answers), where a tag would
// otherwise run in the page. The docs keep theirs, which some use on purpose.
export function renderMarkdown(text, from, kind, { rawHtml = true } = {}) {
  const fm = splitFrontmatter(text);
  if (fm.fields) {
    const inner = renderMarkdown(fm.body, from, kind, { rawHtml });
    return { html: frontmatterProps(fm.fields, from, kind) + inner.html.replace(/ data-line="(\d+)"/g, (_, n) => ` data-line="${+n + fm.lines}"`), headings: inner.headings.map(h => ({ ...h, line: h.line && h.line + fm.lines })) };
  }
  const slug = slugger(), headings = [], lines = headingLines(text);
  const marked = new Marked({
    gfm: true,
    walkTokens(t) {
      if (t.type === 'link') t.href = rewriteHref(t.href, from, kind);
      if (t.type === 'image') t.href = rewriteSrc(t.href, from, kind);
    },
    renderer: {
      ...(rawHtml ? {} : { html: ({ text: h, block }) => (block ? `<p>${esc(h.trim())}</p>\n` : esc(h)) }),
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens), plain = this.parser.parseInline(tokens, this.parser.textRenderer);
        const id = slug(plain), line = lines[headings.length];
        headings.push({ depth, text: plain, id, line });
        return `<h${depth} id="${esc(id)}"${line ? ` data-line="${line}"` : ''}><a class="hq-anchor" href="#${esc(id)}" aria-label="Link to this heading">#</a>${inner}</h${depth}>\n`;
      },
      codespan({ text: raw }) {
        const t = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        if (/^[\w./-]+$/.test(t) && /[./]/.test(t) && !/^\.+$/.test(t)) {
          // as written from the repo root, which is how the docs name files, else relative to this doc
          for (const p of [resolveRepoPath('', t), resolveRepoPath(from, t)]) {
            if (p && kind(p)) return `<a href="${esc(rewriteHref('/' + p, from, kind))}"><code>${esc(t)}</code></a>`;
          }
        }
        return `<code>${esc(t)}</code>`;
      },
      code({ text: code, lang }) {
        const html = highlight(code, (lang || '').split(/\s/)[0]);
        return `<pre class="hq-pre"><code class="hljs">${html}</code></pre>\n`;
      },
    },
  });
  const html = marked.parse(text);
  // a heading form the line scan missed would shift every line after it, so the lines are only kept when both agree
  if (lines.length !== headings.length) return { html: html.replace(/ data-line="\d+"/g, ''), headings: headings.map(h => ({ ...h, line: undefined })) };
  return { html, headings };
}
