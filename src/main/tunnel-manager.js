// v2.0.0 (M10): TunnelManager — the Playit daemon is GLOBAL (one process serves N tunnels), so the
// app must track WHICH instances still want it. Stopping instance B must never kill a daemon that
// instance A still needs, and the app must never stop a daemon the USER started (only one it
// started itself). This module is the pure bookkeeping; tunnel.js does the process work.
//
// State (kept on ctx):
//   ctx.tunnelDaemonUsers  Set<instanceId>  — instances whose server is running + autoTunnel on
//   ctx.tunnelStartedByApp bool             — the app started this daemon (so it may stop it)

// Pure: should the daemon be STOPPED now? Only when NO instance still needs it AND the app owns it.
// A user-run daemon (ownedByApp=false) is never stopped, even with zero users.
function shouldStopDaemon(users, ownedByApp) {
  const n = users && typeof users.size === 'number' ? users.size : 0;
  return n === 0 && !!ownedByApp;
}

// Pure: should we START the daemon? Only if at least one instance wants it and it is not already up.
function shouldStartDaemon(users, daemonRunning) {
  const n = users && typeof users.size === 'number' ? users.size : 0;
  return n > 0 && !daemonRunning;
}

// Pure: add an instance to the user set (returns a NEW Set; no mutation).
function addUser(users, instanceId) {
  const s = new Set(users || []);
  if (instanceId != null) s.add(String(instanceId));
  return s;
}

// Pure: remove an instance (returns a NEW Set).
function removeUser(users, instanceId) {
  const s = new Set(users || []);
  s.delete(String(instanceId));
  return s;
}

module.exports = { shouldStopDaemon, shouldStartDaemon, addUser, removeUser };
