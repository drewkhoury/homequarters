// Proves: hq check --demo renders HQ's pages with the demo setting on, against the repo, and fails naming the page and
// the string when a name the setting should hide reaches one; once the setting swaps that name it passes, and a plain
// hq check never renders a page. It writes nothing: no link file, nothing in the cache.
// Why: QuestKeep's tests/unit/hq-demo-pages.test.mjs checked that the demo hides that repo's own names, from inside
// QuestKeep. When HQ's code leaves QuestKeep the test leaves too, and hq check --demo is its replacement (decision 17).
// The names here are made up: Rose Quartzfake is a git author the setting finds and swaps by itself, and "Zanzibar
// Secret" is a string the laptop's private list names, which nothing swaps until the project's demo file maps it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HQ = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs');
const AUTHOR = { name: 'Rose Quartzfake', email: 'rose.q@mail.invalid' };
const PLANTED = 'Zanzibar Secret';

// A repo inside a made-up home folder, committed by the made-up author, with the planted string in one doc and the
// laptop's private list in the cache, where git never sees it.
function repo(t, { mapped = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'hq-check-demo-')), dir = join(home, 'repos', 'doors'), cache = join(home, 'cache');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const put = (p, text) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); };
  put('README.md', `# Doors\n\n${AUTHOR.name} keeps this repo; write to ${AUTHOR.email}.\n`);
  put('docs/notes.md', `# Notes\n\nThe code name is ${PLANTED}.\n`);
  put('docs/backlog/next/fix-the-door.md', `---\ntype: bug\nasked: ${AUTHOR.name.split(' ')[0]}, 27 Sep\n---\n# The door sticks\n\nA sentence.\n\nDone when: it opens.\n`);
  put('hq/demo.json', JSON.stringify({ schema: 1, ...(mapped ? { names: { Zanzibar: 'Nowhere' } } : {}) }));
  put('hq.json', JSON.stringify({ schemaVersion: 1, name: 'doors', cache, link: 'web/.hq.json', backlog: { dir: 'docs/backlog' }, demo: 'hq/demo.json' }));
  mkdirSync(join(cache, 'hq'), { recursive: true });
  writeFileSync(join(cache, 'hq', 'demo.json'), JSON.stringify({ private: [PLANTED] }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email, GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email };
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'], { env: { ...env, HOME: home } });
  execFileSync('git', ['-C', dir, 'add', '.'], { env });
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'doors'], { env });
  return { dir, home, cache };
}
const check = (r, ...args) => spawnSync(process.execPath, [HQ, 'check', '--repo', r.dir, ...args], { encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: r.home } });
const files = d => (existsSync(d) ? readdirSync(d, { recursive: true }).sort() : []);

test('a name the demo setting leaves on a page fails the check, naming the page and the name', t => {
  const r = repo(t);
  const before = files(r.cache);
  const out = check(r, '--demo');
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /^demo \(\d+\):$/m);
  assert.ok(out.stdout.includes(`  /code/docs/notes.md: ${PLANTED}`), out.stdout);
  assert.ok(out.stdout.includes(`  /raw/docs/notes.md: ${PLANTED}`), out.stdout);
  for (const s of [AUTHOR.name, AUTHOR.email, 'Quartzfake', r.home]) assert.ok(!out.stdout.includes(`: ${s}\n`), `${s} is swapped by the setting, so no page holds it:\n${out.stdout}`);
  assert.equal(existsSync(join(r.dir, 'web', '.hq.json')), false, 'the check writes no link file');
  assert.deepEqual(files(r.cache), before, 'and nothing in the cache');
});

test('once the project\'s demo file swaps the name, the check passes', t => {
  const r = repo(t, { mapped: true });
  const out = check(r, '--demo');
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /keeps its contract/);
  assert.match(out.stdout, /demo: \d+ pages rendered with the demo setting, none holds a name it hides/);
});

test('a plain hq check renders no page, so the planted name does not fail it', t => {
  const r = repo(t);
  const out = check(r);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.doesNotMatch(out.stdout, /demo/);
});
