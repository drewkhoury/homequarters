# The manifest, hq.json

A project declares itself to HQ in one file at the repo root, `hq.json`. HQ reads no folder the manifest does not name, and a repo with no manifest gets the baseline pages (Home, Repo, Machine, GitHub, Conversations, Export) and nothing else. `hq setup` scans the repo and the machine and prints the manifest it would propose; the person adds it. HQ never writes the file.

```json
{
  "schemaVersion": 1,
  "name": "questkeep",
  "cache": "~/.cache/questkeep",
  "docs": { "home": "README.md", "groups": "hq/groups.json" },
  "backlog": { "dir": "docs/backlog", "stages": ["inbox", "next", "parked"], "map": "hq/backlog-map.json", "earlier": "docs/BACKLOG.md" },
  "decisions": { "dir": "docs/decisions", "earlier": "docs/DECISIONS.md" },
  "tests": { "layers": "tests/layers.json", "pipeline": "hq/pipeline.json", "sets": "tests/sets.json" },
  "stores": ["runs", "lock", "problems", "dora", "ci"],
  "info": true,
  "deploy": [{ "env": "prod", "provider": "firebase-hosting", "url": "https://questkeep.web.app", "with": { "project": "questkeep" } }],
  "delivery": { "userPaths": ["web", "firestore.rules"], "deployWorkflow": ".github/workflows/deploy.yml", "testWorkflow": ".github/workflows/test.yml", "tz": "America/New_York",
    "gateJobs": ["test", "laptop"], "deployJob": "deploy", "smokeJob": "smoke", "deploySteps": ["Deploy to production"], "reuseSteps": ["Reuse a gate that passed"], "testSteps": ["Run the tests"] },
  "plugins": [{ "path": "./hq-plugins/launch.mjs", "with": {} }],
  "demo": "hq/demo.json",
  "link": "web/.hq.json"
}
```

## The keys of schema 1

| Key | Required | Turns on |
| --- | --- | --- |
| `schemaVersion` | yes | the defaults epoch, a whole number from 1 |
| `name` | yes | the project's name: `^[a-z0-9][a-z0-9-]*$`, used in the cache path, titles and export file names |
| `cache` | no | the cache folder; default `$XDG_CACHE_HOME/hq/<name>`, else `~/.cache/hq/<name>` |
| `docs` | no | `home`: the file Home opens on; `groups`: the groups file the file tree narrows to |
| `backlog` | no | the Backlog page: `dir` of stage folders, `stages` in order (default inbox, next, parked), `map` of renamed items, `earlier` one-line file |
| `decisions` | no | the Decisions page: `dir` of dated files, `earlier` one-line file |
| `tests` | no | the Testing page: `layers`, `pipeline`, `sets` and `headers` globs (`docs/standards/pipeline.md`, `sets.md`) |
| `stores` | no | which folders under the cache HQ reads: `runs`, `lock`, `problems`, `dora`, `ci`; each a string or `{ id, path }` |
| `info` | no | the status line's `.git/project-info.json`; `true` or an object |
| `deploy` | no | deploy providers, each `{ env, provider, url, with }`; HQ never reads inside `with` |
| `delivery` | no | `userPaths`: the paths a change must touch to count as reaching users; `deployWorkflow` and `testWorkflow`: the workflow files whose runs are deploys and test runs; `tz`: the zone the days are counted in. Each defaults to what HQ did before the key: every path, `deploy.yml`, `test.yml`, New York `gateJobs`: the jobs of a test run that are the gate; `deployJob` and `smokeJob`: the deploy run's job that deploys and the one that smoke-tests the release; `deploySteps`, `reuseSteps`, `testSteps`: the steps, matched by their first words, that deploy, that reuse an earlier gate, and that run the tests. With none named, every job of a test run is the gate, a deploy is any successful run of the deploy workflow, live when its last job ended, and no gate is reused. |
| `plugins` | no | pages the project adds, each a string path or `{ path, with }`; a module exports `hqApi` and a default factory taking `{ ui, m }` |
| `demo` | no | the demo setting's file for filming |
| `link` | no | the link file: `hq serve` writes `{"url": "http://127.0.0.1:<port>", "pid": <pid>}` on one line there as it starts, so the project's app can link to HQ, and removes it when it stops unless a newer HQ has written its own since. With no `link`, HQ writes nothing in the repo |
| `$schema` | no | for editors; never warned about |

Paths are from the repo root unless they start with `/` or `~/`. The separator is `/` on every platform. Nothing is interpolated from the environment.

## Versioning

- `schemaVersion` is the defaults epoch. A key's shape never changes inside an epoch; a new shape is a new key, and the old key stays readable. HQ bumps the schema only when a default changes, and applies the defaults of the manifest's own epoch, so an old manifest keeps its old behaviour.
- HQ at schema N reads every manifest from 1 to N. A newer manifest is read with the newest defaults HQ knows and a warning; its unknown keys are listed on the Machine page and left alone. `hq check` says both as notes and counts neither as a problem, so a check in CI stays green the day a teammate's HQ writes the next schema. An unknown key in a manifest at HQ's own schema or older is a problem: a typo, at the top level or inside `docs`, `backlog`, `decisions`, `tests`, `delivery` or `info`. A manifest with no `name` is warned and named after its folder.
- A key, once published, is never renamed or removed. A replaced key keeps working and the warning names what replaces it.
- Every list element takes a string or an object, and a string is shorthand for the object's one needed attribute, so adding a second attribute never changes a shape.
- The convention files the manifest names (`tests.layers`, `tests.pipeline`, `tests.sets`, `docs.groups`, `demo`) carry their own `schema`, a whole number; missing reads as 1, newer or malformed warns once at start and is read for what HQ knows. Each store's files carry their own version too (`v` on appended lines, `version` in `dora.json`); the manifest never versions a store's contents.

## What HQ does with it

The manifest is read once, when `hq` or a writer starts (`lib/manifest.mjs`). The one file HQ writes in the repo is the link file, and only when `link` names it; the project keeps it out of git (QuestKeep's `.gitignore` lists `web/.hq.json`). Every writer (`hq slot`, `hq run-info`, `hq space`, `hq ci-keep`, `hq problem`, `hq dora`, `hq backlog`) finds the repo from `--repo`, `HQ_REPO`, or the git checkout it runs in, and takes the cache and the stores from the manifest. The Machine page shows the manifest HQ read, its warnings, and what `hq setup` would propose instead.
