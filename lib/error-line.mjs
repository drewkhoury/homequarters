// The facts line on a red gate: for each failing test, its error line, and where else the same line turned up, so one
// cause shared across tests and branches (a burst) is seen at the second red rather than after days of reruns blamed on
// load (docs/decisions/2026-10-13-red-gates-print-their-facts.md). It reports and decides nothing: a red stays red.
//
// Every burst of 26 September to 11 October spread across tests: the slowness to gstatic on 8 October failed 32 of 35
// browser tests, none more than 8% of its runs, so a view by test never showed it. What the reds shared was a line in
// their logs. Pure functions here; scripts/facts.mjs reads the logs and the run store and prints.

// What makes a line from one run comparable with another's: times, ids, ports and counts vary, the cause does not.
export function normalize(line) {
  return String(line)
    .replace(/\[?\d{4}-\d{2}-\d{2}T[\d:.]+Z\]?/g, '')                   // ISO times
    .replace(/\?[^\s"']*/g, '')                                         // query strings
    .replace(/https?:\/\/(\d+\.\d+\.\d+\.\d+|localhost):\d+/g, 'local') // the emulators and the server, on any port
    .replace(/https?:\/\/([^/\s"']+)[^\s"']*/g, '$1')                   // an outside URL by its host alone
    .replace(/demo-qk-[\w-]+/g, 'demo-qk')                              // a test's own project
    .replace(/%2F[A-Za-z0-9]{12,}/g, '%2FID')                           // an account id in a Storage path
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'ID')
    .replace(/\b[0-9a-f]{16,}\b/gi, 'ID').replace(/\b[A-Za-z0-9]{20,}\b/g, 'ID')
    .replace(/\d{3,}/g, 'N')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
}

// A bare Playwright timeout says only that something never came: a sync bug and a slow network look the same, so such a
// line is marked generic and never taken alone for a shared cause.
const TIMEOUT = /^(page|locator|frame|browser|context)?\.?[\w.]+: Timeout \d+ms exceeded/;

// The lines in one test's log that could be its cause, best first. A thrown error says most; then what the page logged
// as an error; then a request that failed outright or a refused one; then the test's own failed checks; a timeout last.
export function candidates(text) {
  const out = [], lines = String(text || '').split('\n');
  // the browser's echo of a failed request names no URL; the request's own FAILED, SEALED or HTTP line does
  const echo = l => /^Failed to load resource: /.test(l);
  const add = (rank, line, generic = false) => { const n = normalize(line); if (n && !echo(n)) out.push({ rank, line: n, generic }); };
  lines.forEach((l, i) => {
    const t = l.trim();
    let m;
    if (/^AssertionError( \[\w+\])?: Expected values to be [\w -]+:$/.test(t)) {
      // node's assert says only "Expected values to be strictly deep-equal:"; the first line of the diff that is the
      // actual value's own says what came: on 8 October, "Installing packages…" from npm ci run inside the gate
      const plus = lines.slice(i + 1, i + 12).map(x => x.trim()).find(x => /^\+ /.test(x) && !/^\+ actual - expected/.test(x) && !/^\+\s*[[\]{}]?,?$/.test(x));
      add(1, plus ? `AssertionError: ${plus.replace(/^\+\s+/, '+ ')}` : t, !plus);
    } else if (/^(Error|TypeError|RangeError|SyntaxError|ReferenceError|AssertionError)( \[\w+\])?: /.test(t)) add(1, t);
    else if ((m = /^errors: (\[.+\])$/.exec(t)) && m[1] !== '[]') {
      try { for (const e of JSON.parse(m[1])) add(2, e.replace(/^[AB]: /, '')); } catch { add(2, m[1]); }
    } else if (/^ERR\s/.test(t)) add(2, t.replace(/^ERR\s+(page\d+\s+)?/, '')); // a console error, as the multi-page tests print it
    else if (/^(FAILED|SEALED) [A-Z]+ \S+ :: net::ERR_\w+/.test(t)) add(3, t);
    else if (/^HTTP [45]\d\d [A-Z]+ /.test(t)) add(4, t.split(' :: ')[0]);
    else if (/^FAIL$/.test(t) && lines[i + 1] && lines[i + 1].trim()) add(5, `FAIL: ${lines[i + 1].trim().replace(/^- /, '').split(' :: ')[0]}`); // FAIL, then its first check, with a dash or not
    else if (/^FAIL \S/.test(t) && !TIMEOUT.test(t.slice(5))) add(5, `FAIL: ${t.slice(5).split(' :: ')[0]}`); // the one-line form: FAIL and the check
    else if (TIMEOUT.test(t.replace(/^[A-Z-]+ FAILED /, '').replace(/^FAIL /, ''))) {
      // the frame it timed out in, when the test's own code names one: "in signIn" parts sign-in from everything else
      const at = lines.slice(i + 1, i + 4).map(x => /at (?:async )?(\w+) \(\/repo\/tests\//.exec(x)).find(Boolean);
      add(6, `${t.replace(/^[A-Z-]+ FAILED /, '').replace(/^FAIL /, '').replace(/ Timeout \d+ms exceeded\./, ' timed out')}${at ? ` in ${at[1]}` : ''}`, true);
    }
  });
  return out.sort((a, b) => a.rank - b.rank);
}

// The lines a run's passing tests also printed: shared by red and green alike, they cannot be what failed. With the
// browsers sealed (tests/helpers.js), every signed-in test logs its refused avatar request; without this, every red would
// read as a burst seen in thirty tests.
export function sharedLines(passingTexts) {
  return new Set(passingTexts.flatMap(t => candidates(t).map(c => c.line)));
}

// A failing test's cause: its best line that a passing test of the same run did not also print. When every line it has
// was printed by a passing test too, its best line still, marked shared: on 4 October the clock's message failed some
// tests and passed others under the 5 ms the helper allows, and was the cause all the same. Null when it has none.
export function causeOf(text, shared = new Set()) {
  const all = candidates(text), c = all.find(x => !shared.has(x.line));
  return c ? { line: c.line, generic: c.generic } : all.length ? { line: all[0].line, generic: all[0].generic, shared: true } : null;
}

// For each failing test of this run, where its line turned up elsewhere. history: the other runs' failing tests as
// [{ run, when, branch, test, line }]; within: the window that counts as now (6 hours). Answers [{ test, line, generic,
// recent: { tests, runs, branches }, before }], tests counting this one, before being the latest sighting older than the window, since the
// node_modules burst's clusters came 15 to 26 hours apart.
export const WINDOW_H = 6;
export function factsFor(red, history, { now = Date.now(), within = WINDOW_H } = {}) {
  const from = now - within * 3600e3;
  return red.tests.map(t => {
    if (!t.line) return { test: t.test, line: null, generic: false, recent: null, before: null, rerun: t.rerun || null };
    const flags = { generic: t.generic, ...(t.shared ? { shared: true } : {}) };
    const same = history.filter(h => h.line === t.line && h.run !== red.run);
    const recent = same.filter(h => Date.parse(h.when) >= from && Date.parse(h.when) <= now);
    const older = same.filter(h => Date.parse(h.when) < from).sort((a, b) => Date.parse(b.when) - Date.parse(a.when));
    const others = red.tests.filter(o => o !== t && o.line === t.line).map(o => o.test);
    return {
      test: t.test, line: t.line, ...flags,
      recent: {
        tests: new Set([t.test, ...others, ...recent.map(h => h.test)]).size,
        runs: new Set(recent.map(h => h.run)).size,
        branches: new Set(recent.map(h => h.branch).concat(red.branch ? [red.branch] : [])).size,
      },
      before: older[0] ? { when: older[0].when, branch: older[0].branch, test: older[0].test } : null,
      rerun: t.rerun || null,
    };
  });
}

const short = iso => { const d = new Date(iso); return `${d.getUTCDate()} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)} UTC`; };

// The lines to print: one per error line, naming every failing test that showed it, facts only. Never "don't
// investigate" or "known flake": a generic line can be a real bug, and a line seen everywhere can still hide one.
export function factLines(facts) {
  const groups = [];
  for (const f of facts) {
    const g = f.line && groups.find(x => x.line === f.line);
    if (g) g.tests.push(f); else groups.push({ ...f, tests: [f] });
  }
  return groups.map(g => factLine({ ...g, test: g.tests.map(t => t.test).join(', '), rerun: g.tests.map(t => t.rerun && (g.tests.length > 1 ? `${t.test} ${t.rerun}` : t.rerun)).filter(Boolean).join(', ') || null }));
}

export function factLine(f) {
  if (!f.line) return `=== facts ${f.test}: no error line found in its log${f.rerun ? ` · rerun: ${f.rerun}` : ''}`;
  const r = f.recent;
  const where = r.runs || r.tests > 1
    ? `last ${WINDOW_H} h: ${r.tests} test${r.tests === 1 ? '' : 's'}, ${r.runs} other run${r.runs === 1 ? '' : 's'}, ${r.branches} branch${r.branches === 1 ? '' : 'es'}`
    : `not seen elsewhere in the last ${WINDOW_H} h`;
  const was = f.before ? `${short(f.before.when)} (${f.before.test}${f.before.branch ? `, ${f.before.branch}` : ''})` : 'never';
  return `=== facts ${f.test}: "${f.line}"${f.generic ? ' (generic)' : ''}${f.shared ? " (this run's passing tests printed it too)" : ''} · ${where} · before that: ${was}${f.rerun ? ` · rerun: ${f.rerun}` : ''}`;
}
