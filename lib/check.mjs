// hq check: the contract, checked. Reads the manifest and each convention file it names, and says what does not keep to
// its standard: the manifest's own warnings, a convention file's schema, the backlog's rules, the decisions' shape, the
// groups covering every tracked file once, the pipeline naming real sets, tests and layers, the test headers, the stages
// and the sets. Nothing is written. Each problem names the file or the thing, so the person can act on it.
// Its first line is the HQ version that checked, and a pin of homequarters in the repo's package.json at another major
// version is a note: the repo may be checked by a global HQ and run by its pin, or the other way round.
// With --demo it also renders HQ's pages with the demo setting on (lib/demo.mjs), against the repo, and fails naming
// the page and the string when a name the setting should hide reaches one (demoChecks, below).
// Usage: hq check [--repo DIR] [--demo]     exit 1 when anything is wrong, 0 when the repo keeps its contract
import { readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from './manifest.mjs';
import { conventionWarnings } from './schema.mjs';
import { configureBacklog, loadItems, check as checkBacklog } from './backlog.mjs';
import { configureDecisions, loadDecisions, check as checkDecisions } from './decisions.mjs';
import { loadGroups, groupsOf } from './groups.mjs';
import { loadPipeline, allSteps } from './pipeline.mjs';
import { loadLayers } from './layers.mjs';
import { configureSets, parseSets, testSets } from './sets.mjs';
import { catalogue, headerProblems } from './headers.mjs';
import { stagesFrom } from './stages.mjs';

export const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

// The note a repo's package.json earns when it pins homequarters at another major version than this HQ, or null. A pin
// that names no version (a path, a git URL, a tag, *) says nothing, and neither does a 0.x minor: semver's majors only.
export function pinNote(pkg, version = VERSION) {
  const spec = pkg && ['dependencies', 'devDependencies', 'optionalDependencies'].map(k => pkg[k] && pkg[k].homequarters).find(s => typeof s === 'string');
  if (!spec) return null;
  const m = /^\s*(?:npm:homequarters@)?[\^~=v<>\s]*(\d+)(?:[.\s]|$)/.exec(spec);
  if (!m) return null;
  const pinned = +m[1], mine = +String(version).split('.')[0];
  return pinned === mine ? null : `package.json pins homequarters ${spec}, major ${pinned}; this is HQ ${version}, major ${mine}`;
}
const pinOf = repo => { try { return pinNote(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))); } catch { return null; } };

export function repoOf(argv, env) {
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (env.HQ_REPO) return env.HQ_REPO;
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.cwd(); }
}

const tracked = repo => { try { return execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean); } catch { return []; } };
const read = f => { try { return readFileSync(f, 'utf8'); } catch { return null; } };

// Every problem, as [{ area, problem }], for a repo: pure given the manifest and the files it names. Each area runs
// only when the manifest turns it on, and a missing or unreadable file is one problem, not a crash.
// A manifest or convention file written for a later HQ is read with a warning, never failed: the README promises it, and
// a check in CI must not go red the day a teammate's HQ writes schema 2. These warnings are notes, said and not counted.
const NOTE = /newer than this HQ|; it still works$/;
export const isNote = w => NOTE.test(w);

