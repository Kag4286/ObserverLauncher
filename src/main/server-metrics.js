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

// One sampling tick — extracted from the interval so tests can drive it with a fixed ctx/state
// (same pattern as scheduler.js's exported schedulerTick). `st` carries the counters between ticks.
async function metricsTick(ctx, st) {
  const used = process.memoryUsage().rss / 1024 / 1024;
  if (!ctx.serverProcess?.pid) {
    ctx.monitoredPid = null; st.consecutiveMisses = 0; st.javaRetryCount = 0;
    // Idle (server stopped): this sampler still runs so the launcher-RAM KPI stays live, but pushing
    // every second is ~86k pointless IPC messages/day. Throttle the idle push to ~1 per 5s.
    if ((st.idleTicks++ % 5) !== 0) return;
    ctx.send('server:metrics', { appMemory: Math.round(used), running: false, timestamp: Date.now(), ...ctx.live });
    return;
  }
  st.idleTicks = 0;
  if (!ctx.monitoredPid) {
    const found = await Promise.race([
      platform.findJavaDescendant(ctx.serverProcess.pid),
      new Promise(resolve => setTimeout(() => resolve(null), 3000))
    ]).catch(() => null);
    if (found) {
      ctx.monitoredPid = found;
      st.javaRetryCount = 0;
    } else {
      st.javaRetryCount++;
      if (st.javaRetryCount >= 2 || ctx.currentSoftware === 'paper-like') {
        ctx.monitoredPid = ctx.serverProcess.pid;
      } else {
        ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: st.lastMetrics.serverMemory, cpu: st.lastMetrics.cpu, running: true, timestamp: Date.now(), ...ctx.live });
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
    st.consecutiveMisses++;
    if (st.consecutiveMisses >= 3) { ctx.monitoredPid = null; st.javaRetryCount = 0; }
    ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: st.lastMetrics.serverMemory, cpu: st.lastMetrics.cpu, running: true, timestamp: Date.now(), ...ctx.live });
    return;
  }
  st.consecutiveMisses = 0;
  const [memoryRaw, cpuTotalRaw] = String(r.stdout).trim().split('|');
  const memory = parseMetricValue(memoryRaw), cpuTotal = parseMetricValue(cpuTotalRaw);
  const now = Date.now();
  let cpu = 0;
  if (Number.isFinite(cpuTotal) && ctx.previousCpu && Number.isFinite(ctx.previousCpu.total)) {
    const deltaSeconds = (now - ctx.previousCpu.at) / 1000;
    if (deltaSeconds > 0) cpu = Math.max(0, Math.min(100, ((cpuTotal - ctx.previousCpu.total) / deltaSeconds / os.cpus().length) * 100));
  }
  if (Number.isFinite(cpuTotal)) ctx.previousCpu = { total: cpuTotal, at: now };
  if (memory > 20) st.lastMetrics.serverMemory = memory;
  if (Number.isFinite(cpu)) st.lastMetrics.cpu = Math.round(cpu);
  pushHistory(ctx, { t: now, tps: ctx.live?.tps ?? null, mspt: ctx.live?.mspt ?? null, cpu: Number.isFinite(cpu) ? Math.round(cpu) : null, ram: memory > 20 ? Math.round(memory) : (st.lastMetrics.serverMemory || null), players: (ctx.live?.players || []).length });
  ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: memory > 20 ? memory : st.lastMetrics.serverMemory, cpu: Math.round(cpu), running: true, timestamp: now, ...ctx.live });
}
// Ring buffer of samples, capped at ~1800 (30 min at 1 sample/s). Oldest dropped first.
const METRICS_HISTORY_CAP = 1800;
function pushHistory(ctx, sample) {
  if (!Array.isArray(ctx.metricsHistory)) ctx.metricsHistory = [];
  ctx.metricsHistory.push(sample);
  if (ctx.metricsHistory.length > METRICS_HISTORY_CAP) ctx.metricsHistory.splice(0, ctx.metricsHistory.length - METRICS_HISTORY_CAP);
}
// Pure: filter history to the last `minutes`, downsample to at most `maxSamples` so a big window
// doesn't blow the AI context window. Returns {samples, count, sourceCount, from, to, spanMinutes}.
function queryHistory(history, opts = {}) {
  const minutes = Math.max(1, Number(opts.minutes) || 30);
  const maxSamples = Math.min(Math.max(1, Number(opts.maxSamples) || 500), 1000);
  const list = Array.isArray(history) ? history : [];
  if (!list.length) return { samples: [], count: 0, sourceCount: 0, spanMinutes: 0 };
  const now = Date.now();
  const cutoff = now - minutes * 60 * 1000;
  let win = list.filter(s => s && s.t >= cutoff);
  if (!win.length) win = [list[list.length - 1]];
  let samples = win;
  if (win.length > maxSamples) {
    const step = win.length / maxSamples;
    samples = [];
    for (let i = 0; i < maxSamples; i++) samples.push(win[Math.floor(i * step)]);
    if (samples[samples.length - 1] !== win[win.length - 1]) samples.push(win[win.length - 1]);
  }
  const from = samples[0]?.t || now, to = samples[samples.length - 1]?.t || now;
  return { samples, count: samples.length, sourceCount: win.length, from, to, spanMinutes: Math.round((to - from) / 60000) };
}

// v2.0.0: sample EVERY instance, not just the active one, so a background server's history keeps
// filling and its dot/chart is correct the moment you switch to it. ONE interval loops the instance
// ids and runs each tick inside ctx.runInInstance(id, ...) — that pins ctx.inst()/ctx.serverProcess/
// ctx.live to the right instance. Per-instance counters live in `states` (keyed by instance id).
// GATED channels mean a background push is dropped, so this costs 0 IPC for unseen servers.
function freshSampleState() {
  return { consecutiveMisses: 0, lastMetrics: { serverMemory: 0, cpu: 0 }, javaRetryCount: 0, idleTicks: 0, sampling: false };
}
function startMetrics(ctx) {
  const states = new Map(); // instanceId -> counters
  const stateOf = id => { let s = states.get(id); if (!s) { s = freshSampleState(); states.set(id, s); } return s; };
  clearInterval(ctx.sampleTimer);
  ctx.sampleTimer = setInterval(async () => {
    // Snapshot the ids first: seedInstances may replace ctx.instances mid-tick.
    const ids = [...ctx.instances.keys()];
    if (!ids.length) ids.push(ctx.inst());
    for (const id of ids) {
      const st = stateOf(id);
      // BUGFIX (per instance now): setInterval does NOT await an async callback. A slow tick
      // (findJavaDescendant ~3s, getProcessMetrics ~5s) must not overlap the next one for the SAME
      // instance — skip while that instance's previous tick is still in flight.
      if (st.sampling) continue;
      st.sampling = true;
      try {
        await ctx.runInInstance(id, () => metricsTick(ctx, st));
      } catch (err) {
        try {
          await ctx.runInInstance(id, () => {
            const used = process.memoryUsage().rss / 1024 / 1024;
            ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: st.lastMetrics.serverMemory, cpu: st.lastMetrics.cpu, running: true, timestamp: Date.now(), ...ctx.live });
          });
        } catch {}
      }
      finally { st.sampling = false; }
    }
  }, 1000);
}

module.exports = { parseMetricValue, startMetrics, metricsTick, pushHistory, queryHistory, METRICS_HISTORY_CAP };
