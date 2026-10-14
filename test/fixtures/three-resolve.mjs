// Lets a unit test import web modules that `import * as THREE from 'three'`, as the page's import map does: the bare
// name resolves to the vendored copy the app serves. Registered with node:module's register() before such an import.
const THREE_URL = new URL('../../../web/vendor/three@0.184.0/build/three.module.js', import.meta.url).href;
export async function resolve(spec, ctx, next) { return spec === 'three' ? { url: THREE_URL, shortCircuit: true } : next(spec, ctx); }
