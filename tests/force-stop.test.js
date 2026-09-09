// Regression: server:force-stop must be registered and must never throw —
// a stuck server is exactly when the user needs it, so even the no-process
// path resolves {ok:false} instead of rejecting (silent dead button).
const assert = require('assert');
const { registerServer } = require('../src/main/server-lifecycle.js');

let passed = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  passed++;
}

(async () => {
  const handlers = {};
  const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const mkCtx = () => ({
    serverProcess: null, serverStatus: 'stopped', manualStop: false,
    restartTimer: null, autoPollTimer: null, monitoredPid: null,
    send: () => {}, appendLog: () => {}, setServerStatus(s) { this.serverStatus = s; },
  });
  registerServer(fakeIpc, mkCtx());

  ok('server:force-stop registered', typeof handlers['server:force-stop'] === 'function');
  ok('server:start still registered', typeof handlers['server:start'] === 'function');
  ok('server:stop still registered', typeof handlers['server:stop'] === 'function');

  const r = await handlers['server:force-stop']();
  ok('force-stop with no process resolves ok:false', r && r.ok === false && typeof r.error === 'string');

  console.log(`\n${passed} passed, 0 failed`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
