// Auto-poll (split from server-lifecycle.js — behaviour unchanged).
// Every 5s while running, sends `list` (and `tps`/`tick query` for paper-like, `forge tps` for
// Forge) into the server stdin and suppresses the echoed status lines from the console.
function startAutoPoll(ctx, software) {
  clearInterval(ctx.autoPollTimer);
  ctx.autoPollTimer = setInterval(() => {
    if (!ctx.serverProcess || !ctx.serverProcess.stdin.writable) return;
    ctx.suppressStatusUntil = Date.now() + 4000;
    try {
      ctx.serverProcess.stdin.write('list\r\n');
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
