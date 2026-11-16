// The manifest, hq.json at the repo root: how a project declares itself to HQ. HQ reads no folder the manifest does not
// name. Every key but schemaVersion and name is optional, and a missing key turns its feature off, so a repo with no
// manifest gets the baseline (Home, Repo, Machine, GitHub, Conversations, Export) and nothing else.
//
// Versioning (docs/BRIEF.md, after the schema review of 14 October):
// - schemaVersion is the defaults epoch, a whole number. A key's shape never changes inside any epoch; a new shape is a
//   new key, and the old key stays readable. A bump happens only when a default changes, and HQ applies the defaults of
//   the manifest's own epoch, so an old manifest keeps its old behaviour. HQ at SCHEMA reads every epoch from 1 to SCHEMA;
//   a newer one gets the newest defaults HQ knows, a warning, and its unknown keys listed and left alone.
// - A key, once published, is never renamed or removed; a replaced key stays readable and the warning names what replaces
//   it (RENAMED). "$schema" is for editors and never warned about.
// - Every list element takes a string or an object, and a string means { id } (stores, backlog.stages, tests.headers) or
//   { path } (plugins), so a second attribute never changes a shape. info takes true or an object, and true means {}.
// - Paths: repo-relative unless they start with / or ~/. ~ is only the leading ~/ and means the home folder. The separator
//   is / on every platform. No environment interpolation.
// - name matches ^[a-z0-9][a-z0-9-]*$: it goes into the cache path, titles and export file names.
// - The default cache is $XDG_CACHE_HOME/hq/<name>, else ~/.cache/hq/<name>. Setup always writes cache explicitly.
// Nothing here reads a folder: it only resolves names.
import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute, basename, resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';

export const SCHEMA = 1;
// The defaults each schema applies when a key is missing: one table per schema, so a later schema can change a default
// without touching what a manifest written for an earlier one means. Add a schema here before changing any of these.
export const DEFAULTS = {
  1: {
    docs: { home: 'README.md' },
    backlog: { stages: ['inbox', 'next', 'parked'] },
    // the deploy and test workflows have no default here: dora.mjs applies its own when the manifest names none
    delivery: { userPaths: [], deployWorkflow: null, testWorkflow: null, tz: null, gateJobs: null, deployJob: null, smokeJob: null, deploySteps: null, reuseSteps: null, testSteps: null, dailyAt: null, countingChanges: null, blindSpots: null },
  },
};
export const FILE = 'hq.json';
// the keys schema 1 knows; schema/hq.schema.json names the same ones (test/manifest-schema.test.mjs)
export const KEYS = ['$schema', 'schemaVersion', 'name', 'cache', 'docs', 'backlog', 'decisions', 'tests', 'stores', 'info', 'deploy', 'delivery', 'plugins', 'demo', 'link'];
// The keys inside each object key, so a typo inside docs or tests is caught like one at the top.
const MARK_MAX = 60;
const markOk = v => typeof v === 'string' && v.trim().length > 0 && v.length <= MARK_MAX;
// the dates Delivery gives in words, each from the one note whose since names it: the day the gate moved to the
// Laptop, and the day redeploys of a tree already live started being skipped
export const SINCE = ['laptop-gate', 'skipped-redeploys'];
export const SUBKEYS = { docs: ['home', 'groups'], backlog: ['dir', 'stages', 'map', 'earlier'], decisions: ['dir', 'earlier'], tests: ['layers', 'pipeline', 'sets', 'headers'], delivery: ['userPaths', 'deployWorkflow', 'testWorkflow', 'tz', 'gateJobs', 'deployJob', 'smokeJob', 'deploySteps', 'reuseSteps', 'testSteps', 'dailyAt', 'countingChanges', 'blindSpots'], info: ['file'] };
// a key that was replaced keeps working and says what to use instead; none yet
export const RENAMED = {};
// the stores HQ knows, each with where it sits under the cache unless the entry says otherwise
export const STORES = { runs: 'runs', lock: 'lock', problems: 'problems', dora: 'dora', ci: 'ci' };
export const NAME = /^[a-z0-9][a-z0-9-]*$/;

// A path from the manifest as an absolute one: ~/ is the home folder, / is absolute, anything else is from the repo root.
export function expand(p, { repo, home = homedir() }) {
  if (p == null || p === '') return null;
  const s = String(p);
  if (s === '~') return home;
  if (s.startsWith('~/')) return join(home, s.slice(2));
  return isAbsolute(s) ? s : resolvePath(repo, s);
}

