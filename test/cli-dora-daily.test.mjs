// Proves: a daily copy hq dora writes late, for a day the run was missed, counts that day's activity up to the
// manifest's delivery.dailyAt in delivery.tz and nothing after it; with no dailyAt it counts the whole day, as before.
// Why: QuestKeep's own script wrote its late copies as of its nightly, 07:07 New York, and the package wrote them as of
// the day's end, so the same missed morning gave two different records, up to 17 hours apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HQ = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hq.mjs');
const ZONE = 'America/New_York';
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();

// Clock readings in New York, worked out here with Intl alone so the test does not lean on lib/dora.mjs's own day code
const LOCAL = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const local = ms => { const p = Object.fromEntries(LOCAL.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
const shift = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// the instant New York's clock reads day hh:mm: guess it as UTC, then step by the gap the clock shows, twice
const at = (day, hhmm) => {
  const want = Date.parse(`${day}T${hhmm}:00Z`);
  let t = want;
  for (let i = 0; i < 2; i++) { const l = local(t); t += want - Date.parse(`${l.day}T${l.time}:00Z`); }
  return t;
};

// The missed day is two days back, with the last copy the day before it, so the run fills it in late. One deploy went
// live at 06:50 New York that day and one at 07:30, either side of a 07:07 dailyAt.
const TODAY = local(Date.now()).day, MISSED = shift(TODAY, -2), LAST_COPY = shift(TODAY, -3);
const EARLY = 101, LATE = 102;

function project(delivery) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-dora-daily-')), cache = join(dir, 'cache'), raw = join(cache, 'ci', 'actions');
  writeFileSync(join(dir, 'hq.json'), JSON.stringify({ schemaVersion: 1, name: 'doors', cache, stores: ['dora', 'ci'], delivery }));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', 'hq.json'); git(dir, 'commit', '-q', '-m', 'm');
  const sha = git(dir, 'rev-parse', 'HEAD');
  mkdirSync(join(raw, 'jobs'), { recursive: true });
  const deploy = (id, live) => {
    writeFileSync(join(raw, 'jobs', `${id}-1.json`), JSON.stringify({ jobs: [{ name: 'deploy', conclusion: 'success', completed_at: new Date(live).toISOString(), labels: [] }] }));
    return { id, path: '.github/workflows/deploy.yml', event: 'push', status: 'completed', conclusion: 'success', run_attempt: 1, head_sha: sha,
      created_at: new Date(live - 5 * 60000).toISOString(), html_url: `https://github.com/o/doors/actions/runs/${id}` };
  };
  writeFileSync(join(raw, 'runs.json'), JSON.stringify([deploy(EARLY, at(MISSED, '06:50')), deploy(LATE, at(MISSED, '07:30'))]));
  mkdirSync(join(cache, 'dora', 'daily'), { recursive: true });
  writeFileSync(join(cache, 'dora', 'daily', `${LAST_COPY}.json`), '{}');
  const r = spawnSync(process.execPath, [HQ, 'dora', '--no-fetch', '--quiet', '--repo', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(r.status, 0, r.stderr);
  const copy = JSON.parse(readFileSync(join(cache, 'dora', 'daily', `${MISSED}.json`), 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  return copy;
}

test('with delivery.dailyAt 07:07, a late copy counts its day up to 07:07 New York and not after', () => {
  const copy = project({ tz: ZONE, dailyAt: '07:07' });
  assert.equal(copy.writtenLate, true);
  assert.deepEqual(local(Date.parse(copy.generatedAt)), { day: MISSED, time: '07:07' });
  assert.deepEqual(copy.today.deploys.map(x => x.run), [EARLY], 'the 07:30 deploy came after the copy was due');
});

test('with no delivery.dailyAt, a late copy counts its whole day, as it did before the key', () => {
  const copy = project({ tz: ZONE });
  assert.equal(copy.writtenLate, true);
  assert.deepEqual(local(Date.parse(copy.generatedAt)), { day: MISSED, time: '23:59' });
  assert.deepEqual(copy.today.deploys.map(x => x.run), [EARLY, LATE]);
});
