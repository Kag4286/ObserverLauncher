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

// RESOURCES (1.2.0): expose server state as read-only MCP resources so an AI client can pull
// context without spending a tool call. Each URI maps to an existing read tool's result.
async function resourceForUri(ctx, uri) {
  const call = async name => { const t = getTool(name); return t ? await t.handler(ctx, {}) : { ok: false, error: 'tool missing: ' + name }; };
  if (uri === 'observer://server/status') return call('get_status');
  if (uri === 'observer://server/properties') return call('get_properties');
  if (uri === 'observer://server/console') return call('read_console');
  if (uri === 'observer://server/diagnosis') return call('diagnose_server');
  return { ok: false, error: 'Unknown resource: ' + uri };
}

const MAX_BODY = 4 * 1024 * 1024; // 4 MB — generous for file writes, capped to avoid abuse

function bridgeConfigPath() {
  return path.join(app.getPath('userData'), 'mcp-bridge.json');
}

// Absolute path to bridge.js as an MCP client must invoke it. In a packaged build the file is
// unpacked OUTSIDE app.asar (asarUnpack in package.json), so `node app.asar/bridge.js` would fail;
// rewrite the asar segment to app.asar.unpacked. In dev it is just the source path.
function bridgeScriptPath() {
  const p = path.join(__dirname, 'bridge.js');
  // Only rewrite the `app.asar` path SEGMENT (a directory named exactly app.asar). A plain
  // String.replace('app.asar', ...) would also rewrite an already-unpacked path
  // (app.asar.unpacked -> app.asar.unpacked.unpacked) or an unrelated directory that happens to
  // contain the substring. Split on the path separator and swap the exact segment.
  const parts = p.split(path.sep);
  const i = parts.indexOf('app.asar');
  if (i !== -1) parts[i] = 'app.asar.unpacked';
  return parts.join(path.sep);
}

// Ask the renderer to confirm a write/destroy tool. Resolves true/false. Times out to false
// after 60s so a headless/closed window can never hang a tool call forever.
function confirmOnGui(ctx, tool, args, risk, instanceName) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(!!v); } };
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => finish(false), 60000);
    if (typeof ctx.onMcpConfirm === 'function') {
      // instanceName lets the dialog show WHICH server the tool targets (a multi-instance user
      // otherwise has to read the raw JSON args to find out). null when unresolved/single-instance.
      ctx.onMcpConfirm({ reqId, tool, args, risk, instanceName }, v => { clearTimeout(timer); finish(v); });
    } else {
      clearTimeout(timer); finish(false);
    }
  });
}

// AUDIT LOG (1.2.0): append every write/destroy call to userData/mcp-audit.log so the user (and
// the AI via read_audit_log) can see exactly what an assistant changed. Best-effort, capped at
// ~256 KB so it can never grow unbounded.
function auditLog(tool, risk, result) {
  try {
    const file = path.join(app.getPath('userData'), 'mcp-audit.log');
    try { if (fs.statSync(file).size > 256 * 1024) fs.rmSync(file, { force: true }); } catch {}
    const line = `${new Date().toISOString()}\t${risk}\t${tool}\t${result && result.ok === false ? 'denied/error: ' + (result.error || '') : 'ok'}\n`;
    fs.appendFileSync(file, line);
  } catch {}
}

