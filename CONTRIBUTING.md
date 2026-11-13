# Contributing to HomeQuarters

Thanks for helping. HQ is small, and it stays small by reading what a project writes and running no code from it, so a change that makes HQ run a project's code will not be taken.

## Before you start

Open an issue first for anything bigger than a typo or a clear bug, so we can agree on the shape before you write it. The issue templates ask for what we need.

## Setting up

```sh
git clone https://github.com/drewkhoury/homequarters.git
cd homequarters
npm ci
```

You need Node 22 or later and git. `gh`, `docker`, `devpipe` and `claude` are optional: HQ shows more when they are installed, and the suite passes without them.

## Running the tests

```sh
HOME="$(mktemp -d)" \
GIT_AUTHOR_NAME=you GIT_AUTHOR_EMAIL=you@example.com \
GIT_COMMITTER_NAME=you GIT_COMMITTER_EMAIL=you@example.com \
npm test
```

- The scratch `HOME` keeps the tests away from your own `~/.cache`, where HQ keeps real projects' records.
- The tests make git commits in scratch repos, so git needs the identity above when `HOME` has no git config.
- `HQ_OFFLINE=1` skips the one test that needs the npm registry.

The suite takes about ten seconds. A test that fails now and then is a bug; please report it rather than re-running until it passes.

## Making a change

1. For a bug, write the test that fails first and commit it on its own, then the fix in a second commit.
2. Test what the code does, not how it does it.
3. Add a line to the `Unreleased` section of `CHANGELOG.md` if a project that installs HQ would notice the change.
4. Keep `lib/ui-api.mjs` and the manifest keys backwards compatible: add, never rename or remove.
5. Open a pull request. CI runs the suite on Node 22 and 24, on Linux and macOS.

## Licence

By contributing you agree that your contribution is licensed under the MIT licence in `LICENSE`.
