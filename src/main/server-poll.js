// Auto-poll (split from server-lifecycle.js — behaviour unchanged, extended in 2.4.0).
// Every 5s while running, sends `list` (and tps/tick query for paper-like, `forge tps` for Forge /
// `spark tps` when the server has Spark and rejects `forge tps`) into the server stdin and
// suppresses the echoed status lines from the console.
function startAutoPoll(ctx, software) {
  clearInterval(ctx.autoPollTimer);
  ctx.autoPollTimer = setInterval(() => {
    if (!ctx.serverProcess || !ctx.serverProcess.stdin.writable) return;
    ctx.suppressStatusUntil = Date.now() + 4000;
    try {
      ctx.serverProcess.stdin.write('list\r\n');
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

module.exports = { startAutoPoll };
