# Changelog

What each version of HomeQuarters changes for a project that installs it. The manifest's `schemaVersion` has its own
rule (docs/standards/manifest.md): a key, once published, is never renamed or removed, and a newer manifest is read with
a warning.

## 0.3.5

The Problems page's read after a response no longer holds HQ for seconds, so pages asked while it reads are answered.
No manifest change. The first start on 0.3.5 reads the run store and the causes index cold once, since the code that
reads them changed. Times are from QuestKeep's data on the same laptop.

- After a new run, the register works out test results and reds for that run alone, where it walked all 2.8 million
  results again. A CI run whose folders did not change is kept as the same run, so what was worked out from it stands.
- The red runs' folders are stamped with non-blocking file calls before the register reads them, in place of 44,000
  stat calls in a row.
- The lock log, the problem events and each CI folder's run.json are parsed once while they stay unchanged.
- The longest stretch a re-read holds the server fell from 330-400 ms to 95-195 ms. On 0.3.4 a re-read after a new
  run took about 1.5 s of it, in one piece.

## 0.3.4

Delivery draws what hq.json says now, a restart after an upgrade starts warm, and the slowest first reads are cut.
One manifest key: a project that wants Delivery's Not counted list adds `delivery.blindSpots` when it moves to 0.3.4;
HQ 0.3.3 warns on the key. The first start on 0.3.4 reads the run store cold once, since 0.3.3's indexes carry no
code key. Times are from QuestKeep's data on the same laptop.

- Delivery takes the counting notes from the manifest HQ started with, where it drew the copies `dora.json` saved
  at the last `hq dora`. On 15 November QuestKeep's "skipped since" went missing until `make dora` ran.
- `delivery.blindSpots`: the sentences Delivery lists under Not counted. The list was QuestKeep's, written into the
  package; with no key there is no such section.
- The period line names the zone the figures were cut in, where it said New York time for every project.
- `dora.json` records the settings its figures were counted by. Figures counted by other settings, written before HQ
  started, get the background refresh old figures already get, once.
- The run index and the causes index are kept by a fingerprint of the code that reads, not by HQ's version: an
  upgrade that leaves that code alone starts from them.
- The Repo page reads every branch worktree's distance from main and last commit in one git run, and keeps the
  picture for 10 s, then reads again after the response: 2 ms warm, against 1.9 s. Fetch drops it. Export shares it.
- Export's check for minified files reads each line once: 23 ms over QuestKeep's 2,060 files, against 1,961.
- Conversations finds every backlog item a session mentions in one pass over its text, 213 ms against 1,764, and
  matches a session's commits by subject, 175 ms against 984.
- The Machine page keeps its software list in `<cache>/hq/software.json` and asks the tools again after the response
  once it is a minute old. Its first read after a start takes about 0.1 s, against 3.5.
- After a restart the warm-up takes about 13 s, against 20 on 0.3.3.
- For contributors: `scripts/try-release.mjs <project>` tries a release on a project's data beside its pinned HQ;
  CONTRIBUTING.md has it as the step before a tag. The workflows use checkout v7.0.1 and setup-node v6.5.0.

## 0.3.3

One manifest key, and Delivery stops reading QuestKeep's decision names. A project that dates "Laptop since" or
"skipped since" adds `since` to those notes first; HQ 0.3.2 reads a note with it without a warning.

- `delivery.countingChanges[].since`: `laptop-gate` on the note for the day the gate moved to the Laptop, which
  Delivery gives beside gate time, or `skipped-redeploys` on the note for the day redeploys of a tree already live
  started being skipped, which Method gives. One note each; `hq check` warns on another word or a second note.
- Delivery finds those two dates, and the deploys chart its marks, only by `since` and `mark`. The lookups by
  QuestKeep's decision file names are gone, as 0.3.2 said.
- What each branch does to the backlog is read in four git runs, plus one for each branch still on the old one-file
  backlog: the commit graph once, every branch's merge base worked out from it, and every branch's diff in one
  `diff-tree`. Home's first read used to run two for each branch not merged into main; on QuestKeep's 599 branches
  that takes 97 ms, against 758.

## 0.3.2

Restarts and memory, and one optional manifest key. Nothing has to change in a project. Times are from the same
laptop and data as 0.3.1's, measured while other tests ran on it.

- HQ saves what it read from the run store to `<cache>/hq/runs-index.json` (about 54 MB here), and a restarted HQ
  reads only the run folders that changed since: 0.8 s for the store, against 7.3 s cold.
