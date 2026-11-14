// Proves: localMinute gives the same text toLocaleString('sv-SE') did, for two years of times either side of each
// summer-time change, and null for a value that is no time.
// Why: the Testing, GitHub, Conversations and Problems pages show every run's time with it, and changing how it is made
// must not change what they show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localMinute } from '../lib/when.mjs';

const old = iso => { const d = new Date(iso); return isNaN(d) ? null : d.toLocaleString('sv-SE', { hour12: false }).slice(0, 16); };

test("a time reads as toLocaleString('sv-SE') read it, through every summer-time change", () => {
  const start = Date.parse('2025-01-01T00:00:00Z');
  for (let t = start; t < start + 2 * 365 * 864e5; t += 7 * 3600e3 + 61e3) {
    const iso = new Date(t).toISOString();
    assert.equal(localMinute(iso), old(iso), iso);
  }
  assert.match(localMinute('2026-11-14T10:09:30Z'), /^2026-11-1\d \d\d:\d\d$/);
});

test('a value that is no time is null', () => {
  for (const x of ['nope', undefined, 'not a date']) assert.equal(localMinute(x), null, String(x));
});
