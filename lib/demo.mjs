// HQ's demo setting (HQ_DEMO=1, make hq-demo), for filming HQ in public: the same pages from the same repo, with what
// should not be shown swapped as each answer leaves the server. Nothing on disk changes. People's names become
// stand-ins, the GitHub owner and repo become your-org/your-repo, the home folder becomes ~, and email addresses become
// ones at example.com. Conversations other than HQ's own Chat get a title made from what they did, and their
// transcripts stay closed. The Actions minutes and the plan's usage are left out, the photos in web/images are not
// listed or served, and the header reads HQ with a HomeQuarters wordmark.
//
// The settings are hq/demo.json. People are found in git's authors and the backlog's "asked" lines, so a new name is
// swapped without anyone listing it. <cache>/hq/demo.json on this laptop, which git never sees, can add names ("names":
// { "Real": "Stand-in" }), people ("people": [["First", "Last"]]) and conversations to keep ("keep": [regex]), and
// holds the strings tests/unit/hq-demo-pages.test.mjs checks never reach a page ("private": [...]).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gitInfo } from './outside.mjs';
import { loadItems } from './backlog.mjs';

const SETTINGS = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo.json');
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// The stand-in written the way the name it replaces was: drew → alex, DREW → ALEX, Drew → Alex.
export const sameCase = (was, to) => (was === was.toLowerCase() ? to.toLowerCase() : was === was.toUpperCase() && was.length > 1 ? to.toUpperCase() : to);

// Everyone whose name could be on a page: git's authors with a first and last name (a one-word author is a bot or a
// tool), the backlog's askers, and any the laptop's settings add. One person per first name.
export function peopleOf({ authors = [], asked = [], extra = [] }) {
  const people = new Map();
  const person = (first, last = '') => {
    const k = first.toLowerCase();
    if (!people.has(k)) people.set(k, { first: cap(first), last: '', emails: new Set() });
    const p = people.get(k);
    if (last && !p.last) p.last = last;
    return p;
  };
  for (const [name, email] of authors) {
    const words = String(name).trim().split(/\s+/);
    if (words.length < 2 || /\[bot\]/i.test(name)) continue;
    const p = person(words[0], words.slice(1).map(cap).join(' '));
    if (email) p.emails.add(String(email).toLowerCase());
  }
  for (const a of asked) if (/^[A-Z][a-z]+$/.test(a)) person(a);
  for (const [first, last] of extra) person(first, last);
  return [...people.values()].sort((a, b) => a.first.localeCompare(b.first));
}

