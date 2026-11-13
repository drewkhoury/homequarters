# HomeQuarters

HQ is a local website for keeping up with your own repo: what changed and why, what guards it, and what is next. It runs on your laptop at http://127.0.0.1:8780 and only your laptop can reach it. It reads what your project writes and runs no code from it.

HQ was built inside QuestKeep and left it as this package on 14 October 2026. The product brief with the decisions behind it is `docs/BRIEF.md` in the repo, with the data standards under `docs/standards/` and the reviews under `docs/reviews/`; the npm package ships the code, not those docs.

## Install

```sh
npm install -g homequarters    # once it is on npm; until then, from a checkout:
git clone https://github.com/drewkhoury/homequarters.git
npm install -g ./homequarters  # or: npm pack ./homequarters && npm install -g homequarters-0.1.0.tgz
```

The command is `hq`, but the package is `homequarters`. The `hq` package on npm and the `hq` formula in Homebrew core are other, unrelated projects, so `npm install -g hq` and `brew install hq` install something else.

Node 22 or later. Nothing else is needed for the baseline; `git` for the Repo page, and `gh`, `docker`, `devpipe` and `claude` light up more when they are there.

## Run

```sh
hq                         # in any git repo: start HQ for it, on 8780 or the next free port
hq --port 8790             # a port of your own; HQ_PORT=8790 does the same
hq --repo ~/code/other     # a repo other than the one you are in (every command takes --repo, or HQ_REPO)
hq setup                   # what HQ found in the repo and on this machine, the hq.json it proposes, and make lines
hq check                   # the contract, checked: docs/standards/contract.md lists every rule; exit 1 if anything is broken
hq machine                 # what the machine is doing now, as JSON
hq backlog                 # the backlog in the terminal: ready, in progress, blocked, inbox
hq problem note --title "..." --kind <kind> --evidence <pointer>   # write to the problem register (hq problem --help)
hq slot take <name> | release <name> <status> | who | status <msg> | claim <why> | unclaim   # one test run at a time
hq space host | figures | vm       # free space on the disks a test run fills; exit 1 stops the run
hq run-info <kind>                 # the `=== run {json}` line a recorded run starts with
hq ci-keep <results> <name>        # keep a self-hosted runner job's results in the ci store as the job ends
hq ci-fetch [<folder>]             # download the CI results a workflow kept as junit-* artifacts into the ci store
hq dora [--no-fetch] [--quiet]     # the delivery figures: fetch from GitHub, work them out, write the dora store
```

HQ keeps what it writes for a repo under one cache folder: the manifest's `cache`, else `$XDG_CACHE_HOME/hq/<name>` or `~/.cache/hq/<name>`; `HQ_CACHE` points one run elsewhere. A bare `hq` writes its own conversation index and health notes there, and nothing else.

