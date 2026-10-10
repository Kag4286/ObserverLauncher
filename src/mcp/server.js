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
// B1 (v3.0.0): no top-level electron require (throws in plain Node). All data paths go through
// dataDir(); the one remaining Electron use (app.getVersion) stays lazily inside a try/catch.
const { dataDir } = require('../main/data-dir.js');
const { TOOLS, getTool } = require('./tools.js');
// 4.4.0: constant-time bearer-token compare (shared with the remote server).
const { tokenEquals, bearerToken } = require('../main/validate.js');

// RESOURCES (1.2.0, single-source in 5.0.0): expose server state as read-only MCP resources so an
// AI client can pull context without spending a tool call. The URI->{tool,args} map lives in
// resources.js (static + RFC 6570 templates) so the bridge and this server cannot drift.
async function resourceForUri(ctx, uri) {
  const { resolveResource } = require('./resources.js');
  const hit = resolveResource(String(uri || ''));
  if (!hit) return { ok: false, error: 'Unknown resource: ' + uri };
  const t = getTool(hit.tool);
  if (!t) return { ok: false, error: 'tool missing: ' + hit.tool };
  return await t.handler(ctx, hit.args || {});
}

const MAX_BODY = 4 * 1024 * 1024; // 4 MB — generous for file writes, capped to avoid abuse