// The rules the swap applies, in order, from what was found (facts) and hq/demo.json with the laptop's own on top
// (settings). facts: { home, slug: 'owner/repo', authors: [[name, email]], asked: [name] }.
export function demoConfig(facts, settings) {
  const s = settings, names = s.names || {};
  const people = peopleOf({ authors: facts.authors, asked: facts.asked, extra: s.people || [] });
  // stand-ins that are nobody's real name, handed out in order; a name the settings map says what it becomes
  const taken = new Set(people.flatMap(p => [p.first, ...p.last.split(' ')]).filter(Boolean).map(x => x.toLowerCase()));
  const pool = (s.standIns || []).filter(([f, l]) => !taken.has(f.toLowerCase()) && !taken.has(l.toLowerCase()));
  people.forEach((p, i) => {
    const [f, l] = pool[i] || [`Person${i + 1}`, 'Example'];
    p.to = { first: names[p.first] || f, last: l };
    p.to.email = `${p.to.first.toLowerCase()}@example.com`;
  });
  const rules = [];
  const add = (re, to) => rules.push([re, to]);

  // email addresses: a person's becomes their stand-in's; any other becomes someone@example.com, unless its domain is
  // one kept (git@github.com, noreply@anthropic.com)
  const byEmail = new Map(people.flatMap(p => [...p.emails].map(e => [e, p.to.email])));
  const kept = new RegExp(`(^|\\.)(${(s.keepEmailDomains || []).map(reEsc).join('|') || '$^'})$`, 'i');
  add(/[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi, m => byEmail.get(m.toLowerCase()) || (kept.test(m.split('@')[1]) ? m : 'someone@example.com'));

  // the home folder: /Users/drew/repos as ~/repos, in a URL as well, and as Claude Code names its project folders
  if (facts.home) {
    add(new RegExp(`${reEsc(facts.home)}(?![\\w-])`, 'g'), '~');
    add(new RegExp(`${reEsc(encodeURIComponent(facts.home))}(?![\\w-])`, 'gi'), '~');
    const flat = facts.home.replace(/[^a-zA-Z0-9-]/g, '-');
    add(new RegExp(`${reEsc(flat)}(?![a-zA-Z0-9])`, 'g'), flat.replace(/[^-]+$/, s.home || 'you'));
  }

  // the GitHub owner and repo, together and the owner alone
  const [owner, repo] = String(facts.slug || '').split('/');
  if (owner && repo) add(new RegExp(`\\b${reEsc(owner)}/${reEsc(repo)}(?![\\w-])`, 'gi'), `${s.owner}/${s.repo}`);
  if (owner) add(new RegExp(`\\b${reEsc(owner)}\\b`, 'gi'), s.owner);

  // a whole name, in any case and with or without something between: Drew Khoury, drew khoury, drewkhoury (a login),
  // jane-doe, janedoe16
  for (const p of people.filter(x => x.last)) {
    add(new RegExp(`\\b(${reEsc(p.first)})([\\s._-]?)(${reEsc(p.last)})(\\d*)\\b`, 'gi'), (m, f, sep, l, n) => `${sameCase(f, p.to.first)}${sep}${sameCase(l, p.to.last)}${n}`);
  }
  // names the settings list that are not someone's first name, in any case
  for (const [from, to] of Object.entries(names)) {
    if (!people.some(p => p.first === from)) add(new RegExp(`\\b${reEsc(from)}\\b`, 'gi'), m => sameCase(m, to));
  }
  // a last name alone, in any case, and as a login makes it from an initial and digits (jdoe16)
  for (const p of people.filter(x => x.last)) {
    add(new RegExp(`\\b([a-z]?)(${reEsc(p.last)})(\\d*)\\b`, 'gi'), (m, i, l, n) => `${i ? sameCase(i, p.to.first[0]) : ''}${sameCase(l, p.to.last)}${n}`);
  }
  // a first name alone, in any case; but a name that is also a word (drew, rose) in lower case only where it is part
  // of a longer name (drew-laptop)
  const words = new Set((s.words || []).map(w => w.toLowerCase()));
  for (const p of people) {
    const f = reEsc(p.first), lo = f.toLowerCase();
    const whole = words.has(lo) ? `${f}|${f.toUpperCase()}` : `${f}|${f.toUpperCase()}|${lo}`;
    add(new RegExp(`\\b(?:${whole})\\b|\\b${lo}(?=[-_.][a-z0-9])|(?<=[a-z0-9][-_.])${lo}\\b`, 'g'), m => sameCase(m, p.to.first));
  }
  // the project's name beside HQ, in a title or a sentence ("QuestKeep HQ"): the demo shows HQ alone, so that it is
  // HomeQuarters that is filmed, whatever repo it runs against
  // in any case: the manifest's name is a slug, and a transcript or a doc writes the project's name as it likes
  if (facts.name) add(new RegExp(`\\b${reEsc(facts.name)} HQ\\b`, 'gi'), s.brand);
  add(/\bHQ\b/g, s.brand);

  return {
    rules, people, brand: s.brand, wordmark: s.wordmark,
    hide: (s.hide || []).map(h => h.toLowerCase()),
    keepSources: s.keepSources || [], keep: (s.keep || []).map(k => new RegExp(k)),
  };
}

// The swap itself, on any text. Without a config the text comes back as it was.
export function scrub(text, cfg) {
  if (!cfg || text == null) return text;
  let out = String(text);
  for (const [re, to] of cfg.rules) out = out.replace(re, to);
  return out;
}

// A whole HQ page: the header's brand, HQ with the project's name beside it (lib/page.mjs), becomes HQ with its
// wordmark, then the swap. A plugin page kept out of the demo is already out of the nav (server.mjs).
export function demoPage(html, cfg) {
  if (!cfg) return html;
  const mark = `$1${cfg.brand}<small class="hq-wordmark" style="font-size:.8em;letter-spacing:.03em;text-transform:none;font-weight:500;opacity:.72;margin-left:.55em">${cfg.wordmark}</small></a>`;
  return scrub(String(html).replace(/(<a class="brand" href="\/">)HQ(?: <span class="hq-brand-name">[^<]*<\/span>)?<\/a>/, mark), cfg);
}

// Whether a repo path is kept out of the demo: listed nowhere and served as not found. Compared in lower case, as
// macOS opens a path in any case.
export const hiddenPath = (cfg, rel) => {
  if (!cfg) return false;
  const p = String(rel).replace(/^\/+/, '').toLowerCase();
  return cfg.hide.some(h => (h.endsWith('/') ? `${p}/`.startsWith(h) : p === h));
};

// A conversation keeps its title and transcript when HQ's Chat started it, or when the settings keep it by id or title.
export const keptConversation = (cfg, s) => !cfg || cfg.keepSources.includes(s.entrypoint) || cfg.keep.some(r => r.test(`${s.id} ${s.title}`));

// A title made from what a conversation did: its first commit's summary, else the first file it changed, else its branch.
export function neutralTitle(s) {
  const subject = (s.commitsFound || s.commits || [])[0]?.subject || s.subjects?.[0]?.subject;
  if (subject) { const t = subject.replace(/^\w+(\([^)]*\))?!?:\s*/, ''); return cap(t.charAt(0)) + t.slice(1); }
  if (s.edited?.[0]) return `Changes to ${s.edited[0]}`;
  return s.branches?.[0] ? `A conversation on ${s.branches[0]}` : 'A conversation';
}

