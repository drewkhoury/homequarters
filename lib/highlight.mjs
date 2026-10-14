// Syntax highlighting for the code viewer and the docs' code blocks, done here in node with highlight.js so the
// browser gets plain HTML. Only the languages this repo has are loaded.
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import makefile from 'highlight.js/lib/languages/makefile';
import yaml from 'highlight.js/lib/languages/yaml';
import ini from 'highlight.js/lib/languages/ini';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import python from 'highlight.js/lib/languages/python';
import diff from 'highlight.js/lib/languages/diff';
import { esc } from './page.mjs';

for (const [name, lang] of Object.entries({ javascript, css, xml, json, markdown, bash, makefile, yaml, ini, dockerfile, python, diff })) hljs.registerLanguage(name, lang);
hljs.registerAliases(['js', 'mjs', 'cjs', 'node'], { languageName: 'javascript' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['toml'], { languageName: 'ini' });

// The language for a file, by its name. Firestore and Storage rules read well enough as JavaScript.
export function languageOf(path) {
  const name = path.split('/').pop().toLowerCase();
  if (name === 'makefile') return 'makefile';
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return { js: 'javascript', mjs: 'javascript', cjs: 'javascript', rules: 'javascript', css: 'css', html: 'xml', svg: 'xml', xml: 'xml',
    json: 'json', webmanifest: 'json', md: 'markdown', sh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini', env: 'ini', py: 'python', diff: 'diff', patch: 'diff' }[ext] || '';
}

// Highlighted HTML for code in the language named, or the code escaped when the language is unknown.
export function highlight(code, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* fall through */ }
  }
  return esc(code);
}

// Highlighted HTML cut into lines, each a whole piece of HTML: a span still open at the end of a line (a comment or a
// string that runs on) is closed there and opened again at the start of the next, so each line can sit in its own row.
export function splitLines(html) {
  const out = [], open = [];
  for (const line of html.split('\n')) {
    const prefix = open.join('');
    for (const m of line.matchAll(/<span\b[^>]*>|<\/span>/g)) {
      if (m[0] === '</span>') open.pop(); else open.push(m[0]);
    }
    out.push(prefix + line + '</span>'.repeat(open.length));
  }
  return out;
}
