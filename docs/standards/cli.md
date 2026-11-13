# The command line, `hq`

This is the command line a project may build on: every command `bin/hq.mjs` takes, its flags, its exit codes, and the environment names HQ reads. A Makefile, a workflow or a script that calls `hq` as written here keeps working within a major version. `test/contract-docs.test.mjs` holds this page to the code: a command or an `HQ_` name the code reads and this page leaves out fails it.

## Everywhere

- The repo is `--repo DIR` when given, else `HQ_REPO`, else the git checkout the current folder is in, else the current folder. `hq setup`, `hq serve` and `hq check` refuse a `--repo` that is not a folder, with exit 2.
- The cache and the stores come from the repo's `hq.json` ([manifest.md](manifest.md)).
- `hq --version` prints the package's version. `hq --help`, `hq help` and `hq <command> --help` print the command list and exit 0; `hq problem --help` prints the problem writer's own usage, with its kinds and stages.
- An unknown command exits 2.

## Exit codes

| Code | Means |
| --- | --- |
| 0 | done, or nothing to do |
| 1 | the command found what it exists to find: a broken contract (`check`), a disk too full to start a run (`space`), a refused event (`problem`), a server that could not start (`serve`) |
| 2 | the command line was wrong: an unknown command or subcommand, missing arguments, `--repo` not a folder |
| 3 | `hq slot` would not take or claim the slot: someone else holds it and `LOCK_WAIT` ran out, or was 0 |

A run of `hq dora` on CI exits with the fetch's own status when the fetch fails, so a workflow sees it.

## `hq serve`

`hq [serve] [--port N] [--repo DIR]` starts HQ for the repo on 127.0.0.1. With no port it takes 8780, or the next free one up to 20 above, and the start line says when it moved. `--port N` or `HQ_PORT=N` takes that port as it is, and 0 takes any free one. It prints `HQ <version> for <name>: <url>`, then any warning about the manifest or a plugin, and runs until Ctrl-C, SIGTERM or SIGHUP, which exit 0. It exits 1 when the server cannot start.

When the manifest names `link`, the server writes `{"url": "<url>", "pid": <pid>}` there before the start line and removes it as it stops, unless a newer HQ has written its own since. `HQ_DEMO=1` turns on the demo setting, for filming.

## `hq setup`

`hq setup [--repo DIR]` scans the repo and the machine and prints a proposed `hq.json`, a proposed `tests/sets.json` when the Makefile names its sets, and the make lines to add. It writes nothing and exits 0.

## `hq check`

`hq check [--repo DIR] [--demo]` checks the repo against the contract its manifest turns on ([contract.md](contract.md)). The first line is `HQ <version>`. Each problem is named under its area, and the command exits 1 when there is any, 0 when there is none. A repo with no `hq.json` has nothing to check and exits 0.

Notes are printed and never counted: a manifest or convention file newer than this HQ, and a `homequarters` pin in the repo's `package.json` at another major version than the HQ running.

`--demo` also starts HQ's server with the demo setting, on a free port, and renders every page in the nav, every backlog item, and every tracked file that holds a name the setting should hide, as its page and as a raw file. A page that holds one of those names is a problem, named as `<page>: <name>`. So is a file the setting hides that still answers, and a plugin kept out of the demo that still answers. The names are each git author's (first and last), their email addresses, the home folder, the GitHub owner and repo, the project's name beside "HQ", the laptop's `private` list in `<cache>/hq/demo.json`, and `HQ_DEMO_PRIVATE`. It writes nothing: no link file, HQ's own cache in a scratch folder, and GitHub, Firebase and claude refused rather than asked.

## `hq slot`

One test run at a time on this machine ([slot.md](slot.md)).

| Subcommand | Does | Exits |
| --- | --- | --- |
| `take <name>` | waits its turn, then holds the slot for the run named | 0 when taken; 3 when `LOCK_WAIT` runs out |
| `release <name> <status>` | gives the slot back with the run's exit status | 0 |
| `who` | who holds it, who waits, each session's line, test containers running | 0 |
| `status [msg]` | with no message, the same as `who`; with one, posts this session's line | 0 |
| `claim [why]` | keeps the slot across several runs | 0; 3 when someone else's run or claim holds it |
| `unclaim [force]` | lets a claim go; `force` lets someone else's go | 0; 3 for someone else's claim without `force` |

