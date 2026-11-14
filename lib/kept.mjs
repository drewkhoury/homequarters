// What is worked out from the runs, kept while they stand. The run store answers the same array until a run folder
// changes (allRuns in lib/runs.mjs), and the test catalogue the same list until a test file changes (catalogue in
// lib/headers.mjs), so an answer worked out from them is kept against those very objects, and goes when they do: a new
// run is a new array, which nothing has been worked out from yet. An argument that is not an object keys by its value.
// Only for functions whose answer depends on nothing but their arguments, and whose answer no caller changes.
export function kept(fn) {
  const node = () => ({ objects: new WeakMap(), values: new Map(), done: false, answer: undefined });
  const top = node();
  return (...args) => {
    let at = top;
    for (const a of args) {
      const by = a !== null && (typeof a === 'object' || typeof a === 'function') ? at.objects : at.values;
      let next = by.get(a);
      if (!next) by.set(a, next = node());
      at = next;
    }
    if (!at.done) { at.answer = fn(...args); at.done = true; }
    return at.answer;
  };
}