// The default cache for a name: XDG first, then ~/.cache.
export const defaultCache = (name, { home = homedir(), env = process.env } = {}) => join(env.XDG_CACHE_HOME || join(home, '.cache'), 'hq', name);

// The raw file, or null when there is none. A file that is not JSON is an error, never silently ignored.
export function readManifest(repo) {
  const file = join(repo, FILE);
  if (!existsSync(file)) return { file, raw: null, present: false, error: null };
  try { return { file, raw: JSON.parse(readFileSync(file, 'utf8')), present: true, error: null }; }
  catch (e) { return { file, raw: null, present: true, error: `${FILE} is not valid JSON: ${e.message}` }; }
}

// A folder name as a manifest name: lower case, dashes for anything else.
export const nameFrom = folder => String(folder).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';

// What a repo with no manifest gets: the name of its folder, a cache under the default, and no conventions.
export function defaults(repo, { home = homedir(), env = process.env } = {}) {
  const name = nameFrom(basename(repo));
  return { name, cache: defaultCache(name, { home, env }) };
}

// A list whose elements may be strings or objects: each becomes an object with `key` from the string.
const items = (v, key, what, warnings) => {
  if (v == null) return [];
  if (!Array.isArray(v)) { warnings.push(`${FILE}: "${what}" should be a list; ignored`); return []; }
  return v.map(x => (typeof x === 'string' ? { [key]: x } : x && typeof x === 'object' && !Array.isArray(x) ? x : null))
    .filter((x, i) => { if (!x) warnings.push(`${FILE}: "${what}" item ${i + 1} should be a string or an object; ignored`); return !!x; });
};