export function checks(repo, { m, warnings } = loadManifest(repo), { files = tracked(repo) } = {}) {
  const out = [];
  const add = (area, list) => { for (const p of list) out.push({ area, problem: p }); };
  add('manifest', warnings.filter(w => !isNote(w)));
  add('manifest', conventionWarnings(m).filter(w => !isNote(w)));

  if (m.backlog) {
    configureBacklog({ rel: m.backlog.rel, mapRel: m.backlog.map ? m.backlog.map.slice(repo.length + 1) : null, earlierRel: m.backlog.earlierRel, stages: m.backlog.stages });
    if (!existsSync(m.backlog.dir)) add('backlog', [`${m.backlog.rel}: the folder hq.json names is not there`]);
    else add('backlog', checkBacklog(loadItems(repo)));
  }
  if (m.decisions) {
    configureDecisions({ rel: m.decisions.rel, earlierRel: m.decisions.earlierRel });
    if (!existsSync(m.decisions.dir)) add('decisions', [`${m.decisions.rel}: the folder hq.json names is not there`]);
    else add('decisions', checkDecisions(loadDecisions(repo).files));
    // a counting note that names a decision file shows on Delivery only while the file is there, so a renamed or
    // removed file would make the note vanish without a word
    for (const c of m.delivery?.countingChanges || []) {
      if (c.decision && existsSync(m.decisions.dir) && !existsSync(join(m.decisions.dir, c.decision))) add('delivery', [`delivery.countingChanges: the note of ${c.date} names ${c.decision}, which is not in ${m.decisions.rel}`]);
    }
  }
  if (m.docs && m.docs.groups) {
    const groups = read(m.docs.groups) === null ? null : loadGroups(m.docs.groups);
    if (!groups) add('groups', [`${m.docs.groups}: cannot be read`]);
    else {
      const catchAll = groups.some(g => !g.paths.length);
      for (const f of files) {
        const g = groupsOf(f, groups);
        if (g.length > 1) add('groups', [`${f}: in ${g.join(' and ')}`]);
        if (!g.length && !catchAll) add('groups', [`${f}: in no group, and no group takes the rest`]);
      }
    }
  }
  let sets = {};
  if (m.tests && m.tests.sets) {
    const text = read(m.tests.sets);
    if (text === null) add('sets', [`${m.tests.sets}: cannot be read`]);
    else { const r = parseSets(text); sets = r.sets; add('sets', r.warnings); }
    configureSets({ file: m.tests.sets });
  } else sets = testSets(repo);
  const layers = m.tests && m.tests.layers ? loadLayers(m.tests.layers) : null;
  if (m.tests && m.tests.layers && !layers) add('layers', [`${m.tests.layers}: cannot be read, or has no layers list`]);
  if (layers) for (const l of layers.layers) if (!l.id || !l.name || !l.status) add('layers', [`layer ${JSON.stringify(l.id || l.name || '?')}: needs id, name and status`]);
  if (m.tests && m.tests.pipeline) {
    const pipeline = loadPipeline(m.tests.pipeline);
    if (!pipeline || !Array.isArray(pipeline.paths)) add('pipeline', [`${m.tests.pipeline}: cannot be read, or has no paths list`]);
    else {
      const cat = catalogue(repo), known = new Set([...Object.keys(sets), ...cat.map(f => f.set)]), inSets = new Set(Object.values(sets).flat());
      const open = m.backlog && existsSync(m.backlog.dir) ? new Set(loadItems(repo).map(i => i.slug)) : null;
      const named = new Set();
      for (const s of allSteps(pipeline)) {
        const title = s.title || '(a step with no title)';
        if (!s.title) add('pipeline', [`${title}: ${JSON.stringify(s).slice(0, 60)}`]);
        for (const set of s.sets || []) { named.add(set); if (!known.has(set)) add('pipeline', [`${title}: names the set ${set}, which no file or set list has`]); }
        for (const t of s.tests || []) { named.add(t); if (!inSets.has(t)) add('pipeline', [`${title}: names the test ${t}, which is in no set`]); }
        if (open && 'planned' in s && !open.has(s.planned)) add('pipeline', [`${title}: planned names ${s.planned}, which is not an open backlog item (shipped? then the step is built)`]);
        if (layers) for (const id of s.layers || []) if (!layers.layers.some(l => l.id === id)) add('pipeline', [`${title}: names the layer ${id}, which ${m.tests.layers} does not have`]);
      }
      for (const [set, tests] of Object.entries(sets)) if (!named.has(set) && !tests.every(t => named.has(t))) add('pipeline', [`the ${set} set is on no step`]);
      add('stages', stagesFrom(pipeline).warnings);
    }
  }
  // the header rules run only when the manifest asks (tests.headers), and only for tests a set names: the rest are a
  // project's helpers and unit tests, whose headers are its own business
  if (m.tests && m.tests.headers && m.tests.headers.length && existsSync(join(repo, 'tests'))) {
    const named = new Set(Object.keys(sets));
    for (const f of catalogue(repo)) if (named.has(f.set)) for (const p of headerProblems(f)) add('headers', [`${f.path}: ${p}`]);
  }
  return out;
}

// The notes a manifest earns: what is read for less than it says, with nothing wrong.
export function notes({ m, warnings }) { return [...warnings, ...conventionWarnings(m)].filter(isNote); }

export function report(problems, noted = []) {
  const tail = noted.length ? `\n${noted.map(n => `  note: ${n}`).join('\n')}` : '';
  if (!problems.length) return `hq check: the repo keeps its contract.${tail}`;
  const byArea = new Map();
  for (const p of problems) byArea.set(p.area, [...(byArea.get(p.area) || []), p.problem]);
  return [...byArea].map(([area, list]) => `${area} (${list.length}):\n${list.map(p => `  ${p}`).join('\n')}`).join('\n') + `\n\n${problems.length} problem${problems.length === 1 ? '' : 's'}.${tail}`;
}

