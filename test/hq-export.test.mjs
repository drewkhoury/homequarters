// Export (hq/lib/export.mjs): which sections a request gets, how big they are to Claude, which files go in (only ones
// git tracks, never binary, minified or huge ones), and how the file is laid out. git is a stub answering a fixed list
// of tracked files; the files live in a temp folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pickSections, estimateTokens, fileName, skipReason, docKind, docsSection, sourceSection, conversationsSection, assemble, SECTIONS, MAX_FILE, trackedDocs, trackedSource, zipEntries, zipName, conversationFile } from '../lib/export.mjs';

// A small repo: what git tracks, and one file it does not (a secret that must never reach the export).
const TRACKED = ['README.md', 'docs/DATA.md', 'docs/plans/fast-deploy.md', 'docs/backlog/README.md', 'docs/backlog/next/sprint.md',
  'web/app.js', 'web/app.min.js', 'web/icon.png', 'package-lock.json', 'big.json'];
const SECRET = 'ANTHROPIC_API_KEY=sk-ant-not-a-real-key';
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'hq-export-'));
  const put = (p, body) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), body); };
  put('README.md', '# QuestKeep\n\nA quest app.\n');
  put('docs/DATA.md', '# Data\n\n```js\nconst a = 1;\n```\n');
  put('docs/plans/fast-deploy.md', '# Fast deploy\n');
  put('docs/backlog/README.md', '# Backlog\n');
  put('docs/backlog/next/sprint.md', '---\ntype: feature\n---\n# Sprint\n');
  put('web/app.js', 'export const x = 1;\n');
  put('web/app.min.js', `var a=${'1,'.repeat(3000)}1;`);
  put('web/icon.png', Buffer.from([137, 80, 78, 71, 0, 0, 0, 13]));
  put('package-lock.json', '{}');
  put('big.json', 'x'.repeat(MAX_FILE + 1));
  put('.env', SECRET);
  return dir;
}
// git ls-files as the export calls it: -z, optionally with a pattern
const git = async args => {
  const pattern = args[args.indexOf('--') + 1];
  const list = args.includes('--') ? TRACKED.filter(p => (pattern === '*.md' ? p.endsWith('.md') : true)) : TRACKED;
  return list.join('\0') + '\0';
};

test('a request picks its sections in the file\'s order; unknown names drop out; with none named, the ones ticked to start with', () => {
  assert.deepEqual(pickSections(new URLSearchParams('sections=source,repo,bogus')).ids, ['repo', 'source']);
  assert.deepEqual(pickSections(new URLSearchParams()).ids, SECTIONS.filter(s => s.on).map(s => s.id));
  assert.equal(pickSections(new URLSearchParams('sections=repo&prompts=1')).prompts, false, 'what people wrote comes only with Conversations');
  assert.equal(pickSections(new URLSearchParams('sections=conversations&prompts=1')).prompts, true);
});

test('tokens are about four characters each, and the file is named for the day and the commit', () => {
  assert.equal(estimateTokens('abcd'.repeat(10)), 10);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(fileName('2026-09-29T05:38:04Z', '79ee20916bb4edb573'), 'questkeep-hq-2026-09-29-79ee209.md');
});

test('binary, minified, generated, lock and huge files stay out of Source; the project\'s own code goes in', () => {
  assert.equal(skipReason('web/app.js', 20, Buffer.from('export const x = 1;\n')), '');
  assert.equal(skipReason('web/icon.png', 8, null), 'binary');
  assert.equal(skipReason('web/data.bin', 8, Buffer.from([1, 0, 2])), 'binary');
  assert.equal(skipReason('package-lock.json', 2, null), 'generated or someone else\'s');
  assert.equal(skipReason('web/app.min.js', 10, null), 'generated or someone else\'s');
  assert.equal(skipReason('web/bundle.js', 6001, Buffer.from(`var a=${'1,'.repeat(3000)}`)), 'minified');
  assert.equal(skipReason('big.json', MAX_FILE + 1, null), 'over 512 KB');
  assert.equal(skipReason('web/app.js', 245 * 1024, null), '', 'the app\'s own main file, about 240 KB, goes in');
  assert.equal(skipReason('web/vendor/three@0.184.0/build/three.module.js', 1200 * 1024, null), 'generated or someone else\'s', 'a vendored library stays out whatever its size');
});

