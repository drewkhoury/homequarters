// Stands in for a browser test that hangs, for tests/unit/time-limit.test.mjs. Like a real one it starts a browser in a
// session of its own, as Playwright starts Chromium, so a signal sent to the test's process group would miss it. It
// writes both process numbers to the file QK_PROBE_PIDS names, prints "ready", and never ends. With QK_PROBE_STUBBORN=1
// both ignore SIGTERM, so only a SIGKILL stops them.
const { spawn } = require('child_process');
const { writeFileSync } = require('fs');

const stubborn = process.env.QK_PROBE_STUBBORN === '1';
const ignoreTerm = "process.on('SIGTERM', () => {});";
const browser = spawn(process.execPath, ['-e', `${stubborn ? ignoreTerm : ''} setInterval(() => {}, 1 << 30);`], { detached: true, stdio: 'ignore' }); // cap: the stand-in browser runs until it is stopped
if (stubborn) process.on('SIGTERM', () => {});
writeFileSync(process.env.QK_PROBE_PIDS, `${process.pid} ${browser.pid}\n`);
console.log('ready');
setInterval(() => {}, 1 << 30); // cap: a hung test never ends; only its time limit stops it
