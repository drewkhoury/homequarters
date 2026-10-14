# Fixtures for tests/unit/dora.test.mjs

These are 23 real Actions runs from this repo, 30 September to 6 October 2026, as `hq/dora-fetch.mjs` saved them in `~/.cache/questkeep/ci/actions/`. Each one is trimmed to the fields `hq/lib/dora.mjs` reads. Each was picked because it is one of the cases the figures must get right. The numbers in the tests come from these files, so a test reads as "this real run counts as this".

- `runs.json`: the runs, oldest first, trimmed from GitHub's `actions/runs` list.
- `jobs.json`: each attempt's jobs and steps, keyed `<run>-<attempt>`, from `actions/runs/<run>/attempts/<n>/jobs`.
- `logs.json`: decide's row line from each Deploy run's decide job log.
- `pulls.json`: the merged pull requests whose merge commit is one of these pushes, with their titles.
- `lock.json`: the laptop runner's test-slot events inside these runs' gate jobs, from `~/.cache/questkeep/lock/log.jsonl`.
- `recheck.json`: run 37887271953 alone (9 Oct). Its smoke test went red, and a re-run of that job on the same release passed 85 s later. It is kept apart so the other tests' counts stay as they are.
- `commits.json`: four commits on main from `git log`, each body trimmed to what a test reads, with every path it changed. e6b4837's paragraph names Deploy run 36692304266, the smoke red, which is how a failure finds the commit that explains it. b61152e is the commit that went red and names no run. c5b78b0 is PR #172's merge, whose subject is the title a change takes when pulls.json is missing. For rework: b61152e and e6b4837 are fix: commits that changed `web/`, and 7ad0722 is one that changed only `hq/`.
- `waiting.json`: open pull requests for "Waiting on you", the merged ones a title can match, and the runs of their heads, trimmed from `pulls-open.json`, `pulls.json` and `runs.json`. Only #199 was open when this was written; the other three are real pull requests as they stood while open:
  - #199: open on 6 October, its gate passed. Neither stale nor old.
  - #157: as on the evening of 4 October, after its first push's gate (37239479411) went red, so its checks fail.
  - #179: open from 02:56 on 6 October until it was closed at 15:03. #197, with the same title, was merged at 15:10, so this is #179 as if nobody had closed it: probably stale.
  - #1: open for six minutes on 25 September, with no run. #2, with the same title, was merged that evening. Stale, with no checks.
- `slot.json`: three laptop gate runs kept apart from the others, with their jobs and every test-slot line inside their gate jobs, so the counts above stay as they are. They pin slot wait on real waits:
  - 37239479411: PR #157's first gate, red. The laptop runner waited 793 s for the slot behind a soak's test container, before the lock logged the run, so the wait is matched by time. A session used the same pid two days before, and its lines are kept to show they are passed over.
  - 37255436574: PR #157's next gate, the one its lead time counts. It took the slot at once, which is why #157 shows no slot wait.
  - 37434109311: PR #194's gate, whose lock lines name the run (`ciRun`). It waited 330 s behind a person's smoke test, whose own wait and take sit beside its lines.

## The cases

| Run | What it is |
|---|---|
| 36691018155 | A deploy (row 6) on GitHub's machines, the one before the smoke red. |
| 36692304266 | b61152e: deployed, then the production smoke test went red. This is a failed deploy. |
| 36694091370 | The next deploy, with a green smoke test, which ends that failure's recovery. |
| 36824992530 | e6b4837: the deploy step itself failed, so nothing was released. This is a pipeline red, not a failed deploy. |
| 36930220866 | 5b09943 (PR #75): cancelled while queued, with no jobs. Its commit went live with the next run. |
| 36930221298 | e5f2e2e (PR #76), pushed the same second: its first attempt's gate went red, and the re-run (attempt 2) deployed, shipping 5b09943 too. |
| 37106204812 | 8d23791: the deploy step passed, then the job was cancelled. The release is live all the same. |
| 37107791344 | The first deploy on the laptop runner after that. |
| 37370455019 | A row 7 deploy (gate and deploy) for PR #161, whose pull request runs are not here. That makes it a change with no start time. |
| 37380538618 | Row 6 for PR #172, which landed by rebase. Its merge commit c5b78b0 differs from its pushed head 74ab1b1. |
| 37400367027 | Row 7 for PR #175, whose gate went red on its first attempt and passed on a re-run 1½ hours later. |
| 37416302816 | Row 5: skipped, since live already served exactly what it served. |
| 37076848861 | A passed gate on GitHub's machines (two halves), for the "different runner" comparison. |
| 37105642855, 37105642861 | PR #132's gate and unit runs on the laptop. |
| 37379510900, 37379511012 | PR #172's gate and unit runs. |
| 37391190949, 37391190926 | PR #175's gate (two attempts) and unit runs. |
| 37096136960 | A PR gate red where neither job ran a step: GitHub's minutes had run out (infra). |
| 37103854046 | A PR gate red where only the job that files a passed gate failed (filing). |
| 37168916705 | A PR gate red on the laptop with a real test failure (test). |
| 37355400331 | A red on a throwaway `exp/` branch (experiment). |

To add a case, copy the run from the cache in the same trimmed shape and add a row here.
