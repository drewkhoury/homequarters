// Stands in for a browser test that ends on its own, for tests/unit/time-limit.test.mjs: it prints a line and exits with
// the code QK_PROBE_EXIT gives, 0 when it is not set.
console.log('quick test ran');
process.exitCode = Number(process.env.QK_PROBE_EXIT || 0);