// The manifest as the pages use it: every path absolute, every feature a boolean, every store a folder or null.
export function resolveManifest(raw, { repo, home = homedir(), env = process.env }) {
  const warnings = [];
  const d = defaults(repo, { home, env });
  const r = raw || {};
  let schemaVersion = SCHEMA;
  if (raw) {
    if (r.schemaVersion == null) warnings.push(`${FILE} has no schemaVersion; read as schema ${SCHEMA}`);
    else if (!Number.isInteger(r.schemaVersion) || r.schemaVersion < 1) warnings.push(`${FILE} has schemaVersion ${JSON.stringify(r.schemaVersion)}, which is not a whole number from 1; read as schema ${SCHEMA}`);
    else if (r.schemaVersion > SCHEMA) { schemaVersion = r.schemaVersion; warnings.push(`${FILE} is schema ${r.schemaVersion}, newer than this HQ (schema ${SCHEMA}); read with this HQ's defaults, and keys it does not know are listed below and left alone`); }
    else schemaVersion = r.schemaVersion;
    for (const k of Object.keys(r)) {
      if (RENAMED[k]) warnings.push(`${FILE}: "${k}" is now "${RENAMED[k]}"; it still works`);
      else if (!KEYS.includes(k)) warnings.push(schemaVersion > SCHEMA ? `${FILE}: "${k}" is not a key this HQ knows, from schema ${schemaVersion}, newer than this HQ; left alone` : `${FILE}: "${k}" is not a key this HQ knows; left alone`);
      else if (SUBKEYS[k] && r[k] && typeof r[k] === 'object' && !Array.isArray(r[k])) for (const sk of Object.keys(r[k])) if (!SUBKEYS[k].includes(sk)) warnings.push(`${FILE}: "${k}.${sk}" is not a key this HQ knows; left alone`);
    }
    if (r.name == null) warnings.push(`${FILE} names no name; using "${d.name}", the folder's`);
  }
  let name = d.name;
  if (raw && r.name != null) {
    if (typeof r.name === 'string' && NAME.test(r.name)) name = r.name;
    else warnings.push(`${FILE}: name ${JSON.stringify(r.name)} should match ${NAME}; using "${d.name}"`);
  }
  const cache = expand(r.cache, { repo, home }) || defaultCache(name, { home, env });
  const p = v => expand(v, { repo, home });
  const obj = (v, what) => { if (v == null || v === false) return null; if (v === true) return {}; if (typeof v === 'object' && !Array.isArray(v)) return v; warnings.push(`${FILE}: "${what}" should be an object; ignored`); return null; };

  const D = DEFAULTS[Math.min(schemaVersion, SCHEMA)] || DEFAULTS[SCHEMA];
  const docs = { home: (r.docs && r.docs.home) || D.docs.home, groups: p(r.docs && r.docs.groups) };
  const bl = obj(r.backlog, 'backlog');
  const stages = items(bl && bl.stages, 'id', 'backlog.stages', warnings);
  const backlog = bl && bl.dir ? { dir: p(bl.dir), rel: String(bl.dir).replace(/\/$/, ''), stages: stages.length ? stages.map(s => s.id).filter(Boolean) : D.backlog.stages, stageItems: stages, map: p(bl.map), earlier: p(bl.earlier), earlierRel: bl.earlier || null } : null;
  const de = obj(r.decisions, 'decisions');
  const decisions = de && de.dir ? { dir: p(de.dir), rel: String(de.dir).replace(/\/$/, ''), earlier: p(de.earlier), earlierRel: de.earlier || null } : null;
  const te = obj(r.tests, 'tests');
  const tests = te ? { layers: p(te.layers), pipeline: p(te.pipeline), sets: p(te.sets), headers: items(te.headers, 'glob', 'tests.headers', warnings) } : null;
  const stores = items(r.stores, 'id', 'stores', warnings).filter(s => { if (STORES[s.id]) return true; warnings.push(`${FILE}: store "${s.id}" is not one this HQ knows (${Object.keys(STORES).join(', ')}); left alone`); return false; });
  const storeDirs = Object.fromEntries(stores.map(s => [s.id, s.path ? expand(s.path, { repo: cache, home }) : join(cache, STORES[s.id])]));
  const store = n => storeDirs[n] || null;
  const deploy = items(r.deploy, 'provider', 'deploy', warnings).filter((x, i) => { if (x.provider) return true; warnings.push(`${FILE}: deploy item ${i + 1} names no provider; ignored`); return false; })
    .map((x, i) => ({ env: x.env || (i === 0 ? 'prod' : `env${i + 1}`), provider: x.provider, url: x.url || x.site || null, with: x.with && typeof x.with === 'object' ? x.with : {} }));
  const plugins = items(r.plugins, 'path', 'plugins', warnings).filter((x, i) => { if (x.path) return true; warnings.push(`${FILE}: plugin item ${i + 1} names no path; ignored`); return false; })
    .map(x => ({ path: p(x.path), with: x.with && typeof x.with === 'object' ? x.with : {} }));
  const dl = obj(r.delivery, 'delivery');
  // what reaches users, which workflows deploy and test, and the zone the days are counted in; a zone Intl does not
  // know is left out with a warning rather than crash every date on the Delivery page
  const str = k => (dl && typeof dl[k] === 'string' && dl[k] ? dl[k] : null);
  let tz = str('tz');
  if (tz) { try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch { warnings.push(`${FILE}: delivery.tz "${tz}" is not a time zone Intl knows; ignored`); tz = null; } }
  // the GitHub names dora reads: lists of names, or a name; a wrong shape is warned and read as none
  const names = k => { if (!dl || dl[k] == null) return D.delivery[k]; if (Array.isArray(dl[k]) && dl[k].every(x => typeof x === 'string')) return dl[k]; warnings.push(`${FILE}: delivery.${k} should be a list of names; ignored`); return D.delivery[k]; };
  // when the daily copy is taken: hh:mm on a 24-hour clock in tz; anything else is warned and read as the day's end
  let dailyAt = dl && dl.dailyAt != null ? dl.dailyAt : D.delivery.dailyAt;
  if (dailyAt != null && !(typeof dailyAt === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(dailyAt))) { warnings.push(`${FILE}: delivery.dailyAt should be a time such as "07:07"; ignored`); dailyAt = null; }
  // the project's own notes on when its figures started being counted another way: { date, what, decision?, mark?,
  // since? } each, a decision being a file in the decisions folder, a mark the short label Delivery's deploys chart
  // draws on that day, and since which of Delivery's dates (SINCE) the note gives; a note that is not one of those is
  // left out with a warning, and a mark that is not short text or a since that is unknown or taken is dropped
  let countingChanges = D.delivery.countingChanges;
  if (dl && dl.countingChanges != null) {
    if (!Array.isArray(dl.countingChanges)) warnings.push(`${FILE}: delivery.countingChanges should be a list; ignored`);
    else {
      countingChanges = [];
      const given = new Set();
      dl.countingChanges.forEach((c, i) => {
        const ok = c && typeof c === 'object' && typeof c.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && typeof c.what === 'string' && c.what
          && (c.decision == null || (typeof c.decision === 'string' && c.decision && !/[\\/]/.test(c.decision)));
        if (!ok) { warnings.push(`${FILE}: delivery.countingChanges[${i}] should be { date: "yyyy-mm-dd", what, decision?, mark?, since? } with decision a file name; left out`); return; }
        const note = { date: c.date, what: c.what, decision: c.decision || null };
        if (markOk(c.mark)) note.mark = c.mark;
        else if (c.mark != null) warnings.push(`${FILE}: delivery.countingChanges[${i}].mark should be text of 1 to ${MARK_MAX} characters; the note is kept without it`);
        if (c.since == null) { /* gives none of Delivery's dates */ }
        else if (!SINCE.includes(c.since)) warnings.push(`${FILE}: delivery.countingChanges[${i}].since should be one of ${SINCE.join(', ')}; the note is kept without it`);
        else if (given.has(c.since)) warnings.push(`${FILE}: delivery.countingChanges[${i}].since: an earlier note already gives ${c.since}; this one is kept without it`);
        else { given.add(c.since); note.since = c.since; }
        countingChanges.push(note);
      });
    }
  }
  // what the project's figures cannot see, which Delivery lists under Not counted: text each
  let blindSpots = D.delivery.blindSpots;
  if (dl && dl.blindSpots != null) {
    if (!Array.isArray(dl.blindSpots)) warnings.push(`${FILE}: delivery.blindSpots should be a list of text; ignored`);
    else blindSpots = dl.blindSpots.filter((b, i) => {
      const ok = typeof b === 'string' && b.trim().length > 0;
      if (!ok) warnings.push(`${FILE}: delivery.blindSpots[${i}] should be text; left out`);
      return ok;
    });
  }
  const delivery = { userPaths: Array.isArray(dl && dl.userPaths) ? dl.userPaths : D.delivery.userPaths, deployWorkflow: str('deployWorkflow') || D.delivery.deployWorkflow, testWorkflow: str('testWorkflow') || D.delivery.testWorkflow, tz: tz || D.delivery.tz,
    gateJobs: names('gateJobs'), deployJob: str('deployJob') || D.delivery.deployJob, smokeJob: str('smokeJob') || D.delivery.smokeJob, deploySteps: names('deploySteps'), reuseSteps: names('reuseSteps'), testSteps: names('testSteps'), dailyAt, countingChanges, blindSpots };
  // the link file: where hq serve writes its address for the project's app (server.mjs advertise); a path, or nothing
  let link = null;
  if (r.link != null) { if (typeof r.link === 'string' && r.link) link = p(r.link); else warnings.push(`${FILE}: "link" should be a path, as a string; ignored`); }
  const inf = obj(r.info, 'info');
  const info = inf ? { file: inf.file ? p(inf.file) : join(repo, '.git', 'project-info.json') } : null;

  const features = {
    backlog: !!backlog, decisions: !!decisions,
    testing: !!(tests || store('runs') || store('ci')),
    delivery: !!store('dora'), problems: !!store('problems'),
    deploys: deploy.length > 0, info: !!info,
  };
  return {
    m: { schemaVersion: raw ? schemaVersion : null, present: !!raw, name, repo, cache,
      docs, backlog, decisions, tests, stores: stores.map(s => s.id), store, info, deploy, plugins, demo: p(r.demo), link, delivery, features },
    warnings,
  };
}

