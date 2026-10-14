// Stands in for tests/project.mjs when tests/unit/time-limit.test.mjs runs the Makefile's own recipes in a scratch
// folder: `new` prints a made-up test project id and every other command does nothing, so no emulator is touched.
if (process.argv[2] === 'new') console.log(`demo-qk-probe-${process.argv[3] || 'test'}`);
