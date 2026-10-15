# Recorded runs

A run is one `make test`, gate, long set or container run, kept so the Testing page, the live-run page, the Delivery figures and the problem register can read it back. HQ reads two stores: the `runs` store, where devpipe keeps the laptop's runs, and the `ci` store, where a workflow's results land (`hq ci-keep` as the job ends, or `hq ci-fetch` later).

## The run line, v 1

Every recorded task starts with one line HQ reads back:

```
=== run {"v":1,"kind":"gate","where":"laptop","who":"agent","session":"d761…","branch":"main","commit":"8011a64a","dirty":false,"lanes":2,"out":"…/results/2026-10-14T20-55-08Z-x1","machine":{…}}
```

`hq run-info <kind>` prints it; `--json <file>` writes the same object to a file instead, as CI does beside its JUnit files. The fields:

| Field | Meaning |
| --- | --- |
| `v` | the shape of the line; a reader takes a missing one as 0 |
| `kind` | what ran: a set's name (`gate`, `after`, `unit`, `rules`) or a run of the project's own (`soak`, `deploy`, `load`) |
| `where` | `laptop`, `container` or `ci` |
| `who` | `person`, `agent` (a Claude Code session) or `ci`; `session` and `agent` name the session and the agent when there is one |
| `branch`, `commit`, `dirty` | the checkout as it was |
| `lanes` | how many tests ran side by side |
| `partial` | `true` when the run named its own tests, so it ran part of a set and is not the set's result |
| `out` | the run's folder of test files, which HQ opens a failed test's log from |
| `machine` | what the machine was doing (`docs/standards/machine.md`) |
| on CI | `event`, `run`, `attempt`, `at`, `runner` (`github` or `self-hosted`), `tree` |
| the project's own | anything handed in with `--extra '<json>'`, under HQ's fields |

The environment moves the facts a Makefile cannot say on the command line: `HQ_KIND`, `HQ_WHERE`, `HQ_BRANCH`, `HQ_COMMIT`, `HQ_LANES`, `HQ_OUT`, `HQ_AGENT`, `HQ_PARTIAL`, each read under its `QK_` name too for one release.

## The runs store

devpipe's folder: `<runs>/runs/<id>/run.json` with the tasks, their status, seconds, log paths and JUnit cases, and `report.html`. HQ reads each task's log head for the run line; the last task's line names the run, so a `make test` of unit, rules and the gate reads as the gate. A run with `rerun.xml` in its `out` folder gains a task named `rerun`, which never turns the run green.

## The ci store

One folder per uploaded artifact, `junit-<run>-<attempt>-<part>`, where the part is a set's name (`gate`, `gate_a`, `after`, `load`); each holds the `run.json` that `hq run-info --json` wrote and a JUnit file per task. Of one run's folders, the newest attempt of each part counts. Any other folder name is skipped, so a project may keep other artifacts there.

## Rules

- HQ is the recorder, never a dependency of the tests: a Makefile's record line does nothing when `hq` is missing and never fails a run when `hq` fails (`hq-record` in the lines `hq setup` proposes).
- Nothing in a store is ever rewritten or deleted by HQ.
- A failed test's log is opened only from inside the cache, by a plain file name the JUnit message gives.