// Route one tool call. `args` is whatever the MCP client sent.
async function callTool(ctx, toolName, args, cfg) {
  const tool = getTool(toolName);
  if (!tool) return { ok: false, error: `Unknown tool: ${toolName}` };
  // READ-ONLY MODE (1.2.0): let an AI explore freely with zero risk. write/destroy are refused
  // before any confirm dialog is even shown.
  if (cfg.readOnly && tool.risk !== 'read') return { ok: false, error: `Read-only mode is on - "${toolName}" (${tool.risk}) is blocked. A human can disable it in Settings > MCP.` };
  // M11 + polish: resolve the target instance BEFORE any confirmation so the dialog can name it.
  // An optional `instance` arg targets a specific instance; omitted -> the ACTIVE one (backward
  // compatible). Unknown id -> a clear error. This is the ONE choke point for instance targeting.
  let runId = ctx.activeInstanceId;
  if (args && args.instance) {
    const { resolveInstanceId } = require('../main/settings.js');
    const resolved = resolveInstanceId(String(args.instance));
    if (!resolved) return { ok: false, error: `Unknown instance "${args.instance}". Call list_instances for valid ids.` };
    runId = resolved;
  }
  let instanceName = null;
  try {
    const { listInstances } = require('../main/settings.js');
    const found = (listInstances().instances || []).find(i => i.id === runId);
    instanceName = found ? found.name : null;
  } catch {}
  if (tool.risk === 'write' && !cfg.autoAllowWrite) {
    const yes = await confirmOnGui(ctx, toolName, args, 'write', instanceName);
    if (!yes) { auditLog(toolName, 'write', { ok: false, error: 'denied by user' }); return { ok: false, error: 'Denied by user (write tool).' }; }
  } else if (tool.risk === 'destroy') {
    const yes = await confirmOnGui(ctx, toolName, args, 'destroy', instanceName);
    if (!yes) { auditLog(toolName, 'destroy', { ok: false, error: 'denied by user' }); return { ok: false, error: 'Denied by user (destructive tool).' }; }
  }
  try {
    // M4b: run the handler inside AsyncLocalStorage for the target instance so per-instance ctx
    // accessors resolve to it, and an instance switch mid-await cannot leak across calls.
    const r = await ctx.runInInstance(runId, () => tool.handler(ctx, args || {}));
    if (tool.risk !== 'read') auditLog(toolName, tool.risk, r);
    return r;
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
  // RATE LIMIT (1.2.0): a simple token bucket per tool name. An AI that spins in a tight loop
  // (e.g. polling in a bad retry) could otherwise hammer the main process. 60 calls/min per tool is
  // far above any legitimate use, but stops runaway loops.
  const buckets = new Map();
  const rateLimited = name => {
    const now = Date.now();
    const b = buckets.get(name) || { tokens: 60, at: now };
    b.tokens = Math.min(60, b.tokens + ((now - b.at) / 60000) * 60);
    b.at = now;
    if (b.tokens < 1) { buckets.set(name, b); return true; }
    b.tokens -= 1; buckets.set(name, b); return false;
  };
  const server = http.createServer((req, res) => {
    // SECURITY (1.1.0, defense in depth): the real client is the Node bridge, which NEVER sends an
    // Origin header and connects by IP. A browser page on any site can still POST to 127.0.0.1
    // (localhost CSRF / DNS-rebinding): the token already blocks it, but rejecting browser-shaped
    // requests up front removes the attack surface entirely. Non-IP Host values are rebinding.
    if (req.headers['origin']) { res.writeHead(403); return res.end('forbidden'); }
    const host = String(req.headers['host'] || '').split(':')[0];
    if (host && host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]' && host !== '::1') {
      res.writeHead(403); return res.end('forbidden');
    }
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
    // GET /resource?uri=... returns one resource body as JSON. Auth required (loopback + token).
    if (req.method === 'GET' && req.url.startsWith('/resource')) {
      if (auth !== `Bearer ${token}`) { res.writeHead(401); return res.end('unauthorized'); }
      let uri = '';
      try { uri = new URL(req.url, 'http://127.0.0.1').searchParams.get('uri') || ''; } catch {}
      resourceForUri(ctx, uri).then(result => {
        const ok = result && result.ok !== false;
        res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
        res.end(JSON.stringify(ok ? { ok: true, data: result.result ?? result } : { ok: false, error: (result && result.error) || 'not available' }));
      }).catch(e => { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e?.message || String(e) })); });
      return;
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
      const cfg = { autoAllowWrite: !!settings.mcpAutoAllowWrite, readOnly: !!settings.mcpReadOnly };
      if (rateLimited(String(payload.tool || ''))) {
        res.writeHead(429, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Rate limit exceeded (60/min per tool) - slow down and retry.' }));
      }
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
      // SECURITY: this file holds the MCP token. Write it 0o600 (owner-only) so another user on a
      // shared machine cannot read the token and talk to the loopback server.
      fs.writeFileSync(bridgeConfigPath(), JSON.stringify({ port, token, pid: process.pid, script: bridgeScriptPath(), appVersion }, null, 2), { mode: 0o600 });
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
