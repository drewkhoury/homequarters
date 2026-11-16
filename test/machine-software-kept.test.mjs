// Proves: the Machine page's software list is kept in the cache folder: a restarted HQ answers from the list it saved,
// running no tool, and asks the tools again after the response once the list is over a minute old; with no list saved,
// the tools are asked at once. Why: firebase --version alone takes a second, so the first Machine page after every
// start waited on a dozen tools for a list that rarely changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let n = 0;
const restarted = () => import(`../pages/machine.mjs?restart=${++n}`);
const tools = () => { const ran = []; return { ran, exec: async (cmd, args) => { ran.push(cmd); return { ok: true, out: `${cmd} 1.0.0\n`, err: '' }; } }; };

test('a restarted HQ answers the software list from the cache, and asks the tools again after the response', async t => {
  const cache = mkdtempSync(join(tmpdir(), 'hq-software-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const first = tools(), queued = [], later = fn => queued.push(fn);
  const list = await (await restarted()).softwareList(cache, { exec: first.exec, later, now: 0 });
  assert.ok(first.ran.length > 0 && list.length > 0, 'with nothing saved the tools are asked at once');
  assert.ok(existsSync(join(cache, 'hq', 'software.json')), 'and the list is saved');
  const again = tools();
  const { softwareList } = await restarted();
  assert.deepEqual(await softwareList(cache, { exec: again.exec, later, now: 30000 }), list);
  assert.deepEqual(again.ran, [], 'a restart within the minute runs no tool');
  assert.equal(queued.length, 0);
  assert.deepEqual(await softwareList(cache, { exec: again.exec, later, now: 61000 }), list, 'past the minute the page answers from the saved list');
  assert.deepEqual(again.ran, [], 'before asking any tool');
  assert.equal(queued.length, 1, 'one asking waits for after the response');
  await softwareList(cache, { exec: again.exec, later, now: 61500 });
  assert.equal(queued.length, 1, 'a second page does not queue another');
  await queued.shift()();
  assert.ok(again.ran.length > 0, 'the queued asking runs the tools');
});
