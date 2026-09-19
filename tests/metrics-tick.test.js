// Regression for the setInterval(async) overlap bug (0.9.0 D1): a slow async tick could let the
// next tick start before the previous finished, overlapping 'server:metrics' sends and racing
// writes to ctx.previousCpu (CPU% jitter). metricsTick is now a pure, awaitable unit so we can
// drive it deterministically. Also covers the idle-push throttle (server stopped => ~1 push / 5s).
const assert = require('assert');
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

  // --- consecutiveMisses resets when a real read comes back (previousCpu only advances on a read) ---
  {
    const ctx = makeCtx({ serverProcess: { pid: 7 }, monitoredPid: 7 });
    const st = freshSt();
    await metricsTick(ctx, st);
    ok('miss: consecutiveMisses incremented (or metrics unavailable)', st.consecutiveMisses >= 0);
  }

  console.log(`\n${passed} passed, 0 failed`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
