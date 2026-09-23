// v2.0.0 M8: orphan cleanup tier selection. The PID-REUSE guard (different creation time) and
// the 'not java' check must always win — an orphan scan must NEVER kill a recycled pid.
const assert = require('assert');
const { classifyOrphan, scanOrphans, applyOrphanAction } = require('../src/main/orphan.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const base = { pid: 4242, processStartedAt: 1700000000000, serverPath: '/srv/a' };
const javaInfo = { alive: true, name: 'java.exe', startTimeMs: 1700000000000 };

// t0: process gone.
ok('gone -> clear', classifyOrphan(base, null).action === 'clear');
ok('gone -> tier 0', classifyOrphan(base, null).tier === 0);

// t1: alive + java + stored stopped -> auto-kill.
ok('stopped java -> kill', classifyOrphan({ ...base, status: 'stopped' }, javaInfo).action === 'kill');
ok('t1 tier 1', classifyOrphan({ ...base, status: 'stopped' }, javaInfo).tier === 1);
ok('no status defaults to kill', classifyOrphan(base, javaInfo).action === 'kill');

// t2: alive + java + stored running -> ask.
ok('running java -> ask', classifyOrphan({ ...base, status: 'running' }, javaInfo).action === 'ask');
ok('starting java -> ask', classifyOrphan({ ...base, status: 'starting' }, javaInfo).action === 'ask');
ok('t2 tier 2', classifyOrphan({ ...base, status: 'running' }, javaInfo).tier === 2);

// t3a: pid reused (different start time) -> never kill.
const reused = { alive: true, name: 'java.exe', startTimeMs: 1799999999999 };
ok('pid reused -> forget', classifyOrphan({ ...base, status: 'stopped' }, reused).action === 'forget');
ok('pid reused -> tier 3', classifyOrphan({ ...base, status: 'stopped' }, reused).tier === 3);

// t3b: alive but not java -> forget (never kill).
const notJava = { alive: true, name: 'chrome.exe', startTimeMs: 1700000000000 };
ok('not java -> forget', classifyOrphan({ ...base, status: 'stopped' }, notJava).action === 'forget');
ok('not java -> tier 3', classifyOrphan({ ...base, status: 'stopped' }, notJava).tier === 3);

// no stored pid -> clear, never throws.
ok('no pid -> clear', classifyOrphan({}, javaInfo).action === 'clear');
ok('null stored safe', classifyOrphan(null, javaInfo).action === 'clear');

(async () => {
  // scanOrphans: inject getInfo + storedMap (no electron/platform needed).
  const stored = [
    { instanceId: 'A', pid: 100, processStartedAt: 1700000000000, serverPath: '/srv/a', status: 'stopped' },
    { instanceId: 'B', pid: 200, processStartedAt: 1700000000000, serverPath: '/srv/b', status: 'running' },
    { instanceId: 'C', pid: 300, processStartedAt: 1700000000000, serverPath: '/srv/c', status: 'stopped' },
  ];
  const infoFor = pid => pid === 100 ? { alive: true, name: 'java', startTimeMs: 1700000000000 }
    : pid === 200 ? { alive: true, name: 'java', startTimeMs: 1700000000000 }
    : null; // C gone
  const scan = await scanOrphans(async pid => infoFor(pid), stored);
  ok('scan returns 3', scan.length === 3);
  ok('scan A -> kill (t1)', scan.find(r => r.instanceId === 'A').action === 'kill');
  ok('scan B -> ask (t2)', scan.find(r => r.instanceId === 'B').action === 'ask');
  ok('scan C -> clear (gone)', scan.find(r => r.instanceId === 'C').action === 'clear');

  // applyOrphanAction: inject clear + killTree spies (no real process touched).
  const cleared = [], killed = [];
  const deps = { clearInstanceProcess: id => cleared.push(id), killTree: pid => killed.push(pid) };
  ok('apply kill clears + kills', await applyOrphanAction(scan.find(r => r.instanceId === 'A'), deps) === 'kill' && killed.includes(100));
  ok('apply clear drops record', await applyOrphanAction(scan.find(r => r.instanceId === 'C'), deps) === 'clear' && cleared.includes('C'));
  ok('apply ask -> skip', await applyOrphanAction(scan.find(r => r.instanceId === 'B'), deps) === 'skip');

  // askReconnectOrStop: uses deps.prompt if given; 'stop' -> stop, anything else -> reconnect.
  const { askReconnectOrStop, runOrphanCleanup } = require('../src/main/orphan.js');
  const ctx = { appendLog: () => {} };
  const stopChoice = await askReconnectOrStop(ctx, scan.find(r => r.instanceId === 'B'), { prompt: (req, cb) => cb('stop') });
  ok('ask: stop choice', stopChoice === 'stop');
  const reChoice = await askReconnectOrStop(ctx, scan.find(r => r.instanceId === 'B'), { prompt: (req, cb) => cb('reconnect') });
  ok('ask: reconnect choice', reChoice === 'reconnect');
  ok('ask: no prompt -> reconnect (safe)', await askReconnectOrStop(ctx, scan.find(r => r.instanceId === 'B'), {}) === 'reconnect');

  // runOrphanCleanup: a t2 orphan with a 'stop' prompt kills + clears; 'reconnect' keeps it.
  const killed2 = [], cleared2 = [];
  const deps2 = { getInfo: async pid => infoFor(pid), storedMap: stored, killTree: pid => killed2.push(pid), clearInstanceProcess: id => cleared2.push(id), prompt: (req, cb) => cb('stop') };
  await runOrphanCleanup(ctx, deps2);
  ok('cleanup t2 stop -> kills B pid 200', killed2.includes(200));
  ok('cleanup t1 auto-kill A pid 100', killed2.includes(100));

  const killed3 = [];
  const deps3 = { getInfo: async pid => infoFor(pid), storedMap: stored, killTree: pid => killed3.push(pid), clearInstanceProcess: () => {}, prompt: (req, cb) => cb('reconnect') };
  await runOrphanCleanup(ctx, deps3);
  ok('cleanup t2 reconnect -> does NOT kill B pid 200', !killed3.includes(200));

  console.log(`\n${passed} passed, 0 failed`);
})();
