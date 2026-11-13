# Golden records

These are records QuestKeep's own writers wrote, kept so `test/golden-records.test.mjs` can prove that `hq slot` and `hq run-info` write the same records once they replace those writers. They were made on 13 November 2026 from QuestKeep's `main` at 904a9df35.

- `slot-run.json`: the slot's `run.json` while a run held it, from `scripts/lock.mjs take test-gate`.
- `slot-log.jsonl`: that run's two lines in the slot's `log.jsonl`, the take and then the release (`release test-gate 0`).
- `run-info-ci.json`: the CI run line's JSON, from `tests/run-info.mjs gate --json <file>`.
- `run-info-test.json`: a laptop run line, a person's `make test`, from `tests/run-info.mjs test --json <file>`.
- `run-info-docker-gate.json`: a container gate's run line, from `tests/run-info.mjs docker-gate --json <file>`.

## The environment they were made in

`regenerate.sh` runs both writers under `env -i`, so nothing from the shell leaks in. HOME and the slot's folder (`QK_LOCK_DIR`) are a throwaway folder, so the real stores under `~/.cache/questkeep` are never read or written.

The run line is a push to `main` on QuestKeep's self-hosted runner: `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=self-hosted`, `GITHUB_RUN_ID=19000000001`, `GITHUB_RUN_ATTEMPT=2`, `GITHUB_EVENT_NAME=push`, `GITHUB_REF_NAME=main`, `QK_COMMIT=0123456789abcdef0123456789abcdef01234567`, `QK_TARGET=test-gate`, `QK_HALF=1`. Its `hash` is QuestKeep's tree hash of the checkout's HEAD, and its `sdk` is what that empty HOME's SDK cache gave (`network`).

The two laptop lines are a person's runs with nothing set but PATH and HOME, so no LANES: the writer's own default shows, 2 lanes for `test` and 3 for `docker-gate`, which runs in QuestKeep's test image. The writer runs git in the folder it starts in, so `regenerate.sh` runs it in a throwaway checkout named `questkeep` on `main`, whose one empty commit has fixed names and dates (`golden`, 13 November 2026 00:00 UTC) and no git config. Its hash is then the same every time, and the test makes the same commit, so `commit` is compared exactly.

The slot run is the same runner taking the slot for a deploy's gate: `USER=golden`, `QK_WHO=golden-runner`, `QK_NO_DOCKER=1`, the same run and attempt, `QK_RUN_TESTS="sync-offline island-stamps"`, `JUNIT=1`, `QK_KIND=deploy`, `QK_PLACE=home`. A `sleep` stands in for the make recipe's shell (`QK_LOCK_PID`). `scripts/lock.mjs` runs git in its own checkout, so `worktree` and `branch` are that checkout's folder name and branch: regenerate from a checkout named `questkeep` on `main`.

The checkout's `path` names the machine's home folder, so the script writes it as `/path/to/questkeep`. The test treats it as volatile.

## What the test compares

Every key, and every value except the volatile ones the test names: `pid`, `pidStart`, `path`, `since`, `at`, `secs`, `paged` and `machine`. For those it checks only that the field is there with the same type.

The package adds `v` to the slot's log lines and the run line, and `tree` to a CI run line; QuestKeep's readers ignore both. Everything else must match. For the CI run line, the test passes what QuestKeep will pass through `--extra` (decision 11 of the plan to make HQ independent): `runner: "laptop"`, `target`, `half`, and the record's own `hash`, `lanes` and `sdk`, which QuestKeep works out itself. For the laptop lines it passes `lanes` and `sdk` alone. Both are the project's to pass: the package writes `lanes` only when `HQ_LANES`, `QK_LANES` or `LANES=` in `MAKEFLAGS` names it, and never writes `sdk`.

## Making them again

Run `test/fixtures/golden/regenerate.sh <a QuestKeep checkout>` from the package's folder. Redo it when QuestKeep's writers gain a field, then update this file's date and commit, and expect the test to fail until the package writes the new field too.
