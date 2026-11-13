# Working on HomeQuarters

Read `README.md` first. `docs/standards/` holds the contract HQ keeps with the projects that use it; read the standard for the part you touch.

## Running the tests

```sh
npm ci
HOME="$(mktemp -d)" npm test
```

- Give every test run a scratch `HOME`. Several commands write under `~/.cache` (the slot, the problem register, the dora store), and a run against your real home can mix test records into a real project's cache.
- A scratch `HOME` has no git config, so set an identity in the environment: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`, as `.github/workflows/test.yml` does.
- `HQ_OFFLINE=1` skips the pack test, the one test that reaches the npm registry.
- `HQ_RACE_ROUNDS=5` runs more rounds of the slot's race test; the release workflow and `prepublishOnly` use it.
- Judge a command by its own exit code. A pipe reports the last command's code, so `npm test | tail` reads as success when the tests fail.

## Changing the code

- A fix counts only when its test fails without it. Commit the failing test first, then the fix, as two commits.
- Test behaviour, not internals. Each test file starts with `Proves:` and `Why:` lines that say what it guards for a reader who has not seen the code.
- `lib/ui-api.mjs` is the only API HQ promises a plugin. Never remove a function from it or change what one means; add new ones.
- A manifest key, once published, is never renamed or removed (`docs/standards/manifest.md`).
- Add a line to the `Unreleased` section of `CHANGELOG.md` for anything a project that installs the package would notice.

## Committing

- Stage by naming paths. Never `git add -A`, `git add .` or `git commit -am`: another session or tool may be writing to the same tree, and a blanket stage commits its work under your message.
- A commit title says what changed in about 60 characters. The body says why.
- Never push a tag or run `npm publish`. A release is a `v*` tag that the person you work with pushes, and `.github/workflows/release.yml` publishes it.
