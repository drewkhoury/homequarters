#!/usr/bin/env node
// Before a release: the HQ a project has pinned and this checkout's HQ, started one after the other on the project's
// own data, and their pages compared. For each page it prints the status and first-read time from each, and the
// sentences the pinned HQ shows that this one does not; digits are masked, so ages and counts that moved between the
// two reads are not differences. It ends 1 when a page answers with another status, and 0 otherwise: a sentence that
// went may be the point of the release, so it is printed for the person to judge.
// Neither HQ writes the project's link file, and neither starts Delivery's background hq dora, which would rewrite the
// dora.json the project's own HQ reads. Both read and write HQ's own indexes in the project's cache, so the project's
// own HQ may read cold once after.
// Usage: node scripts/try-release.mjs <project repo> [--pinned <folder of the pinned homequarters>]
//   --pinned defaults to <project repo>/node_modules/homequarters.
import cp, { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The text a person reads on a page, as sentences with their digits masked.
export function sentencesOf(html) {
  const text = String(html).replace(/<(style|script)\b[^>]*>[^]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'');
  return new Set(text.split(/\n|(?<=[.!?])\s+/).map(s => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()).filter(s => s.length > 2));
}

// pages: { [path]: { status, ms, html } } from each HQ. Answers one row per path either read.
export function compare(pinned, next) {
  return [...new Set([...Object.keys(pinned), ...Object.keys(next)])].map(path => {
    const a = pinned[path], b = next[path], was = a ? sentencesOf(a.html) : new Set(), now = b ? sentencesOf(b.html) : new Set();
    return { path, status: [a?.status ?? null, b?.status ?? null], ms: [a?.ms ?? null, b?.ms ?? null],
      gone: [...was].filter(s => !now.has(s)), added: [...now].filter(s => !was.has(s)) };
  });
}

// ---- the child: one HQ from <pkg>, serving <repo> on a free port, writing no link file ----
async function child(pkg, repo) {
  process.chdir(repo);
  // Delivery's refresh runs dora.mjs with execFile: answered at once, so the project's dora.json is left as it is
  const real = cp.execFile;
  cp.execFile = function (cmd, args, ...rest) {
    if (Array.isArray(args) && args.some(a => /dora\.mjs$/.test(String(a)))) { const done = rest.find(f => typeof f === 'function'); if (done) setImmediate(() => done(null, '', '')); return null; }
    return real.call(this, cmd, args, ...rest);
  };
  syncBuiltinESMExports();
  const at = p => pathToFileURL(join(pkg, p)).href;
  const { start } = await import(at('server.mjs')), { loadManifest } = await import(at('lib/manifest.mjs')), { loadPlugins } = await import(at('lib/plugins.mjs'));
  const { m, warnings } = loadManifest(repo), { plugins, failed } = await loadPlugins(m);
  const { url } = await start({ repo, m: { ...m, link: null }, plugins, pluginsFailed: failed, warnings, port: 0 });
  console.log(url);
}

// ---- the parent ----
function serve(pkg, repo) {
  const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', pkg, repo], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = () => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } };
  return new Promise((res, rej) => {
    let out = '';
    p.stdout.on('data', d => { out += d; const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(out); if (m) res({ url: m[1], stop }); });
    p.stderr.on('data', d => { out += d; });
    p.on('close', () => rej(new Error(`HQ from ${pkg} ended: ${out.trim()}`)));
  });
}
async function read(url, paths) {
  const pages = {};
  for (const path of paths) {
    const t = Date.now();
    try { const r = await fetch(url + path, { signal: AbortSignal.timeout(60000) }); pages[path] = { status: r.status, ms: Date.now() - t, html: await r.text() }; }
    catch (e) { pages[path] = { status: `failed: ${e.message}`, ms: Date.now() - t, html: '' }; }
  }
  return pages;
}
async function both(repo, pinnedPkg) {
  const { navPages } = await import(pathToFileURL(join(HERE, 'lib', 'warm.mjs')).href);
  const out = {};
  let paths = null;
  for (const [label, pkg] of [['next', HERE], ['pinned', pinnedPkg]]) {
    const s = await serve(pkg, repo);
    try {
      if (!paths) { const home = await read(s.url, ['/']); paths = ['/', ...navPages(home['/'].html).filter(p => p !== '/'), '/testing?tab=tests', '/testing?tab=runs']; }
      out[label] = await read(s.url, paths);
    } finally { s.stop(); }
  }
  return out;
}

if (process.argv[2] === '--child') await child(process.argv[3], process.argv[4]);
else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.argv[2] && resolve(process.argv[2]);
  const i = process.argv.indexOf('--pinned'), pinnedPkg = resolve(i > 0 ? process.argv[i + 1] : join(repo || '.', 'node_modules', 'homequarters'));
  if (!repo || !existsSync(repo)) { console.error('Usage: node scripts/try-release.mjs <project repo> [--pinned <folder of the pinned homequarters>]'); process.exit(2); }
  if (!existsSync(join(pinnedPkg, 'server.mjs'))) { console.error(`No HQ at ${pinnedPkg}: pass --pinned`); process.exit(2); }
  const { pinned, next } = await both(repo, pinnedPkg);
  const rows = compare(pinned, next);
  let bad = 0;
  for (const r of rows) {
    const moved = r.status[0] !== r.status[1];
    if (moved) bad++;
    console.log(`${moved ? 'STATUS' : 'ok    '} ${r.path.padEnd(22)} ${String(r.status[0]).padEnd(4)}→ ${String(r.status[1]).padEnd(4)} first ${r.ms[0]} → ${r.ms[1]} ms`);
    for (const s of r.gone.slice(0, 8)) console.log(`         gone: ${s.slice(0, 160)}`);
    if (r.gone.length > 8) console.log(`         gone: … ${r.gone.length - 8} more`);
    if (r.added.length) console.log(`         new:  ${r.added.length} sentence${r.added.length === 1 ? '' : 's'}`);
  }
  console.log(bad ? `${bad} page${bad === 1 ? '' : 's'} answered with another status.` : 'Every page answered as the pinned HQ did; read the gone lines above.');
  process.exit(bad ? 1 : 0);
}
