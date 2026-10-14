# HomeQuarters: the product brief

Written 14 October 2026 from a conversation with Drew. Every decision below is his; the reasoning is kept so a reviewer can argue with it.

## Why

HomeQuarters (HQ) is the local website that `make hq` starts in QuestKeep: the repo's files and docs, its tests and recorded runs, its backlog and decisions, its Claude Code conversations, GitHub, deploys, delivery figures and a problem register. It has 17k lines, 196 commits since 26 September, 53 unit tests and two npm dependencies. On 13 October Drew decided it is a product of its own, for anyone whose project follows its data standards, with QuestKeep as the first customer.

The public launch page at questkeep.web.app/hq already offers it under this name and takes early-access sign-ups. The claim on that page is "keep up with your own repo": Claude writes much of the code now, and HQ gives the person back their bearings, what changed and why, what guards it, and what is next.

Three products share one idea. The status line (`claude-statusline`) reads a file the repo writes, `.git/project-info.json`, to a published schema, and never runs repo code. devpipe runs a repo's tasks from one config file and records every run. HQ reads what both produce, and more. The idea goes back to `minimum-viable-delivery/cicd-spec.md` (2023): a portable entry point, an info file per repo, and a verification engine that reports what it found and what it could not see.

## What ties HQ to QuestKeep today

Found by reading every module and page on 14 October.

- Names and paths: "QuestKeep HQ" in titles, exports, Claude prompts and logs; the cache at `~/.cache/questkeep`; privacy checks that allow only `~/repos/questkeep*`; the hunter's checkout at `~/repos/questkeep-hunt`.
- HQ finds the repo as its own parent folder. Nothing points HQ at a project.
- Every page loads the app's `web/nocturne.css` and `web/app.css`, and draws Moss. HQ's own 1,140 lines of CSS are a layer on top. The app's stylesheet contributes six classes; the theme file contributes 53 variables.
- Repo-layout conventions with no written spec: backlog items as `docs/backlog/<stage>/*.md` with frontmatter, decisions as dated files plus the older one-line file, five-field test headers, `tests/layers.json`, `hq/pipeline.json`, `hq/groups.json`, the Makefile's GATE and AFTER lists.
- Cache-folder formats with no written spec: devpipe run folders plus QuestKeep's first log line, the slot's `lock/log.jsonl` with a machine block, `dora/dora.json` version 3, `problems/events.jsonl`, CI junit folders named `junit-<run>-<attempt>-<set>`, and the `=== smoke-prep (25s)` lines the live-run page parses from the Makefile's output.
- The problem register's twelve stages are QuestKeep's pipeline by name. Delivery already splits its figures into a `portable` block and a `questkeep` block.
- The writers live outside `hq/`: `scripts/lock.mjs`, `machine.mjs`, `space.mjs`, `project-info.mjs`, `ci-keep.mjs`, `tests/run-info.mjs`, `history.mjs`, `headers.mjs`, and about 15 make targets.
- Whole features that are QuestKeep's: the backlog hunter (about 1,300 lines across HQ, skills and workflows), the Launch page, and Firebase Hosting as the only deploy provider.
- HQ's tests sit in `tests/unit` beside the app's, chosen by an import heuristic; the demo test reads private strings from a file on one laptop.

## Decisions, 14 October

