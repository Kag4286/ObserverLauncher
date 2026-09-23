// v2.0.0 (M8 full re-attach): adoptProcess adopts a live server we did NOT spawn. Guards: pid must
// be alive + java + match the recorded start time (PID-reuse). The process stub has no stdin, so
// server:stop routes via RCON.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-adopt-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const { createContext } = require('../src/main/context.js');
const { adoptProcess } = require('../src/main/server-lifecycle.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

(async () => {
  const ctx = createContext();
  ctx.setActiveInstance('A');
  ctx.instances.set('A', { serverStatus: 'stopped', serverPath: '/srv/A' });
  ctx.appendLog = () => {};
  ctx.send = () => {};
  ctx.pushFiles = () => {};

  const base = { pid: 4242, processStartedAt: 1700000000000, serverPath: '/srv/A' };
  const javaOk = async () => ({ alive: true, name: 'java.exe', startTimeMs: 1700000000000 });

  // Happy path: alive java, matching start time -> adopts, status running, stub has no stdin.
  const r1 = await ctx.runInInstance('A', () => adoptProcess(ctx, base, { getInfo: javaOk }));
  ok('adopt ok', r1.ok === true && r1.pid === 4242);
  ok('adopt: serverStatus running', ctx.instances.get('A').serverStatus === 'running');
  ok('adopt: stub marked adopted', ctx.instances.get('A').serverProcess && ctx.instances.get('A').serverProcess.adopted === true);
  ok('adopt: stub has no stdin', ctx.instances.get('A').serverProcess.stdin === null);
  clearInterval(ctx.instances.get('A').adoptWatchTimer);

  // PID reuse: different start time -> refuse.
  const r2 = await ctx.runInInstance('A', () => adoptProcess(ctx, base, { getInfo: async () => ({ alive: true, name: 'java.exe', startTimeMs: 1799999999999 }) }));
  ok('adopt refuses reused pid', r2.ok === false && /reused/i.test(r2.error));

  // Not java -> refuse.
  const r3 = await ctx.runInInstance('A', () => adoptProcess(ctx, base, { getInfo: async () => ({ alive: true, name: 'chrome.exe', startTimeMs: 1700000000000 }) }));
  ok('adopt refuses non-java', r3.ok === false && /not a java/i.test(r3.error));

  // Gone -> refuse.
  const r4 = await ctx.runInInstance('A', () => adoptProcess(ctx, base, { getInfo: async () => null }));
  ok('adopt refuses gone pid', r4.ok === false);

  // No pid -> refuse.
  const r5 = await ctx.runInInstance('A', () => adoptProcess(ctx, { pid: 0 }, { getInfo: javaOk }));
  ok('adopt refuses no pid', r5.ok === false);

  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
