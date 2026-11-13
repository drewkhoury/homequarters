#!/bin/sh
# Writes this folder's golden records from QuestKeep's own writers, in a fixed environment. README.md says why and when.
# Usage: test/fixtures/golden/regenerate.sh <a QuestKeep checkout>
# Nothing here touches the real stores: HOME and the lock folder are a throwaway folder, removed at the end.
set -eu
QK=${1:?usage: regenerate.sh <a QuestKeep checkout>}
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TMP=$(mktemp -d)
trap 'kill "$HOLDER" 2>/dev/null || true; rm -rf "$TMP"' EXIT
mkdir -p "$TMP/home" "$TMP/lock"

# The run line, as QuestKeep's self-hosted runner writes it on a push to main (tests/run-info.mjs).
env -i PATH="$PATH" HOME="$TMP/home" \
  GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=self-hosted GITHUB_RUN_ID=19000000001 GITHUB_RUN_ATTEMPT=2 \
  GITHUB_EVENT_NAME=push GITHUB_REF_NAME=main QK_COMMIT=0123456789abcdef0123456789abcdef01234567 \
  QK_TARGET=test-gate QK_HALF=1 \
  node "$QK/tests/run-info.mjs" gate --json "$TMP/run-info.json"

# The run lines a laptop writes: a person's `make test` and a container gate (`make docker-gate`), as QuestKeep's Makefile
# starts tests/run-info.mjs for each, with no LANES given, so the writer's own lanes default shows (2, or 3 for a gate in
# its test image). On a laptop the writer runs git in the folder it is run from, so it runs in a throwaway checkout
# named questkeep on main whose one commit is made with fixed names and dates: its hash is the same every time, and the
# test makes the same commit.
GOLDEN_GIT="GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=golden GIT_AUTHOR_EMAIL=golden@example.invalid GIT_COMMITTER_NAME=golden GIT_COMMITTER_EMAIL=golden@example.invalid GIT_AUTHOR_DATE=2026-11-13T00:00:00Z GIT_COMMITTER_DATE=2026-11-13T00:00:00Z"
mkdir "$TMP/questkeep"
env -i PATH="$PATH" HOME="$TMP/home" $GOLDEN_GIT git -C "$TMP/questkeep" init -q -b main
env -i PATH="$PATH" HOME="$TMP/home" $GOLDEN_GIT git -C "$TMP/questkeep" commit -q --allow-empty -m golden
laptop() {
  (CDPATH= cd -- "$TMP/questkeep" && env -i PATH="$PATH" HOME="$TMP/home" node "$QK/tests/run-info.mjs" "$@")
}
laptop test --json "$TMP/run-info-test.json"
laptop docker-gate --json "$TMP/run-info-docker-gate.json"

# The slot: a take and a release by the self-hosted runner for a deploy's gate (scripts/lock.mjs). A sleep stands in for
# the make recipe's shell, whose process number the record keeps.
sleep 600 & HOLDER=$!
lock() {
  env -i PATH="$PATH" HOME="$TMP/home" USER=golden QK_LOCK_DIR="$TMP/lock" QK_NO_DOCKER=1 QK_LOCK_PID="$HOLDER" \
    QK_WHO=golden-runner GITHUB_RUN_ID=19000000001 GITHUB_RUN_ATTEMPT=2 \
    QK_RUN_TESTS="sync-offline island-stamps" JUNIT=1 QK_KIND=deploy QK_PLACE=home \
    node "$QK/scripts/lock.mjs" "$@"
}
lock take test-gate
cp "$TMP/lock/run.json" "$TMP/slot-run.json"
lock release test-gate 0

# The checkout's path names the machine's home folder: it is volatile, so it is written as a placeholder.
node -e '
const fs = require("fs"), [tmp, here, qk] = process.argv.slice(1);
const scrub = o => (o.path === qk ? { ...o, path: "/path/to/questkeep" } : o);
const copy = (from, to) => fs.writeFileSync(`${here}/${to}`, JSON.stringify(JSON.parse(fs.readFileSync(`${tmp}/${from}`, "utf8")), null, 2) + "\n");
copy("run-info.json", "run-info-ci.json");
copy("run-info-test.json", "run-info-test.json");
copy("run-info-docker-gate.json", "run-info-docker-gate.json");
fs.writeFileSync(`${here}/slot-run.json`, JSON.stringify(scrub(JSON.parse(fs.readFileSync(`${tmp}/slot-run.json`, "utf8"))), null, 2) + "\n");
const lines = fs.readFileSync(`${tmp}/lock/log.jsonl`, "utf8").trim().split("\n").map(l => JSON.stringify(scrub(JSON.parse(l))));
fs.writeFileSync(`${here}/slot-log.jsonl`, lines.join("\n") + "\n");
' "$TMP" "$HERE" "$(CDPATH= cd -- "$QK" && pwd)"
echo "golden records written to $HERE from $QK at $(git -C "$QK" rev-parse --short HEAD)"
