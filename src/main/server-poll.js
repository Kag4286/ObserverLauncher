// Auto-poll (split from server-lifecycle.js — behaviour unchanged, extended in 2.4.0).
// Every 5s while running, sends `list` (and tps/tick query for paper-like, `forge tps` for Forge /
// `spark tps` when the server has Spark and rejects `forge tps`) into the server stdin and
// suppresses the echoed status lines from the console.
//
// B3 (3.3.0): the TPS command is polled with change-detection instead of every tick. It makes the
// server COMPUTE stats (spark is the expensive case) and its 5s/1m/5m windows barely move within a
// single 5s poll, so the old every-tick send was mostly wasted work. `list` still runs every 5s.
const TPS_HEALTHY = 19.5;
// Pure: send the TPS command this tick? Always while TPS is unknown or lagging (catch a real
// problem fast), otherwise only every 3rd tick (15s). Exported so it is testable without timers.
function shouldPollTps(tick, tps) {
  if (tps == null || tps < TPS_HEALTHY) return true;
  return tick % 3 === 1; // healthy: first tick, then every 3rd (5s, then 15s)
}
function startAutoPoll(ctx, software) {
  clearInterval(ctx.autoPollTimer);
  let tick = 0; // per-interval, like the timer itself (fresh on each start)
  ctx.autoPollTimer = setInterval(() => {
    if (!ctx.serverProcess || !ctx.serverProcess.stdin.writable) return;
    ctx.suppressStatusUntil = Date.now() + 4000;
    try {
      ctx.serverProcess.stdin.write('list\r\n');
      tick++;
      if (!shouldPollTps(tick, ctx.live && ctx.live.tps)) return;
      if (ctx.tpsUnsupported) {
        // 2.4.0: the primary tps command failed before. If the server has Spark, use `spark tps`
        // (its output `TPS from last 5s, 10s, 1m...` is already parsed by parseServerLine).
        if (ctx.sparkAvailable) ctx.serverProcess.stdin.write('spark tps\r\n');
        return;
      }
      if (software === 'paper-like') {
        ctx.serverProcess.stdin.write('tps\r\n');
        ctx.serverProcess.stdin.write('tick query\r\n');
      } else if (software === 'forge') {
        ctx.serverProcess.stdin.write('forge tps\r\n');
      }
    } catch {}
  }, 5000);
}

module.exports = { startAutoPoll, shouldPollTps };
