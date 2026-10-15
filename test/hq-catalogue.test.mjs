// Proves: the test catalogue reads the description a test file opens with, the five-field header, the sets a
// project's Makefile puts tests in, and the node test titles results are matched to.
// Why: the Testing page's cards and docs/TESTING.md come from these headers, so a misread header is a wrong page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHeader, openingComment, makeSets, testTitles, shotNames } from '../lib/catalogue.mjs';

// the shape of load-check.js today: a require, then the comment
const TODAY = `const { BASE_URL, launch } = require('./helpers');
// The cheapest smoke. The app page loads
// with no script error.
(async () => {
  // not part of the description
})();`;

// the header backlog 29 describes, with a field that runs over two lines
const HEADER = `// Moss without WebGL.
// Proves: the flat companion shows
//   and Settings says why.
// Why it exists: a work Mac saw no reason given.
// Runs in: gate
// Takes: 2 s
// Run it when: moss3d.js or the Settings companion card changes.
const x = 1;`;

test('the description is the opening comment, after the requires, and stops at the first code', () => {
  assert.deepEqual(parseHeader(TODAY), { description: 'The cheapest smoke. The app page loads with no script error.', fields: null });
});

test('a file with no opening comment has an empty description', () => {
  assert.deepEqual(parseHeader("const a = require('a');\n(async () => {})();"), { description: '', fields: null });
});

test('the header fields are picked up, a field runs over its next lines, and the text before them stays the description', () => {
  assert.deepEqual(parseHeader(HEADER), {
    description: 'Moss without WebGL.',
    fields: {
      proves: 'the flat companion shows and Settings says why.',
      why: 'a work Mac saw no reason given.',
      runsIn: 'gate',
      takes: '2 s',
      runWhen: 'moss3d.js or the Settings companion card changes.',
    },
  });
});

test('field names may be bold or any case', () => {
  assert.deepEqual(parseHeader('// **Proves**: it works\n// RUNS IN: after\nx();').fields, { proves: 'it works', runsIn: 'after' });
});

test('a blank comment line ends a field', () => {
  assert.deepEqual(parseHeader('// Proves: one\n//\n// More about the file.\nx();'), { description: 'More about the file.', fields: { proves: 'one' } });
});

test('a block comment works as the opening comment', () => {
  assert.deepEqual(openingComment("#!/usr/bin/env node\n'use strict';\n/* First line\n * second line */\nx();"), ['First line', 'second line']);
});

test("the Makefile's GATE and AFTER lists are the sets, and the lanes are not", () => {
  const mk = 'GATE    := load-check smoke-stamps\nGATE_A  := smoke-stamps\nAFTER   := walk-universe walk-world\nAFTER_A := walk-universe\n';
  assert.deepEqual(makeSets(mk), { gate: ['load-check', 'smoke-stamps'], after: ['walk-universe', 'walk-world'] });
});

test('node test titles are read in all three quote styles, and a title built at run time is left out', () => {
  const src = "test('one', () => {});\ntest(\"two's\", async () => {});\ntest(`three`, t => {});\ntest(`n=${n}`, () => {});\nit('four', () => {});";
  assert.deepEqual(testTitles(src), ['one', "two's", 'three', 'four']);
});

test('screenshot names are read from the paths a test writes to', () => {
  assert.deepEqual(shotNames("page.screenshot({ path: process.env.S + '/u1-panel.png' });\nuni.screenshot({ path: SHOTS + '/universe-inside.png' });"), ['u1-panel.png', 'universe-inside.png']);
});
