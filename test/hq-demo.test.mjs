// Proves: the demo setting (lib/demo.mjs) swaps people, paths, remotes and the project's name on a page so it is safe
// to film, and with no config every function hands back what it was given.
// Why: HQ is filmed in public; a missed swap is a private name on a video, and a swap when the demo is off would
// change what the person sees of their own repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  demoConfig, scrub, demoPage, hiddenPath, keptConversation, neutralTitle, demoSession, demoResponse, demoSettings, loadDemo, peopleOf, sameCase,
} from '../lib/demo.mjs';

// Two made-up people, one a git author with a name that is also a word (Rose, rose), one only ever in the backlog.
// A made-up home folder and GitHub remote, and the project's name as its manifest gives it. None of these is anyone real.
const FACTS = {
  home: '/Users/rosefake',
  name: 'QuestKeep',
  slug: 'fakeowner/fakerepo',
  authors: [['rose quartzfake', 'rose.q@mail.invalid'], ['Rose Quartzfake', 'rose.q@mail.invalid'], ['dependabot[bot]', 'bot@mail.invalid'], ['Claude', 'noreply@anthropic.com']],
  asked: ['Pip', 'unknown', 'review', 'plan fast-deploy'],
};
const SETTINGS = {
  brand: 'HQ', wordmark: 'HomeQuarters', owner: 'your-org', repo: 'your-repo', home: 'you',
  // the first pair is a real person's first name here, so it is passed over
  standIns: [['Pip', 'Nobody'], ['Alex', 'Morgan'], ['Sam', 'Rivera']],
  names: { Rosie: 'Lexi' }, words: ['rose'], hide: ['web/images/', 'docs/Secret.md'], keepSources: ['sdk-cli'], keep: ['^keepme-'],
  keepEmailDomains: ['example.com', 'anthropic.com', 'github.com'],
};
const cfg = demoConfig(FACTS, SETTINGS);
const swap = t => scrub(t, cfg);

test('without a config nothing changes', () => {
  const page = '<a class="brand" href="/">QUESTKEEP HQ</a> Rose Quartzfake in /Users/rosefake';
  assert.equal(scrub(page, null), page);
  assert.equal(demoPage(page, null), page);
  assert.equal(hiddenPath(null, 'web/images/a.jpg'), false);
  const s = { id: 'x', title: 'Pairing with Rose', entrypoint: 'cli' };
  assert.equal(keptConversation(null, s), true);
  assert.equal(demoSession(null, s), s);
  const res = { write() {}, end() {}, writeHead() {}, setHeader() {} }, before = { ...res };
  assert.equal(demoResponse(res, null), res);
  assert.deepEqual(res, before, 'the response is not wrapped');
  assert.equal(loadDemo({ repo: '.', cache: null, env: {} }), null, 'HQ_DEMO unset means no demo');
  assert.equal(loadDemo({ repo: '.', cache: null, env: { HQ_DEMO: '0' } }), null);
});

test('people come from authors with two names and from the backlog, and bots and one-word authors are left out', () => {
  const people = peopleOf(FACTS);
  assert.deepEqual(people.map(p => [p.first, p.last]), [['Pip', ''], ['Rose', 'Quartzfake']]);
  assert.deepEqual([...people[1].emails], ['rose.q@mail.invalid']);
  assert.deepEqual(cfg.people.map(p => `${p.to.first} ${p.to.last}`), ['Alex Morgan', 'Sam Rivera'], 'Pip is a real name, so no one stands in as Pip');
});

test('a whole name is swapped in any case and with anything between, a login and its digits too', () => {
  assert.equal(swap('Rose Quartzfake wrote it'), 'Sam Rivera wrote it');
  assert.equal(swap('rose quartzfake <x>'), 'sam rivera <x>');
  assert.equal(swap('Logged in as rosequartzfake'), 'Logged in as samrivera');
  assert.equal(swap('rosequartzfake42 and rose-quartzfake.jpg'), 'samrivera42 and sam-rivera.jpg');
  assert.equal(swap('QUARTZFAKE, quartzfake, Quartzfake'), 'RIVERA, rivera, Rivera');
  assert.equal(swap('opened by rquartzfake7'), 'opened by srivera7', 'a login made from an initial and the last name');
});

