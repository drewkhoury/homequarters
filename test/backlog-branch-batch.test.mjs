// Proves: what each branch does to the backlog is read in a few git runs however many branches there are, and the
// answer is the same as diffing each branch against its merge base: a branch that merged main in is diffed from that
// merge, a branch still on the old one-file backlog is read from its merge base, a branch only on origin is marked so,
// and a branch with no history in common with main touches nothing.
// Why: on QuestKeep, Home's first read after a start ran two git processes for each of 599 branches, a merge base and
// a diff, about 1.2 s of the page's wait.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchWork } from '../lib/backlog.mjs';

const EDITS = 8;
const OLD = line => `# Backlog\n\n## Next\n\n${line}\n`;
const MAP = [{ old: 'Name your world', slug: 'name-your-world' }];

// main holds EDITS item files and the old one-file backlog. Branches: edit-<i> edits item-<i>; ship-0 deletes item-0;
// merged-main edits item-1 and then merges main after main edited item-2; old-file edits the old file's entry;
// origin/pushed-only edits item-3 and exists only on origin; orphan has its own history.
function repoWithBranches() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'hq-branches-')));
  let tick = 0;
  const git = (...a) => { tick++; const at = `2026-10-01T10:${String(tick).padStart(2, '0')}:00Z`;
    return execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } }).trim(); };
  const item = i => join('docs', 'backlog', 'next', `item-${i}.md`);
  const write = (path, text) => { writeFileSync(join(repo, path), text); git('add', path); };
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(repo, 'docs', 'backlog', 'next'), { recursive: true });
  for (let i = 0; i < EDITS; i++) write(item(i), `---\ntype: bug\nasked: Noor\n---\n# Quest ${i} goes missing\n`);
  write('docs/BACKLOG.md', OLD('3. **Name your world.** Let people name their world.'));
  git('commit', '-q', '-m', 'docs: the backlog');
  const branch = (name, change) => { git('checkout', '-q', '-b', name, 'main'); change(); git('commit', '-q', '-m', `wip: ${name}`); git('checkout', '-q', 'main'); };
  for (let i = 0; i < EDITS; i++) branch(`edit-${i}`, () => write(item(i), `---\ntype: bug\nasked: Noor\n---\n# Quest ${i} goes missing on reload\n`));
  branch('ship-0', () => git('rm', '-q', item(0)));
  branch('merged-main', () => write(item(1), '---\ntype: bug\nasked: Noor\n---\n# Quest 1 goes missing twice\n'));
  branch('old-file', () => write('docs/BACKLOG.md', OLD('3. **Name your world.** Let people name their world, privately first.')));
  branch('pushed-only', () => write(item(3), '---\ntype: bug\nasked: Noor\n---\n# Quest 3 goes missing at night\n'));
  git('update-ref', 'refs/remotes/origin/pushed-only', 'pushed-only'); git('branch', '-q', '-D', 'pushed-only');
  // main moves on: item-2 changes there, and merged-main takes that change in
  write(item(2), '---\ntype: bug\nasked: Noor\n---\n# Quest 2 goes missing, said Jane\n'); git('commit', '-q', '-m', 'docs: item 2 reworded');
  git('checkout', '-q', 'merged-main'); git('merge', '-q', '--no-edit', 'main'); git('checkout', '-q', 'main');
  git('checkout', '-q', '--orphan', 'orphan'); git('rm', '-rq', '--cached', '.');
  for (let i = 0; i < EDITS; i++) unlinkSync(join(repo, item(i)));
  write(item(5), '---\ntype: bug\nasked: Noor\n---\n# Another quest 5\n'); git('commit', '-q', '-m', 'orphan');
  git('checkout', '-q', '-f', 'main');
  return { repo, done: () => rmSync(repo, { recursive: true, force: true }) };
}

// real git, counted: the args form branchWork takes as `git`, and the stdin form it takes as `gitIn`
function counting() {
  const ran = [];
  const run = (args, cwd, input) => new Promise(done => {
    ran.push(args[0]);
    const p = spawn('git', args, { cwd }), out = [];
    p.stdout.on('data', d => out.push(d)); p.on('close', code => done(code ? '' : Buffer.concat(out).toString('utf8')));
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
  return { ran, git: (args, cwd) => run(args, cwd), gitIn: (input, args, cwd) => run(args, cwd, input) };
}
const plain = work => Object.fromEntries([...work].sort(([a], [b]) => a.localeCompare(b))
  .map(([slug, ws]) => [slug, ws.map(w => `${w.branch} ${w.how}${w.remoteOnly ? ' remote' : ''}`).sort()]));

test('each branch\'s backlog changes are read from its merge base, in a few git runs for any number of branches', async () => {
  const h = repoWithBranches();
  try {
    const { ran, git, gitIn } = counting();
    const work = await branchWork(h.repo, 'main', { map: MAP, git, gitIn });
    const edited = i => `edit-${i} editing`;
    assert.deepEqual(plain(work), {
      'item-0': [edited(0), 'ship-0 shipping'],
      'item-1': [edited(1), 'merged-main editing'],
      'item-2': [edited(2)],
      'item-3': [edited(3), 'pushed-only editing remote'],
      ...Object.fromEntries([4, 5, 6, 7].map(i => [`item-${i}`, [edited(i)]])),
      'name-your-world': ['old-file editing'],
    });
    assert.ok(ran.length <= 6, `git ran ${ran.length} times for ${EDITS + 5} branches: ${ran.join(', ')}`);
  } finally { h.done(); }
});