test('Markdown sorts into Docs, the backlog\'s items, and plans, design and history', () => {
  assert.deepEqual(['README.md', 'docs/DATA.md', 'docs/backlog/README.md', 'docs/backlog/next/sprint.md', 'docs/plans/x.md', 'docs/design/y.md', 'docs/history/z.md'].map(docKind),
    ['docs', 'docs', 'docs', 'backlog', 'plans', 'plans', 'plans']);
});

test('only tracked files are read: an untracked .env never reaches Docs or Source', async () => {
  const dir = repo();
  const docs = docsSection(await trackedDocs(dir, git, 'docs')), src = sourceSection(await trackedSource(dir, git));
  assert.ok(!docs.includes(SECRET) && !src.includes(SECRET));
  assert.match(docs, /^## Docs\n\n3 Markdown files/);
  assert.match(docs, /### README\.md\n\n```+markdown\n# QuestKeep/);
  assert.ok(!docs.includes('### docs/backlog/next/sprint.md') && !docs.includes('### docs/plans/'), 'items and plans have their own sections');
  assert.match(src, /### web\/app\.js\n\n```+javascript\nexport const x = 1;\n```+/);
  for (const p of ['web/app.min.js', 'web/icon.png', 'package-lock.json', 'big.json']) assert.ok(!src.includes(`### ${p}`), p);
  assert.match(src, /Left out:\n- generated or someone else's: 2/);
  rmSync(dir, { recursive: true, force: true });
});

test('a file\'s own fences never close the fence around it', async () => {
  const dir = repo();
  const docs = docsSection(await trackedDocs(dir, git, 'docs'));
  const block = docs.slice(docs.indexOf('### docs/DATA.md'));
  assert.match(block, /^### docs\/DATA\.md\n\n````markdown\n# Data\n\n```js\nconst a = 1;\n```\n````/, 'four backticks round a file that has three');
  rmSync(dir, { recursive: true, force: true });
});

// One conversation from the index, as hq/lib/conversations.mjs keeps it.
const SESSION = { id: '2dd45ba5-8d8f-46a6-8f53-610e4ea5c1fd', title: 'Backlog review', entrypoint: 'cli', branches: ['main'], cwd: '/r', started: '2026-09-28T20:00:00Z',
  lastActive: '2026-09-28T23:00:00Z', prompts: 4, tokens: { in: 1000, out: 2000, cacheRead: 50000, cacheWrite: 0 }, edited: ['docs/BACKLOG.md'], commits: [{ sha: '492e951abc', subject: 'feat(hq): board' }], gone: false };

test('Conversations lists each one, and adds what was written only when asked', () => {
  const plain = conversationsSection([SESSION]);
  assert.match(plain, /### Backlog review\n\n- id `2dd45ba5-8d8f-46a6-8f53-610e4ea5c1fd`, terminal, branch `main`/);
  assert.match(plain, /51k tokens in, 2k out/);
  assert.match(plain, /Commits: `492e951` feat\(hq\): board/);
  assert.ok(!plain.includes('What people and Claude wrote'));
  const writing = conversationsSection([SESSION], { writing: true, textOf: () => 'Look at the backlog.\n' });
  assert.match(writing, /What people and Claude wrote \(no tool output\):\n\n```+text\nLook at the backlog\.\n```+/);
});

test('the file opens with what it is and what is in it, then the chosen sections in order', () => {
  const body = assemble({ repo: '/r', branch: 'main', sha: 'abc1234', at: '2026-09-29T05:00:00Z', ids: ['repo', 'docs'],
    sections: { repo: '## Repo state\n\nclean', docs: '## Docs\n\nhello', source: '## Source code\n\nnot chosen' } });
  assert.match(body, /^# QuestKeep HQ export\n\nWhat QuestKeep HQ, the project's local intranet, showed at 2026-09-29T05:00:00.000Z: the repo `\/r` on branch `main` at commit `abc1234`/);
  assert.match(body, /- Repo state: about \d+ tokens\n- Docs: about \d+ tokens/);
  assert.ok(body.indexOf('## Repo state') < body.indexOf('## Docs'));
  assert.ok(!body.includes('not chosen'));
});

// ---- the zip ----

const ZIP_FILES = {
  docs: [{ path: 'README.md', text: '# QuestKeep\n' }, { path: 'docs/DATA.md', text: '# Data\n' }],
  plans: [{ path: 'docs/plans/fast-deploy.md', text: '# Fast deploy\n' }],
  backlogItems: [{ path: 'docs/backlog/next/sprint.md', text: '---\ntype: feature\n---\n# Sprint\n' }],
  source: { files: [{ path: 'web/app.js', buf: Buffer.from('export const x = 1;\n') }], skipped: { 'lock files': ['package-lock.json'] } },
};
const ZIP_PARTS = { repo: '## Repo state\n', backlog: '## Backlog\n', tests: '## Tests\n', github: '## GitHub\n', conversations: '## Conversations\n' };
const AT = Date.parse('2026-09-29T10:00:00Z');

test('the zip is one folder: a README first, the summaries, and the tracked files at their repo paths under repo/', () => {
  const e = zipEntries({ repo: '/r', branch: 'main', sha: 'cf0d3c5aaa', at: AT, ids: ['repo', 'docs', 'backlog', 'source'], parts: ZIP_PARTS, files: ZIP_FILES });
  const root = 'questkeep-hq-2026-09-29-cf0d3c5/';
  assert.deepEqual(e.map(x => x.name.replace(root, '')), ['README.md', 'repo-state.md', 'backlog.md', 'repo/docs/backlog/next/sprint.md', 'repo/README.md', 'repo/docs/DATA.md', 'repo/web/app.js']);
  assert.ok(e.every(x => x.name.startsWith(root)));
  assert.match(e[0].data, /## What is where\n\n- `repo-state.md`/);
  assert.match(e[0].data, /Left out of the source:\n  - lock files: 1/);
  assert.equal(e.find(x => x.name.endsWith('web/app.js')).data.toString(), 'export const x = 1;\n', 'a file goes in as it is, not fenced');
  assert.equal(zipName(AT, 'cf0d3c5aaa'), 'questkeep-hq-2026-09-29-cf0d3c5.zip');
});

test('sections left out leave their files out, and conversations get a file each only when asked', () => {
  const talks = [{ file: conversationFile({ id: '2dd45ba5-8d8f', started: '2026-09-28T23:21:00Z', title: 'Backlog status and batch assessment!' }), text: '# t\n' }];
  assert.equal(talks[0].file, '2026-09-28-backlog-status-and-batch-assessment-2dd45ba5.md');
  const e = zipEntries({ repo: '/r', sha: 'abc1234', at: AT, ids: ['conversations'], parts: ZIP_PARTS, files: ZIP_FILES, talks }).map(x => x.name.split('/').slice(1).join('/'));
  assert.deepEqual(e, ['README.md', 'conversations/index.md', `conversations/${talks[0].file}`]);
  assert.ok(!e.some(n => n.startsWith('repo/')));
});

test('the zip writer makes a file unzip and Python both read back', { skip: (() => { try { execFileSync('python3', ['-c', 'import zipfile']); return false; } catch { return 'no python3'; } })() }, async () => {
  const { zip } = await import('../lib/zip.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'hq-zip-')), f = join(dir, 'x.zip');
  writeFileSync(f, zip([{ name: 'a/README.md', data: '# Hi\n'.repeat(40) }, { name: 'a/repo/web/ünï.js', data: 'let a = 1;\n' }]));
  const out = execFileSync('python3', ['-c', `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('|'.join(i.filename for i in z.infolist())); print(z.read('a/repo/web/ünï.js').decode())`, f]).toString();
  assert.equal(out, 'a/README.md|a/repo/web/ünï.js\nlet a = 1;\n\n');
  rmSync(dir, { recursive: true, force: true });
});
