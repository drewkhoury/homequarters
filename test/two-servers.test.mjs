// Proves: two HQ servers in one process each draw their own nav and brand; a request to one never shows the other's.
// Why: the nav and the project's name were module state set by whichever handler was made last, so a test that started a
// demo server beside a plain one saw the plain one's pages in both, and any embedding of two HQs would too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { start } from '../server.mjs';
import { loadManifest } from '../lib/manifest.mjs';

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
const repo = (name, extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), `hq-two-${name}-`));
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`);
  writeFileSync(join(dir, 'hq.json'), JSON.stringify({ schemaVersion: 1, name, cache: join(dir, 'cache'), ...extra }));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'm');
  return dir;
};
const get = (base, path) => new Promise((resolve, reject) => {
  const u = new URL(base);
  request({ host: u.hostname, port: u.port, path }, res => { const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); }).on('error', reject).end();
});

test('each server keeps its own brand and nav, whichever started last', async () => {
  const a = repo('apple'), b = repo('banana', { decisions: { dir: 'docs/decisions' } });
  const sa = await start({ port: 0, repo: a, m: loadManifest(a).m, gh: async () => { throw new Error('no gh'); } });
  const sb = await start({ port: 0, repo: b, m: loadManifest(b).m, gh: async () => { throw new Error('no gh'); } });
  try {
    const [ha, hb] = await Promise.all([get(sa.url, '/'), get(sb.url, '/')]);
    assert.match(ha, /<title>Home · apple HQ<\/title>/, 'the first server, started first, shows its own name');
    assert.match(hb, /<title>Home · banana HQ<\/title>/);
    assert.doesNotMatch(ha, /href="\/decisions"/, 'the first server has no Decisions page in its nav');
    assert.match(hb, /href="\/decisions"/, 'the second does');
  } finally {
    sa.server.close(); sb.server.close();
    rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true });
  }
});
