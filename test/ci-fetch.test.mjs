// Proves: hq ci-fetch keeps an artifact only once its download has finished, so a download that fails part way leaves
// nothing behind, and the next fetch downloads it again.
// Why: ci-fetch skips any folder already in the ci store, and HQ reads a folder as soon as it is there: a half-written
// one was read as a run with tests missing and never fetched again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fetchCi } from '../lib/ci-fetch.mjs';

const ARTIFACT = { name: 'junit-70-1-gate', expired: false, workflow_run: { id: 70 } };
// gh as ci-fetch calls it: the artifact list, and a download that writes run.json and then, when it works, gate.xml
function fakeGh({ fails }) {
  return args => {
    if (args[0] === '--version') return 'gh version 2';
    if (args[0] === 'api') return JSON.stringify([{ artifacts: [ARTIFACT] }]);
    const into = args[args.indexOf('--dir') + 1];
    mkdirSync(into, { recursive: true });
    writeFileSync(join(into, 'run.json'), JSON.stringify({ kind: 'gate', run: '70', attempt: 1 }));
    if (fails) throw Object.assign(new Error('download failed'), { stderr: 'error downloading gate.xml: connection reset' });
    writeFileSync(join(into, 'gate.xml'), '<testsuite><testcase name="smoke-sync" time="20"/></testsuite>');
    return '';
  };
}

test('a download that fails part way leaves nothing, and the next fetch brings the whole artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'hq-fetch-')), repo = join(root, 'repo'), dir = join(root, 'ci');
  try {
    mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://example.invalid/r.git']);
    assert.match(fetchCi(dir, repo, { gh: fakeGh({ fails: true }) }), /Could not download junit-70-1-gate/);
    assert.equal(existsSync(join(dir, 'junit-70-1-gate')), false, 'no half-written folder');
    assert.deepEqual(readdirSync(dir), [], 'and no download folder left over');
    assert.match(fetchCi(dir, repo, { gh: fakeGh({ fails: false }) }), /Fetched 1 new CI result\b/);
    assert.deepEqual(readdirSync(join(dir, 'junit-70-1-gate')).sort(), ['gate.xml', 'run.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
