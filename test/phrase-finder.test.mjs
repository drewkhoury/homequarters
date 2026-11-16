// Proves: phraseFinder finds exactly the phrases a text holds, as text.includes would for each, for phrases that
// overlap, that end inside one another, that are another's start, and that hold characters past ASCII; on 2,000 random
// texts over a small alphabet it agrees with includes every time. Why: the Conversations page finds which sessions
// mention each backlog item with it, in one pass over each text, and a miss would drop a session from an item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { phraseFinder } from '../lib/conversations.mjs';

const naive = (phrases, text) => new Set(phrases.map((p, i) => (p && text.includes(p) ? i : -1)).filter(i => i >= 0));
const same = (phrases, text) => assert.deepEqual([...phraseFinder(phrases)(text)].sort(), [...naive(phrases, text)].sort(), `${JSON.stringify(phrases)} in ${JSON.stringify(text)}`);

test('the phrases found are the ones includes finds, for overlapping, nested and non-ASCII phrases', () => {
  const phrases = ['he', 'she', 'his', 'hers', 'smoke-accounts', 'smoke-accounts-refused', 'accounts', 'café crème', 'é', ''];
  for (const text of ['ushers', 'she said his', 'the smoke-accounts-refused item', 'smoke-account', 'a café crème', 'cafe creme', '', 'é']) same(phrases, text);
});

test('on random texts over a small alphabet the finder agrees with includes', () => {
  let seed = 7;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const word = (alphabet, max) => Array.from({ length: 1 + rand(max) }, () => alphabet[rand(alphabet.length)]).join('');
  const alphabet = ['a', 'b', '-', 'é'];
  for (let k = 0; k < 2000; k++) {
    const phrases = Array.from({ length: 1 + rand(6) }, () => word(alphabet, 4));
    same(phrases, word(alphabet, 30));
  }
});
