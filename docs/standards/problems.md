# The problem register

What went wrong, when it was found, where it should have been caught, and what guards it now. One file in the `problems` store, `events.jsonl`, one JSON line per event about one entry, appended whole by `hq problem` and never rewritten; an entry is its events read in order. HQ's Problems page folds the file, adds what it works out from the other stores (slot waits, flaky tests, pull requests waiting), and the export carries the same vocabulary.

## The event line, v 1

```
{"v":1,"at":"2026-10-14T09:12:00Z","ev":"opened","id":"P-2026-10-14-agent-mistake-a1b2","by":"questkeep-91","fields":{"title":"…","kind":"agent-mistake","foundAt":"you","evidence":"…"}}
```

- `ev` is one of `opened`, `set`, `closed`, `reopened`, `merged-into`, `redacted`. An event that would rewrite history (a second open, a second close, a reopen of an open entry) or that names no entry is refused and reported, never guessed at. A redaction hides its fields everywhere, on the entry and in each event.
- `id` is `P-<date>-<kind or word>-<hex>`, never words of the title.
- `by` is who wrote it: a session, an agent, a backfill.
- `v`: a reader takes a missing one as 0 and reads a newer writer's line for what it knows.
- `fields` holds only the fields below; an unknown or invalid one is dropped and named back to the writer.

## The vocabulary

The eight kinds are HQ's, fixed, so projects can be compared: `product-bug`, `test-failure`, `flaky-test`, `slot-contention`, `pr-pileup`, `proof-churn`, `tooling-breakage`, `agent-mistake`. Each has its modes; `hq problem --help` lists them, with the factors, effects, guard types and finders.

The stages are the project's: the pipeline file's `stages` in order (`docs/standards/pipeline.md`) with HQ's five people-stages around them, `self`, `reviewer`, `you` before the merge, `you-after`, `users` after. A stage id is never renamed, only retired; a retired name stays readable through `was`.

The fields an event may set: `title`, `kind`, `mode`, `signature`, `factors` (up to three), `foundAt`, `foundBy`, `shouldHaveCaughtAt`, `playerFacing`, `effect`, `guardType`, `guard`, `believed`, `actual`, `evidence`, `fix`, `repeatOf`, `record`, `runs`, `seenFrom`, `confidence`. `evidence` is a pointer, a run id, a `file:line`, a commit, never copied text. A problem found by a reviewer, by the person or after the merge closes only with `shouldHaveCaughtAt`.

## Where entries come from

- `hq problem note|set|close|reopen|merge|redact` from a session, when something cost time and no fix commit records it.
- Fix commits' trailers (`Found-by`, `Kind`, `Found-at`, `Player-facing`, `Signature`), read from git.
- `hq problem-backfill red-gates`, which imports a sort of red runs as entries that own their reds.
- Observations HQ works out from the stores and never writes: slot waits from the lock log, flakes from the runs, pull requests waiting from GitHub's answers.

## Privacy

Free text (`title`, `signature`, `guard`, `believed`, `actual`, `evidence`) is refused when it matches a private pattern (an email, a home path outside the repo, a token); the export checks again. The register stays on the laptop.
