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

// A JSON Schema validator for the part of draft 2020-12 that schema/hq.schema.json uses: type, enum, const, pattern,
// minimum, minLength, required, properties, additionalProperties (true or false), items, anyOf, and $ref to #/$defs.
// Written here so the package needs no dependency for it. Answers a list of "where: what" lines, empty when valid.
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
export function validate(schema, value, root = schema, at = '') {
  const where = at || '(the file)', out = [];
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o && o[k], root);
    if (!target) return [`${where}: the schema's $ref ${schema.$ref} names nothing`];
    out.push(...validate(target, value, root, at));
  }
  if (schema.anyOf && !schema.anyOf.some(s => !validate(s, value, root, at).length)) out.push(`${where}: matches none of the forms it may take`);
  if (schema.type) {
    const types = [].concat(schema.type), t = typeOf(value);
    if (!types.some(x => x === t || (x === 'number' && t === 'integer'))) return [...out, `${where}: should be ${types.join(' or ')}, not ${t}`];
  }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${where}: should be one of ${schema.enum.join(', ')}`);
  if ('const' in schema && value !== schema.const) out.push(`${where}: should be ${JSON.stringify(schema.const)}`);
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) out.push(`${where}: should not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) out.push(`${where}: should match ${schema.pattern}`);
  }
  if (typeof value === 'number' && schema.minimum != null && value < schema.minimum) out.push(`${where}: should be at least ${schema.minimum}`);
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => out.push(...validate(schema.items, v, root, `${at ? `${at}/` : ''}${i}`)));
  if (typeOf(value) === 'object') {
    for (const k of schema.required || []) if (!(k in value)) out.push(`${where}: needs ${k}`);
    for (const [k, v] of Object.entries(value)) {
      const s = schema.properties && Object.hasOwn(schema.properties, k) ? schema.properties[k] : null;
      if (s) out.push(...validate(s, v, root, `${at ? `${at}/` : ''}${k}`));
      else if (schema.additionalProperties === false) out.push(`${where}: "${k}" is not a key it takes`);
    }
  }
  return out;
}