test('a first name is swapped as a name is written, and left alone where it is an ordinary word', () => {
  assert.equal(swap("Rose asked. Rose's idea. ROSE."), "Sam asked. Sam's idea. SAM.");
  assert.equal(swap('the sun rose over the hill'), 'the sun rose over the hill');
  assert.equal(swap('runner rose-laptop and box.rose'), 'runner sam-laptop and box.sam');
  assert.equal(swap('Pip, 28 Sep; ask pip'), 'Alex, 28 Sep; ask alex', 'a name that is not a word goes in lower case too');
  assert.equal(swap('Roseanne and Pipette'), 'Roseanne and Pipette', 'only the whole name');
});

test('names the settings add are swapped in any case, and one of them can name a person\'s stand-in', () => {
  assert.equal(swap('Rosie, ROSIE, rosie'), 'Lexi, LEXI, lexi');
  const named = demoConfig(FACTS, { ...SETTINGS, names: { Rose: 'Kit' } });
  assert.equal(scrub('Rose Quartzfake and Rose', named), 'Kit Rivera and Kit');
  assert.equal(sameCase('x', 'Alex'), 'alex');
});

test('email addresses become stand-ins or someone@example.com, except in the domains kept', () => {
  assert.equal(swap('<rose.q@mail.invalid>'), '<sam@example.com>');
  assert.equal(swap('ROSE.Q@MAIL.INVALID'), 'sam@example.com');
  assert.equal(swap('stranger@elsewhere.org'), 'someone@example.com');
  assert.equal(swap('Co-Authored-By: Claude <noreply@anthropic.com>'), 'Co-Authored-By: Claude <noreply@anthropic.com>');
  assert.equal(swap('test@example.com'), 'test@example.com');
});

test('the home folder becomes ~, in a path, in a URL and in Claude Code\'s project folder names', () => {
  assert.equal(swap('/Users/rosefake/repos/x and /Users/rosefake.'), '~/repos/x and ~.');
  assert.equal(swap('?path=%2FUsers%2Frosefake%2Frepos'), '?path=~%2Frepos');
  assert.equal(swap('~/.claude/projects/-Users-rosefake-repos-x/1.jsonl'), '~/.claude/projects/-Users-you-repos-x/1.jsonl');
  assert.equal(swap('/Users/rosefakes/x'), '/Users/rosefakes/x', 'another folder that starts the same');
});

test('the GitHub owner and repo become your-org/your-repo, and the owner alone your-org', () => {
  assert.equal(swap('git@github.com:fakeowner/fakerepo.git'), 'git@github.com:your-org/your-repo.git');
  assert.equal(swap('https://github.com/FakeOwner/FakeRepo/actions/runs/1'), 'https://github.com/your-org/your-repo/actions/runs/1');
  assert.equal(swap('/orgs/fakeowner/settings and fakeowner/other'), '/orgs/your-org/settings and your-org/other');
  assert.equal(swap('fakerepo on its own'), 'fakerepo on its own', 'a bare repo name can be the product name');
});

