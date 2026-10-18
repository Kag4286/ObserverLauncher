// instances-snapshot.js — a READ-ONLY live summary of every instance for the cross-instance
// dashboard (v6.0.0 E4).
//
// WHY pure: the dashboard redraws on a timer, so the shape it reads must be cheap and predictable.
// This function takes the ctx.instances Map and a lookup that returns the display name, and returns
// one plain object per instance. No disk reads, no IPC, no side effects: whatever the caller passes
// is what it sees, which is exactly what a unit test needs.

// One snapshot row. `inst` is the per-instance runtime state (freshInstState shape).
// When the server is stopped, every live number is null (never 0), so the UI can render a dash
// instead of a false zero. Uptime is milliseconds and only meaningful while running.
function rowFor(id, name, group, inst, nowMs) {
  const st = inst || {};
  const status = String(st.serverStatus || 'stopped');
  const running = status === 'running';
  const sample = running ? lastOf(st.metricsHistory) : null;
  const live = st.live || {};
  const startedAt = Number(st.startedAt) || 0;
  const uptimeMs = running && startedAt > 0 ? Math.max(0, Number(nowMs || Date.now()) - startedAt) : 0;
  return {
    id, name: name || '', group: group || '',
    status, running,
    tps: running ? num(sample && sample.tps) : null,
    mspt: running ? num(sample && sample.mspt) : null,
    cpu: running ? num(sample && sample.cpu) : null,
    ram: running ? num(sample && sample.ram) : null,
    players: running ? (Array.isArray(live.players) ? live.players.length : 0) : 0,
    uptimeMs,
  };
}
function lastOf(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[arr.length - 1] || null;
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Build the whole dashboard. `instances` is an iterable of { id, name, group } (the listInstances
// shape). `getState(id)` returns the per-instance runtime state (or undefined when unknown).
function buildSnapshots(instances, getState, nowMs) {
  const out = [];
  for (const meta of (Array.isArray(instances) ? instances : [])) {
    if (!meta || !meta.id) continue;
    const st = getState ? getState(meta.id) : null;
    out.push(rowFor(meta.id, meta.name, meta.group, st, nowMs));
  }
  return out;
}

module.exports = { buildSnapshots, rowFor };