// ---- hq check --demo ----

// What the demo setting must hide, from what the repo and this machine know: the home folder, the GitHub owner and repo,
// each git author with a first and last name (their names written the ways a page or a login writes them, and their
// email addresses), the laptop's "private" list in <cache>/hq/demo.json, which git never sees, and HQ_DEMO_PRIVATE
// (comma separated). A first name that is also a word (demo.json's words) is hidden in its capitals only, as the swap
// does. Each is { name, test(text) }; the project's name beside HQ is matched as a phrase, so "Your HQ" is not "r HQ".
export function hiddenNames({ cfg, facts, settings, env = process.env }) {
  const words = new Set((settings.words || []).map(w => w.toLowerCase()));
  const strings = [facts.home, facts.home && facts.home.replace(/[^a-zA-Z0-9-]/g, '-'), ...(facts.slug ? [facts.slug, facts.slug.split('/')[0]] : [])];
  for (const p of cfg.people.filter(x => x.last)) {
    strings.push(p.first, ...(words.has(p.first.toLowerCase()) ? [] : [p.first.toLowerCase()]), p.last, p.last.toLowerCase(),
      `${p.first[0]}${p.last}`.toLowerCase(), `${p.first} ${p.last}`, `${p.first}${p.last}`.toLowerCase(), ...p.emails);
  }
  strings.push(...(settings.private || []), ...String(env.HQ_DEMO_PRIVATE || '').split(','));
  const out = [...new Set(strings.filter(x => x != null).map(x => String(x).trim()).filter(x => x.length > 2))].map(n => ({ name: n, test: t => t.includes(n) }));
  if (facts.name) { const re = new RegExp(`\\b${facts.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} HQ\\b`, 'i'); out.push({ name: `${facts.name} HQ`, test: t => re.test(t) }); }
  return out;
}

// The extra views each page in the nav brings: its tabs, its ranges, the GitHub page's parts.
const DEMO_PAGES = { '/': ['/code', '/search?q=the'], '/export': ['/export?preview=1', '/export/download'],
  '/testing': ['/testing?tab=tests', '/testing?tab=runs'], '/backlog': ['/backlog?tab=list', '/backlog?tab=trends'], '/delivery': ['/delivery?range=30d', '/delivery?list=changes'],
  '/github': ['health', 'dashboard', 'firebase', 'ci-now', 'actions'].map(n => `/github/part/${n}`) };
const urlOf = (top, f) => `/${top}/${f.split('/').map(encodeURIComponent).join('/')}`;

