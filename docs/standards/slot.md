# The test slot

One browser or container test run at a time on one machine. `hq slot take <name>` waits its turn and holds the slot for the shell that called it; `hq slot release <name> <exit status>` gives it back. A session can claim the slot across several runs with `hq slot claim <why>` and let it go with `hq slot unclaim`. `hq slot who` shows the holder, the claim, the queue, each session's status line and the last runs; `hq slot status <msg>` posts a session's line.

The slot is a guard, not a record. A Makefile that cannot find `hq` must stop a guarded run rather than skip the slot, since two runs at once is what the slot prevents. The make lines `hq setup` proposes do that:

```make
hq-slot = $(call hq-guard,slot take $(1)) && { trap '$(HQ) slot release $(1) $$?' EXIT; trap 'exit 130' HUP INT TERM; $(2); }
```

## Where it writes

The repo's `lock` store, named in `hq.json` under `stores` (`<cache>/lock` when it is not), or `HQ_SLOT_DIR`. What is shared is the machine, so every checkout of the project on it points at the same folder.

| file | holds |
| --- | --- |
| `run.json` | the run holding the slot: session, agent, process and its start time, worktree, branch, target, since, the swap counters at the take |
| `claim.json` | a session's claim across runs: who, why, since, renewed |
| `board/<id>.json` | each session's latest status line and its last run's result |
| `queue/<ticket>.json` | each run waiting, named by the time it began to wait |
| `log.jsonl` | one line per event, appended whole, never rewritten |
| `*.stale-*.json` | records moved aside when judged stale or released; the newest ten of each kept |

## The log line, v 1

Every line has `v`, `at` and `event`. A reader takes a line without `v` as the first shape. The events are `take`, `wait`, `release`, `takeover`, `claim`, `claim-ended`, `unclaim`, `refused` (a take that would not wait), `gave-up` (a take past its `LOCK_WAIT` minutes) and `left` (a waiter stopped before its turn). A line carries who wrote it (`session`, `agent`, `person`, `worktree`, `branch`, `target`), and a `take` or `release` carries `machine`, the load, swap and busiest programs at that moment (`hq machine` says the shape); a `release` also carries `status`, `secs` and the paging rate during the run. A line written inside a GitHub Actions job carries `ciRun` and `ciAttempt`. A `wait`, `refused`, `gave-up` or `left` line says in `for` what it was waiting behind.

HQ's Problems page reads `wait`, `refused`, `gave-up` and `left` as time lost to the slot, and Delivery matches a self-hosted runner's waits to its jobs by `ciRun`.

## Rules

- Waiters go in the order they came. A session holding a claim goes first.
- A holder whose process has gone is taken over; a claim whose Claude session has ended is dropped; a waiter whose process has gone is dropped from the queue. A live holder is never taken over, however long it has run.
- A test container still running from an ended run makes the next run wait, named with the command to stop it. HQ stops nobody's container. Containers are found by the labels `hq.test=<target>` and `hq.worktree=<name>` (QuestKeep's `qk.*` are read too), or by the image `HQ_TEST_IMAGE` names.
- The slot stands aside on hosted CI, inside a test container (`HQ_IN_CONTAINER=1`) and with `HQ_SLOT=0`. A self-hosted runner takes its turn like anyone else, under the name `HQ_WHO` gives it.
- `LOCK_WAIT=0` fails at once with exit 3 instead of waiting; `LOCK_WAIT=<minutes>` waits that long at most.
- Agents of one Claude session share its id. An agent started by another names itself with `HQ_AGENT`, and its claim and status line are its own.

Every `HQ_` name is read under the `QK_` name QuestKeep used, for one release: `HQ_SLOT_DIR`, `HQ_SLOT_PID`, `HQ_SLOT_POLL_MS`, `HQ_AGENT`, `HQ_WHO`, `HQ_NO_DOCKER`, `HQ_TEST_IMAGE`, `HQ_SLOT`, `HQ_IN_CONTAINER`.
