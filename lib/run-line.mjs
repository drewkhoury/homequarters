// The "=== run {...}" line tests/run-info.mjs prints at the top of a recorded task's log, read back: its JSON, or null.
// HQ (hq/lib/runs.mjs) and make prune-runs (scripts/runs-prune.mjs) both read it, so it lives here, inside the files the
// tree hash covers, where scripts/ may load it.
export function runInfoLine(text) {
  const m = /^=== run (\{.*\})\s*$/m.exec(text);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}
