// hq check: the contract, checked. Reads the manifest and each convention file it names, and says what does not keep to
// its standard: the manifest's own warnings, a convention file's schema, the backlog's rules, the decisions' shape, the
// groups covering every tracked file once, the pipeline naming real sets, tests and layers, the test headers, the stages
// and the sets. Nothing is written. Each problem names the file or the thing, so the person can act on it.
// Usage: hq check [--repo DIR]     exit 1 when anything is wrong, 0 when the repo keeps its contract
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
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
export function checks(repo, { m, warnings } = loadManifest(repo), { files = tracked(repo) } = {}) {
  const out = [];
  const add = (area, list) => { for (const p of list) out.push({ area, problem: p }); };
  add('manifest', warnings);
  add('manifest', conventionWarnings(m));

  if (m.backlog) {
    configureBacklog({ rel: m.backlog.rel, mapRel: m.backlog.map ? m.backlog.map.slice(repo.length + 1) : null, earlierRel: m.backlog.earlierRel, stages: m.backlog.stages });
    if (!existsSync(m.backlog.dir)) add('backlog', [`${m.backlog.rel}: the folder hq.json names is not there`]);
    else add('backlog', checkBacklog(loadItems(repo)));
  }
  if (m.decisions) {
    configureDecisions({ rel: m.decisions.rel, earlierRel: m.decisions.earlierRel });
    if (!existsSync(m.decisions.dir)) add('decisions', [`${m.decisions.rel}: the folder hq.json names is not there`]);
    else add('decisions', checkDecisions(loadDecisions(repo).files));
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
  if (m.tests && existsSync(join(repo, 'tests'))) for (const f of catalogue(repo)) if (f.set !== 'helper' && f.set !== 'unit') for (const p of headerProblems(f)) add('headers', [`${f.path}: ${p}`]);
  return out;
}

export function report(problems) {
  if (!problems.length) return 'hq check: the repo keeps its contract.';
  const byArea = new Map();
  for (const p of problems) byArea.set(p.area, [...(byArea.get(p.area) || []), p.problem]);
  return [...byArea].map(([area, list]) => `${area} (${list.length}):\n${list.map(p => `  ${p}`).join('\n')}`).join('\n') + `\n\n${problems.length} problem${problems.length === 1 ? '' : 's'}.`;
}

export function main(argv, env = process.env) {
  const problems = checks(repoOf(argv, env));
  console.log(report(problems));
  return problems.length ? 1 : 0;
}