// Renders the demo pages against the repo and answers { problems, notes, pages }. The server it starts is HQ's own, with
// the demo setting the manifest and the laptop give, on a free port, reading the repo and the manifest's stores as hq
// serve does. Nothing is written: the link file is left out, HQ's own cache goes to a scratch folder (with a copy of the
// delivery figures, so the Delivery page has them), the server's GitHub, Firebase and claude are refused rather than
// asked, and no conversation is read (the demo keeps terminal transcripts closed whatever they say). The Machine page
// is rendered as hq serve renders it, so it still runs this machine's tools (lib/scan.mjs): each one's --version,
// `gh auth status` (which asks GitHub whether the login is good), `gcloud auth list` and `docker info`. Pages swept:
// every page in the nav, every backlog item, and every tracked file that holds a hidden name, as its page and as a raw
// file. A file the setting hides must answer not found, and so must a plugin kept out of the demo.
export async function demoChecks(repo, { m }, { env = process.env, home = homedir(), files = tracked(repo) } = {}) {
  const [{ start }, { loadPlugins }, { demoConfig, demoFacts, demoSettings, hiddenPath }, { pagesFor }, { gitInfo }] = await Promise.all([
    import('../server.mjs'), import('./plugins.mjs'), import('./demo.mjs'), import('./manifest.mjs'), import('./outside.mjs')]);
  const settings = demoSettings(m.cache, undefined, m.demo), facts = demoFacts(repo, home, { name: m.name });
  const cfg = demoConfig(facts, settings), names = hiddenNames({ cfg, facts, settings, env });
  const scratch = mkdtempSync(join(tmpdir(), 'hq-check-demo-'));
  const figures = join(m.store('dora') || join(m.cache, 'dora'), 'dora.json');
  if (existsSync(figures)) { mkdirSync(join(scratch, 'dora')); copyFileSync(figures, join(scratch, 'dora', 'dora.json')); }
  const refuse = async () => { throw Object.assign(new Error('hq check --demo does not ask GitHub, Firebase or Claude'), { stderr: '' }); };
  const { plugins } = await loadPlugins(m);
  const { server, url } = await start({ port: 0, repo, m: { ...m, link: null }, plugins, cache: scratch, gh: refuse, fb: { gcloud: refuse, cli: refuse },
    claude: { find: async () => null, env: {} }, projectsDir: join(scratch, 'projects'), demo: cfg });
  const problems = [], notes = [];
  let pages = 0;
  const get = async path => { const r = await fetch(url + path, { redirect: 'manual' }); return { status: r.status, body: await r.text() }; };
  try {
    const shown = plugins.filter(p => p.demo), kept = plugins.filter(p => !p.demo);
    const dirs = [...new Set(files.filter(f => f.includes('/')).map(f => f.split('/')[0]))].filter(d => !hiddenPath(cfg, `${d}/`));
    let items = [];
    if (m.backlog && existsSync(m.backlog.dir)) { const { loadItems } = await import('./backlog.mjs'); items = loadItems(repo).map(i => `/backlog/${encodeURIComponent(i.slug)}`); }
    const holding = gitGrep(repo, names.filter(n => !n.name.endsWith(' HQ')).map(n => n.name)).filter(f => !hiddenPath(cfg, f));
    const nav = pagesFor(m, shown, { github: !!gitInfo(repo)?.slug }).map(([, , p]) => p);
    const paths = [...new Set([...nav.flatMap(p => [p, ...(DEMO_PAGES[p] || [])]), ...dirs.map(d => urlOf('code', d)), ...items,
      ...holding.flatMap(f => [urlOf('code', f), urlOf('raw', f)])])];
    for (const path of paths) {
      const r = await get(path);
      pages++;
      if (r.status >= 400) notes.push(`demo: ${path} answered ${r.status}, so it was read as that answer`);
      for (const n of names) if (n.test(r.body)) problems.push({ area: 'demo', problem: `${path}: ${n.name}` });
    }
    for (const f of files.filter(f => hiddenPath(cfg, f))) for (const path of [urlOf('code', f), urlOf('raw', f)]) {
      const r = await get(path);
      if (r.status !== 404) problems.push({ area: 'demo', problem: `${path}: answers ${r.status}, and the demo setting hides it` });
    }
    for (const p of kept) {
      const r = await get(`/${p.path}`);
      if (r.status !== 404) problems.push({ area: 'demo', problem: `/${p.path}: ${p.label} keeps out of the demo, and answers ${r.status}` });
    }
  } finally {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
    rmSync(scratch, { recursive: true, force: true });
  }
  return { problems, notes, pages };
}

// The tracked files holding any of the strings, by git grep (text files only).
function gitGrep(repo, strings) {
  if (!strings.length) return [];
  try { return execFileSync('git', ['-C', repo, 'grep', '-z', '-l', '-I', '-F', ...strings.flatMap(s => ['-e', s])], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); }
  catch { return []; } // exit 1: no file holds any
}

export function main(argv, env = process.env) {
  const repo = repoOf(argv, env);
  if (!existsSync(repo) || !statSync(repo).isDirectory()) { console.error(`hq: --repo ${repo} is not a folder.`); return 2; }
  console.log(`HQ ${VERSION}`);
  const loaded = loadManifest(repo), pin = pinOf(repo);
  if (!loaded.present) { console.log(`hq check: no hq.json in ${repo}, so nothing to check. hq setup proposes one.${pin ? `\n  note: ${pin}` : ''}`); return 0; }
  const problems = checks(repo, loaded), noted = [...notes(loaded), ...(pin ? [pin] : [])];
  if (!argv.includes('--demo')) { console.log(report(problems, noted)); return problems.length ? 1 : 0; }
  // the demo sweep runs a server, so it ends later and main answers nothing now. The pages leave timers behind (the
  // GitHub stash, the claude lookup), so the process exits once the report is written instead of waiting them out.
  const done = (text, code, out = process.stdout) => out.write(`${text}\n`, () => process.exit(code));
  demoChecks(repo, loaded, { env }).then(d => {
    const all = [...problems, ...d.problems];
    done(report(all, [...noted, ...d.notes]) + (d.problems.length ? '' : `\ndemo: ${d.pages} pages rendered with the demo setting, none holds a name it hides.`), all.length ? 1 : 0);
  }, e => done(`hq check --demo could not render the pages: ${e.stack || e.message}`, 1, process.stderr));
  return undefined;
}
