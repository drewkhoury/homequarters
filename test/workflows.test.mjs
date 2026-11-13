// Proves: the test workflow runs the suite on push and pull request on Node 22 and 24, on Linux and macOS, with a git
// identity and offline mode on pull requests, then checks the package's own hq.json; and the release workflow runs on a
// v* tag on Node 24, refuses a tag whose version has no CHANGELOG heading, and publishes with provenance. Why: the suite
// had only run on one Mac, and a release that skips the changelog check or the provenance flag cannot be taken back
// once npm has it. Read as text, so the test needs no YAML parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => {
  const p = join(PKG, '.github/workflows', f);
  assert.ok(existsSync(p), `.github/workflows/${f} is missing`);
  return readFileSync(p, 'utf8');
};

test('the test workflow runs on push and pull request, on Node 22 and 24, on ubuntu and macOS', () => {
  const w = read('test.yml');
  assert.match(w, /^on:[\s\S]*^\s+push:/m);
  assert.match(w, /^on:[\s\S]*^\s+pull_request:/m);
  assert.match(w, /node(-version)?:\s*\[\s*22\s*,\s*24\s*\]/);
  assert.match(w, /os:\s*\[\s*ubuntu-latest\s*,\s*macos-latest\s*\]/);
  assert.match(w, /node-version:\s*\$\{\{\s*matrix\.node\s*\}\}/);
});

test('the test workflow gives git an identity, goes offline on pull requests, and checks the package\'s own hq.json', () => {
  const w = read('test.yml');
  for (const name of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) assert.match(w, new RegExp(`${name}:\\s*\\S`), name);
  assert.match(w, /HQ_OFFLINE:\s*\$\{\{\s*github\.event_name == 'pull_request' && '1' \|\| ''\s*\}\}/);
  assert.match(w, /run:\s*npm ci\b/);
  assert.match(w, /run:\s*npm test\b/);
  assert.match(w, /run:\s*node bin\/hq\.mjs check --repo \./);
  assert.ok(existsSync(join(PKG, 'hq.json')), 'the hq.json the check step reads');
});

test('the release workflow runs on a v* tag, on Node 24, with the id token provenance needs', () => {
  const w = read('release.yml');
  assert.match(w, /^on:\s*\n\s+push:\s*\n\s+tags:\s*\[\s*'v\*'\s*\]/m);
  assert.match(w, /node-version:\s*24\b/);
  assert.match(w, /id-token:\s*write/);
  assert.match(w, /contents:\s*read/);
});

test('the release workflow tests with more race rounds, checks the changelog, then publishes with provenance', () => {
  const w = read('release.yml');
  const at = re => { const m = w.match(re); assert.ok(m, String(re)); return m.index; };
  const tests = at(/HQ_RACE_ROUNDS=5 npm test/);
  const changelog = at(/CHANGELOG\.md/);
  const publish = at(/run:\s*npm publish --provenance --access public/);
  assert.ok(tests < publish && changelog < publish, 'both checks come before the publish');
  assert.match(w, /GITHUB_REF_NAME#v/, 'the version is the tag without its v');
});

test('the release workflow refuses a changelog heading still marked unreleased', () => {
  // `## 0.1.0 (unreleased)` passed the heading check, so a tag would publish a changelog saying the version is not out
  const w = read('release.yml');
  assert.match(w, /grep[^\n]*unreleased[^\n]*CHANGELOG\.md/i, 'a grep for "(unreleased)" on the version heading');
});
