// Proves: an answer kept by kept() is worked out once for the same arguments, again for a new object or a new value,
// and with the arguments in the order given.
// Why: HQ keeps the flakes and each file's results against the run store's array, so a new run, which is a new array,
// must be worked out afresh and never answered from the last one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kept } from '../lib/kept.mjs';

test('the same arguments are worked out once, a new array or value again', () => {
  let calls = 0;
  const count = kept((runs, where) => (calls++, runs.filter(r => !where || r === where).length));
  const runs = ['laptop', 'ci'];
  assert.equal(count(runs), 2);
  assert.equal(count(runs), 2);
  assert.equal(calls, 1);
  assert.equal(count(runs, 'ci'), 1);
  assert.equal(count(runs, 'ci'), 1);
  assert.equal(calls, 2);
  assert.equal(count([...runs, 'ci']), 3, 'a new array, as after a new run');
  assert.equal(calls, 3);
  assert.equal(count(runs, undefined), 2, 'an undefined argument is a value of its own');
});

test('an answer of undefined or null is kept too', () => {
  let calls = 0;
  const none = kept(x => (calls++, x.length ? x[0] : undefined));
  const empty = [];
  assert.equal(none(empty), undefined);
  assert.equal(none(empty), undefined);
  assert.equal(calls, 1);
});
