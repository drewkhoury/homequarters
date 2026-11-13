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
fs.writeFileSync(`${here}/run-info-ci.json`, JSON.stringify(JSON.parse(fs.readFileSync(`${tmp}/run-info.json`, "utf8")), null, 2) + "\n");
fs.writeFileSync(`${here}/slot-run.json`, JSON.stringify(scrub(JSON.parse(fs.readFileSync(`${tmp}/slot-run.json`, "utf8"))), null, 2) + "\n");
const lines = fs.readFileSync(`${tmp}/lock/log.jsonl`, "utf8").trim().split("\n").map(l => JSON.stringify(scrub(JSON.parse(l))));
fs.writeFileSync(`${here}/slot-log.jsonl`, lines.join("\n") + "\n");
' "$TMP" "$HERE" "$(CDPATH= cd -- "$QK" && pwd)"
echo "golden records written to $HERE from $QK at $(git -C "$QK" rev-parse --short HEAD)"
