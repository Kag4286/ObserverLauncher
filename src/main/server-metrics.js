// Resource metrics sampler (split from server-lifecycle.js — behaviour unchanged).
// Owns the per-second CPU/RAM sampling of the server's Java process and the metric parsing.
const os = require('os');
const platform = require('./platform');

// BUGFIX: PS output can carry a culture comma ("45,6712") even after we ask
// for InvariantCulture (old PS, localized shims). Normalize before Number() so
// a comma never produces NaN and silently zeroes RAM/CPU.
function parseMetricValue(raw) {
  if (raw === null || raw === undefined) return NaN;
  const s = String(raw).trim();
  if (!s) return NaN; // empty read → not a number, not a fake 0
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function startMetrics(ctx) {
  let consecutiveMisses = 0;
  let lastMetrics = { serverMemory: 0, cpu: 0 };
  let javaRetryCount = 0;
  clearInterval(ctx.sampleTimer);
  ctx.sampleTimer = setInterval(async () => {
    try {
      const used = process.memoryUsage().rss / 1024 / 1024;
      if (!ctx.serverProcess?.pid) {
        ctx.monitoredPid = null; consecutiveMisses = 0; javaRetryCount = 0;
        ctx.send('server:metrics', { appMemory: Math.round(used), running: false, timestamp: Date.now(), ...ctx.live });
        return;
      }
      if (!ctx.monitoredPid) {
        const found = await Promise.race([
          platform.findJavaDescendant(ctx.serverProcess.pid),
          new Promise(resolve => setTimeout(() => resolve(null), 3000))
        ]).catch(() => null);
        if (found) {
          ctx.monitoredPid = found;
          javaRetryCount = 0;
        } else {
          javaRetryCount++;
          if (javaRetryCount >= 2 || ctx.currentSoftware === 'paper-like') {
            ctx.monitoredPid = ctx.serverProcess.pid;
          } else {
            ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: lastMetrics.serverMemory, cpu: lastMetrics.cpu, running: true, timestamp: Date.now(), ...ctx.live });
            return;
          }
        }
        if (!ctx.monitoredPid) { ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: 0, cpu: 0, running: true, timestamp: Date.now(), ...ctx.live }); return; }
      }
      const metrics = await Promise.race([
        platform.getProcessMetrics(ctx.monitoredPid),
        new Promise(resolve => setTimeout(() => resolve(null), 5000))
      ]).catch(() => null);
      const r = metrics ? { ok: true, stdout: `${metrics.memoryMB}|${metrics.cpuTime}` } : { ok: false, stdout: '' };
      if (!r.stdout || !r.stdout.trim()) {
        consecutiveMisses++;
        if (consecutiveMisses >= 3) { ctx.monitoredPid = null; javaRetryCount = 0; }
        ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: lastMetrics.serverMemory, cpu: lastMetrics.cpu, running: true, timestamp: Date.now(), ...ctx.live });
        return;
      }
      consecutiveMisses = 0;
      const [memoryRaw, cpuTotalRaw] = String(r.stdout).trim().split('|');
      const memory = parseMetricValue(memoryRaw), cpuTotal = parseMetricValue(cpuTotalRaw);
      const now = Date.now();
      let cpu = 0;
      if (Number.isFinite(cpuTotal) && ctx.previousCpu && Number.isFinite(ctx.previousCpu.total)) {
        const deltaSeconds = (now - ctx.previousCpu.at) / 1000;
        if (deltaSeconds > 0) cpu = Math.max(0, Math.min(100, ((cpuTotal - ctx.previousCpu.total) / deltaSeconds / os.cpus().length) * 100));
      }
      if (Number.isFinite(cpuTotal)) ctx.previousCpu = { total: cpuTotal, at: now };
      if (memory > 20) lastMetrics.serverMemory = memory;
      if (Number.isFinite(cpu)) lastMetrics.cpu = Math.round(cpu);
      ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: memory > 20 ? memory : lastMetrics.serverMemory, cpu: Math.round(cpu), running: true, timestamp: now, ...ctx.live });
    } catch (err) {
      const used = process.memoryUsage().rss / 1024 / 1024;
      ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: lastMetrics.serverMemory, cpu: lastMetrics.cpu, running: true, timestamp: Date.now(), ...ctx.live });
    }
  }, 1000);
}

module.exports = { parseMetricValue, startMetrics };
