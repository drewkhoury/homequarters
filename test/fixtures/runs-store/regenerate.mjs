// Writes expected.json: what HQ works out from test/run-fixtures.mjs's store. Made once from 0.3.0 (9a54dff), before the
// run store replaced the readers, so the store is held to the answers the old reading gave. Run it again only when a
// change to the answers is meant, and say so in the commit: node test/fixtures/runs-store/regenerate.mjs
import { writeFileSync } from 'node:fs';
import { buildStore, answersOf } from '../../run-fixtures.mjs';
const s = buildStore();
try { writeFileSync(new URL('./expected.json', import.meta.url), JSON.stringify(answersOf(s), null, 1) + '\n'); } finally { s.done(); }