test('the header reads HQ with a HomeQuarters wordmark, and the project\'s name beside HQ becomes HQ', () => {
  // the header as lib/page.mjs draws it: HQ, then the project's name from the manifest
  // the name is the manifest's slug, but a transcript or a doc may write it in any case
  const page = '<title>Home · QuestKeep HQ</title><a class="brand" href="/">HQ <span class="hq-brand-name">QuestKeep</span></a><p>Comments from QuestKeep HQ, questkeep HQ and QUESTKEEP HQ</p>';
  const out = demoPage(page, cfg);
  assert.match(out, /Comments from HQ, HQ and HQ</, 'the project\'s name beside HQ is swapped in any case');
  assert.match(out, /<title>Home · HQ<\/title>/);
  assert.match(out, /<a class="brand" href="\/">HQ<small class="hq-wordmark"[^>]*>HomeQuarters<\/small><\/a>/);
  assert.doesNotMatch(out, /QuestKeep HQ|hq-brand-name/i);
  // a repo with no manifest has no name beside HQ, and gets the wordmark all the same
  assert.match(demoPage('<a class="brand" href="/">HQ</a>', cfg), /<a class="brand" href="\/">HQ<small class="hq-wordmark"[^>]*>HomeQuarters<\/small><\/a>/);
});

test("a git name that starts with HQ is not taken for a person, so HQ's own class names and paths survive", () => {
  // the package's own test runs and CI set git's name to "HQ Test"; demoFacts adds git's user.name as an author
  const withHq = demoConfig({ ...FACTS, authors: [...FACTS.authors, ['HQ Test', 'hq@mail.invalid']] }, SETTINGS);
  const page = '<a href="#hq-main">Skip</a><link rel="stylesheet" href="/hq/hq-comments.css"><div class="hq-moss">hq check</div>';
  assert.equal(scrub(page, withHq), page);
  assert.ok(!withHq.people.some(p => /^hq$/i.test(p.first)), 'HQ is nobody\'s first name');
});

test('the paths the settings hide are hidden in any letter case, and nothing else is', () => {
  for (const p of ['web/images', 'web/images/a.jpg', 'WEB/Images/b.JPG', '/web/images/c.png', 'docs/secret.md']) assert.equal(hiddenPath(cfg, p), true, p);
  for (const p of ['web', 'web/imagesque.js', 'web/app.js', 'docs/secret.md.bak', 'docs']) assert.equal(hiddenPath(cfg, p), false, p);
});

test('HQ\'s own Chat conversations and the ones the settings keep stay as they are; the rest get a title from what they did', () => {
  const chat = { id: 'c1', title: 'What does this chain unblock?', entrypoint: 'sdk-cli' };
  const kept = { id: 'keepme-2', title: 'Rose and the rules', entrypoint: 'cli' };
  const other = { id: 'o3', title: 'Rose force push', entrypoint: 'cli', branches: ['fix/sync'], edited: ['web/app.js'],
    commitsFound: [{ sha: 'abc', subject: 'fix(app): a quest being typed survives a change' }] };
  assert.equal(demoSession(cfg, chat), chat);
  assert.equal(demoSession(cfg, kept), kept);
  const shown = demoSession(cfg, other);
  assert.equal(shown.title, 'A quest being typed survives a change');
  assert.equal(shown.demoClosed, true);
  assert.equal(other.title, 'Rose force push', 'the session itself is not changed');
});

test('a title comes from the first commit, else the first file changed, else the branch', () => {
  assert.equal(neutralTitle({ commits: [{ subject: 'feat(hq)!: one table for every list' }] }), 'One table for every list');
  assert.equal(neutralTitle({ subjects: [{ subject: 'docs: plain words' }] }), 'Plain words');
  assert.equal(neutralTitle({ edited: ['hq/server.mjs'], branches: ['main'] }), 'Changes to hq/server.mjs');
  assert.equal(neutralTitle({ branches: ['explore/backlog'] }), 'A conversation on explore/backlog');
  assert.equal(neutralTitle({}), 'A conversation');
});

// A response that records what reaches the wire.
function fakeRes() {
  const sent = [];
  return { sent, setHeader() {}, writeHead() {}, write(c) { sent.push(c); return true; }, end(c) { if (c != null) sent.push(c); } };
}

