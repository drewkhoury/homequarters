// The kinds of test (tests/layers.json): what each proves and does not, what it needs, how long it takes, and which
// files are in it. A branch from before the file has none; there loadLayers answers null and the pages leave the
// layers out.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const layersPath = repo => join(repo, 'tests', 'layers.json');

// { layers, places } or null when the file is missing or unreadable.
export function loadLayers(file) {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(d.layers) ? { layers: d.layers, places: d.places || [] } : null;
  } catch { return null; }
}

// A files pattern from layers.json against a repo path: * stands for any part of one name, anything else is literal.
export function globMatch(pattern, path) {
  const re = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  return re.test(path);
}

// Every layer a path is in, and the one it belongs to: a layer that names the file itself wins over one that takes
// it through a pattern, so tests/unit/contract.test.mjs is the rules layer's even though tests/unit/*.test.mjs takes it.
export const layersOf = (layers, path) => layers.filter(l => (l.files || []).some(p => globMatch(p, path)));
export function layerOf(layers, path) {
  return layers.find(l => (l.files || []).includes(path)) || layersOf(layers, path)[0] || null;
}

// The test files a layer covers, from the catalogue.
export const filesOf = (layer, files) => files.filter(f => (layer.files || []).some(p => globMatch(p, f.path)));

export const isPlanned = layer => !/^built$/i.test(layer.status || '');
