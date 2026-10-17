// src/main/pinggy-tunnel.js — per-instance Pinggy tunnel orchestration (v6.0.0, A2.3).
//
// Design (docs/v6.0.0-plan.md, A2):
//   - Pinggy runs ALONGSIDE Playit. Playit = Java TCP (as before); Pinggy = Bedrock UDP.
//   - PER-INSTANCE: an ssh child forwards one specific local port. Each instance owns
//     ctx.pinggyProcess / pinggyProto / pinggyAddress / pinggyStatus / pinggyRestartTimer.
//   - A free Pinggy tunnel expires at 60 min, so a 55-min timer restarts it automatically.
//   - No auto-fallback from Playit; the UI offers Pinggy explicitly.
//
// ASYNC-SAFETY (v6.0.0 review fix): every timer and child 'exit' callback runs OUTSIDE the IPC
// call chain, so it has no AsyncLocalStorage scope. Reading/writing ctx.pinggy* inside them would
// resolve to whatever instance is active at that moment, not the one that owns the tunnel. Every
// such callback therefore re-enters ctx.runInInstance(ownId, ...) first (memory gotcha 15).
//
// The ssh argv, address parser and spawn wrapper live in pinggy.js (pure, unit-tested).
const P = require('./pinggy.js');

const RESTART_MS = 55 * 60 * 1000; // restart before the 60-minute free-tier cutoff
const START_WATCHDOG_MS = 40000;   // if start never settles, force 'error' (never leave 'starting')

// The local port to forward. 'tcp' = the server port; 'udp' = Geyser's Bedrock port (default 19132).
function localPortFor(ctx, proto) {
  const kind = String(proto || '').toLowerCase();
  if (kind === 'udp') {
    try {
      const { inspectGeyser } = require('./geyser.js');
      const info = inspectGeyser(ctx.currentServerPath, {});
      const bp = info && info.config && info.config.bedrock && info.config.bedrock.port;
      const n = Number(bp);
      if (Number.isFinite(n) && n > 0 && n < 65536) return n;
    } catch {}
    return 19132;
  }
  return require('./tunnel.js').resolveTargetPort(ctx);
}

function clearRestart(ctx) {
  if (ctx.pinggyRestartTimer) { try { clearTimeout(ctx.pinggyRestartTimer); } catch {} ctx.pinggyRestartTimer = null; }
}

function killChild(ctx) {
  const child = ctx.pinggyProcess;
  ctx.pinggyProcess = null;
  if (!child) return;
  try { if (child.pid) require('./kill.js').killTree(child.pid); } catch {}
  try { child.kill(); } catch {}
}

function snapshot(ctx) {
  return { status: ctx.pinggyStatus || 'stopped', address: ctx.pinggyAddress || '', proto: ctx.pinggyProto || null };
}
function emit(ctx) { try { ctx.send('pinggy:status', snapshot(ctx)); } catch {} }

// Stop the tunnel for the CURRENT instance. Safe to call when nothing runs.
function stopPinggy(ctx) {
  clearRestart(ctx);
  killChild(ctx);
  ctx.pinggyStatus = 'stopped';
  ctx.pinggyAddress = '';
  emit(ctx);
  return { ok: true };
}

// Stop every instance's tunnel. Called on app quit: without this, a background instance's ssh
// child would outlive the app (orphan process holding the Pinggy tunnel open). Runs each stop in
// that instance's ALS scope so it touches the right ctx fields.
function stopAllPinggy(ctx) {
  let ids = [];
  try { ids = [...ctx.instances.keys()]; } catch {}
  for (const id of ids) {
    try { ctx.runInInstance(id, () => stopPinggy(ctx)); } catch {}
  }
  // Also stop the active instance even if it is not in the map yet.
  try { stopPinggy(ctx); } catch {}
  return { ok: true };
}

