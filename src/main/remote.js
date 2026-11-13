// remote.js (v3.3.0, Track A - Remote management).
//
// DESIGN GATE (docs/v3.0.0-plan.md): never expose MCP to the internet. The remote API is a SEPARATE
// loopback server with a long-lived token + an IP allowlist and a READ-ONLY-ish subset; write/destroy
// and install are NEVER reachable remotely. The user brings it online with Tailscale (or a tunnel).
//
// R1 (this file, pure helpers): token generation, allowlist parsing + matching, a UI snapshot, and
// the local addresses to show. No network/Electron -> unit-testable. R2 adds the HTTP server.
const crypto = require('crypto');

// Long-lived token (the MCP token is regenerated every launch; this one is NOT, so a remote client is
// configured once). 24 random bytes -> 48 hex chars.
function newRemoteToken() { return crypto.randomBytes(24).toString('hex'); }

// Parse the allowlist setting (comma/space separated) into a clean array. Empty -> [] (allow any).
function parseAllowList(str) {
  return String(str || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

// 8.1.0: parse trusted reverse-proxy / Tailscale MagicDNS hostnames (empty -> [] = loopback/IP only).
// Rejects bare '*' so DNS-rebinding cannot be accidentally opened to arbitrary origins.
function parseAllowedHosts(str) {
  return String(str || '').split(/[\s,]+/)
    .map(s => s.trim().toLowerCase().replace(/:\d+$/, ''))
    .filter(s => s && s !== '*' && /^[a-z0-9*.-]+$/.test(s));
}

function isHostAllowed(hostHdr, bind, allowedHosts) {
  const h = String(hostHdr || '').trim().toLowerCase();
  if (!h) return false;
  const { isSafeIp } = require('./validate.js');
  const b = String(bind || '127.0.0.1').trim().toLowerCase();
  const wildcardBind = b === '0.0.0.0' || b === '::' || b === '';
  if (h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]' || h === b) return true;
  if (wildcardBind && isSafeIp(h)) return true;
  const list = Array.isArray(allowedHosts) ? allowedHosts : parseAllowedHosts(allowedHosts);
  for (const entry of list) {
    if (h === entry) return true;
    if (entry.startsWith('*.') && h.endsWith(entry.slice(1)) && h.length > entry.length - 1) return true;
  }
  return false;
}

function ipv4ToInt(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

// Is `ip` allowed by the allowlist? Empty allow -> true (no restriction). Entries may be an exact IP,
// a wildcard 'a.b.c.*', or CIDR 'a.b.c.d/n'. IPv6 (incl. '::1') matches exactly.
function isIpAllowed(ip, allow) {
  const list = Array.isArray(allow) ? allow : parseAllowList(allow);
  const target = String(ip || '').replace(/^::ffff:/, '');
  if (!list.length) return true;
  if (!target) return false;
  for (const raw of list) {
    const entry = String(raw).trim();
    if (entry === target) return true;
    if (entry.endsWith('.*')) { if (target.startsWith(entry.slice(0, -1))) return true; continue; }
    const m = entry.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
    if (m) {
      const base = ipv4ToInt(m[1]), t = ipv4ToInt(target), bits = Number(m[2]);
      if (base == null || t == null || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
      if ((base & mask) === (t & mask)) return true;
    }
  }
  return false;
}

// Snapshot for the UI (never exposes the token - only whether one is set).
function remoteSnapshot(settings) {
  const s = settings || {};
  return {
    enabled: !!s.remoteEnabled,
    readOnly: s.remoteReadOnly !== false,
    allow: parseAllowList(s.remoteAllow),
    allowedHosts: parseAllowedHosts(s.remoteAllowedHosts),
    port: Number(s.remotePort) || 0,
    bind: String(s.remoteBind || '').trim() || '127.0.0.1',
    tokenSet: !!s.remoteToken,
  };
}

// Local addresses a remote client could use (localhost first, then LAN IPv4s). Friendly UI default.
function remoteAddresses(port) {
  const out = [`http://127.0.0.1:${port}`];
  try { const { localIPv4s } = require('./network.js'); for (const ip of localIPv4s() || []) out.push(`http://${ip}:${port}`); } catch {}
  return out;
}

// R2: the loopback HTTP server. Handlers are INJECTED so this is testable without Electron and so
// the caller decides what each read/safe-action does (it wires them to existing tool handlers).
//   opts: { token, allow, readOnly, handlers:{ status, console, players, command }, version }
// Returns { server, port, close() }. Binds 127.0.0.1 ONLY. Never serves write/destroy/install.
const http = require('http');
const { originOk, ipIsLoopback } = require('./http-guard.js');
const fs = require('fs');
const path = require('path');
function createRemoteServer(opts) {
  const o = opts || {};
  const token = String(o.token || '');
  const allow = Array.isArray(o.allow) ? o.allow : parseAllowList(o.allow);
  const readOnly = o.readOnly !== false;
  const h = o.handlers || {};
  const MAX = 64 * 1024;
  const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  // Read + size-cap + JSON-parse a POST body, then hand the payload to cb. Shared by /command and
  // /action so the boilerplate lives once (gotcha #20). Sends 413/400 itself and returns.
  const readJson = (req, res, cb) => {
    let body = ''; let big = false;
    req.on('data', c => { if (big) return; body += c; if (body.length > MAX) { big = true; send(res, 413, { ok: false, error: 'Request too large.' }); req.destroy(); } });
    req.on('end', () => {
      if (big) return;
      let payload; try { payload = JSON.parse(body || '{}'); } catch { return send(res, 400, { ok: false, error: 'bad json' }); }
      cb(payload || {});
    });
  };
  const { isSafeConsoleCommand, tokenEquals, bearerToken } = require('./validate.js');
  // 4.4.0: the Remote web dashboard — three FIXED files, read once at server creation and served
  // from memory. The path is never built from the request (no traversal possible). If the assets are
  // missing (an unpackaged checkout) the GUI routes 404 but the JSON API still works.
  const UI_DIR = path.join(__dirname, '..', 'remote-ui');
  const uiAssets = {};
  try {
    uiAssets['/'] = { type: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(UI_DIR, 'index.html')) };
    uiAssets['/ui'] = uiAssets['/'];
    uiAssets['/ui/style.css'] = { type: 'text/css; charset=utf-8', body: fs.readFileSync(path.join(UI_DIR, 'style.css')) };
    uiAssets['/ui/app.js'] = { type: 'text/javascript; charset=utf-8', body: fs.readFileSync(path.join(UI_DIR, 'app.js')) };
  } catch { /* GUI not available -> API only */ }
  // RATE LIMIT (4.4.0): per client IP, shared token-bucket. The web dashboard polls a few
  // endpoints every few seconds, so the budget must sit well above that (the old 60/min throttled
  // the GUI itself). 300/min still bounds a leaked-token hammer. The bucket is PER SERVER, so it
  // does not share the MCP server's per-tool budget.
  const rateLimited = require('./rate-limit.js').makeRateLimiter(300, 60000);
  // 8.1.0: dedicated brute-force limiter for failed auth (15 attempts / 5 min per IP).
  const authLimited = require('./rate-limit.js').makeRateLimiter(15, 5 * 60 * 1000);
  const allowedHosts = Array.isArray(o.allowedHosts) ? o.allowedHosts : parseAllowedHosts(o.allowedHosts);
  const sseClients = new Set();
  const MAX_SSE_CLIENTS = 10;
  const sseHeartbeat = setInterval(() => {
    for (const c of sseClients) { try { c.res.write(': ping\n\n'); } catch { sseClients.delete(c); } }
  }, 20000);
  if (sseHeartbeat.unref) sseHeartbeat.unref();

  const publish = (type, payload) => {
    if (!sseClients.size) return;
    const frame = `event: ${type}\ndata: ${JSON.stringify(payload || {})}\n\n`;
    const evInst = payload && payload.instanceId ? String(payload.instanceId) : '';
    for (const c of sseClients) {
      if (c.inst && evInst && c.inst !== evInst) continue;
      try { c.res.write(frame); } catch { sseClients.delete(c); }
    }
  };

  const server = http.createServer((req, res) => {
    // SECURITY: reject browser-shaped cross-origin requests up front (localhost CSRF /
    // DNS-rebinding). Shared with prometheus.js via http-guard.originOk().
    if (!originOk(req)) { res.writeHead(403); return res.end('forbidden'); }
    const hostHdr = require('./validate.js').hostFromHeader(req.headers['host']);
    const bind = String(o.bind || '127.0.0.1');
    if (!isHostAllowed(hostHdr, bind, allowedHosts)) { res.writeHead(403); return res.end('forbidden'); }
    const ip = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
    // SECURITY: the IP allowlist applies to EVERYTHING below this line, including /health and assets.
    if (!isIpAllowed(ip, allow)) return send(res, 403, { ok: false, error: 'IP not allowed.' });
    let url;
    try { url = new URL(req.url || '/', 'http://127.0.0.1'); }
    catch { return send(res, 400, { ok: false, error: 'Bad request.' }); }
    // /health is unauthenticated liveness (strip query string so /health?x=1 works).
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, uptime: Math.round(process.uptime()), version: o.version || 'dev' });
    // Serve the dashboard's fixed assets (query-safe pathname matching).
    if (req.method === 'GET' && uiAssets[url.pathname]) {
      const a = uiAssets[url.pathname];
      res.writeHead(200, {
        'content-type': a.type,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'",
      });
      return res.end(a.body);
    }
    const auth = req.headers['authorization'] || '';
    if (!token) return send(res, 401, { ok: false, error: 'unauthorized' });
    // SECURITY: enforce lockout BEFORE comparing tokens so brute-force guesses are blocked even if lucky.
    if (authLimited.isLimited(ip)) return send(res, 429, { ok: false, error: 'Too many failed authentication attempts.' });
    if (!tokenEquals(bearerToken(auth), token)) {
      if (authLimited(ip)) return send(res, 429, { ok: false, error: 'Too many failed authentication attempts.' });
      return send(res, 401, { ok: false, error: 'unauthorized' });
    }
    authLimited.reset(ip);
    if (rateLimited(ip)) return send(res, 429, { ok: false, error: 'Too many requests.' });
    const inst = url.searchParams.get('instance') || '';
    const run = async fn => { try { const r = await fn(); send(res, 200, { ok: true, data: r }); } catch (e) { try { if (typeof o.onError === 'function') o.onError(e); } catch {} send(res, 500, { ok: false, error: 'Internal error.' }); } };
    if (req.method === 'GET' && url.pathname === '/ui/config') return send(res, 200, { ok: true, data: { readOnly } });
    if (req.method === 'GET' && url.pathname === '/events') {
      if (sseClients.size >= MAX_SSE_CLIENTS) return send(res, 503, { ok: false, error: 'Too many live stream clients.' });
      if (typeof req.setTimeout === 'function') req.setTimeout(0);
      if (typeof res.setTimeout === 'function') res.setTimeout(0);
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 3000\n: connected\n\n');
      const client = { res, inst };
      sseClients.add(client);
      const drop = () => { sseClients.delete(client); };
      req.on('close', drop);
      res.on('close', drop);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/instances') return run(() => h.instances && h.instances());
    if (req.method === 'GET' && url.pathname === '/status') return run(() => h.status && h.status(inst));
    if (req.method === 'GET' && url.pathname === '/metrics') return run(() => h.metrics && h.metrics(inst));
    if (req.method === 'GET' && url.pathname === '/backups') return run(() => h.backups && h.backups(inst));
    if (req.method === 'GET' && url.pathname === '/console') return run(() => h.console && h.console(Math.max(1, Math.min(1000, Number(url.searchParams.get('lines')) || 200)), inst));
    if (req.method === 'GET' && url.pathname === '/players') return run(() => h.players && h.players(inst));
    // Safe server ACTIONS (start/stop/restart/kick/backup/whitelist/ban). Gated by !readOnly.
    if (req.method === 'POST' && url.pathname === '/action') {
      if (readOnly) return send(res, 403, { ok: false, error: 'Remote is in read-only mode.' });
      return readJson(req, res, (payload) => {
        const action = String(payload.action || '').trim();
        if (!h.action) return send(res, 501, { ok: false, error: 'action not supported.' });
        const targetInst = String(payload.instance || url.searchParams.get('instance') || '');
        const name = payload.name == null ? '' : String(payload.name);
        run(() => h.action(action, { instance: targetInst, name }));
      });
    }
    if (req.method === 'POST' && url.pathname === '/command') {
      if (readOnly) return send(res, 403, { ok: false, error: 'Remote is in read-only mode.' });
      return readJson(req, res, (payload) => {
        const cmd = String(payload.command == null ? '' : payload.command);
        if (!isSafeConsoleCommand(cmd)) return send(res, 400, { ok: false, error: 'Command must be single-line, max 2000 characters.' });
        const targetInst = String(payload.instance || url.searchParams.get('instance') || '');
        if (!h.command) return send(res, 501, { ok: false, error: 'command not supported.' });
        run(() => h.command(cmd, targetInst));
      });
    }
    return send(res, 404, { ok: false, error: 'not found' });
  });
  server.requestTimeout = 15000;
  return {
    server,
    port: () => (server.address() && server.address().port) || 0,
    publish,
    clientCount: () => sseClients.size,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(o.port) || 0, String(o.bind || '127.0.0.1'), () => resolve(server.address().port)); }),
    close: () => {
      clearInterval(sseHeartbeat);
      for (const c of sseClients) { try { c.res.end(); } catch {} }
      sseClients.clear();
      try { server.close(); } catch {}
      try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch {}
    },
  };
}

