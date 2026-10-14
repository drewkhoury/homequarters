# The pipeline file

A project tells HQ how a change reaches production in one JSON file, named in `hq.json` under `tests.pipeline`. HQ draws it on the Testing page's Pipeline tab, finds each step's last result in the recorded runs, and takes the problem register's stages from it. Without the file the Pipeline tab says so and the register uses HQ's default stages.

## Shape, schema 1

```json
{
  "schema": 1,
  "about": "One paragraph for the reader, optional.",
  "stages": [
    { "id": "unit", "label": "Unit tests", "about": "The fast tests, run by hand or by a hook." },
    { "id": "gate", "label": "The gate", "about": "What runs on a pull request." },
    { "id": "merge", "label": "The merge", "about": "The change merged and went live.", "merge": true },
    { "id": "after", "label": "After the merge", "about": "What runs once it is live." }
  ],
  "paths": [
    { "id": "pr", "title": "A pull request", "steps": [
      { "title": "Unit tests", "stage": "unit", "sets": ["unit"], "results": [{ "where": "laptop", "task": "unit" }] },
      { "title": "The gate", "stage": "gate", "sets": ["gate"], "results": [{ "where": "ci", "task": "gate" }],
        "parts": [{ "title": "Half a", "sets": ["rules"] }, { "title": "Half b", "sets": ["unit"] }] },
      { "title": "Deploy", "stage": "merge", "what": "What happens here, shown on the page." },
      { "title": "Live check", "stage": "after", "planned": "prod-smoke" }
    ] }
  ]
}
```

- `schema` is the whole number of this shape. A reader treats a missing one as 1 and a newer one as the newest it knows, with a warning.
- `stages` run in pipeline order. Each has an `id` (lower case, letters, digits and dashes), a `label` and an `about`; a string is shorthand for an id. Exactly one is marked `merge: true`, the point after which a problem has reached users. A stage may list the ids it `was`, so lines recorded under an old id still read. A stage id is never renamed, only retired.
- Each step names its `stage`. A part takes its step's stage unless it names its own. A step may also carry `what` (shown beside the title), `sets` (the test sets that run there), `layers` (kinds of test from `tests.layers`), `tests` (single test files), `results` (where its last result comes from: `where` is laptop, container or ci, `task` is the task's id in a recorded run) and `planned` (a backlog item's file name for a step not built yet).

## The stages the register uses

HQ places five stages of its own around the file's: `self` (the agent noticed before anything ran), then the file's stages before the merge, then `reviewer` and `you`, then the merge and the stages after it, then `you-after` and `users`. A project cannot redefine those five, and `person`, `person-after` and `players` are read as `you`, `you-after` and `users`.

A commit trailer `Found-at: <stage>` and the writer's `--found-at` and `--should-have-caught-at` take any of these ids. A red recorded from a place and task that a step's `results` names is found at that step's stage.

When the file names no `stages`, HQ uses `checks`, `merge` and `after`, so a project can start recording problems before it describes its pipeline.

## What HQ warns about and leaves out

A stage with a bad id, one of HQ's own ids, an old name, or a repeat is left out with a warning on the Machine page and at start. A step naming a stage the list does not have warns. A file with stages and no `merge` mark reads every stage as before the merge and says so.