// readManifest and resolveManifest in one: what the server wants when it starts.
export function loadManifest(repo, { home = homedir(), env = process.env } = {}) {
  const read = readManifest(repo);
  const { m, warnings } = resolveManifest(read.raw, { repo, home, env });
  if (read.error) warnings.unshift(read.error);
  return { m, warnings, file: read.file, present: read.present };
}

// The pages a manifest turns on, in nav order: the baseline first, then each convention the manifest names. GitHub is
// in the nav only when the repo has a GitHub remote (the server says; the default keeps it for a manifest read alone).
export function pagesFor(m, plugins = [], { github = true } = {}) {
  const f = m.features;
  return [
    ['home', 'Home', '/'],
    ['repo', 'Repo', '/repo'],
    ['machine', 'Machine', '/machine'],
    f.testing && ['testing', 'Testing', '/testing'],
    f.backlog && ['backlog', 'Backlog', '/backlog'],
    f.decisions && ['decisions', 'Decisions', '/decisions'],
    ['conversations', 'Conversations', '/conversations'],
    github && ['github', f.deploys ? 'GitHub & Deploys' : 'GitHub', '/github'],
    f.delivery && ['delivery', 'Delivery', '/delivery'],
    f.problems && ['problems', 'Problems', '/problems'],
    ...plugins.map(pl => [pl.id, pl.label, `/${pl.path}`]),
    ['export', 'Export', '/export'],
  ].filter(Boolean);
}