With no `hq.json`, HQ shows the baseline: Home (the files and docs, with search, and on a first run a card saying what HQ found and the manifest it would propose), Repo (git state and worktrees), Machine (this computer, the software found, and the manifest HQ would propose), GitHub (when the remote is GitHub), Conversations (Claude Code's transcripts for this folder) and Export.

## The manifest

`hq.json` at the repo root says what else HQ may read. HQ reads no folder the manifest does not name. Every key but `schemaVersion` and `name` is optional, and a missing key turns its page off. The smallest one, which is what `hq setup` proposes for a repo with none of the conventions below:

```json
{ "schemaVersion": 1, "name": "hello", "cache": "~/.cache/hq/hello" }
```

A full one: QuestKeep's own, as an example. Its paths, job names and plugin are QuestKeep's; a project names its own.

```json
{
  "schemaVersion": 1,
  "name": "questkeep",
  "cache": "~/.cache/questkeep",
  "docs": { "home": "README.md", "groups": "hq/groups.json" },
  "backlog": { "dir": "docs/backlog", "stages": ["inbox", "next", "parked"], "map": "hq/backlog-map.json", "earlier": "docs/BACKLOG.md" },
  "decisions": { "dir": "docs/decisions", "earlier": "docs/DECISIONS.md" },
  "tests": { "layers": "tests/layers.json", "pipeline": "hq/pipeline.json", "sets": "tests/sets.json", "headers": ["tests/*.js"] },
  "stores": ["runs", "lock", "problems", "dora", "ci"],
  "info": true,
  "deploy": [{ "provider": "firebase-hosting", "site": "https://questkeep.web.app" }],
  "delivery": { "userPaths": ["web"], "deployWorkflow": ".github/workflows/deploy.yml", "testWorkflow": ".github/workflows/test.yml", "tz": "America/New_York",
                "gateJobs": ["test", "test (a)", "test (b)", "laptop"], "deployJob": "deploy", "smokeJob": "smoke", "deploySteps": ["Deploy to production", "Run make deploy"], "reuseSteps": ["Reuse a gate that passed"], "testSteps": ["Run the tests"] },
  "plugins": ["./hq-plugins/launch.mjs"],
  "demo": "hq/demo.json"
}
```

| Key | Turns on |
|---|---|
| `docs` | where Home opens, and the groups the file tree narrows to |
| `backlog` | the Backlog page: one markdown file per item in stage folders |
| `decisions` | the Decisions page: one dated file per decision, and an earlier one-line file |
| `tests` | the Testing page's layers, pipeline and sets (`docs/standards/`); `headers` turns on the test-header rules for the tests the sets name |
| `stores` | which folders under `cache` HQ reads: runs, lock, problems, dora, ci |
| `info` | the status line's `.git/project-info.json` |
| `deploy` | deploy providers; `firebase-hosting` is the first |
| `delivery` | the Delivery figures: which paths count as reaching users, which workflows deploy and test, the time zone, and the GitHub job and step names that mark the gate, the deploy and a reused gate (with none, a deploy is any successful deploy run) |
| `plugins` | pages the project adds (below) |
| `demo` | the demo setting for filming |

`schemaVersion` is a whole number. HQ reads every manifest from 1 up to the schema it knows; a newer one is read with a warning, its unknown keys are listed on the Machine page and left alone, and `hq check` counts neither as a problem. A key, once published, is never renamed or removed; `CHANGELOG.md` says what each version changes.

## Plugins

A plugin is an ES module the manifest names. Its default export takes `{ ui, m }` and answers `{ id, label, path, page(ctx, params, rest), actions?, demo? }`. `ui` is the only API HQ promises across versions: the page frame, escaping, the info mark, tables, charts, markdown, and `git` and `gh`, which HQ itself only ever calls to read (`lib/ui-api.mjs` in the repo). A plugin imports the API from `homequarters`. It may import the package's internals too, as `homequarters/internal/lib/<file>.mjs`; those are stable per exact version only, so pin `homequarters` exactly if it does. A bare `homequarters/lib/...` is refused by the package's `exports` map. A plugin that fails to load is reported on the Machine page and left out.

## Recording runs

HQ shows runs; devpipe records them. `hq run-info <kind>` prints the `=== run {json}` line a recorded run starts with, and devpipe, when it runs your tests, keeps the run under the cache's `runs` store for HQ to read. Without devpipe the line is printed and nothing is kept. `hq setup` proposes make lines where every such call falls through when `hq` is not installed or fails, so HQ is never a dependency of your tests. The one exception is the test slot: `hq slot take` is a guard, so the proposed slot line stops the run with the install command when `hq` is missing, since two browser runs at once is what the slot prevents; on hosted CI it stands aside. `test/make-snippet.test.mjs` in the repo proves both, and `docs/standards/slot.md` says what the slot writes.

## Tests

```sh
npm test                       # about seven seconds; needs node, git, npm and the npm registry once (the pack test)
HQ_OFFLINE=1 npm test          # skips the pack test, the one that reaches the registry
HQ_RACE_ROUNDS=5 npm test      # more rounds of the slot's dead-holder race; `npm publish` runs this first
```

The tests make git commits in scratch repos, so git needs an identity: `user.name` and `user.email` in your git config, or `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` in the environment, as CI sets them. `CONTRIBUTING.md` says how to run them without touching your own cache.
