# Changelog

What each version of HomeQuarters changes for a project that installs it. The manifest's `schemaVersion` has its own
rule (docs/standards/manifest.md): a key, once published, is never renamed or removed, and a newer manifest is read with
a warning.

## 0.1.0 (unreleased)

The first package: HQ as it left QuestKeep on 14 October 2026, with a manifest, one `hq` command for serving, checking
and recording, a plugin seam, and seven data standards under docs/standards/.

Kept for this release only, and gone at 0.2.0 (test/release.test.mjs is the clock):

- The writers read QuestKeep's old environment names beside HQ's: `QK_LOCK_DIR`, `QK_AGENT`, `QK_PROBLEMS_DIR`,
  `QK_IN_CONTAINER`, `QK_LOCK`, `QK_SPACE_*`, `QK_CACHE`. Rename to the `HQ_` names before 0.2.0.
- `hq dora` writes the project's figures as `project` and a copy as `questkeep`, for a Delivery page from before this
  release that still reads the old name.
- The slot looks for test containers by the `qk.test` docker label beside `hq.test`.

Kept for good: every reader keeps every old name it ever read (`questkeep` in dora's daily files, `GATE=` lines in a
Makefile, `was` names on stages), because nothing recorded is ever deleted or rewritten.