function bridgeConfigPath() {
  return path.join(dataDir(), 'mcp-bridge.json');
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
  // B4 (v3.0.0): explicit headless confirm policy so write/destroy handling is DELIBERATE, not an
  // accident of ctx.onMcpConfirm being undefined. Modes:
  //   'gui'        (default) - ask the renderer dialog (unchanged).
  //   'auto-deny'  - refuse write/destroy immediately + audit; never open a dialog or wait 60s.
  //   'allowlist'  - allow ONLY tools named in ctx.confirmAllow, deny the rest.
  const mode = ctx.confirmMode || 'gui';
  if (mode === 'auto-deny') return Promise.resolve(false);
  if (mode === 'allowlist') {
    const allow = Array.isArray(ctx.confirmAllow) ? ctx.confirmAllow : [];
    return Promise.resolve(allow.includes(tool));
  }
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
// C3 (v3.0.0): JSONL + rotation. The old format was a TSV text that was DELETED wholesale at 256 KB,
// so any write/destroy history older than the last ~256 KB was lost. Now each line is a JSON object
// and the file ROTATES to mcp-audit.log.1/.2/.3 (keep 3), so history survives across the cap and an
// AI can parse entries structurally instead of re-splitting tabs.
const AUDIT_MAX_BYTES = 256 * 1024;
const AUDIT_KEEP = 3;
function rotateAuditIfNeeded(file) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size <= AUDIT_MAX_BYTES) return;
    // Shift .N-1 -> .N (oldest dropped), then base -> .1.
    for (let i = AUDIT_KEEP - 1; i >= 1; i--) {
      const a = `${file}.${i}`, b = `${file}.${i + 1}`;
      try { if (fs.existsSync(a)) fs.renameSync(a, b); } catch {}
    }
    try { fs.renameSync(file, `${file}.1`); } catch {}
  } catch {}
}
function auditLog(tool, risk, result) {
  try {
    const file = path.join(dataDir(), 'mcp-audit.log');
    rotateAuditIfNeeded(file);
    const denied = !!(result && result.ok === false);
    const entry = { ts: new Date().toISOString(), risk, tool, ok: !denied, ...(denied ? { error: result.error || '' } : {}) };
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
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
  // B4: when NOT in GUI mode the deny is a POLICY decision, so the message says so (the GUI text
  // stays byte-identical for the existing confirm-flow tests).
  const denyMsg = (riskLabel) => ((ctx.confirmMode && ctx.confirmMode !== 'gui')
    ? `Denied by headless confirm policy (${riskLabel}).`
    : `Denied by user (${riskLabel}).`);
  // 5.0.0: server LIFECYCLE actions (start/stop/restart/force-stop, incl. per-instance variants) are
  // the everyday operations of a launcher. When the user enables auto-allow-write they should NOT
  // have to approve each one. start_* is already 'write' (skipped by autoAllowWrite below); the
  // stop/restart/force-stop tools are 'destroy' tier for SAFETY, but they are lifecycle, not data
  // loss, so autoAllowWrite covers them too. Everything else at 'destroy' (delete/restore/apply_fix)
  // still ALWAYS confirms.
  const LIFECYCLE_TOOLS = new Set(['start_server', 'stop_server', 'force_stop_server', 'safe_restart', 'start_instance', 'stop_instance', 'prepare_and_start']);
  const lifecycleAutoAllowed = cfg.autoAllowWrite && LIFECYCLE_TOOLS.has(toolName);
  if (tool.risk === 'write' && !cfg.autoAllowWrite) {
    const yes = await confirmOnGui(ctx, toolName, args, 'write', instanceName);
    if (!yes) { auditLog(toolName, 'write', { ok: false, error: 'denied by user' }); return { ok: false, error: denyMsg('write tool') }; }
  } else if (tool.risk === 'destroy' && !lifecycleAutoAllowed) {
    const yes = await confirmOnGui(ctx, toolName, args, 'destroy', instanceName);
    if (!yes) { auditLog(toolName, 'destroy', { ok: false, error: 'denied by user' }); return { ok: false, error: denyMsg('destructive tool') }; }
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
    const userData = dataDir();
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
  // RATE LIMIT (1.2.0): a shared token bucket per (client, tool). An AI that spins in a tight loop
  // (e.g. polling in a bad retry) could otherwise hammer the main process. 60 calls/min per tool is
  // far above any legitimate use, but stops runaway loops.
  // Keyed by CLIENT + tool (1.2.0, revised 4.2.0): a bucket per bridge process (x-ob-client header)
  // so two MCP clients do not share one 60/min budget. A missing header (old bridge) falls back to
  // 'local', preserving the old per-tool behaviour for it.
  // 4.4.0: the bucket math lives in the shared rate-limit.js (also used by the remote server).
  const limitBucket = require('../main/rate-limit.js').makeRateLimiter(60, 60000);
  const rateLimited = (client, name) => limitBucket(client + '::' + name);
  const server = http.createServer((req, res) => {
    // SECURITY (1.1.0, defense in depth): the real client is the Node bridge, which NEVER sends an
    // Origin header and connects by IP. A browser page on any site can still POST to 127.0.0.1
    // (localhost CSRF / DNS-rebinding): the token already blocks it, but rejecting browser-shaped
    // requests up front removes the attack surface entirely. Non-IP Host values are rebinding.
    if (req.headers['origin']) { res.writeHead(403); return res.end('forbidden'); }
    // BUGFIX: use hostFromHeader so an IPv6 Host ('[::1]:8080') is not mis-split to '['.
    const host = require('../main/validate.js').hostFromHeader(req.headers['host']);
    // 5.0.0 (defense in depth): a MISSING Host header must be refused too (was: the guard was
    // skipped entirely when host was falsy). HTTP/1.1 always sends Host; the bridge sends an
    // IP-literal Host. Only a malformed/rebinding-shaped request omits it.
    if (!host || (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1')) {
      res.writeHead(403); return res.end('forbidden');
    }
    // C2 (v3.0.0): UNAUTHENTICATED /health for container/orchestrator healthchecks (Docker 3.1.0).
    // The per-launch token is unreadable to a healthcheck, so it cannot be gated. It exposes only
    // liveness + version (NO tool access, NO server state) and stays behind the same loopback +
    // Origin/Host guards above, so it is still not reachable off-host.
    if (req.method === 'GET' && req.url === '/health') {
      let version = 'dev';
      try { version = require('electron').app.getVersion(); } catch { try { version = require('../../package.json').version; } catch {} }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), version }));
    }
    const auth = req.headers['authorization'] || '';
    // 5.0.0 (fail-closed): an empty/absent configured token rejects everything below (mirrors
    // remote.js). startMcpServer always mints one, so this only guards direct embedding.
    if (!token) { res.writeHead(401); return res.end('unauthorized'); }
    // GET /tools returns the real tool list (name/description/inputSchema) so the bridge can
    // advertise exact schemas instead of shipping a stale hardcoded copy. Auth required.
    if (req.method === 'GET' && req.url === '/tools') {
      if (!tokenEquals(bearerToken(auth), token)) { res.writeHead(401); return res.end('unauthorized'); }
      announceClient();
      // v5.0.0: advertise annotations + outputSchema too, so the MCP client can auto-approve reads
      // (readOnlyHint) and validate structured results. Omitted fields are simply absent.
      const tools = TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.annotations ? { annotations: t.annotations } : {}),
        ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ tools }));
    }
    // v5.0.0: GET /prompts returns the prompt list (name/title/description/arguments) so the bridge
    // can advertise workflow templates. GET /prompt?name=..&args=<base64 json> returns the BUILT
    // message list for one prompt. Both auth-gated (loopback + token).
    if (req.method === 'GET' && req.url === '/prompts') {
      if (!tokenEquals(bearerToken(auth), token)) { res.writeHead(401); return res.end('unauthorized'); }
      announceClient();
      const { promptList } = require('./prompts.js');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ prompts: promptList() }));
    }
    if (req.method === 'GET' && req.url.startsWith('/prompt')) {
      if (!tokenEquals(bearerToken(auth), token)) { res.writeHead(401); return res.end('unauthorized'); }
      let name = '', args = {};
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        name = u.searchParams.get('name') || '';
        const raw = u.searchParams.get('args');
        if (raw) { try { args = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) || {}; } catch {} }
      } catch {}
      const { getPrompt } = require('./prompts.js');
      const p = getPrompt(name);
      if (!p) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'Unknown prompt: ' + name })); }
      let messages;
      try { messages = p.build(args); } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: e?.message || String(e) })); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, description: p.description, messages }));
    }
    // GET /resource?uri=... returns one resource body as JSON. Auth required (loopback + token).
    // v5.0.0: GET /resource-templates returns the RFC 6570 templates so a client can build concrete
    // instance/file URIs. Auth-gated.
    // v5.0.0: GET /resources returns the static resource list (single source: resources.js) so the
    // bridge does not carry a duplicate copy. Auth-gated.
    if (req.method === 'GET' && req.url === '/resources') {
      if (!tokenEquals(bearerToken(auth), token)) { res.writeHead(401); return res.end('unauthorized'); }
      announceClient();
      const { STATIC_RESOURCES } = require('./resources.js');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ resources: STATIC_RESOURCES }));
    }
    if (req.method === 'GET' && req.url === '/resource-templates') {
      if (!tokenEquals(bearerToken(auth), token)) { res.writeHead(401); return res.end('unauthorized'); }
      announceClient();
      const { RESOURCE_TEMPLATES } = require('./resources.js');
      const tpl = RESOURCE_TEMPLATES.map(t => ({ uriTemplate: t.uriTemplate, name: t.name, description: t.description, mimeType: t.mimeType }));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ resourceTemplates: tpl }));
    }
    if (req.method === 'GET' && req.url.startsWith('/resource')) {
      if (!tokenEquals(bearerToken(auth), token)) { res.writeHead(401); return res.end('unauthorized'); }
      // 5.0.0: /resource previously bypassed the rate limiter AND the per-instance ALS scope
      // (it called the handler directly). Both now apply, so an instance template reads the RIGHT
      // instance and a leaked token cannot spam the expensive diagnosis resource.
      const client = String(req.headers['x-ob-client'] || 'local').replace(/[^\w.-]/g, '').slice(0, 32) || 'local';
      if (rateLimited(client, 'resource')) {
        res.writeHead(429, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Rate limit exceeded (60/min) - slow down and retry.' }));
      }
      let uri = '';
      try { uri = new URL(req.url, 'http://127.0.0.1').searchParams.get('uri') || ''; } catch {}
      const { resolveResource } = require('./resources.js');
      const hit = resolveResource(uri);
      const runId = (hit && hit.args && hit.args.instance) || ctx.activeInstanceId;
      Promise.resolve().then(() => (typeof ctx.runInInstance === 'function' ? ctx.runInInstance(runId, () => resourceForUri(ctx, uri)) : resourceForUri(ctx, uri))).then(result => {
        const ok = result && result.ok !== false;
        res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
        res.end(JSON.stringify(ok ? { ok: true, data: result.result ?? result } : { ok: false, error: (result && result.error) || 'not available' }));
      }).catch(e => { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e?.message || String(e) })); });
      return;
    }
    // Only POST /rpc is served beyond that. Anything else → 404.
    if (req.method !== 'POST' || req.url !== '/rpc') { res.writeHead(404); return res.end(); }
    if (!tokenEquals(bearerToken(auth), token)) { res.writeHead(401); return res.end('unauthorized'); }
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
      const client = String(req.headers['x-ob-client'] || 'local').replace(/[^\w.-]/g, '').slice(0, 32) || 'local';
      if (rateLimited(client, String(payload.tool || ''))) {
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

module.exports = { startMcpServer, stopMcpServer, callTool, bridgeConfigPath, bridgeScriptPath, auditLog };
