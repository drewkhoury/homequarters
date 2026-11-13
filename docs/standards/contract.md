# The contract

What HQ asks of a project, in one list, and whether `hq check` checks it. HQ reads what the manifest names and nothing
else; a rule applies only when its key is in `hq.json`. A rule marked *checked* makes `hq check` exit 1 when broken; one
marked *read* is applied when HQ reads the file, with a warning on the Machine page, and never fails a check.

## The five surfaces

Everything a project may build on. Each has one doc that says it and tests that hold the code to the doc. A change to a surface is a change to its doc in the same commit, and a breaking one waits for a major version.

| # | Surface | Doc | Tests |
|---|---|---|---|
| 1 | The manifest, `hq.json` schema 1, and its JSON Schema [`schema/hq.schema.json`](../../schema/hq.schema.json) | [manifest.md](manifest.md) | [manifest](../../test/manifest.test.mjs), [manifest-schema](../../test/manifest-schema.test.mjs), [check](../../test/check.test.mjs) |
| 2 | The convention files the manifest names, which HQ only reads, and the link file, the one file HQ writes in the repo | this page, [pipeline.md](pipeline.md), [sets.md](sets.md) | [check](../../test/check.test.mjs), [schema](../../test/schema.test.mjs), [link](../../test/link.test.mjs), [check-demo](../../test/check-demo.test.mjs) |
| 3 | The stores under the cache: each record carries a `v`, readers tolerate one version behind, and projects add fields through the pass-throughs | [runs.md](runs.md), [slot.md](slot.md), [problems.md](problems.md), [machine.md](machine.md) | [run-info](../../test/run-info.test.mjs), [slot](../../test/slot.test.mjs), [problem-writer](../../test/problem-writer.test.mjs), [ci-keep](../../test/ci-keep.test.mjs), [dora](../../test/dora.test.mjs) |
| 4 | The command line: every command, flag and exit code, and the `HQ_` environment names with their `QK_` aliases for one release | [cli.md](cli.md) | [startup](../../test/startup.test.mjs), [pack](../../test/pack.test.mjs), [check-version](../../test/check-version.test.mjs), [contract-docs](../../test/contract-docs.test.mjs) |
| 5 | The plugin API: a module exporting `hqApi: 1` whose default export receives the `ui` object | [plugins.md](plugins.md) | [plugins](../../test/plugins.test.mjs), [contract-docs](../../test/contract-docs.test.mjs) |

The rest of this page lists the rules for the first two surfaces, and whether `hq check` checks each.

## The manifest (`hq.json`, [manifest.md](manifest.md))

| Rule | hq check |
|---|---|
| `schemaVersion` is a whole number from 1; a newer one is read with a note | note, not a problem |
| `name` matches `^[a-z0-9][a-z0-9-]*$`; a missing one is warned and the folder's name used | checked |
| every key, at the top and inside `docs`, `backlog`, `decisions`, `tests`, `delivery` and `info`, is one HQ knows | checked (a note when the schema is newer) |
| a list key (`stores`, `deploy`, `plugins`, `backlog.stages`, `tests.headers`) holds strings or objects | checked |
| a store is one of runs, lock, problems, dora, ci | checked |
| a deploy item names a provider; a plugin item names a path | checked |
| `delivery.tz` is a zone Intl knows; `delivery.gateJobs`, `deploySteps`, `reuseSteps` and `testSteps` are lists of names | checked |
| a convention file's `schema` is a whole number; a newer one is read for what HQ knows | note, not a problem |
| `link` is a path; HQ writes `{"url","pid"}` there as it serves and removes it as it stops | checked (a path); the write is `hq serve`'s |
| a `homequarters` pin in the repo's `package.json` is in this HQ's major version | note, not a problem |

## The backlog (`backlog.dir`, QuestKeep's house rules carried over)

| Rule | hq check |
|---|---|
| the folder named is there | checked |
| each item is one markdown file in a stage folder, named in lower-case words joined by hyphens, no two with one name | checked |
| an item has frontmatter with `type` one of bug, feature, chore, question and an `asked` line, a `#` title, and stays under 150 words | checked |
| an item `blocked-by` another names an item that exists | checked |
| the inbox holds at most 10 items | checked |

## Decisions (`decisions.dir`)

| Rule | hq check |
|---|---|
| the folder named is there | checked |
| a file is named `<yyyy-mm-dd>-<slug>.md`, has a `date` that agrees with the name, and a `#` title | checked |
| a file that names `superseded-by` names another file in the folder, dated no earlier | checked |

## Groups (`docs.groups`)

| Rule | hq check |
|---|---|
| the file can be read | checked |
| every tracked file is in exactly one group, or a group with no paths takes the rest | checked |

## Tests (`tests.*`, [pipeline.md](pipeline.md), [sets.md](sets.md))

| Rule | hq check |
|---|---|
| `tests.sets`, `tests.layers`, `tests.pipeline` can be read, as the shapes their standards give | checked |
| each layer has `id`, `name` and `status` | checked |
| each pipeline step has a title; a set it names is in the sets file; a test it names is in a set; a layer it names is in the layers file | checked |
| every set is on some step, or every test of it is | checked |
| a step's `planned` names an open backlog item | checked, when `backlog` is set too |
| the stages list has one marked `merge`, and `was` names alias none of HQ's fixed stages | checked |
| **with `tests.headers` set:** a test the sets file names opens with Proves, Why it exists, Runs in, Takes and Run it when; Runs in names its set; a test in a set named `gate` gives a budget in `Takes` of at most 45 s on CI, no lower than its recorded range | checked |

## The demo setting (`demo`, with `hq check --demo`)

| Rule | hq check --demo |
|---|---|
| no page in the nav, backlog item, or page or raw view of a tracked file holds a name the demo setting should hide: a git author's, their email, the home folder, the GitHub owner and repo, the project's name beside HQ, the laptop's `private` list, `HQ_DEMO_PRIVATE` | checked |
| a path the setting hides answers not found, as its page and as a raw file | checked |
| a plugin with `demo: false` answers not found | checked |

## The stores ([runs.md](runs.md), [problems.md](problems.md), [slot.md](slot.md), [machine.md](machine.md))

The stores are written by `hq` and devpipe, not by the project, so `hq check` reads none of them. Their shapes are the
standards' business: each file carries a version (`v`), a missing one reads as 0, and a reader keeps every old name.

## Not checked, and why

- Whether the Makefile calls `hq` at all: HQ is never a dependency of a project's tests.
- Whether a deploy provider's login works: that is the GitHub page's chip and the Machine page's software table, at run time.
- The words a project uses: a finder is any lower-case slug, a set has any name, the stages are the pipeline file's own.
