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
function createRemoteServer(opts) {
  const o = opts || {};
  const token = String(o.token || '');
  const allow = Array.isArray(o.allow) ? o.allow : parseAllowList(o.allow);
  const readOnly = o.readOnly !== false;
  const h = o.handlers || {};
  const MAX = 64 * 1024;
  const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const { isSafeConsoleCommand } = require('./validate.js');
  const server = http.createServer((req, res) => {
    // SECURITY: reject browser-shaped requests up front (localhost CSRF / DNS-rebinding), same
    // defense-in-depth as the MCP server. The real remote client sends no Origin and connects by IP.
    if (req.headers['origin']) { res.writeHead(403); return res.end('forbidden'); }
    const hostHdr = String(req.headers['host'] || '').split(':')[0];
    if (hostHdr && hostHdr !== '127.0.0.1' && hostHdr !== 'localhost' && hostHdr !== '::1' && hostHdr !== '[::1]' && hostHdr !== String(o.bind || '127.0.0.1')) {
      res.writeHead(403); return res.end('forbidden');
    }
    const ip = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
    // /health is unauthenticated liveness (no tool access) - same idea as the MCP /health.
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, uptime: Math.round(process.uptime()), version: o.version || 'dev' });
    if (!isIpAllowed(ip, allow)) return send(res, 403, { ok: false, error: 'IP not allowed.' });
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${token}`) return send(res, 401, { ok: false, error: 'unauthorized' });
    const url = new URL(req.url, 'http://127.0.0.1');
    // 3.3.0: optional ?instance=<id> on every read (and `instance` in the /command body) so a remote
    // client can target a SPECIFIC server, not just the active one. Empty -> active instance.
    const inst = url.searchParams.get('instance') || '';
    const run = async fn => { try { const r = await fn(); send(res, 200, { ok: true, data: r }); } catch (e) { send(res, 500, { ok: false, error: e?.message || String(e) }); } };
    if (req.method === 'GET' && url.pathname === '/instances') return run(() => h.instances && h.instances());
    if (req.method === 'GET' && url.pathname === '/status') return run(() => h.status && h.status(inst));
    if (req.method === 'GET' && url.pathname === '/console') return run(() => h.console && h.console(Math.max(1, Math.min(1000, Number(url.searchParams.get('lines')) || 200)), inst));
    if (req.method === 'GET' && url.pathname === '/players') return run(() => h.players && h.players(inst));
    if (req.method === 'POST' && url.pathname === '/command') {
      if (readOnly) return send(res, 403, { ok: false, error: 'Remote is in read-only mode.' });
      let body = ''; let big = false;
      req.on('data', c => { if (big) return; body += c; if (body.length > MAX) { big = true; send(res, 413, { ok: false, error: 'Request too large.' }); req.destroy(); } });
      req.on('end', () => {
        if (big) return;
        let payload; try { payload = JSON.parse(body || '{}'); } catch { return send(res, 400, { ok: false, error: 'bad json' }); }
        const cmd = String(payload.command == null ? '' : payload.command);
        // SECURITY: same guard the MCP send_console_command tool uses - a single line, <=2000 chars.
        // Without it a `\r\nstop` in the body would inject a SECOND console command.
        if (!isSafeConsoleCommand(cmd)) return send(res, 400, { ok: false, error: 'Command must be single-line, max 2000 characters.' });
        const inst = String(payload.instance || url.searchParams.get('instance') || '');
        if (!h.command) return send(res, 501, { ok: false, error: 'command not supported.' });
        run(() => h.command(cmd, inst));
      });
      return;
    }
    return send(res, 404, { ok: false, error: 'not found' });
  });
  return {
    server,
    port: () => (server.address() && server.address().port) || 0,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(o.port) || 0, String(o.bind || '127.0.0.1'), () => resolve(server.address().port)); }),
    close: () => { try { server.close(); } catch {} },
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
    readOnly: s.remoteReadOnly !== false,
    port: Number(s.remotePort) || 0,
    // Bind 127.0.0.1 by default. A power user may set remoteBind to a Tailscale IP (100.x) or
    // 0.0.0.0 to skip a proxy — that is their explicit choice in Advanced settings.
    bind: String(s.remoteBind || '').trim() || '127.0.0.1',
    version: (() => { try { return require('../../package.json').version; } catch { return 'dev'; } })(),
    handlers: {
      instances: () => listInstances(),
      status: (inst) => call('get_status', {}, inst),
      console: (n, inst) => call('read_console', { lines: n }, inst),
      players: (inst) => call('list_players', {}, inst),
      command: async (c, inst) => {
        const runId = resolveInst(inst);
        if (!runId) return { ok: false, error: `Unknown instance "${inst}".` };
        const { sendConsoleCommand } = require('./server-lifecycle.js');
        return await ctx.runInInstance(runId, () => sendConsoleCommand(ctx, String(c)));
      },
    },
  });
  const port = await srv.listen();
  ctx.remoteServer = srv; ctx.remotePort = port;
  return { port };
}
function stopRemote(ctx) {
  try { if (ctx.remoteServer) ctx.remoteServer.close(); } catch {}
  ctx.remoteServer = null; ctx.remotePort = 0;
}

module.exports = { newRemoteToken, parseAllowList, ipv4ToInt, isIpAllowed, remoteSnapshot, remoteAddresses, createRemoteServer, startRemote, stopRemote };
