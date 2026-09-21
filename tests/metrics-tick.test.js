// Regression for the setInterval(async) overlap bug (0.9.0 D1): a slow async tick could let the
// next tick start before the previous finished, overlapping 'server:metrics' sends and racing
// writes to ctx.previousCpu (CPU% jitter). metricsTick is now a pure, awaitable unit so we can
// drive it deterministically. Also covers the idle-push throttle (server stopped => ~1 push / 5s).
const assert = require('assert');
// Mock the platform layer so getProcessMetrics is deterministic (the real one probes the OS and
// would make the miss/reset assertions timing-dependent).
const Module = require('module');
const origLoad = Module._load;
let metricsResult = null; // what the mocked getProcessMetrics returns for the next call
Module._load = function (request, parent, isMain) {
  if (request === './platform' || request.endsWith('/platform') || request.endsWith('platform/index.js')) {
    return { getProcessMetrics: async () => metricsResult, findJavaDescendant: async () => null };
  }
  return origLoad.apply(this, arguments);
};
const { metricsTick } = require('../src/main/server-metrics.js');

let passed = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  passed++;
}

function makeCtx(overrides) {
  const sent = [];
  const ctx = Object.assign({
    serverProcess: null,
    monitoredPid: null,
    previousCpu: null,
    currentSoftware: null,
    live: { tps: null, mspt: null, players: [] },
    send: (ch, data) => sent.push({ ch, data }),
  }, overrides || {});
  ctx._sent = sent;
  return ctx;
}
const freshSt = () => ({ consecutiveMisses: 0, lastMetrics: { serverMemory: 0, cpu: 0 }, javaRetryCount: 0, idleTicks: 0, sampling: false });

(async () => {
  // --- idle throttle: server stopped, only every 5th tick pushes ---
  {
    const ctx = makeCtx();
    const st = freshSt();
    for (let i = 0; i < 5; i++) await metricsTick(ctx, st);
    ok('idle: 5 ticks -> 1 push', ctx._sent.length === 1);
    ok('idle: push has running:false', ctx._sent[0].data.running === false);
    await metricsTick(ctx, st);
    ok('idle: 6th tick -> 2nd push (every 5th)', ctx._sent.length === 2);
    for (let i = 0; i < 4; i++) await metricsTick(ctx, st);
    ok('idle: ticks 7-10 -> still 2 pushes', ctx._sent.length === 2);
    await metricsTick(ctx, st);
    ok('idle: 11th tick -> 3rd push', ctx._sent.length === 3);
  }

  // --- running: each tick pushes (with a live pid + metrics) ---
  {
    const ctx = makeCtx({ serverProcess: { pid: 4242 }, monitoredPid: 4242 });
    const st = freshSt();
    await metricsTick(ctx, st);
    ok('running: pushes on the first tick', ctx._sent.length === 1);
    ok('running: push has running:true', ctx._sent[0].data.running === true);
  }

  // --- consecutiveMisses: a failed read increments it; a good read resets it ---
  {
    const ctx = makeCtx({ serverProcess: { pid: 7 }, monitoredPid: 7 });
    const st = freshSt();
    metricsResult = null; // getProcessMetrics returns nothing -> miss
    await metricsTick(ctx, st);
    ok('miss: consecutiveMisses incremented', st.consecutiveMisses === 1);
    await metricsTick(ctx, st);
    ok('miss: consecutiveMisses increments again', st.consecutiveMisses === 2);
    // 3 misses in a row -> monitoredPid dropped so the sampler re-hunts the java descendant
    await metricsTick(ctx, st);
    ok('miss: 3rd miss drops monitoredPid', st.consecutiveMisses === 3 && ctx.monitoredPid === null);
  }
  {
    const ctx = makeCtx({ serverProcess: { pid: 8 }, monitoredPid: 8 });
    const st = freshSt();
    st.consecutiveMisses = 2; // pretend we had misses
    metricsResult = { memoryMB: 512, cpuTime: 10.5 }; // a good read
    await metricsTick(ctx, st);
    ok('good read resets consecutiveMisses', st.consecutiveMisses === 0);
    ok('good read pushes serverMemory', st.lastMetrics.serverMemory === 512);
  }

  console.log(`\n${passed} passed, 0 failed`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
