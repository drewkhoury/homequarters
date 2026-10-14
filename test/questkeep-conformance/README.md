# Tests that belong to QuestKeep

These files came over from QuestKeep's `tests/unit/` with HQ's other tests on 14 October 2026, and they test QuestKeep's own repo, not HQ. Each reads a real file of that repo: its backlog, its decisions, its Makefile, its `hq/groups.json`, `hq/pipeline.json` and `tests/layers.json`, or the private strings in the laptop's `~/.cache/questkeep/hq/demo.json`. They are conformance checks: does QuestKeep keep to the conventions its `hq.json` names. They go back to QuestKeep when HQ is split out, and nothing runs them from here. The suite is `node --test test/*.test.mjs`, which does not look in this folder.

Their imports point at `../../lib/`, so a file loads from this folder, but each fails at once for want of the repo it reads. The `REPO` each works out (two folders up from the test) is QuestKeep's root when the file is back in `tests/unit/`.

## What is here

| File | What it checks | What it reads |
|---|---|---|
| `backlog.test.mjs` | every item in `docs/backlog` keeps the README's rules; the README is there; `hq/backlog-map.json` names real items | `docs/backlog/`, `hq/backlog-map.json` |
| `decisions.test.mjs` | `docs/DECISIONS.md` holds its frozen lines and no more; every file in `docs/decisions/` keeps the rules | `docs/DECISIONS.md`, `docs/decisions/` |
| `dora.test.mjs` | every decision a counting change in `lib/dora.mjs` cites is still a file in `docs/decisions/` (one test; the rest stayed in `test/dora.test.mjs`) | `docs/decisions/` |
| `hq-groups.test.mjs` | every tracked file lands in exactly one group, and the groups land where Drew asked (two tests; the pattern tests stayed in `test/hq-groups.test.mjs`) | `hq/groups.json`, `git ls-files` |
| `hq-pipeline.test.mjs` | the pipeline file names only sets and tests the Makefile has, planned steps name open backlog items, and layers the layers file knows (five tests; the pure and drawing tests stayed in `test/hq-pipeline.test.mjs`) | `hq/pipeline.json`, `Makefile`, `tests/`, `docs/backlog/`, `tests/layers.json` |
| `hq-demo-pages.test.mjs` | with the demo setting on, no private string reaches any page, part, raw file, Chat stream or export of the real repo | git's authors and remote, `hq/demo.json`, `~/.cache/questkeep/hq/demo.json`, `web/images`, `tests/unit/fixtures/dora` |
| `ci-keep.test.mjs` | a laptop-runner job's results land in the CI store (`scripts/ci-keep.mjs`) | `scripts/ci-keep.mjs`, which is QuestKeep's writer today; the brief's step 4 brings it into HQ as `hq ci-keep`, and the test comes with it then |

## Left with QuestKeep's plugins

Tests of features that are QuestKeep's plugins now, deleted from HQ's suite rather than moved:

- `hq-server.test.mjs`, the backlog hunter: Start a pass; the Backlog page's Hunter tab (passes, claims, Start a pass); Take control by tty; Take control and Send to the pass once ended; a session.json naming another checkout is refused; a pass's deck as an HQ page; Stop; Clean up; the Hunter tab's rows; a claim's merged pull request. Ten tests and their helpers (`seedPass`, `endedPid`, `withManage`).
- `hq-demo.test.mjs`, the Launch page leaves the nav in the demo. The generic rule took its place: a plugin with `demo: false` is out of the nav and its page answers not in the demo (`test/hq-server.test.mjs`).
- `hq-demo-pages.test.mjs` (moved whole, above) also holds "the Launch page, which lists sign-ups, is not in the demo", and its nav sweep looks for `/launch`; those lines are the Launch plugin's to keep.

## Dropped by the extraction, for QuestKeep to decide

- `problem-privacy.test.mjs` allowed a pointer into `~/repos/meta-analysis` (backfill cites that repo's corrections by file and line). The check now takes the repo and the cache from the manifest and allows only the repo, its worktrees, the cache and the repo's own transcripts, so that assertion is gone. A manifest key for other folders a project may cite would bring it back.
