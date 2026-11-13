// v8.1.1 tests: PowerShell host idle auto-shutdown/respawn, forceStopServer timer cleanup,
// idle metrics throttling, and orphan cleanup ps-host release.
const { EventEmitter } = require('events');
const psHost = require('../src/main/platform/ps-host.js');
const { forceStopServer } = require('../src/main/server-lifecycle.js');
const { metricsTick, freshSampleState } = (() => {
  const m = require('../src/main/server-metrics.js');
  return { metricsTick: m.metricsTick, freshSampleState: () => ({ consecutiveMisses: 0, lastMetrics: { serverMemory: 0, cpu: 0 }, javaRetryCount: 0, idleTicks: 0, sampling: false, rootIsJava: undefined }) };
})();
const { runOrphanCleanup } = require('../src/main/orphan.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

(async () => {
  // 1. ps-host idleStop contract & respawn capability
  ck('ps-host exports IDLE_TTL_MS === 15000', psHost.IDLE_TTL_MS === 15000);
  ck('ps-host idleStop returns false when no child', psHost.idleStop() === false);

  if (psHost.IS_WIN) {
    const out1 = await psHost.run('Write-Output "ok1"', 8000);
    ck('ps-host first run succeeds', out1.trim() === 'ok1' && psHost._hasChild());
    const stopped = psHost.idleStop();
    ck('ps-host idleStop kills idle powershell child', stopped === true && !psHost._hasChild());
    const out2 = await psHost.run('Write-Output "ok2"', 8000);
    ck('ps-host respawns cleanly after idleStop', out2.trim() === 'ok2' && psHost._hasChild());
    psHost.idleStop();
    ck('ps-host cleaned up after test', !psHost._hasChild());
  }

  // 2. forceStopServer clears shutdownTimer and restartAfterStop
  const sent = [];
  const fakeProc = new EventEmitter();
  fakeProc.pid = 999999; // non-existent pid; killTree catches safely
  fakeProc.stdin = { writable: true, write: () => {} };
  let shutdownCleared = false;
  const dummyTimer = setInterval(() => { shutdownCleared = false; }, 100);
  const ctx = {
    serverProcess: fakeProc,
    serverStatus: 'stopping',
    monitoredPid: null,
    manualStop: false,
    restartAfterStop: { fake: true },
    shutdownTimer: dummyTimer,
    restartTimer: setTimeout(() => {}, 10000),
    autoPollTimer: setInterval(() => {}, 10000),
    currentSoftware: 'paper-like',
    live: { tps: null, mspt: null, players: [] },
    instances: new Map(),
    inst: () => 'default',
    appendLog: (m) => sent.push(m),
    setServerStatus: (s) => { ctx.serverStatus = s; },
  };
  const r = await forceStopServer(ctx);
  clearTimeout(ctx.restartTimer);
  clearInterval(ctx.autoPollTimer);
  ck('forceStopServer -> ok:true', r.ok === true);
  ck('forceStopServer clears shutdownTimer', ctx.shutdownTimer === null);
  ck('forceStopServer clears restartAfterStop', ctx.restartAfterStop === null);
  ck('forceStopServer sets manualStop', ctx.manualStop === true);
  shutdownCleared = true;
  await new Promise(res => setTimeout(res, 150));
  ck('old shutdownTimer never fired after forceStopServer', shutdownCleared === true);

  // 3. idle metrics throttling (1 IPC per 5 idle ticks)
  let ipcCount = 0;
  const idleCtx = {
    serverProcess: null,
    monitoredPid: null,
    live: { tps: null, mspt: null, players: [] },
    send: () => { ipcCount++; },
  };
  const st = freshSampleState();
  for (let i = 0; i < 5; i++) await metricsTick(idleCtx, st);
  ck('metricsTick idle pushes once every 5 ticks', ipcCount === 1);

  // 4. runOrphanCleanup completes and frees ps-host
  const orphanRes = await runOrphanCleanup({ serverProcess: null, instances: new Map(), appendLog: () => {} }, { storedMap: [] });
  ck('runOrphanCleanup empty ok', Array.isArray(orphanRes) && orphanRes.length === 0 && !psHost._hasChild());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
