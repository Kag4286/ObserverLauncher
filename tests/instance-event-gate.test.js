// v2.0.0 (M5) per-instance event gate: gated channels (server:metrics/live/files/log) only
// reach the renderer for the ACTIVE instance, so N background instances do not each push
// IPC + redraws for a view nobody is looking at. server:state is NOT gated; error log lines
// BYPASS the gate (a background crash must still hit the rail badge).
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-event-gate-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const { createContext } = require('../src/main/context.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const ctx = createContext();
const sent = [];
ctx.win = { isDestroyed: () => false, webContents: { send: (ch, data) => sent.push({ ch, data }) } };
ctx.setActiveInstance('A');
const last = ch => sent.filter(s => s.ch === ch).pop();

(async () => {
  // Active instance: gated channels delivered.
  await ctx.runInInstance('A', async () => { ctx.send('server:metrics', { m: 1 }); });
  ok('active: server:metrics delivered', !!last('server:metrics'));

  // Background instance: gated channel dropped.
  sent.length = 0;
  await ctx.runInInstance('B', async () => { ctx.send('server:metrics', { m: 2 }); });
  ok('background: server:metrics dropped', sent.length === 0);

  // Non-gated channel always passes (even from a background instance).
  sent.length = 0;
  await ctx.runInInstance('B', async () => { ctx.send('tunnel:status', { s: 1 }); });
  ok('background: tunnel:status delivered', !!last('tunnel:status'));

  // server:state is NOT gated (rail dot must reflect background crash/stop).
  sent.length = 0;
  await ctx.runInInstance('B', async () => { ctx.setServerStatus('running'); });
  ok('background: server:state delivered', !!last('server:state'));
  ok('server:state carries instanceId', last('server:state').data.instanceId === 'B');

  // appendLog: normal line from background is gated (no IPC) but still buffered.
  sent.length = 0;
  await ctx.runInInstance('B', async () => { ctx.appendLog('hello world'); });
  ok('background: normal log dropped from IPC', !sent.some(s => s.ch === 'server:log'));
  // consoleBuffer is a per-instance accessor; read B's state directly (we are outside ALS here).
  ok('background: normal log still buffered', (ctx.instances.get('B').consoleBuffer || []).some(l => l.text === 'hello world' && l.instanceId === 'B'));

  // Error line from background BYPASSES the gate.
  sent.length = 0;
  await ctx.runInInstance('B', async () => { ctx.appendLog('boom', 'error'); });
  ok('background: error log delivered', !!last('server:log'));
  ok('error log has instanceId B', last('server:log').data.instanceId === 'B');

  // ERROR text (not type) also bypasses.
  sent.length = 0;
  await ctx.runInInstance('B', async () => { ctx.appendLog('java.lang.ERROR: x'); });
  ok('background: ERROR-text log delivered', !!last('server:log'));

  // Switch active -> the former background now delivers.
  ctx.setActiveInstance('B');
  sent.length = 0;
  await ctx.runInInstance('B', async () => { ctx.send('server:live', { x: 1 }); });
  ok('after switch: new active delivers', !!last('server:live'));
  sent.length = 0;
  await ctx.runInInstance('A', async () => { ctx.send('server:live', { x: 2 }); });
  ok('after switch: old active is now gated', sent.length === 0);

  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
