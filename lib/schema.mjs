// The convention files a manifest names (tests.layers, tests.pipeline, tests.sets, docs.groups, demo) each carry
// `schema`, the whole number of their shape, so a reader can tell a file written for a later HQ. The rule is the
// manifest's: a missing schema is read as 1, a newer one is read for what this HQ knows and warned about once, at start.
import { readFileSync } from 'node:fs';

// The schema each file is at in this HQ.
export const SCHEMAS = { 'tests.layers': 1, 'tests.pipeline': 1, 'tests.sets': 1, 'docs.groups': 1, demo: 1 };

// The warning a file's schema earns, or null: not an object, not a whole number, or newer than this HQ.
export function schemaWarning(key, json, known = SCHEMAS[key]) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null; // not this check's business
  if (json.schema === undefined) return null; // written before the files carried one: read as 1
  if (!Number.isInteger(json.schema) || json.schema < 1) return `${key}: schema should be a whole number from 1; read as ${known}`;
  if (json.schema > known) return `${key}: schema ${json.schema} is newer than this HQ reads (${known}); reading what it knows`;
  return null;
}

// Every warning the manifest's convention files earn, read once at start. A file that is missing or not JSON is its own
// page's problem and says so there; this only speaks to schema.
export function conventionWarnings(m) {
  const files = [['tests.layers', m.tests && m.tests.layers], ['tests.pipeline', m.tests && m.tests.pipeline], ['tests.sets', m.tests && m.tests.sets], ['docs.groups', m.docs && m.docs.groups], ['demo', m.demo]];
  const out = [];
  for (const [key, file] of files) {
    if (!file) continue;
    let json;
    try { json = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    const w = schemaWarning(key, json);
    if (w) out.push(w);
  }
  return out;
}