// A session as the demo shows it: as it is when kept, else with a made-up title and its transcript marked closed.
export const demoSession = (cfg, s) => (keptConversation(cfg, s) ? s : { ...s, title: neutralTitle(s), demoClosed: true });

// Everything that leaves the server through res as text is swapped: pages, JSON, the Chat's and the logs' streams,
// HQ's scripts, and a raw file of any type unless it has a NUL in its first few kilobytes. Images, fonts and zips go
// out as they are.
const BINARY = /^(image|font|video|audio)\/|^application\/(zip|pdf|wasm)/i;
export function demoResponse(res, cfg) {
  if (!cfg) return res;
  let type = '';
  const { setHeader, writeHead, write, end } = res;
  const note = (k, v) => { if (String(k).toLowerCase() === 'content-type') type = String(v); };
  res.setHeader = function (k, v) { note(k, v); return setHeader.call(this, k, v); };
  res.writeHead = function (status, ...rest) {
    const h = rest.find(x => x && typeof x === 'object' && !Array.isArray(x));
    if (h) for (const [k, v] of Object.entries(h)) note(k, v);
    return writeHead.call(this, status, ...rest);
  };
  const swap = chunk => {
    if (chunk == null || typeof chunk === 'function' || BINARY.test(type)) return chunk;
    if (Buffer.isBuffer(chunk) && chunk.subarray(0, 8000).includes(0)) return chunk;
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    return /^text\/html/i.test(type) ? demoPage(text, cfg) : scrub(text, cfg);
  };
  res.write = function (chunk, ...rest) { return write.call(this, swap(chunk), ...rest); };
  res.end = function (chunk, ...rest) { return end.call(this, swap(chunk), ...rest); };
  return res;
}

// ---- reading what the swap needs ----

const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };

// hq/demo.json with the laptop's own settings on top; names and people add to the committed ones.
export function demoSettings(cache, file = SETTINGS) {
  const base = readJson(file), local = cache ? readJson(join(cache, 'hq', 'demo.json')) : {};
  return { ...base, ...local, names: { ...base.names, ...local.names }, people: [...(base.people || []), ...(local.people || [])], keep: [...(base.keep || []), ...(local.keep || [])] };
}

// What is in this checkout and on this laptop that the swap must know: the home folder, the GitHub remote, every
// author in git's history and the backlog's askers; and the project's name from the manifest, when given.
export function demoFacts(repo, home = homedir(), { name = null } = {}) {
  const git = args => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
  const authors = git(['log', '--all', '--format=%an%x09%ae']).split('\n').filter(Boolean).map(l => l.split('\t'));
  const me = [git(['config', 'user.name']).trim(), git(['config', 'user.email']).trim()];
  let asked = [];
  try { asked = loadItems(repo).map(i => i.askedBy); } catch { /* no backlog */ }
  return { home, name, slug: gitInfo(repo)?.slug || '', authors: [...authors, me].filter(([n]) => n), asked };
}

// The demo's config for this checkout, or null when HQ_DEMO is not 1. name is the project's, from the manifest.
export function loadDemo({ repo, cache, name = null, env = process.env, home = homedir() }) {
  if (env.HQ_DEMO !== '1') return null;
  return demoConfig(demoFacts(repo, home, { name }), demoSettings(cache));
}
