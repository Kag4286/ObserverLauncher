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

// Absolute path to bridge.js as an MCP client must invoke it. In a packaged build the file is
// unpacked OUTSIDE app.asar (asarUnpack in package.json), so `node app.asar/bridge.js` would fail;
// rewrite the asar segment to app.asar.unpacked. In dev it is just the source path.
function bridgeScriptPath() {
  let p = path.join(__dirname, 'bridge.js');
  if (p.includes('app.asar')) p = p.replace('app.asar', 'app.asar.unpacked');
  return p;
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

// Generate a user-runnable launcher script + MCP client config so the packaged app (where the
// bridge lives inside app.asar and cannot be run directly) still works. We extract bridge.js to
// userData on first use and point the script at it. Best-effort: failure is logged, not fatal.
function ensureLauncherScript() {
  try {
    const userData = app.getPath('userData');
    const bridgeSrc = path.join(__dirname, 'bridge.js');
    const bridgeDst = path.join(userData, 'mcp', 'bridge.js');
    fs.mkdirSync(path.dirname(bridgeDst), { recursive: true });
    fs.copyFileSync(bridgeSrc, bridgeDst);
    // Use the running executable itself as the Node runtime (ELECTRON_RUN_AS_NODE=1 turns the
    // Electron/app binary into a plain Node process). This means a packaged install works even if
    // the user has NO system Node.js — the old config hardcoded `node` and failed for them.
    const cfg = { mcpServers: { observerlauncher: {
      command: process.execPath,
      args: [bridgeDst],
      env: { ELECTRON_RUN_AS_NODE: '1', OBSERVER_MCP_USERDATA: userData },
    } } };
    const cfgPath = path.join(userData, 'mcp', 'mcp-config.json');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    return { bridgeDst, cfgPath, command: process.execPath };
  } catch { return null; }
}

function startMcpServer(ctx) {
  stopMcpServer(ctx);
  ctx.mcpLauncher = ensureLauncherScript();
  const token = crypto.randomBytes(32).toString('hex');
  let announcedClient = false;
  const announceClient = () => {
    if (announcedClient) return;
    announcedClient = true;
    try { ctx.appendLog('MCP: an AI client connected.', 'system'); } catch {}
    try { ctx.send('mcp:client', { connected: true }); } catch {}
  };
  const server = http.createServer((req, res) => {
    const auth = req.headers['authorization'] || '';
    // GET /tools returns the real tool list (name/description/inputSchema) so the bridge can
    // advertise exact schemas instead of shipping a stale hardcoded copy. Auth required.
    if (req.method === 'GET' && req.url === '/tools') {
      if (auth !== `Bearer ${token}`) { res.writeHead(401); return res.end('unauthorized'); }
      announceClient();
      const tools = TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ tools }));
    }
    // Only POST /rpc is served beyond that. Anything else → 404.
    if (req.method !== 'POST' || req.url !== '/rpc') { res.writeHead(404); return res.end(); }
    if (auth !== `Bearer ${token}`) { res.writeHead(401); return res.end('unauthorized'); }
    announceClient();
    let body = '';
    let tooBig = false;
    req.on('data', c => {
      if (tooBig) return;
      body += c;
      if (Buffer.byteLength(body) > MAX_BODY) {
        tooBig = true;
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Request too large (max 4 MB).' }));
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (tooBig) return; // 413 already sent
      let payload;
      try { payload = JSON.parse(body || '{}'); } catch { res.writeHead(400); return res.end('bad json'); }
      const settings = require('../main/settings.js').loadSettings();
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
      let appVersion = 'dev';
      try { appVersion = require('electron').app.getVersion(); } catch {}
      fs.writeFileSync(bridgeConfigPath(), JSON.stringify({ port, token, pid: process.pid, script: bridgeScriptPath(), appVersion }, null, 2));
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

module.exports = { startMcpServer, stopMcpServer, callTool, bridgeConfigPath, bridgeScriptPath };
