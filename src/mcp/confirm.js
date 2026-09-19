// MCP write/destroy confirmation — bridges a tool call in the main process to a GUI dialog
// in the renderer. The MCP HTTP server (server.js) calls ctx.onMcpConfirm(req, cb); we forward
// req to the renderer over 'mcp:confirm-request' and resolve cb when the user answers via
// 'mcp:confirm-response'. One ipcMain.on listener handles every pending request by reqId.
const pending = new Map();

function registerMcpConfirm(ipcMain, ctx) {
  ipcMain.on('mcp:confirm-response', (_e, payload) => {
    const id = payload && payload.reqId;
    const fn = pending.get(id);
    if (fn) { pending.delete(id); fn(!!payload.allow); }
  });
  // server.js expects ctx.onMcpConfirm(req, cb) where req = { reqId, tool, args, risk }.
  ctx.onMcpConfirm = (req, cb) => {
    pending.set(req.reqId, cb);
    try { ctx.send('mcp:confirm-request', req); } catch { pending.delete(req.reqId); cb(false); }
  };
}

module.exports = { registerMcpConfirm };
