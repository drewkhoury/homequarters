// Proves: what 0.2.0 makes public is HQ's own code, not a copy: each helper ui gained, each export of
// homequarters/unstable and homequarters/testing is the function HQ's pages use; ui.backlog reads the backlog's settings
// as the manifest sets them; and testing's start() serves HQ without touching the machine: no link file written, no
// demo from HQ_DEMO, no claude, and the Machine page shows every tool missing.
// Why: QuestKeep moves its imports of HQ's internals onto these. A re-export that wrapped or copied a function would
// let the two drift apart, and a test server that wrote the manifest's link file rewrote and then deleted the real
// checkout's link to HQ (web/.hq.json) on every unit run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ui, UI_VERSION } from '../lib/ui-api.mjs';
import * as unstable from '../unstable.mjs';
import * as testing from '../testing.mjs';
import * as files from '../lib/files.mjs';
import * as github from '../lib/github.mjs';
import * as conversations from '../lib/conversations.mjs';
import * as convPage from '../pages/conversations.mjs';
import * as dora from '../lib/dora.mjs';
import * as backlog from '../lib/backlog.mjs';
import * as outside from '../lib/outside.mjs';
import * as claude from '../lib/claude.mjs';
import * as firebase from '../lib/firebase.mjs';
import * as stash from '../lib/stash.mjs';
import * as manifest from '../lib/manifest.mjs';
import * as plugins from '../lib/plugins.mjs';
import * as page from '../lib/page.mjs';
import * as demo from '../lib/demo.mjs';
import * as runInfo from '../lib/run-info.mjs';
import * as runs from '../lib/runs.mjs';
import * as decisions from '../lib/decisions.mjs';

test('ui 2 adds the pure helpers, each the function HQ itself uses', () => {
  assert.equal(UI_VERSION, 2);
  const same = [
    [ui.kindIn, files.kindIn], [ui.gh.checksOf, github.checksOf], [ui.git.belongs, conversations.belongs],
    [ui.claude.folderName, conversations.escapePath], [ui.days.key, dora.dayKey], [ui.days.start, dora.dayStart],
    [ui.backlog.parseItem, backlog.parseItem], [ui.backlog.check, backlog.check], [ui.backlog.openBlockers, backlog.openBlockers],
  ];
  for (const [pub, own] of same) assert.equal(pub, own, own.name);
  for (const k of ['gh', 'git', 'claude', 'days', 'backlog']) assert.ok(Object.isFrozen(ui[k]), `ui.${k} is frozen`);
});

test("ui.backlog's folder and stages are the manifest's, read when asked", t => {
  t.after(() => backlog.configureBacklog({ rel: 'docs/backlog', stages: ['inbox', 'next', 'parked'] }));
  backlog.configureBacklog({ rel: 'notes/todo', stages: ['now', 'later'] });
  assert.equal(ui.backlog.dir(), 'notes/todo');
  assert.deepEqual(ui.backlog.stages(), ['now', 'later']);
});

test('homequarters/unstable exports HQ\'s own functions, and nothing else', () => {
  const own = {
    ghPart: github.ghPart, branchPr: github.branchPr, mainCheckout: conversations.mainCheckout, readTurns: conversations.readTurns,
    itemsHtml: convPage.itemsHtml, gitInfo: outside.gitInfo, openInClaude: claude.openInClaude, findClaude: claude.findClaude,
    pickTerminal: claude.pickTerminal, focusTabCommand: claude.focusTabCommand, projectId: firebase.projectId,
    makeStash: stash.makeStash, readEntry: stash.readEntry, fileFor: stash.fileFor, branchWork: backlog.branchWork,
  };
  assert.deepEqual(Object.keys(unstable).sort(), Object.keys(own).sort());
  for (const [k, f] of Object.entries(own)) assert.equal(unstable[k], f, k);
});

test('homequarters/testing exports HQ\'s own readers, and start and NO_TOOLS', () => {
  const own = {
    loadManifest: manifest.loadManifest, loadPlugins: plugins.loadPlugins, setNav: page.setNav, demoConfig: demo.demoConfig,
    demoFacts: demo.demoFacts, demoSettings: demo.demoSettings, runInfo: runInfo.runInfo, readLaptopRuns: runs.readLaptopRuns,
    loadDecisions: decisions.loadDecisions, dailyAsOf: dora.dailyAsOf,
  };
  assert.deepEqual(Object.keys(testing).sort(), [...Object.keys(own), 'start', 'NO_TOOLS'].sort());
  for (const [k, f] of Object.entries(own)) assert.equal(testing[k], f, k);
});

test("testing's start writes no link file, ignores HQ_DEMO, finds no claude and asks NO_TOOLS", async t => {
  const home = mkdtempSync(join(tmpdir(), 'hq-testing-start-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const repo = join(home, 'app');
  mkdirSync(join(repo, 'web'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# app\n');
  writeFileSync(join(repo, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'app', link: 'web/.hq.json' }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { env });
  execFileSync('git', ['-C', repo, 'add', '.'], { env });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'first'], { env });
  const { m } = manifest.loadManifest(repo, { home, env: {} });
  assert.ok(m.link, 'the manifest names a link file, so a plain start would write it');
  const was = process.env.HQ_DEMO;
  process.env.HQ_DEMO = '1';
  t.after(() => { if (was === undefined) delete process.env.HQ_DEMO; else process.env.HQ_DEMO = was; });
  const srv = await testing.start({ repo, m });
  try {
    assert.equal(existsSync(join(repo, 'web', '.hq.json')), false, 'the link file is never written');
    const home1 = await (await fetch(`${srv.url}/`)).text();
    assert.doesNotMatch(home1, /hq-wordmark/, 'no demo header');
    const status = await (await fetch(`${srv.url}/claude/status`)).json();
    assert.equal(status.installed, false);
    const machine = await (await fetch(`${srv.url}/machine`)).text();
    assert.match(machine, /data-found="no"/, 'the tools are listed');
    assert.doesNotMatch(machine, /data-found="yes"/, 'and none is found');
  } finally { await srv.close(); }
  assert.equal(existsSync(join(repo, 'web', '.hq.json')), false, 'and none is left behind');
});