// R2 lifecycle: build + start the loopback server from settings, wire handlers to EXISTING tool
// handlers (read-only subset) and gate /command on remoteReadOnly. Stores the server on ctx (a plain
// global property - NOT per-instance). Returns { port } or null when disabled.
async function startRemote(ctx) {
  const { loadSettings, saveSettings } = require('./settings.js');
  let s; try { s = loadSettings(); } catch { s = {}; }
  if (!s.remoteEnabled) return null;
  let token = s.remoteToken;
  if (!token) { token = newRemoteToken(); try { const cur = loadSettings(); cur.remoteToken = token; saveSettings(cur); } catch {} }
  const { getTool } = require('../mcp/tools.js');
  const { resolveInstanceId, listInstances } = require('./settings.js');
  // Resolve an optional remote instance arg to a real id. Empty -> the active instance. An unknown
  // id returns null so the handler reports a clear error instead of silently targeting the wrong one.
  const resolveInst = (instanceId) => {
    const raw = String(instanceId || '').trim();
    if (!raw) return ctx.activeInstanceId;
    return resolveInstanceId(raw);
  };
  const call = async (name, args, instanceId) => {
    const tool = getTool(name);
    if (!tool) return { ok: false, error: 'tool missing: ' + name };
    const runId = resolveInst(instanceId);
    if (!runId) return { ok: false, error: `Unknown instance "${instanceId}".` };
    return await ctx.runInInstance(runId, () => tool.handler(ctx, args || {}));
  };
  const srv = createRemoteServer({
    token,
    allow: parseAllowList(s.remoteAllow),
    allowedHosts: parseAllowedHosts(s.remoteAllowedHosts),
    readOnly: s.remoteReadOnly !== false,
    port: Number(s.remotePort) || 0,
    // Bind 127.0.0.1 by default. A power user may set remoteBind to a Tailscale IP (100.x) or
    // 0.0.0.0 to skip a proxy — that is their explicit choice in Advanced settings.
    bind: String(s.remoteBind || '').trim() || '127.0.0.1',
    version: (() => { try { return require('../../package.json').version; } catch { return 'dev'; } })(),
    // 4.4.0: log handler failures server-side instead of returning the raw message to the client.
    // Throttle repeated identical messages (a polling client could otherwise spam the log).
    onError: (() => {
      const seen = new Map();
      return (e) => {
        const msg = e?.message || String(e);
        const now = Date.now();
        if ((seen.get(msg) || 0) > now - 30000) return;
        seen.set(msg, now);
        try { ctx.appendLog('Remote handler error: ' + msg, 'error'); } catch {}
      };
    })(),
    handlers: {
      instances: () => listInstances(),
      status: (inst) => call('get_status', {}, inst),
      metrics: async (inst) => {
        const runId = resolveInst(inst);
        if (!runId) return { ok: false, error: `Unknown instance "${inst}".` };
        return await ctx.runInInstance(runId, () => {
          const hist = Array.isArray(ctx.metricsHistory) ? ctx.metricsHistory.slice(-20) : [];
          const last = hist[hist.length - 1] || {};
          const { loadSettingsFor } = require('./settings.js');
          const cfg = loadSettingsFor(runId) || {};
          return {
            ok: true,
            result: {
              status: ctx.serverStatus || 'stopped',
              running: ctx.serverStatus !== 'stopped',
              startedAt: ctx.startedAt || 0,
              tps: ctx.live?.tps ?? last.tps ?? null,
              mspt: ctx.live?.mspt ?? last.mspt ?? null,
              cpu: last.cpu ?? null,
              ram: last.ram ?? null,
              memoryMaxMb: (Number(cfg.memoryMax) || 4) * 1024,
              history: hist,
            },
          };
        });
      },
      backups: async (inst) => {
        const runId = resolveInst(inst);
        if (!runId) return { ok: false, error: `Unknown instance "${inst}".` };
        return await ctx.runInInstance(runId, () => {
          const { serverFiles } = require('./server-files.js');
          const f = ctx.currentServerPath ? serverFiles(ctx.currentServerPath) : { worlds: [], backups: [] };
          return { ok: true, result: { worlds: f.worlds || [], backups: f.backups || [] } };
        });
      },
      console: (n, inst) => call('read_console', { lines: n }, inst),
      players: (inst) => call('list_players', {}, inst),
      command: async (c, inst) => {
        const runId = resolveInst(inst);
        if (!runId) return { ok: false, error: `Unknown instance "${inst}".` };
        const { sendConsoleCommand } = require('./server-lifecycle.js');
        return await ctx.runInInstance(runId, () => sendConsoleCommand(ctx, String(c)));
      },
      // Safe server ACTIONS (start/stop/restart/kick/backup/whitelist/ban).
      action: async (action, opts) => {
        const a = String(action || '').trim().toLowerCase();
        const runId = resolveInst(opts && opts.instance);
        if (!runId) return { ok: false, error: `Unknown instance "${opts && opts.instance}".` };
        if (a === 'kick') {
          const name = String((opts && opts.name) || '').trim();
          const { isSafePlayerName } = require('./validate.js');
          if (!isSafePlayerName(name)) return { ok: false, error: 'Invalid player name.' };
          const { sendConsoleCommand } = require('./server-lifecycle.js');
          const r = await ctx.runInInstance(runId, () => sendConsoleCommand(ctx, 'kick ' + name));
          return { ok: true, result: r && r.ok === false ? r : { kicked: name } };
        }
        if (a === 'whitelist_add' || a === 'whitelist_remove' || a === 'ban' || a === 'unban') {
          const name = String((opts && opts.name) || '').trim();
          const { isSafePlayerName } = require('./validate.js');
          if (!isSafePlayerName(name)) return { ok: false, error: 'Invalid player name.' };
          const players = require('./players.js');
          return await ctx.runInInstance(runId, () => {
            if (a === 'whitelist_add') return players.whitelistToggle(ctx, { name, add: true });
            if (a === 'whitelist_remove') return players.whitelistToggle(ctx, { name, add: false });
            return players.banToggle(ctx, { name, ban: a === 'ban' });
          });
        }
        if (a === 'backup') {
          const { createBackupInternal } = require('./backups.js');
          return await ctx.runInInstance(runId, () => createBackupInternal(ctx, { reason: 'remote' }));
        }
        const { startServerInternal, requestStop, forceStopServer } = require('./server-lifecycle.js');
        const { loadSettingsFor } = require('./settings.js');
        if (a === 'start') {
          return await ctx.runInInstance(runId, () => startServerInternal(ctx, loadSettingsFor(runId)));
        }
        if (a === 'stop') {
          return await ctx.runInInstance(runId, () => requestStop(ctx));
        }
        if (a === 'force_stop') {
          return await ctx.runInInstance(runId, () => forceStopServer(ctx));
        }
        if (a === 'restart') {
          return await ctx.runInInstance(runId, () => requestStop(ctx, loadSettingsFor(runId)));
        }
        return { ok: false, error: 'Unknown action. Allowed: start, stop, force_stop, restart, kick, backup, whitelist_add, whitelist_remove, ban, unban.' };
      },
    },
  });
  const port = await srv.listen();
  if (ctx.remoteListeners instanceof Set) {
    ctx._remoteSseHandler = (type, payload) => srv.publish(type, payload);
    ctx.remoteListeners.add(ctx._remoteSseHandler);
  }
  ctx.remoteServer = srv; ctx.remotePort = port;
  return { port };
}
function stopRemote(ctx) {
  if (ctx.remoteListeners instanceof Set && ctx._remoteSseHandler) {
    ctx.remoteListeners.delete(ctx._remoteSseHandler);
    ctx._remoteSseHandler = null;
  }
  try { if (ctx.remoteServer) ctx.remoteServer.close(); } catch {}
  ctx.remoteServer = null; ctx.remotePort = 0;
}

module.exports = { newRemoteToken, parseAllowList, parseAllowedHosts, isHostAllowed, ipv4ToInt, isIpAllowed, remoteSnapshot, remoteAddresses, createRemoteServer, startRemote, stopRemote };
