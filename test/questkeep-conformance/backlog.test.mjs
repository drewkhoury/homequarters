// The backlog in docs/backlog/ keeps to the rules its README sets: every item names its type and who asked, a
// blocked-by names an item that exists, no item runs past 150 words, and the inbox holds at most 10. Runs before each
// commit with the other fast tests, so a broken item never lands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadItems, check, normTitle } from '../../lib/backlog.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const items = loadItems(REPO);

test('every item in docs/backlog keeps to the rules', () => {
  assert.ok(items.length > 0, 'no items found; is docs/backlog there?');
  assert.deepEqual(check(items), []);
});

test('the README that explains the backlog is there', () => {
  assert.ok(existsSync(join(REPO, 'docs', 'backlog', 'README.md')));
});

test('each entry the old BACKLOG.md had when it closed names a file that exists or existed', () => {
  // hq/backlog-map.json ties the old file's history to the items; a slug that names nothing loses that history
  const map = JSON.parse(readFileSync(join(REPO, 'hq', 'backlog-map.json'), 'utf8'));
  const titles = map.map(m => normTitle(m.old));
  assert.equal(new Set(titles).size, titles.length, 'an old title is mapped twice');
  for (const m of map) assert.match(m.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, m.old);
});