test('what leaves through the response is swapped when it is text, and left as it is otherwise', () => {
  const html = demoResponse(fakeRes(), cfg);
  html.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  html.end('<a class="brand" href="/">HQ <span class="hq-brand-name">QuestKeep</span></a> Rose in /Users/rosefake/x');
  assert.match(html.sent[0], /HQ<small class="hq-wordmark"[^>]*>HomeQuarters<\/small><\/a> Sam in ~\/x/);

  const json = demoResponse(fakeRes(), cfg);
  json.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  json.end(JSON.stringify({ html: 'by rose.q@mail.invalid at fakeowner/fakerepo' }));
  assert.deepEqual(JSON.parse(json.sent[0]), { html: 'by sam@example.com at your-org/your-repo' });

  const stream = demoResponse(fakeRes(), cfg);
  stream.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  stream.write(Buffer.from('{"text":"Rose"}\n'));
  stream.end();
  assert.deepEqual(stream.sent, ['{"text":"Sam"}\n']);

  const image = demoResponse(fakeRes(), cfg), bytes = Buffer.from('Rose Quartzfake');
  image.writeHead(200, { 'content-type': 'image/jpeg' });
  image.end(bytes);
  assert.equal(image.sent[0], bytes, 'an image goes out untouched');

  const raw = demoResponse(fakeRes(), cfg);
  raw.writeHead(200, { 'content-type': 'application/octet-stream' });
  raw.end(Buffer.from('# Makefile by Rose\n'));
  assert.equal(raw.sent[0], '# Makefile by Sam\n', 'a raw file that is text is swapped whatever its type');

  const binary = demoResponse(fakeRes(), cfg), blob = Buffer.from('Rose\0Quartzfake');
  binary.writeHead(200, { 'content-type': 'application/octet-stream' });
  binary.end(blob);
  assert.equal(binary.sent[0], blob, 'a file with a NUL in it is not text');
});

test('the laptop\'s own settings add names, people and kept conversations to the committed ones', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-demo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'demo.json');
  writeFileSync(file, JSON.stringify({ brand: 'HQ', names: { A: 'B' }, people: [['Kay', 'Fake']], keep: ['^x'] }));
  mkdirSync(join(dir, 'cache', 'hq'), { recursive: true });
  writeFileSync(join(dir, 'cache', 'hq', 'demo.json'), JSON.stringify({ names: { C: 'D' }, people: [['Lou', 'Fake']], keep: ['^y'], private: ['z'] }));
  const s = demoSettings(join(dir, 'cache'), file);
  assert.deepEqual(s.names, { A: 'B', C: 'D' });
  assert.deepEqual(s.people, [['Kay', 'Fake'], ['Lou', 'Fake']]);
  assert.deepEqual(s.keep, ['^x', '^y']);
  assert.equal(s.brand, 'HQ');
  assert.deepEqual(demoSettings(join(dir, 'nowhere'), file).names, { A: 'B' }, 'no laptop file is fine');
});

// The manifest's demo key names the project's own demo settings, read over the package's defaults and under the
// laptop's. Until now the key was resolved and never read.
test("the project's demo file, named in hq.json, is read over the package's defaults and under the laptop's", () => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-demo-project-'));
  mkdirSync(join(dir, 'cache', 'hq'), { recursive: true });
  writeFileSync(join(dir, 'demo.json'), JSON.stringify({ names: { Rose: 'Robin' }, keep: ['a-keeper'] }));
  writeFileSync(join(dir, 'cache', 'hq', 'demo.json'), JSON.stringify({ names: { Pip: 'Pat' } }));
  const s = demoSettings(join(dir, 'cache'), undefined, join(dir, 'demo.json'));
  assert.equal(s.brand, 'HQ', "the package's defaults stand");
  assert.deepEqual(s.names, { Rose: 'Robin', Pip: 'Pat' });
  assert.ok(s.keep.includes('a-keeper'));
  const d = loadDemo({ repo: '.', cache: join(dir, 'cache'), file: join(dir, 'demo.json'), env: { HQ_DEMO: '1' } });
  assert.ok(d && d.rules, 'a demo config with the file read');
  rmSync(dir, { recursive: true, force: true });
});
