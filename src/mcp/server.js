// MCP integration — HTTP server inside the Electron main process.
//
// The MCP *bridge* (src/mcp/bridge.js) is a separate Node process that an MCP client
// (Claude Desktop, Cursor, …) launches over stdio. It forwards each tool call here as a
// POST /rpc request over loopback HTTP. We chose HTTP over WebSocket deliberately: the
// exchange is pure request/response (no server-initiated push), so a tiny built-in http
// server needs ZERO extra dependencies.
//
// Security model:
//   - bind 127.0.0.1 only (never reachable from the LAN)
//   - a random 32-byte token, regenerated every app launch, required on every request
//   - the token + port are written to userData/mcp-bridge.json so the bridge can find them
//   - every tool declares a risk tier ('read' | 'write' | 'destroy'); write/destroy are gated
//     by a GUI confirmation (see tools.js / gate())
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { TOOLS, getTool } = require('./tools.js');

const MAX_BODY = 4 * 1024 * 1024; // 4 MB — generous for file writes, capped to avoid abuse

function bridgeConfigPath() {
  return path.join(app.getPath('userData'), 'mcp-bridge.json');
}

// Ask the renderer to confirm a write/destroy tool. Resolves true/false. Times out to false
// after 60s so a headless/closed window can never hang a tool call forever.
function confirmOnGui(ctx, tool, args, risk) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(!!v); } };
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => finish(false), 60000);
    if (typeof ctx.onMcpConfirm === 'function') {
      ctx.onMcpConfirm({ reqId, tool, args, risk }, v => { clearTimeout(timer); finish(v); });
    } else {
      clearTimeout(timer); finish(false);
    }
  });
}

// Route one tool call. `args` is whatever the MCP client sent.
async function callTool(ctx, toolName, args, cfg) {
  const tool = getTool(toolName);
  if (!tool) return { ok: false, error: `Unknown tool: ${toolName}` };
  if (tool.risk === 'write' && !cfg.autoAllowWrite) {
    const yes = await confirmOnGui(ctx, toolName, args, 'write');
    if (!yes) return { ok: false, error: 'Denied by user (write tool).' };
  } else if (tool.risk === 'destroy') {
    const yes = await confirmOnGui(ctx, toolName, args, 'destroy');
    if (!yes) return { ok: false, error: 'Denied by user (destructive tool).' };
  }
  try {
    return await tool.handler(ctx, args || {});
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function startMcpServer(ctx) {
  stopMcpServer(ctx);
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer((req, res) => {
    // Only POST /rpc is served. Anything else → 404.
    if (req.method !== 'POST' || req.url !== '/rpc') { res.writeHead(404); return res.end(); }
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${token}`) { res.writeHead(401); return res.end('unauthorized'); }
    let body = '';
    req.on('data', c => { body += c; if (body.length > MAX_BODY) req.destroy(); });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); } catch { res.writeHead(400); return res.end('bad json'); }
      const settings = require('../settings.js').loadSettings();
      const cfg = { autoAllowWrite: !!settings.mcpAutoAllowWrite };
      const result = await callTool(ctx, payload.tool, payload.args, cfg);
      const out = JSON.stringify(result);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(out);
    });
  });
  server.on('error', err => { try { ctx.appendLog(`MCP server error: ${err?.message || err}`, 'error'); } catch {} });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    ctx.mcpServer = server;
    ctx.mcpToken = token;
    ctx.mcpPort = port;
    // Write the bridge config so a client can point bridge.js here.
    try {
      fs.mkdirSync(path.dirname(bridgeConfigPath()), { recursive: true });
      fs.writeFileSync(bridgeConfigPath(), JSON.stringify({ port, token, pid: process.pid }, null, 2));
    } catch (e) { try { ctx.appendLog(`MCP: could not write bridge config — ${e?.message || e}`, 'error'); } catch {} }
    try { ctx.appendLog(`MCP server listening on 127.0.0.1:${port} (${TOOLS.length} tools).`, 'system'); } catch {}
  });
}

function stopMcpServer(ctx) {
  try { if (ctx.mcpServer) ctx.mcpServer.close(); } catch {}
  ctx.mcpServer = null;
  ctx.mcpToken = null;
  ctx.mcpPort = null;
  try { fs.rmSync(bridgeConfigPath(), { force: true }); } catch {}
}

module.exports = { startMcpServer, stopMcpServer, callTool, bridgeConfigPath };
