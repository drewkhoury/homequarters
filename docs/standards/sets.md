# The test sets

A project tells HQ which test files make up each set a run can be in one JSON file, named in `hq.json` under `tests.sets`. The Testing page uses it to say what a run of a set covered, the live-run page to count what is still to come, and the pipeline file's `sets` to find a step's tests.

```json
{
  "schema": 1,
  "sets": {
    "gate": ["smoke-sync", "smoke-reject", "load-check"],
    "after": ["walk-world", "walk-universe"]
  }
}
```

- `schema` is the whole number of this shape. A reader treats a newer one as the newest it knows, with a warning.
- A set's name is a short lower-case word. Its list holds test names: the file's name without its folder or extension, so `tests/smoke-sync.js` is `smoke-sync`. A name may appear in more than one set.
- A set that is not a list of names is left out with a warning on the Machine page and at start.

The set names a project uses are its own. The recorded run line's `kind` (`hq run-info <kind>`) and a pipeline step's `sets` name the same words, which is how HQ joins a run to what it was meant to cover.

For one release, a project with no `tests.sets` and a Makefile at its root with `GATE := ...` and `AFTER := ...` lines is read from those lines, since that is where QuestKeep kept them. `hq setup` proposes the file from them; the project adds it and names it in `hq.json`. A Makefile that builds its lists from the file keeps the two from drifting; a unit test that reads both does too.
