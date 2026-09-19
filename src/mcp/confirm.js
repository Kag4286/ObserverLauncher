// MCP write/destroy confirmation — bridges a tool call in the main process to a GUI dialog
// in the renderer. The MCP HTTP server (server.js) calls ctx.onMcpConfirm(req, cb); we forward
// req to the renderer over 'mcp:confirm-request' and resolve cb when the user answers via
// 'mcp:confirm-response'. One ipcMain.on listener handles every pending request by reqId.
const pending = new Map();

function registerMcpConfirm(ipcMain, ctx) {
  ipcMain.on('mcp:confirm-response', (_e, payload) => {
    const id = payload && payload.reqId;
    const entry = pending.get(id);
    if (entry) { pending.delete(id); entry.cb(!!payload.allow); }
  });
  // server.js expects ctx.onMcpConfirm(req, cb) where req = { reqId, tool, args, risk }.
  ctx.onMcpConfirm = (req, cb) => {
    // server.js resolves its own call at 60s but never calls cb back on timeout, so the pending
    // entry would leak. This side owns a slightly longer timer that just drops the stale entry
    // (the tool call is already denied by server.js). Also sweeps older leftovers defensively.
    const now = Date.now();
    for (const [id, entry] of pending) { if (now - entry.at > 70000) pending.delete(id); }
    const timer = setTimeout(() => { pending.delete(req.reqId); }, 61000);
    const wrapped = v => { clearTimeout(timer); cb(v); };
    pending.set(req.reqId, { cb: wrapped, at: now });
    try { ctx.send('mcp:confirm-request', req); }
    catch { clearTimeout(timer); pending.delete(req.reqId); cb(false); }
  };
}

module.exports = { registerMcpConfirm };
