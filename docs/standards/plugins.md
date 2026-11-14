# Plugins

A plugin is a page a project adds to HQ. The manifest's `plugins` list names each one as a path, or as `{ "path": ..., "with": { ... } }` ([manifest.md](manifest.md)). HQ loads them in order when it starts (`lib/plugins.mjs`). A plugin that fails to load is listed on the Machine page and in the start line, and left out; it never stops HQ. QuestKeep's Hunter and Launch pages are the first two.

`test/plugins.test.mjs` proves the loading rules below, and `test/contract-docs.test.mjs` holds the ui table to `lib/ui-api.mjs`.

## The module

A plugin is an ES module with two exports:

```js
export const hqApi = 1;

export default ({ ui, m, with: settings }) => ({
  id: 'launch',
  label: 'Launch',
  path: 'launch',
  demo: false,
  page: async (ctx, params, rest) => ui.layout({ title: 'Launch', active: 'launch', body: `<h1>${ui.esc(settings.greeting || 'Launch')}</h1>` }),
  actions: { refresh: async (body, ctx) => ({ ok: true }) },
});
```

- `hqApi` is the version of the ui object the plugin was written against, a whole number from 1. HQ refuses a module that exports none, or a version newer than its own (`UI_VERSION`), and says why. One written for an older version loads, with a warning.
- The default export is a function. HQ calls it once at start with `ui` (below), `m` (the manifest as HQ resolved it: absolute paths, `m.name`, `m.repo`, `m.cache`, `m.store(id)`) and `with` (the manifest entry's `with` object, or `{}`). It may be async. It answers the page's description.

## The description

| Field | Required | Means |
| --- | --- | --- |
| `id` | yes | a short lower-case word, the nav's key and the action route's name |
| `label` | yes | what the nav shows |
| `path` | yes | the first part of the page's URL, lower-case letters, digits and dashes, starting with a letter. It may not be one of HQ's own (`code`, `repo`, `machine`, `backlog`, `decisions`, `conversations`, `ci`, `export`, `testing`, `runs`, `search`, `delivery`, `problems`, `github`, `docs`, `tests`, `pipeline`, `hq`, `theme`, `raw`, `cache`, `plugin`, `reveal`, `git`, `claude`, `setup`) or another plugin's |
| `page` | yes | `async (ctx, params, rest) => html` for `GET /<path>` and `GET /<path>/<rest>`. `params` is the URL's `URLSearchParams`, `rest` the part after `/<path>/`. Answering `null` is a 404 |
| `actions` | no | `{ name: async (body, ctx) => result }`, each taken as `POST /plugin/<id>/<name>` from HQ's own pages only: JSON in, JSON out, a thrown error a 500 with its message |
| `demo` | no | `false` keeps the page out of the demo setting: out of the nav, its page answering not found and its actions refused. Default `true` |

`ctx` is HQ's own for the request. A plugin may read `ctx.repo`, `ctx.cache`, `ctx.m` and `ctx.demo` (the demo setting, or `null` when it is off); the rest of it may change in any release.

A page in the demo is swapped like HQ's own: every name the setting hides is replaced as the answer leaves the server, so a plugin needs no demo code of its own unless it shows something the swap cannot know.

## The ui object

The one API HQ promises a plugin, frozen, from `lib/ui-api.mjs`. Within a major version a member is never removed or given another meaning; a new one may be added, with `UI_VERSION` raised.

| Member | Gives |
| --- | --- |
| `UI_VERSION` | the version of this object, 2 (2 from 0.2.0, which added the members from `kindIn` down) |
| `layout` | `layout({ title, active, body, wide, full, head, skip, scripts })`: a whole HQ page around `body`, with the header, the nav (`active` is the nav key to mark) and the theme |
| `esc` | `esc(s)`: text made safe for HTML |
| `urlPath` | `urlPath(p)`: a repo path as a URL path, each part encoded and the slashes kept |
| `info` | `info(text, label)`: the "i" mark that shows `text` on hover, focus or a tap |
| `dataTable` | `dataTable({ id, columns, rows, empty, cls })`: a sortable, filterable table |
| `duration` | `duration(seconds)`: a length of time in two units at most, as HQ writes every one |
| `numbers` | `numbers({ caption, head, rows })`: a chart's figures as a table for screen readers |
| `dayChart` | `dayChart(rows, series, options)`: a chart of values by day |
| `hbars` | `hbars(rows, label)`: bars across, one per value |
| `spark` | `spark(values, options)`: a small line of recent values |
| `dotPlot` | `dotPlot(points, options)`: dots over time with a median line and a band |
| `partsBar` | `partsBar(parts, options)`: one bar split into its parts |
| `stackBars` | `stackBars(rows, options)`: stacked bars, one per row |
| `strip` | `strip(events, options)`: events on a time line |
| `renderMarkdown` | `renderMarkdown(text, from, kind, { rawHtml })`: markdown as HQ renders the repo's docs |
| `runGit` | `runGit(args, cwd)`: git's output, or `''` when it failed. HQ itself only reads with it |
| `runGh` | `runGh(args, cwd)`: gh's output with the person's own login; rejects when gh fails. HQ itself only reads with it |
| `kindIn` | `kindIn(root)(path)`: `'file'`, `'dir'` or `null` for a repo path, through the same check the server serves files by, so a path that leaves the repo or names a refused folder is `null` |
| `gh` | `gh.checksOf(pr)`: a pull request's checks (its `statusCheckRollup` from gh) in one word: `passing`, `failing`, `running` or `none` |
| `git` | `git.belongs(cwd, main)`: whether a folder is the main checkout, inside it, or one of its worktrees |
| `claude` | `claude.folderName(dir)`: the name Claude Code gives a checkout's folder under `~/.claude/projects` |
| `days` | `days.key(ms, tz)`: the day an instant falls on in a zone, as `yyyy-mm-dd`; `days.start(key, tz)`: the instant that day starts there. Delivery's daily copies are filed by these days |
| `backlog` | `backlog.parseItem(text, { slug, stage })`, `backlog.check(items)`, `backlog.openBlockers(item, items)`: a backlog item read, the folder's problems, an item's blockers still open; `backlog.dir()` and `backlog.stages()`: the folder and stages the manifest set |

## homequarters/unstable

HQ's own helpers that run programs, open a terminal, call GitHub through HQ's cache or write its stash: `ghPart`, `branchPr`, `mainCheckout`, `readTurns`, `itemsHtml`, `gitInfo`, `openInClaude`, `findClaude`, `pickTerminal`, `focusTabCommand`, `projectId`, `makeStash`, `readEntry`, `fileFor`, `branchWork`. Each is the function HQ's pages use. None is promised: any may change or go in a minor release, so a project that imports one pins `homequarters` exactly and takes each release in a pull request of its own.

## homequarters/testing

What a project's own tests import. `start(options)` serves HQ on a free port touching nothing on the machine unless the test says so: a new empty cache and Claude projects folder (removed by `close()`), the manifest's link file never written, the demo off whatever `HQ_DEMO` says, claude not installed, and the Machine page asking `NO_TOOLS`, which finds every tool missing and every reading unknown. A test passes its own `probes`, `claude`, `demo`, `cache` or `projectsDir` to change one; the rest of `start()`'s options pass through. It answers `{ url, server, close }`. A plugin that calls `findClaude` from `homequarters/unstable` itself still finds the real one. The readers `loadManifest`, `loadPlugins`, `setNav`, `demoConfig`, `demoFacts`, `demoSettings`, `runInfo`, `readLaptopRuns`, `loadDecisions` and `dailyAsOf` are HQ's own, so a project's contract test holds its records against HQ's reading of them. Navigation and the backlog's settings are process-wide.

Through 0.2, `homequarters/internal/...` reached any file in the package. 0.3.0 removed it: what a project needs is in `homequarters`, `homequarters/testing` or `homequarters/unstable`.
