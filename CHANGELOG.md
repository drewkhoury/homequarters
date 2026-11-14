# Changelog

What each version of HomeQuarters changes for a project that installs it. The manifest's `schemaVersion` has its own
rule (docs/standards/manifest.md): a key, once published, is never renamed or removed, and a newer manifest is read with
a warning.

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
