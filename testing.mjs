// homequarters/testing: what a project's own tests may import, versioned with the package like the plugin API.
// start() is HQ's server for a test: it touches nothing on the machine it runs on unless the test says so. The rest are
// HQ's own functions, the ones its pages use, so a project's contract test holds its records against HQ's reading of
// them. Navigation and the backlog's settings are process-wide (one HQ per process), so two servers started in one
// test file with different manifests share the last one's.
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { start as startServer } from './server.mjs';
import { loadManifest } from './lib/manifest.mjs';

export { loadManifest };
export { loadPlugins } from './lib/plugins.mjs';
export { setNav } from './lib/page.mjs';
export { demoConfig, demoFacts, demoSettings } from './lib/demo.mjs';
export { runInfo } from './lib/run-info.mjs';
export { readLaptopRuns } from './lib/runs.mjs';
export { loadDecisions } from './lib/decisions.mjs';
export { dailyAsOf } from './lib/dora.mjs';

// The Machine page's answers in a test: every tool missing, every machine reading unknown, no real load or cores.
// A test that wants answers passes its own probes ({ host, exec, loadavg, cores }).
export const NO_TOOLS = Object.freeze({
  host: () => { throw Object.assign(new Error('not run in a test'), { code: 'ENOENT' }); },
  exec: async () => ({ ok: false, code: 'ENOENT', out: '', err: '' }),
  loadavg: () => [0, 0, 0],
  cores: 1,
});

// HQ on a free port for one test. Unless the test passes them: the manifest is read from repo; the cache and Claude's
// projects folder are new empty folders, removed again by close(); the manifest's link file is never written, since it
// is the project's app's link to the HQ the person runs; the demo setting is off whatever HQ_DEMO says; claude is not
// installed; and the Machine page asks NO_TOOLS. Everything else start() takes is passed through (plugins, gh, fb, run,
// platform). Answers { url, server, close }, and close() ends open connections too, so a live page left streaming
// does not hold the test open.
export async function start({ repo, m, cache, projectsDir, probes = NO_TOOLS, claude = { find: async () => null }, demo = null, ...rest } = {}) {
  const made = [];
  const scratch = name => { const d = mkdtempSync(join(tmpdir(), `hq-test-${name}-`)); made.push(d); return d; };
  const base = m || loadManifest(repo).m;
  const c = cache || scratch('cache');
  const p = projectsDir || join(scratch('claude'), 'projects');
  mkdirSync(p, { recursive: true });
  const srv = await startServer({ ...rest, port: rest.port ?? 0, repo, m: { ...base, cache: c, link: null }, cache: c, projectsDir: p, probes, claude, demo });
  const close = async () => {
    srv.server.closeAllConnections?.();
    await new Promise(done => srv.server.close(() => done()));
    for (const d of made) rmSync(d, { recursive: true, force: true });
  };
  return { url: srv.url, server: srv.server, close };
}