- A red run's causes are worked out from its logs once, and saved to `<cache>/hq/causes-index.json` for the next
  start. New lines from passing tests elsewhere no longer make every red run's logs read again.
- The register's git calls are batched: one `cat-file --batch` for the backlog items fixes deleted, and one lookup
  for the commits no ref reaches, where a cold read ran git about 200 times.
- The register keeps test results only for the tests it reads them for, the fixed flaky tests and the Tests tab's
  browser tests: about 240,000 of 2.8 million. Flakes and red sorting read results in full only where a test failed.
- After a restart the warm-up takes about 20 seconds, against 31 on 0.3.1; a register read takes 2.0 s, against
  11.6. Heap after every page has been read: about 580 MB, against 850.
- `delivery.countingChanges[].mark`: a label of up to 60 characters that Delivery's deploys chart draws on that
  note's day. With no note marked, the chart keeps the two marks HQ found by QuestKeep's decision names; 0.3.3 stops
  reading those names. HQ 0.3.1 reads a note with a mark without a warning, so a project can add marks first.

## 0.3.1

Speed and memory, with nothing to change in a project: no manifest keys, commands or exports are added or removed.
Times are from one laptop with QuestKeep's data: 3,611 recorded runs, 2.8 million test results, about 5 GB.

- HQ reads each recorded run once and keeps it, reading a folder again only when it changes. A warm page answers in
  10 to 150 ms; on 0.3.0 Home took 4 to 13 seconds and the Testing page's Tests tab 34.
- Flakes, results by file, the test catalogue, the Testing tabs' times and the Conversations page are worked out
  once per change.
- Problems answers at once from the snapshot it has, and reads the register again after the response when a run
  lands or a minute has passed. A read of the register went from 30 seconds to 0.35 warm: git is read once a read
  rather than once for each fix and run, and red runs' logs only when they change.
- hq serve asks itself for each page once it is listening, so the first click finds the stores read. On this data
  the warm-up takes about 30 seconds after a start.
- The run store holds one copy of each test name; a name used to keep its whole JUnit file alive. Heap after every
  page has been read: about 850 MB.
- Fixes: a run that finished after HQ first looked could stay hidden for up to 5 seconds; a CI download that failed
  part way was never fetched again (hq ci-fetch now moves an artifact into the store only once it is whole).

## 0.3.0

Removes what 0.2 kept for projects moving off it. A project that runs on 0.2 without warnings and imports nothing
from `homequarters/internal/...` needs no change, apart from the environment names below.

- `homequarters/internal/...` is gone from the `exports` map. Use `homequarters`, `homequarters/testing` or
  `homequarters/unstable`.
- Only `HQ_` environment names are read. The `QK_` names, `LOCK_WAIT` and `JUNIT` that 0.2 read beside them are not;
  docs/standards/cli.md lists the names. `HQ_NOW` replaces `QK_NOW` for replaying an old red.
- The slot finds test containers by the `hq.test` and `hq.worktree` labels; QuestKeep's `qk.*` ones are not read. A
  container with neither is still counted by the test image, as before.
- A daily DORA copy no longer carries the `questkeep` copy of the project's figures. Delivery still reads a file that
  has only that block.
- The counting notes the package carried from QuestKeep are gone: a project lists its own in
  `delivery.countingChanges`.

## 0.2.0

Additions only: everything 0.1 read still works.

- `ui` is version 2. New members: `kindIn`, `gh.checksOf`, `git.belongs`, `claude.folderName`, `days.key`,
  `days.start`, and `backlog.parseItem`, `check`, `openBlockers`, `dir()` and `stages()`. A plugin written for 1 still
  loads, with a warning.
- `homequarters/unstable` names HQ's helpers that make no promise between releases, for projects moving off
  `homequarters/internal/...`.
- `homequarters/testing` has `start()`, HQ's server for a test, which writes no link file, ignores `HQ_DEMO`, finds
  no claude and shows the Machine page with every tool missing unless the test says otherwise; `NO_TOOLS`; and HQ's
  readers a project's contract tests use.
- `start()` takes `probes`, which the Machine page asks in place of the machine's tools.
- `delivery.countingChanges` in hq.json lists the project's own counting notes for Delivery, and `hq check` reports
  a note whose decision file is missing.
- To go in 0.3.0: `homequarters/internal/...`; the `QK_` names, `LOCK_WAIT` and `JUNIT` the environment table lists
  as "also read as"; the counting notes the package carries from QuestKeep; the `questkeep` copy of the project's
  figures in a daily DORA copy.

## 0.1.1

