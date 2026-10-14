#!/usr/bin/env node
// hq: HomeQuarters from the command line.
//   hq [serve] [--port N] [--repo DIR]   start HQ for the repo you are in (or DIR), on 8780 or the next free port
//   hq setup [--repo DIR]                scan the repo and this machine, print a proposed hq.json and make lines
//   hq machine                           what the machine is doing now, as JSON (the block recorded with each run)
//   hq run-info <kind> [--json FILE]     the `=== run {json}` line a recorded run starts with (lib/run-info.mjs)
//   hq --version
// HQ reads the repo's hq.json if there is one, and shows the baseline without it. It never writes to the repo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (name, dflt = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt; };
const cmd = args.find(a => !a.startsWith('--') && a !== flag('--port') && a !== flag('--repo')) || 'serve';

// The repo: --repo, else the git checkout the current folder is in, else the current folder.
function findRepo() {
  const given = flag('--repo');
  if (given) return resolve(given);
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.cwd(); }
}

if (args.includes('--version') || cmd === 'version') { console.log(PKG.version); process.exit(0); }
if (args.includes('--help') || cmd === 'help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n')); process.exit(0); }

if (cmd === 'run-info') {
  const { main } = await import('../lib/run-info.mjs');
  main(args.filter(a => a !== 'run-info'));
} else if (cmd === 'machine') {
  const { hostInfo } = await import('../lib/machine.mjs');
  console.log(JSON.stringify(hostInfo(), null, 2));
} else if (cmd === 'setup') {
  const { scanRepo, scanSoftware, proposeManifest, MAKE_SNIPPET } = await import('../lib/scan.mjs');
  const repo = findRepo();
  const [scan, software] = await Promise.all([scanRepo(repo), scanSoftware()]);
  console.log(`# hq setup for ${repo}\n`);
  console.log('## Software found');
  for (const s of software) console.log(`  ${s.id.padEnd(9)} ${s.found ? (s.version || 'present').padEnd(10) : 'missing   '} ${s.about}${s.login ? ` (${s.login})` : ''}${s.engine ? ` (${s.engine})` : ''}`);
  console.log('\n## In the repo');
  if (!scan.found.length) console.log('  nothing HQ recognises beyond the files themselves; the baseline pages work as they are');
  for (const f of scan.found) console.log(`  ${f.rel.padEnd(28)} ${f.note}`);
  if (scan.remote) console.log(`  GitHub remote: ${scan.remote}`);
  if (scan.caches.length) console.log(`  cache folder: ${scan.caches[0]}${scan.stores.length ? ` with ${[...new Set(scan.stores.map(s => s.store))].join(', ')}` : ''}`);
  console.log(`\n## ${scan.manifest ? 'hq.json is already there; this is what setup would propose from scratch' : 'Proposed hq.json (add it to the repo root yourself)'}\n`);
  console.log(JSON.stringify(proposeManifest(scan), null, 2));
  console.log('\n## Make lines to add, if you want runs recorded\n');
  console.log(MAKE_SNIPPET);
} else if (cmd === 'serve') {
  const { start } = await import('../server.mjs');
  const { loadManifest } = await import('../lib/manifest.mjs');
  const { loadPlugins } = await import('../lib/plugins.mjs');
  const repo = findRepo();
  const { m, warnings, present } = loadManifest(repo);
  const { plugins, failed } = await loadPlugins(m);
  const port = flag('--port') ? +flag('--port') : undefined;
  try {
    const { url } = await start({ repo, m, plugins, pluginsFailed: failed, warnings, ...(port ? { port } : {}) });
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
    console.log(`HQ ${PKG.version} for ${m.name}${present ? '' : ' (no hq.json: the baseline pages; run hq setup for more)'}: ${url}`);
    for (const w of warnings) console.log(`  warning: ${w}`);
    for (const f of failed) console.log(`  plugin left out: ${f.file}: ${f.why}`);
    console.log('Only this machine can reach it. Ctrl-C stops it.');
  } catch (e) { console.error(`HQ could not start: ${e.message}`); process.exit(1); }
} else {
  console.error(`hq: unknown command "${cmd}". Try hq --help.`);
  process.exit(2);
}
