# Changelog

What each version of HomeQuarters changes for a project that installs it. The manifest's `schemaVersion` has its own
rule (docs/standards/manifest.md): a key, once published, is never renamed or removed, and a newer manifest is read with
a warning.

## Unreleased

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

## 0.1.0 (unreleased)

The first package: HQ as it left QuestKeep on 14 October 2026, with a manifest, one `hq` command for serving, checking
and recording, a plugin seam, and eight data standards under docs/standards/. The `delivery` key names a project's
GitHub jobs and steps (`gateJobs`, `deployJob`, `smokeJob`, `deploySteps`, `reuseSteps`, `testSteps`); with none, a
deploy is any successful run of the deploy workflow.

Kept for this release only, and gone at 0.2.0 (test/release.test.mjs is the clock):

- The writers read QuestKeep's old environment names beside HQ's: `QK_LOCK_DIR`, `QK_AGENT`, `QK_PROBLEMS_DIR`,
  `QK_IN_CONTAINER`, `QK_LOCK`, `QK_SPACE_*`, `QK_CACHE`. Rename to the `HQ_` names before 0.2.0.
- `hq dora` writes the project's figures as `project` and a copy as `questkeep`, for a Delivery page from before this
  release that still reads the old name.
- The slot looks for test containers by the `qk.test` docker label beside `hq.test`.

Kept for good: every reader keeps every old name it ever read (`questkeep` in dora's daily files, `GATE=` lines in a
Makefile, `was` names on stages), because nothing recorded is ever deleted or rewritten.
