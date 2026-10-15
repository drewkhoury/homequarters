// What `hq setup` and the Machine page find: the software on this machine, with versions and logins, and what in the repo
// looks like one of HQ's conventions. Nothing here reads a folder's contents beyond checking it is there, and nothing
// is written: setup prints a proposed manifest and make lines for the person to add themselves.
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { SCHEMA, FILE, nameFrom, defaultCache } from './manifest.mjs';

const run = (cmd, args, { timeout = 4000 } = {}) => new Promise(done =>
  execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (e, out, err) => done({ ok: !e, out: String(out || ''), err: String(err || ''), code: e ? e.code : 0 })));
const firstLine = s => String(s || '').trim().split('\n')[0];
const version = s => (String(s).match(/\d+\.\d+(\.\d+)?/) || [''])[0];

// The software HQ or a project's Makefile may use: name, how to ask its version, and what it is for.
export const SOFTWARE = [
  { id: 'node', cmd: 'node', args: ['--version'], about: 'runs HQ' },
  { id: 'git', cmd: 'git', args: ['--version'], about: 'the repo, worktrees and history' },
  { id: 'make', cmd: 'make', args: ['--version'], about: 'the project\'s entry points' },
  { id: 'gh', cmd: 'gh', args: ['--version'], about: 'GitHub: pull requests, runs, deploys', login: ['auth', 'status'] },
  { id: 'docker', cmd: 'docker', args: ['--version'], about: 'test containers', engine: true },
  { id: 'devpipe', cmd: 'devpipe', args: ['--version'], about: 'records test runs' },
  { id: 'claude', cmd: 'claude', args: ['--version'], about: 'Chat and Open in Claude' },
  { id: 'java', cmd: 'java', args: ['-version'], about: 'some emulators need it' },
  { id: 'gcloud', cmd: 'gcloud', args: ['--version'], about: 'Google Cloud and Firebase Hosting', login: ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'] },
  { id: 'firebase', cmd: 'firebase', args: ['--version'], about: 'Firebase deploys' },
  { id: 'python3', cmd: 'python3', args: ['--version'], about: 'the status line' },
];

// Which Docker engine answers: OrbStack, Colima, Docker Desktop, or something else, from `docker info`'s name and context.
export function engineOf(info) {
  const s = String(info || '');
  if (/orbstack/i.test(s)) return 'OrbStack';
  if (/colima/i.test(s)) return 'Colima';
  if (/docker desktop/i.test(s)) return 'Docker Desktop';
  if (/podman/i.test(s)) return 'Podman';
  return s.trim() ? 'another engine' : null;
}

// Every tool, asked in parallel: { id, about, found, version, line, login?, engine? }.
export async function scanSoftware({ list = SOFTWARE, exec = run } = {}) {
  return Promise.all(list.map(async t => {
    const r = await exec(t.cmd, t.args);
    const line = firstLine(r.out) || firstLine(r.err);
    const found = r.ok || (r.code !== 'ENOENT' && !!line && !/not found/i.test(line));
    const out = { id: t.id, about: t.about, found, version: found ? version(line) : '', line: found ? line : '' };
    if (found && t.login) {
      const l = await exec(t.cmd, t.login);
      const text = `${l.out}\n${l.err}`;
      out.login = /Logged in to|Logged in as|@/.test(text) ? (text.match(/account\s+(\S+)|Logged in as\s+(\S+)|^(\S+@\S+)$/m) || []).slice(1).find(Boolean) || 'logged in' : 'not logged in';
    }
    if (found && t.engine) {
      const i = await exec(t.cmd, ['info', '--format', '{{.Name}} {{.OperatingSystem}} {{.ServerVersion}}'], { timeout: 6000 });
      out.engine = i.ok ? engineOf(`${i.out}`) || 'running' : 'not running';
      if (i.ok) out.engineLine = firstLine(i.out);
    }
    return out;
  }));
}

const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = p => { try { return statSync(p).isFile(); } catch { return false; } };

// What the repo has that HQ could read, by presence only, each with the manifest key it would fill.
export function scanRepo(repo, { home = homedir() } = {}) {
  const name = basename(repo);
  const found = [];
  const has = (rel, key, note) => { const p = join(repo, rel); const ok = rel.endsWith('/') ? isDir(p) : isFile(p); if (ok) found.push({ rel, key, note }); return ok; };
  has('README.md', 'docs.home', 'the Home page opens on it');
  has('docs/backlog/', 'backlog.dir', 'one markdown file per item, in stage folders');
  has('docs/BACKLOG.md', 'backlog.earlier', 'the earlier one-file backlog, read for history');
  has('hq/backlog-map.json', 'backlog.map', 'old titles mapped to items');
  has('docs/decisions/', 'decisions.dir', 'one dated file per decision');
  has('docs/DECISIONS.md', 'decisions.earlier', 'the earlier one-line decisions file');
  has('tests/layers.json', 'tests.layers', 'what each kind of test proves');
  has('hq/pipeline.json', 'tests.pipeline', 'how a change reaches production');
  has('tests/sets.json', 'tests.sets', 'which tests make up each set a run can be');
  has('hq/groups.json', 'docs.groups', 'the groups the file tree narrows to');
  has('hq/demo.json', 'demo', 'the demo setting for filming');
  has('devpipe.toml', 'stores:runs', 'devpipe records runs; HQ reads them from the cache');
  has('Makefile', null, 'make targets can call hq to record runs');
  has('.git/project-info.json', 'info', 'the status line\'s file; HQ reads it too');
  const caches = [join(home, '.cache', name), join(home, '.cache', 'hq', name)].filter(isDir);
  const stores = [];
  for (const c of caches) for (const s of ['runs', 'lock', 'problems', 'dora', 'ci']) if (isDir(join(c, s))) stores.push({ cache: c, store: s });
  let remote = null;
  try { const cfg = readFileSync(join(repo, '.git', 'config'), 'utf8'); const m = /url = .*github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?\s/.exec(cfg); if (m) remote = m[1]; } catch { /* not a repo, or no remote */ }
  return { name, found, caches, stores, remote, manifest: existsSync(join(repo, FILE)) };
}

// The manifest setup proposes from a scan: only what was found, so nothing points at a folder that is not there.
export function proposeManifest(scan) {
  const m = { schemaVersion: SCHEMA, name: nameFrom(scan.name) };
  const keys = new Set(scan.found.map(f => f.key));
  // the cache is always written, so the default is never relied on and two repos with one name never share one
  m.cache = (scan.caches[0] || defaultCache(m.name)).replace(homedir(), '~');
  if (keys.has('docs.groups')) m.docs = { home: 'README.md', groups: 'hq/groups.json' };
  if (keys.has('backlog.dir')) m.backlog = { dir: 'docs/backlog', stages: ['inbox', 'next', 'parked'], ...(keys.has('backlog.map') ? { map: 'hq/backlog-map.json' } : {}), ...(keys.has('backlog.earlier') ? { earlier: 'docs/BACKLOG.md' } : {}) };
  if (keys.has('decisions.dir')) m.decisions = { dir: 'docs/decisions', ...(keys.has('decisions.earlier') ? { earlier: 'docs/DECISIONS.md' } : {}) };
  if (keys.has('tests.layers') || keys.has('tests.pipeline') || keys.has('tests.sets')) m.tests = { ...(keys.has('tests.layers') ? { layers: 'tests/layers.json' } : {}), ...(keys.has('tests.pipeline') ? { pipeline: 'hq/pipeline.json' } : {}), ...(keys.has('tests.sets') ? { sets: 'tests/sets.json' } : {}) };
  const stores = [...new Set(scan.stores.filter(s => s.cache === scan.caches[0]).map(s => s.store))];
  if (stores.length) m.stores = stores;
  if (keys.has('info')) m.info = true;
  if (keys.has('demo')) m.demo = 'hq/demo.json';
  return m;
}

// The make lines setup suggests: every hq call falls through when hq is not installed, so the Makefile works without it.
export const MAKE_SNIPPET = `# HomeQuarters: records runs and shows them at http://127.0.0.1:8780. Optional: with no hq installed, a recording line
# does nothing, and a broken hq never fails your tests. A check line (the free space) runs only when hq is there and keeps
# hq's own exit. A guard line (the test slot) is different: it must stop the run when hq is missing, since two gates at
# once is what it exists to prevent; on CI there is no shared machine to guard, so there it stands aside, as hq slot does.
HQ := $(shell command -v hq 2>/dev/null)
hq-record = $(if $(HQ),($(HQ) $(1) || true),true)
hq-check = $(if $(HQ),$(HQ) $(1),true)
hq-guard = $(if $(HQ),$(HQ) $(1),$(if $(CI),true,{ echo "hq is not installed, and $(1) guards this run: npm install -g homequarters" >&2; exit 1; }))

.PHONY: hq
hq: ## HQ, a local website for this repo (Ctrl-C stops it)
	@$(if $(HQ),$(HQ),echo "hq is not installed: npm install -g homequarters")

test: ## The tests, recorded when hq is installed
	@$(call hq-record,run-info test) && <your test command>

# A run that needs the machine to itself (a browser, a test container) takes the slot first and gives it back however it
# ends: its exit status is kept, and a Ctrl-C or a closed terminal ends with 130. LOCK_WAIT=0 fails at once instead of waiting.
hq-slot = $(call hq-guard,slot take $(1)) && { trap '$(if $(HQ),$(HQ) slot release $(1) $$?,:)' EXIT; trap 'exit 130' HUP INT TERM; $(2); }

browser-test: ## A browser test, one at a time on this machine
	@$(call hq-slot,browser-test,<your browser test command>)
`;
