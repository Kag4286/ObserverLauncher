// v2.0.0 (M8 t2): bridges an orphan detected at boot to a GUI dialog, so the user chooses
// Reconnect (keep the still-running server) or Stop it. Same shape as mcp/confirm.js: the main
// process calls ctx.onOrphanPrompt(req, cb); the renderer answers over 'orphan:resolve'.
// A 60s timeout resolves to 'reconnect' (the safer default — never force-kill without an answer).
const pending = new Map();

function registerOrphanPrompt(ipcMain, ctx) {
  ipcMain.on('orphan:resolve', (_e, payload) => {
    const id = payload && payload.instanceId;
    const entry = pending.get(id);
    if (entry) { pending.delete(id); entry.cb(String(payload.action || 'reconnect')); }
  });
  // runOrphanCleanup calls ctx.onOrphanPrompt(req, cb) for tier-2 orphans.
  ctx.onOrphanPrompt = (req, cb) => {
    const now = Date.now();
    for (const [id, entry] of pending) { if (now - entry.at > 70000) pending.delete(id); }
    const timer = setTimeout(() => { pending.delete(req.instanceId); cb('reconnect'); }, 60000);
    const wrapped = action => { clearTimeout(timer); cb(action); };
    pending.set(req.instanceId, { cb: wrapped, at: now });
    try { ctx.send('orphan:prompt', req); }
    catch { clearTimeout(timer); pending.delete(req.instanceId); cb('reconnect'); }
  };
}

module.exports = { registerOrphanPrompt };
