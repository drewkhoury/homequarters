// Proves: hq serve's warm-up (lib/warm.mjs) asks for Home, then each page Home's nav links and the heavy Testing tabs,
// one request at a time and each once, and goes on past a page that fails.
// Why: the first click after a start read the run store and the register, 5 to 30 seconds on QuestKeep's data; the
// warm-up does that before the person clicks, and one request at a time leaves room for theirs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { navPages, warmUp } from '../lib/warm.mjs';

const HOME = '<html><nav class="hq-nav" aria-label="Pages"><a href="/">Home</a><a href="/testing">Testing</a><a href="/problems">Problems</a><a href="/broken">Broken</a></nav><a href="/elsewhere">not in the nav</a></html>';

test("the nav's pages are read from Home's nav alone, in order and once each", () => {
  assert.deepEqual(navPages(HOME), ['/', '/testing', '/problems', '/broken']);
  assert.deepEqual(navPages('<p>no nav</p>'), []);
});

test('the warm-up asks for each page once, one at a time, and goes on past a page that fails', async () => {
  const asked = [];
  let open = 0, most = 0;
  const server = createServer((req, res) => {
    asked.push(req.url); open++; most = Math.max(most, open);
    setTimeout(() => {
      open--;
      if (req.url === '/broken') { req.socket.destroy(); return; }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(req.url === '/' ? HOME : 'ok');
    }, 15);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const done = await warmUp(`http://127.0.0.1:${server.address().port}`);
    assert.deepEqual(asked, ['/', '/testing', '/problems', '/broken', '/testing?tab=tests', '/testing?tab=runs']);
    assert.equal(most, 1, 'one request at a time');
    assert.equal(done.find(d => d.path === '/broken').status, null);
    assert.equal(done.find(d => d.path === '/problems').status, 200);
  } finally { server.close(); }
});
