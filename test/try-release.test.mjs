// Proves: the pre-release comparison (scripts/try-release.mjs) reads a page as the sentences a person sees, with
// digits masked, and reports a sentence the pinned HQ showed that the new one does not, and a page whose status moved;
// a count or an age that changed between the two reads is not a difference. Why: 0.3.3 lost Delivery's "skipped since"
// on QuestKeep's own data, which no test with fixtures saw, and a release is now tried on a project's data first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sentencesOf, compare } from '../scripts/try-release.mjs';

const page = body => `<html><style>.a{color:red}</style><script>var x = "Hidden."</script><body>${body}</body></html>`;

test('a page reads as its visible sentences, digits masked, styles and scripts left out', () => {
  assert.deepEqual([...sentencesOf(page('<p>Same-app redeploys: 4 · skipped since 5 Oct</p><p>Updated 3 min ago. Refresh</p>'))],
    ['Same-app redeploys: # · skipped since # Oct', 'Updated # min ago.', 'Refresh']);
});

test('a sentence that went and a status that moved are reported; a moved count is not', () => {
  const pinned = { '/delivery': { status: 200, ms: 30, html: page('<p>Same-app redeploys: 4 · skipped since 5 Oct</p><p>Deploys: 12</p>') },
    '/machine': { status: 200, ms: 3000, html: page('<p>Tools</p>') } };
  const next = { '/delivery': { status: 200, ms: 31, html: page('<p>Same-app redeploys: 4</p><p>Deploys: 13</p>') },
    '/machine': { status: 500, ms: 90, html: page('<p>Tools</p>') } };
  const [delivery, machine] = compare(pinned, next);
  assert.deepEqual(delivery.gone, ['Same-app redeploys: # · skipped since # Oct']);
  assert.deepEqual(delivery.added, ['Same-app redeploys: #']);
  assert.deepEqual(delivery.status, [200, 200]);
  assert.deepEqual(machine.status, [200, 500]);
  assert.deepEqual([machine.gone, machine.added], [[], []]);
});