The slot stands aside, exiting 0 for `take`, `release`, `claim` and `unclaim`, on GitHub-hosted CI, with `HQ_SLOT=0`, and inside a test container (`HQ_IN_CONTAINER=1`).

Coming in 0.1.0: `hq slot --extra '<json>'`, and `HQ_SLOT_EXTRA`, add a project's own fields to the slot record, as QuestKeep's `tests`, `junit`, `place` and `kind`. The writers agent is adding them.

## `hq run-info`

`hq run-info <kind> [--json FILE] [--extra '<json>'] [--repo DIR]` prints the `=== run {json}` line a recorded run starts with ([runs.md](runs.md)), or with `--json` writes the record to FILE, making its folder. Warnings go to stderr. It exits 0.

`--extra` adds a project's own facts to the record. Today they never replace HQ's own fields. Coming in 0.1.0: `--extra` wins over HQ's defaults (decision 11), so a project can pass `runner`, `target`, `half`, `hash`, `lanes` and its own facts through it. The writers agent is making that change.

## `hq ci-keep`

`hq ci-keep <results> <name> [--repo DIR]` copies a self-hosted runner job's results folder into the ci store under `<name>` (QuestKeep's names are `junit-<run>-<attempt>-<kind>`). It prints what it kept, or why it kept nothing, and exits 0 either way, so a job's last step never fails the job. `HQ_CI_DIR` points at another ci store.

## `hq ci-fetch`

`hq ci-fetch [<folder>] [--repo DIR]` downloads the `junit-*` artifacts a workflow uploaded into the ci store, or the folder given, one folder per artifact, skipping any already there. It uses `gh` and its login. With no `gh`, no git remote or no login it says so and exits 0.

## `hq problem`

`hq problem note|set|close|reopen|merge|redact ... [--repo DIR]` appends one event to the problem register ([problems.md](problems.md)). `hq problem --help` lists the subcommands, the fields, the kinds and the stages. A refused event writes nothing and exits 1; a missing subcommand exits 2. `HQ_PROBLEMS_DIR` points at another problems store, and `HQ_AGENT` names the agent writing.

## `hq problem-backfill`

`hq problem-backfill red-gates [<file>] [--write] [--repo DIR]` imports a sort of red gate runs into the problem register. Without `--write` it prints what it would write. Any other subcommand exits 2.

## `hq backlog`

`hq backlog [--repo DIR]` prints the backlog the manifest names: ready (oldest ask first), in progress, blocked and on what, and the inbox. A manifest with no `backlog` gets a sentence naming the key. It exits 0.

## `hq dora`

`hq dora [--no-fetch] [--no-fetch-git] [--no-daily] [--quiet] [--repo DIR]` fetches what is new from GitHub, works out the delivery figures, prints them, and writes `dora/dora.json` in the cache with a dated copy in `dora/daily/`.

- `--no-fetch` uses only what the cache holds, with no `gh`.
- `--no-fetch-git` skips `git fetch origin main`.
- `--no-daily` writes `dora.json` alone.
- `--quiet` prints one line.

`HQ_CACHE` points it at another cache folder.

## `hq space`

The free-space check before a test run. It stands aside on GitHub-hosted runners.

| Subcommand | Does | Exits |
| --- | --- | --- |
| `host` | measures this machine's disks before a run; warns below `HQ_SPACE_WARN_GB` (20) free | 1 below `HQ_SPACE_FAIL_GB` (5) free, else 0; 0 inside a test container |
| `figures` | prints the host's figures as one line of JSON, to hand a container | 0 |
| `vm` | inside the container, measures the Docker VM's disk with the host's figures from `HQ_SPACE_HOST` | 1 to stop the run, else 0 |

## `hq machine`

`hq machine` prints what the machine is doing now as JSON: the block each run records ([machine.md](machine.md)). It exits 0.

