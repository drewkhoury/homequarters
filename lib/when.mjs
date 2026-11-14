// A time as the pages show it, on this machine's clock: 2026-11-14 10:09. One formatter made once, since making one per
// call (what toLocaleString does) cost the Tests tab over a second for its few thousand times. Answers null for a
// value that is no time, and each page says what it shows then.
const MINUTE = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false });
export function localMinute(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : MINUTE.format(d).slice(0, 16);
}
