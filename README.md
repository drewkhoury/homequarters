# HomeQuarters

HQ is a local website for keeping up with your own repo: what changed and why, what guards it, and what is next. It runs on your laptop at http://127.0.0.1:8780 and only your laptop can reach it. It reads what your project writes and runs no code from it.

This is the experiment that takes HQ out of QuestKeep, where it was built. `docs/BRIEF.md` is the product brief with the decisions behind it.

## Install

```sh
npm install -g homequarters    # or: npx homequarters
```

Node 20 or later. Nothing else is needed for the baseline; `gh`, `docker`, `devpipe` and `claude` light up more when they are there.

## Run

```sh
hq            # in any git repo: start HQ for it
hq setup      # what HQ found in the repo and on this machine, and the hq.json it would propose
hq check      # the contract, checked: what breaks the conventions hq.json names (backlog, decisions, groups, pipeline, sets, layers, test headers); exit 1 if anything
hq machine    # what the machine is doing now, as JSON
hq problem note --title "..." --kind <kind> --evidence <pointer>   # write to the problem register (hq problem --help)
hq slot take <name> | release <name> <status> | who | status <msg> | claim <why> | unclaim   # one test run at a time
hq space host | figures | vm      # free space on the disks a test run fills; exit 1 stops the run
hq ci-keep <results> <name>       # keep a self-hosted runner job's results in the ci store as the job ends
hq backlog                        # the backlog in the terminal: ready, in progress, blocked, inbox
hq dora [--no-fetch] [--quiet]    # the delivery figures: fetch from GitHub, work them out, write the dora store
hq ci-fetch [<folder>]            # download the CI results a workflow kept as junit-* artifacts into the ci store
```

With no `hq.json`, HQ shows the baseline: Home (the files and docs, with search), Repo (git state and worktrees), Machine (this computer, the software found, and the manifest HQ would propose), GitHub (when the remote is GitHub and `gh` is logged in), Conversations (Claude Code's transcripts for this folder) and Export.

## The manifest

`hq.json` at the repo root says what else HQ may read. HQ reads no folder the manifest does not name. Every key but `schemaVersion` and `name` is optional, and a missing key turns its page off.

```json
{
  "schemaVersion": 1,
  "name": "questkeep",
  "cache": "~/.cache/questkeep",
  "docs": { "home": "README.md", "groups": "hq/groups.json" },
  "backlog": { "dir": "docs/backlog", "stages": ["inbox", "next", "parked"], "map": "hq/backlog-map.json", "earlier": "docs/BACKLOG.md" },
  "decisions": { "dir": "docs/decisions", "earlier": "docs/DECISIONS.md" },
  "tests": { "layers": "tests/layers.json", "pipeline": "hq/pipeline.json", "sets": "tests/sets.json" },
  "stores": ["runs", "lock", "problems", "dora", "ci"],
  "info": true,
  "deploy": [{ "provider": "firebase-hosting", "site": "https://questkeep.web.app" }],
  "delivery": { "userPaths": ["web"], "deployWorkflow": ".github/workflows/deploy.yml", "testWorkflow": ".github/workflows/test.yml", "tz": "America/New_York" },
  "plugins": ["./hq-plugins/launch.mjs"],
  "demo": "hq/demo.json"
}
```

| Key | Turns on |
|---|---|
| `docs` | where Home opens, and the groups the file tree narrows to |
| `backlog` | the Backlog page: one markdown file per item in stage folders |
| `decisions` | the Decisions page: one dated file per decision, and an earlier one-line file |
| `tests` | the Testing page's layers, pipeline and sets (`docs/standards/`) |
| `stores` | which folders under `cache` HQ reads: runs, lock, problems, dora, ci |
| `info` | the status line's `.git/project-info.json` |
| `deploy` | deploy providers; `firebase-hosting` is the first |
| `delivery` | the Delivery figures: which paths count as reaching users, which workflows deploy and test, and the time zone |
| `plugins` | pages the project adds (below) |
| `demo` | the demo setting for filming |

`schemaVersion` is a whole number. HQ reads every manifest from 1 up to the schema it knows; a newer one is read with a warning and its unknown keys are listed on the Machine page and left alone. A key, once published, is never renamed or removed.

## Plugins

A plugin is an ES module the manifest names. Its default export takes `{ ui, m }` and answers `{ id, label, path, page(ctx, params, rest), actions?, demo? }`. `ui` is the only API HQ promises: the page frame, escaping, the info mark, tables, charts, markdown, and `git` and `gh` run read-only (`lib/ui-api.mjs`). A plugin that fails to load is reported on the Machine page and left out.

## Recording runs

HQ is the recorder, never a dependency of your tests. `hq setup` proposes make lines where every recording call falls through when `hq` is not installed or fails. The one exception is the test slot: `hq slot take` is a guard, so the proposed slot line stops the run with the install command when `hq` is missing, since two browser runs at once is what the slot prevents. `test/make-snippet.test.mjs` proves both. `docs/standards/slot.md` says what the slot writes.

## Tests

```sh
npm test
```