// Start the tunnel for the CURRENT instance. proto is 'tcp' or 'udp'.
async function startPinggy(ctx, proto, opts = {}) {
  const kind = String(proto || '').toLowerCase();
  if (kind !== 'tcp' && kind !== 'udp') return { ok: false, error: 'Choose tcp or udp.' };
  // Capture THIS instance now; the async continuations below re-enter this scope explicitly.
  const ownId = ctx.inst();
  // One tunnel per instance: stop any existing one first (a new address is allocated anyway).
  if (ctx.pinggyProcess) stopPinggy(ctx);
  const ssh = P.findSshBinary();
  if (!ssh) {
    ctx.pinggyStatus = 'error';
    try { ctx.appendLog('Pinggy needs an SSH client, and none was found. Install the Windows OpenSSH client or set pinggyPath in Settings.', 'error'); } catch {}
    emit(ctx);
    return { ok: false, error: 'No SSH client found. Install OpenSSH or set pinggyPath.' };
  }
  const port = localPortFor(ctx, kind);
  ctx.pinggyProto = kind;
  ctx.pinggyStatus = 'starting';
  ctx.pinggyAddress = '';
  try {
    const msg = opts.internal
      ? `Pinggy tunnel is about to expire; restarting (${kind.toUpperCase()}, local port ${port})...`
      : `Starting Pinggy ${kind.toUpperCase()} tunnel to local port ${port}...`;
    ctx.appendLog(msg, 'system');
  } catch {}
  emit(ctx);

  // Watchdog: if the start does not settle within START_WATCHDOG_MS, force an error so the UI can
  // never hang on 'starting'. Cleared once the address promise settles.
  let watchdog = setTimeout(() => {
    ctx.runInInstance(ownId, () => {
      if (ctx.pinggyStatus === 'starting') {
        killChild(ctx);
        ctx.pinggyStatus = 'error';
        ctx.pinggyAddress = '';
        try { ctx.appendLog('Pinggy did not return an address in time. Check that ssh works and the network allows port 443.', 'error'); } catch {}
        emit(ctx);
      }
    });
  }, START_WATCHDOG_MS);
  try { if (watchdog.unref) watchdog.unref(); } catch {}
  const clearWatchdog = () => { try { clearTimeout(watchdog); } catch {} watchdog = null; };

  const r = P.spawnPinggy({ sshBinary: ssh, localPort: port, proto: kind });
  if (!r.ok) {
    clearWatchdog();
    ctx.pinggyStatus = 'error';
    emit(ctx);
    return { ok: false, error: r.error };
  }
  ctx.pinggyProcess = r.child;

  // On an UNEXPECTED child exit, mark error for THIS instance. Do not auto-restart here (a crash
  // loop is worse than a clear error); only the 55-min timer restarts. Runs inside ownId.
  try {
    r.child.on('exit', code => {
      ctx.runInInstance(ownId, () => {
        if (ctx.pinggyProcess !== r.child) return; // superseded by a newer start/stop
        ctx.pinggyProcess = null;
        clearRestart(ctx);
        // Fix (review BUG 1): reset status from BOTH 'starting' and 'running'. Previously only
        // 'running' was handled, so a child that exited before the address arrived left the UI
        // stuck on 'starting' forever.
        if (ctx.pinggyStatus === 'starting' || ctx.pinggyStatus === 'running') {
          ctx.pinggyStatus = 'error';
          ctx.pinggyAddress = '';
          try { ctx.appendLog(`Pinggy tunnel exited unexpectedly (code ${code}). Start it again if Bedrock players need to join.`, 'error'); } catch {}
          emit(ctx);
        }
      });
    });
  } catch {}

  let addr;
  try { addr = await r.addressPromise; } catch (e) { addr = { ok: false, error: e?.message || 'Pinggy did not return an address.' }; }
  clearWatchdog();

  // Re-enter ownId for the post-await continuations (defensive; ALS normally carries through await).
  return await ctx.runInInstance(ownId, async () => {
    if (ctx.pinggyProcess !== r.child) {
      // Superseded by a newer start/stop. Do NOT leave a stale 'starting' status behind.
      if (ctx.pinggyStatus === 'starting') { ctx.pinggyStatus = 'error'; emit(ctx); }
      return { ok: false, error: 'The Pinggy tunnel was stopped.' };
    }
    if (!addr || !addr.ok) {
      killChild(ctx);
      ctx.pinggyStatus = 'error';
      ctx.pinggyAddress = '';
      try { ctx.appendLog(`Pinggy failed: ${(addr && addr.error) || 'no address'}.`, 'error'); } catch {}
      emit(ctx);
      return { ok: false, error: (addr && addr.error) || 'Pinggy did not return an address.' };
    }
    const a = addr.address;
    ctx.pinggyAddress = `${a.proto}://${a.host}:${a.port}`;
    ctx.pinggyStatus = 'running';
    // NOTE: we do NOT write ctx.pinggyAddress into the Playit tunnelAddress field (review BUG 3):
    // that field holds the Java TCP address the Playit panel shows, and a scheme'd Pinggy address
    // would both clobber it and fail the isSafeTunnelAddress validator (review BUG 4). The Pinggy
    // address is shown from ctx.pinggyAddress while the tunnel runs; it is intentionally NOT
    // persisted, because the ssh child dies on app quit so a stored address would be stale.
    try { ctx.appendLog(`Pinggy ${kind.toUpperCase()} tunnel ready: ${ctx.pinggyAddress} (expires in about 60 minutes).`, 'system'); } catch {}
    emit(ctx);
    // 55-minute auto-restart, in ownId so it restarts the RIGHT instance.
    clearRestart(ctx);
    ctx.pinggyRestartTimer = setTimeout(() => {
      ctx.runInInstance(ownId, () => {
        if (ctx.pinggyStatus === 'running') startPinggy(ctx, kind, { internal: true }).catch(() => {});
      });
    }, RESTART_MS);
    try { if (ctx.pinggyRestartTimer.unref) ctx.pinggyRestartTimer.unref(); } catch {}
    return { ok: true, address: ctx.pinggyAddress };
  });
}

function registerPinggy(ipcMain, ctx) {
  ipcMain.handle('pinggy:start', async (_, proto) => {
    try { return await startPinggy(ctx, proto); } catch (e) { return { ok: false, error: e?.message || 'Could not start the Pinggy tunnel.' }; }
  });
  ipcMain.handle('pinggy:stop', async () => {
    try { return stopPinggy(ctx); } catch (e) { return { ok: false, error: e?.message || 'Could not stop the Pinggy tunnel.' }; }
  });
  ipcMain.handle('pinggy:get', async () => snapshot(ctx));
}

module.exports = { registerPinggy, startPinggy, stopPinggy, stopAllPinggy, snapshot, localPortFor, RESTART_MS, START_WATCHDOG_MS };