- The demo setting no longer takes a git name that starts with HQ ("HQ Test") for a person. It used to swap every
  lowercase "hq" on a page, class names and asset paths too, so a demo page lost its styling.

## 0.1.0

The first package: HQ as it left QuestKeep on 14 October 2026, with a manifest, one `hq` command for serving, checking
and recording, a plugin seam, and eight data standards under docs/standards/. The `delivery` key names a project's
GitHub jobs and steps (`gateJobs`, `deployJob`, `smokeJob`, `deploySteps`, `reuseSteps`, `testSteps`); with none, a
deploy is any successful run of the deploy workflow.

Since the package was first cut, before its first release:

- package.json has an `exports` map. A project imports the plugin API from `homequarters`, test helpers from
  `homequarters/testing` (empty until 0.2.0), anything else as `homequarters/internal/<path>`, and
  `homequarters/package.json`. A bare `homequarters/lib/...` import is now refused.
- Node 22 or later (`engines`), since Node 20 reached end of life on 30 April 2026.
- package.json names the GitHub repository, issue tracker and home page. The tarball now carries `LICENSE`,
  `CHANGELOG.md`, `testing.mjs` and the Inter font's licence, `theme/fonts/OFL.txt`.
- The unused `playwright` dev dependency is gone.
- The repo has an MIT `LICENSE`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, issue templates, its own `hq.json`,
  and two workflows: `test.yml` (Node 22 and 24, Linux and macOS) and `release.yml` (publishes a `v*` tag with
  provenance once CHANGELOG.md has its heading).
- Tests and docs no longer name the author's home folder.
- `delivery.dailyAt` (`"07:07"`, in `delivery.tz`) says when the project's daily run takes its copy of the figures.
  `hq dora` writes a missed day's late copy as of that time on that day, as QuestKeep's nightly did; without the key
  the copy is as of the day's end, as before.
- `hq dora` keeps a counting change that predates the project's decisions folder, and so names no decision file, when
  the repo has the manifest's `decisions.earlier` file; QuestKeep's 27 September note is back on make dora and the
  Delivery page. Without that file such a change is still left out.
- `hq slot` records the run's `tests`, `junit`, `kind` and `place` (from `HQ_RUN_TESTS`, `HQ_JUNIT`, `HQ_KIND`,
  `HQ_PLACE`, with QuestKeep's names as aliases), and `--extra '<json>'` or `HQ_SLOT_EXTRA` adds a project's own fields;
  the slot's own fields always win over them.
- `hq run-info --extra` wins over HQ's own values for every field but `v`, so a project can pass its `runner`,
  `target`, `half`, `hash`, `lanes` and `sdk`. HQ writes `lanes` only when `HQ_LANES`, `QK_LANES` or `LANES=` names
  it, and never writes `sdk`, so a project whose readers expect them on every run line passes them.
- `hq serve` writes `{url, pid}` to the file hq.json's `link` key names, and removes it on exit.
- `hq check` prints its version first, notes a pin at another major version, and `hq check --demo` renders the demo
  pages against the repo and fails on any name the demo setting should hide.
- `schema/hq.schema.json` describes hq.json schema 1, and `docs/standards/cli.md` and `plugins.md` document the command
  line and the plugin API.
- Tests: golden slot and run-line records taken from QuestKeep's own writers, `hq machine`'s parsing, `hq dora` on CI
  without `gh`.
- The release workflow refuses a tag whose CHANGELOG heading is missing or still marked unreleased.
- `hq problem` stores a stage word exactly as given, after checking it is a stage or an old name of one:
  `--found-at person` stays `person`, where it had been rewritten to `you`. Readers translate old names, so a reader
  that knows only the old ones, such as QuestKeep's own before it moves to the package, keeps the stage.

Kept for this release only, and gone at 0.2.0 (test/release.test.mjs is the clock):

- The writers read QuestKeep's old environment names beside HQ's: `QK_LOCK_DIR`, `QK_AGENT`, `QK_PROBLEMS_DIR`,
  `QK_IN_CONTAINER`, `QK_LOCK`, `QK_SPACE_*`, `QK_CACHE`. Rename to the `HQ_` names before 0.2.0.
- `hq dora` writes the project's figures as `project` and a copy as `questkeep`, for a Delivery page from before this
  release that still reads the old name.
- The slot looks for test containers by the `qk.test` docker label beside `hq.test`.

Kept for good: every reader keeps every old name it ever read (`questkeep` in dora's daily files, `GATE=` lines in a
Makefile, `was` names on stages), because nothing recorded is ever deleted or rewritten.