1. **A manifest, not detection.** A project declares itself to HQ in one versioned file. HQ reads no folder the manifest does not name. `hq setup` scans the repo and the machine, proposes a manifest and make lines, and the person adds them to the project themselves.
2. **One installed tool, reader and writer in one.** HQ is installed once on the laptop, like the status line and devpipe. `hq` in a repo starts the site. The same command carries the writers the Makefile calls (`hq slot take`, `hq run-info gate`, `hq machine`, `hq info refresh`). A Makefile keeps working when `hq` is absent: it records nothing and fails nothing.
3. **Node.** The code exists and is tested, every Claude Code user has node, a writer starts in about 40 ms, and the install is `npm install -g homequarters` or `npx`. Zero runtime dependencies beyond marked and highlight.js, and no build step. A brew formula can wrap the package later.
4. **A plugin seam from day one.** A manifest key lists plugin modules. Each exports an id, a nav label, a path, a page function, optional POST actions and a demo flag. Core exposes one `ui` module, about a dozen functions, as the only promised API. No tab injection: a plugin gets its own nav entry. Firebase Hosting is written as the first built-in deploy provider against the same shape. Shipping QuestKeep's pages inside the public package was ruled out.
5. **The theme is copied, once.** `nocturne.css` and the six app rules HQ uses move into the package. Moss goes with QuestKeep. The redesign is a later job with no dependency left to untangle.
6. **The cache is named in the manifest**, defaulting to `~/.cache/hq/<name>`. One subfolder per store, each a named standard; the manifest lists which stores the project writes. HQ never deletes anything there.
7. **Kinds fixed, stages from the pipeline file.** The register's eight kinds are HQ's standard vocabulary, so projects can be compared. Stages come from the steps of the project's pipeline file, in order, each with an id a commit trailer names. A stage id is never renamed, only retired. HQ ships a default pipeline with plain stages. "Players" and "the person you work with" become "users" and "you" in the defaults.
8. **A baseline without a manifest.** `hq` in any git repo shows Home (files, docs, search), Repo (git state, worktrees, fetch), Machine (hardware and the software found, with versions and logins), GitHub (when the remote is GitHub and gh is logged in), Conversations (Claude Code's transcripts for this folder, keyed the way Claude Code keys them) and Export. A banner shows what the scan found and offers the manifest. Everything else waits for a manifest key.

## The tiers

| Tier | Needs | Pages |
|---|---|---|
| Baseline | a git repo | Home, Repo, Machine, GitHub, Conversations, Export |
| Conventions | a manifest key per feature | Backlog, Decisions, Testing, Delivery, Problems, Deploys |
| Plugins | a module the manifest names | anything the project adds |

## The manifest, schema 1

`hq.json` at the repo root. Every key but `schemaVersion` and `name` is optional; a missing key turns its feature off. Paths are from the repo root, or `~` for home.

```json
{
  "schemaVersion": 1,
  "name": "questkeep",
  "cache": "~/.cache/questkeep",
  "docs": { "home": "README.md", "groups": "hq/groups.json" },
  "backlog": { "dir": "docs/backlog", "stages": ["inbox", "next", "parked"], "map": "hq/backlog-map.json", "earlier": "docs/BACKLOG.md" },
  "decisions": { "dir": "docs/decisions", "earlier": "docs/DECISIONS.md" },
  "tests": { "layers": "tests/layers.json", "pipeline": "hq/pipeline.json", "headers": ["tests/*.js"] },
  "stores": ["runs", "lock", "problems", "dora", "ci"],
  "info": true,
  "deploy": [{ "provider": "firebase-hosting", "site": "https://questkeep.web.app" }],
  "plugins": ["./hq-plugins/launch.mjs", "./hq-plugins/hunter.mjs"],
  "demo": "hq/demo.json"
}
```

Versioning rules:

- `schemaVersion` is an integer. HQ at schema N reads every manifest from 1 to N. A manifest newer than HQ is read with a warning, and unknown keys are listed, never acted on.
- A key, once published, is never renamed or removed. A replaced key stays readable and the setup page says what replaces it.
- Every new key has a default that matches what HQ did before the key existed.
- Each store carries its own version inside its files (`dora.json` has `version`, devpipe has `pipelineVersion`); the manifest never versions a store's contents.

## The standards

Each is a short document in `docs/standards/` with the format, who writes it, who reads it, and an example from QuestKeep.

1. `hq.json`, the manifest.
2. `project-info.json`, already published by the status line. HQ reads it and `hq info` writes it.
3. Runs: devpipe's run folder plus the `=== run {json}` first line, and the JUnit files.
4. The slot: `lock/` with `run.json`, `claim.json`, `board/`, `queue/`, `log.jsonl` and the machine block.
5. Problems: `problems/events.jsonl`, the eight kinds, the stage ids from the pipeline file.
6. Delivery: `dora/dora.json`, with GitHub's raw answers beside it.
7. CI results: `ci/junit-<run>-<attempt>-<set>/` with a `run.json`.
8. The pipeline file and the layers file.
9. Backlog items and decision files.
10. Test headers: Proves, Why it exists, Runs in, Takes, Run it when.
11. Plugins and deploy providers: the `ui` module and the page shape.

## What stays in QuestKeep

- The backlog hunter, as QuestKeep's first plugin, with its skills, workflows and guard. The part of its rules module the Makefile and pre-push read stays in QuestKeep's `scripts/`.
- The Launch page, as a plugin.
- Moss, in the frame, as part of the hunter or Launch plugin if wanted.
- `hq.json`, make lines that call `hq`, and the four convention files, moved to `.hq/` or kept where they are and pointed at.
- About a quarter of QuestKeep's code leaves with HQ.

## Order of work

Sized in agent time. Waits are named separately.

1. The package skeleton: `bin/hq.mjs`, the manifest loader, the baseline pages, the copied theme, running from outside any repo. Half a day.
2. The Machine page and `hq setup`. Half a day.
3. The convention tier read through the manifest: Backlog, Decisions, Testing, Export. Half a day.
4. The stores and the writer kit as subcommands: slot, run-info, machine, space, info, ci-keep. One day.
5. Delivery and Problems with stages from the pipeline file. Half a day.
6. The plugin seam, Launch as the first plugin, Firebase Hosting as the first provider. Half a day.
7. The standards documents. Half a day.
8. QuestKeep's side: the manifest, the Makefile calling `hq`, `hq/` removed, the hunter as a plugin, the stylesheets unlinked. One day, then a pull request that waits for Drew's click.
9. A second project: a hello-world repo with no manifest, then one of the sibling repos with one. Half a day.

## Risks a reviewer should weigh

- The writer kit makes `hq` a dependency of recording. The absent-means-nothing rule has to hold in every make target, and a unit test has to prove it.
- The Makefile's `=== smoke-prep (25s)` lines are a text protocol between QuestKeep's Makefile and HQ's live page. Either it becomes a standard or the live page reads JUnit as it lands.
- The hunter's rules module is read by the Makefile and pre-push. Splitting it touches the gate's own guards.
- The demo setting reads private strings from a file on one laptop; the product needs a demo that works for anyone.
- `hq` on npm is taken; `homequarters` is free. The command stays `hq`.
- 3.7 GB of QuestKeep history must stay readable after the move; the manifest pointing at the old folder is the plan.