## Environment

Every `HQ_` name the package reads. The `QK_` names in the second column are QuestKeep's, read as well for one release, until 0.2.0; the `HQ_` name wins when both are set.

| Name | Read by | Also read as | Means |
| --- | --- | --- | --- |
| `HQ_REPO` | every command | | the repo, when `--repo` is not given |
| `HQ_PORT` | `serve` | | the port, taken as it is; 0 is any free one |
| `HQ_DEMO` | `serve` | | `1` turns on the demo setting |
| `HQ_DEMO_PRIVATE` | `check --demo` | | more names the demo must hide, comma separated |
| `HQ_EDITOR` | `serve` | | the editor link template, with `{path}` and `{line}`; default `vscode://file/{path}:{line}` |
| `HQ_TERMINAL` | `serve` | | the terminal Open in Claude uses on macOS |
| `HQ_CACHE` | `dora` | `QK_CACHE` | another cache folder than the manifest's |
| `HQ_SLOT_DIR` | `slot` | `QK_LOCK_DIR` | another lock store than the manifest's |
| `HQ_SLOT` | `slot` | `QK_LOCK` | `0` makes the slot stand aside |
| `HQ_SLOT_WAIT` | `slot take` | `LOCK_WAIT` | minutes to wait for the slot; 0 fails at once with exit 3 |
| `HQ_SLOT_PID` | `slot` | `QK_LOCK_PID` | the process that holds the slot, when it is not hq's parent |
| `HQ_SLOT_POLL_MS` | `slot take` | `QK_LOCK_POLL_MS` | how often a waiter looks again; default 2000 |
| `HQ_SLOT_EXTRA` | `slot` | | coming in 0.1.0: a project's own fields for the slot record, as JSON |
| `HQ_AGENT` | `slot`, `run-info`, `problem` | `QK_AGENT` | an agent started by another agent names itself |
| `HQ_WHO` | `slot` | `QK_WHO` | the name a run without a Claude session goes by; default `$USER` |
| `HQ_NO_DOCKER` | `slot` | `QK_NO_DOCKER` | set, the slot does not look for test containers |
| `HQ_TEST_IMAGE` | `slot` | `QK_TEST_IMAGE` | the image whose containers count as test runs |
| `HQ_IN_CONTAINER` | `slot`, `space` | `QK_IN_CONTAINER` | `1` inside a test container: the host already took the slot and checked the disk |
| `HQ_SPACE_WARN_GB` | `space` | `QK_SPACE_WARN_GB` | the free space under which a run warns; default 20 |
| `HQ_SPACE_FAIL_GB` | `space` | `QK_SPACE_FAIL_GB` | the free space under which a run is not started; default 5 |
| `HQ_SPACE_HOST` | `space vm` | `QK_SPACE_HOST` | the host's figures, from `hq space figures` |
| `HQ_KIND` | `run-info` | `QK_KIND` | the kind, over the argument |
| `HQ_WHERE` | `run-info` | `QK_WHERE` | laptop, container or ci, when the kind alone cannot say |
| `HQ_BRANCH` | `run-info` | `QK_BRANCH` | the branch, for a detached checkout |
| `HQ_COMMIT` | `run-info` | `QK_COMMIT` | the commit on CI, where a pull request's checkout is a merge commit |
| `HQ_LANES` | `run-info` | `QK_LANES` | how many tests ran side by side |
| `HQ_OUT` | `run-info` | `QK_OUT` | the run's folder of test files |
| `HQ_PARTIAL` | `run-info` | `QK_PARTIAL` | `1` when the run named its own tests, so it ran part of a set |
| `HQ_CI_DIR` | `ci-keep` | `QK_CI_DIR` | another ci store than the manifest's |
| `HQ_PROBLEMS_DIR` | `problem`, `problem-backfill` | `QK_PROBLEMS_DIR` | another problems store than the manifest's |

Two names only the package's own tests read: `HQ_OFFLINE=1` skips the tests that need the npm registry, and `HQ_RACE_ROUNDS` sets how many rounds the slot's race tests run.
