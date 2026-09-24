#!/usr/bin/env node
// MCP bridge — a tiny stdio MCP server that forwards tool calls to a running
// ObserverLauncher instance over loopback HTTP.
//
// Why not @modelcontextprotocol/sdk? The MCP stdio surface we need is three JSON-RPC
// methods (initialize, tools/list, tools/call) plus one notification. Implementing them
// directly keeps the bridge dependency-free, so it runs from the packaged app without a
// node_modules bundle and never breaks on an SDK release.
//
// Flow:
//   MCP client (Claude Desktop, Cursor, …) --stdio--> this script --HTTP--> Electron app
//
// The app writes userData/mcp-bridge.json = { port, token } on launch and removes it on quit.
// We read that file to discover the app. If it's missing, the app isn't running (or MCP is off).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Resolve the bridge config. The app passes its userData dir in OBSERVER_MCP_USERDATA when it
// generates the launcher script; otherwise fall back to the usual per-OS location.
function bridgeConfigPath() {
  const ud = process.env.OBSERVER_MCP_USERDATA;
  if (ud) return path.join(ud, 'mcp-bridge.json');
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'ObserverLauncher', 'mcp-bridge.json');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'ObserverLauncher', 'mcp-bridge.json');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'ObserverLauncher', 'mcp-bridge.json');
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(bridgeConfigPath(), 'utf8')); } catch { return null; }
}

// Guidance sent to the MCP client at initialize time. This is how the AI learns it is talking to a
// Minecraft server MANAGER: what it can read freely, that write/destroy need GUI approval, and the
// doctor workflow to follow when something is wrong.
const INSTRUCTIONS = [
  'You are connected to ObserverLauncher, a desktop launcher that manages one or MORE local Minecraft server instances on the user\'s PC.',
  'MULTI-INSTANCE: call list_instances FIRST to see every instance (id, name, serverPath, status). Most tools act on the ACTIVE instance; pass an optional "instance" id to target a specific one. get_instance_snapshot reads any instance\'s state (status/console/metrics/java/files) WITHOUT switching - prefer it over select_instance when you only need to inspect a background server.',
  'SETTINGS/SCHEDULE tools (get_settings, set_setting, get_schedule, set_schedule) also honour the "instance" arg: they read/write that instance\'s per-instance keys.',
  'READ tools are free: use them to inspect status, console, players, files, world and performance before acting.',
  'WRITE tools change the server and require GUI approval unless the user enabled auto-allow-write; DESTROY tools always ask.',
  'WORKFLOW when something is wrong: call doctor_report (one-shot) or diagnose_server + analyze_console + explain_crash; each check returns a level (ok/warn/error) and a concrete fix.',
  'SAFE CHANGE: prefer prepare_and_start / safe_restart so a backup is taken and the health checks pass first.',
  'You cannot set the server folder over MCP - that is GUI-only. Add/remove instances in the GUI.',
].join('\n');

// Forward one tool call to the app. Resolves a tool result object {ok,result|error}.
function callApp(tool, args) {
  return new Promise(resolve => {
    const cfg = readConfig();
    if (!cfg || !cfg.port || !cfg.token) {
      return resolve({ ok: false, error: 'ObserverLauncher is not running, or the MCP integration is turned off in its Settings.' });
    }
    const body = JSON.stringify({ tool, args: args || {} });
    const req = http.request({
      host: '127.0.0.1', port: cfg.port, path: '/rpc', method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + cfg.token, 'content-length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); }
        catch { resolve({ ok: false, error: 'Bad response from the app.' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: 'Could not reach ObserverLauncher: ' + (e?.message || e) }));
    req.write(body); req.end();
  });
}

// GET a resource body from the app (resources/read). Returns {text} or null on any failure.
function fetchResource(uri) {
  return new Promise(resolve => {
    const cfg = readConfig();
    if (!cfg || !cfg.port || !cfg.token) return resolve(null);
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: '/resource?uri=' + encodeURIComponent(uri), method: 'GET', headers: { authorization: 'Bearer ' + cfg.token } }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.setTimeout(5000, () => { try { req.destroy(); } catch {} resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}
// Fixed resource list (the app owns the real bodies). Advertised so the AI can pull server state
// as context instead of spending a tool call.
const STATIC_RESOURCES = [
  { uri: 'observer://server/status', name: 'Server status', description: 'Folder, jar, software, Java, running state.', mimeType: 'application/json' },
  { uri: 'observer://server/properties', name: 'server.properties', description: 'Parsed server.properties.', mimeType: 'application/json' },
  { uri: 'observer://server/console', name: 'Console buffer', description: 'Recent console lines.', mimeType: 'application/json' },
  { uri: 'observer://server/diagnosis', name: 'Health diagnosis', description: 'The doctor health check result.', mimeType: 'application/json' },
];

// GET the real tool list (with full inputSchema) from the app. Falls back to the static
// name/description list if the app isn't reachable, so tools/list still answers — the actual
// call will then explain that the app is off.
function fetchToolsFromApp() {
  return new Promise(resolve => {
    const cfg = readConfig();
    if (!cfg || !cfg.port || !cfg.token) return resolve(null);
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: '/tools', method: 'GET', headers: { authorization: 'Bearer ' + cfg.token } }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { try { const j = JSON.parse(data); resolve(Array.isArray(j.tools) ? j.tools : null); } catch { resolve(null); } });
    });
    // TIMEOUT: if the app is wedged, do not hang tools/list forever — fall back to the static list.
    req.setTimeout(4000, () => { try { req.destroy(); } catch {} resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}
let cachedTools = null;
let cachedAt = 0;
async function fetchTools() {
  if (cachedTools && Date.now() - cachedAt < 5000) return cachedTools;
  const fromApp = await fetchToolsFromApp();
  cachedTools = fromApp || STATIC_TOOLS;
  cachedAt = Date.now();
  return cachedTools;
}

// Offline fallback tool list (name + description only). Used ONLY when the app is unreachable —
// at that point every call fails with "app not running", so a full inputSchema would be
// misleading anyway. When the app IS running, fetchTools() pulls the real schemas via GET /tools.
// Kept in sync with src/mcp/tools.js by hand (names + descriptions only).
// IMPORTANT: this list must stay complete and in sync with src/mcp/tools.js. A previous version
// drifted (missing settings/schedule/java/player/audit tools), so an offline tools/list lied.
// Order matches tools.js. Names + descriptions only (no schema needed offline).
const STATIC_TOOLS = [
  ['get_status', 'Server status, folder, jar, software and Java info.'],
  ['read_console', 'Recent console/log lines.'],
  ['list_players', 'Online, whitelisted, banned, op and known players.'],
  ['get_player_data', 'Read one player .dat (stats/inventory) by UUID or name.'],
  ['list_files', 'List a directory inside the server folder.'],
  ['read_file', 'Read a text file inside the server folder.'],
  ['search_files', 'Grep text files inside the server folder.'],
  ['list_content', 'Plugins, mods and datapacks.'],
  ['get_properties', 'Parsed server.properties.'],
  ['get_raw_properties', 'Raw velocity.toml content.'],
  ['get_world_info', 'Seed, spawn, players and waypoints.'],
  ['list_worlds', 'World folders.'],
  ['list_backups', 'Backup files with size + date.'],
  ['get_network_info', 'LAN IPs and server port.'],
  ['get_java_info', 'Detected Java version/path/arch.'],
  ['search_marketplace', 'Search Modrinth, Hangar or Spigot.'],
  ['list_market_versions', 'Versions of a project (Modrinth, Hangar or CurseForge).'],
  ['diagnose_server', 'Full server health check with per-check level + fixes.'],
  ['analyze_console', 'Scan the console for errors/warnings, grouped and ranked.'],
  ['explain_crash', 'Summarise a crash report (newest, or by name).'],
  ['list_crash_reports', 'List all crash-reports (name, mtime, size).'],
  ['read_server_log', 'Tail the server log file (logs/latest.log).'],
  ['check_performance', 'TPS/MSPT/players snapshot with threshold warnings.'],
  ['get_metrics_history', 'Time series of sampled metrics.'],
  ['validate_config', 'Validate server.properties.'],
  ['check_port', 'Check whether the server port is free.'],
  ['read_many_files', 'Read up to 5 text files in one call.'],
  ['doctor_report', 'One-shot combined health report.'],
  ['read_audit_log', 'Recent MCP write/destroy actions.'],
  ['start_server', 'Start the server.'],
  ['send_console_command', 'Send one command to the running server.'],
  ['set_property', 'Set one server.properties key.'],
  ['set_raw_properties', 'Replace velocity.toml content.'],
  ['write_file', 'Write a text file inside the server folder.'],
  ['edit_file', 'Replace oldString with newString in a file.'],
  ['create_backup', 'Create a world backup (ZIP).'],
  ['get_settings', 'Read launcher settings.'],
  ['get_schedule', 'Read the server schedule.'],
  ['list_waypoints', 'List World Map waypoints.'],
  ['install_java', 'Download and install a portable Java runtime.'],
  ['set_setting', 'Change one launcher setting (serverPath NOT settable).'],
  ['set_schedule', 'Set the server schedule.'],
  ['kick_player', 'Kick an online player.'],
  ['search_modpacks', 'Search Modrinth for installable modpacks.'],
  ['install_from_market', 'Install a plugin/mod/datapack/modpack from Modrinth, Hangar or Spigot.'],
  ['install_local_jar', 'Copy a local .jar into plugins/mods.'],
  ['import_modpack_path', 'Import a .mrpack from a local path.'],
  ['export_modpack', 'Export current setup to a .mrpack at a path.'],
  ['plan_modpack', 'Resolve candidates into an install plan with compatibility + dependencies.'],
  ['assemble_modpack', 'Install a whole list of projects in one confirmed batch.'],
  ['prepare_and_start', 'Diagnose -> backup -> start the server.'],
  ['safe_restart', 'Back up, stop, then start again.'],
  ['save_player_data', 'Apply edits to a player .dat.'],
  ['op_player', 'Grant/revoke operator.'],
  ['whitelist_player', 'Add/remove from whitelist.'],
  ['ban_player', 'Ban/unban a player.'],
  ['list_instances', 'List all server instances (id, name, serverPath, status, active).'],
  ['get_instance_snapshot', 'Read one instance\'s full state without making it active.'],
  ['select_instance', 'Make an instance the active one.'],
  ['start_instance', 'Start a specific instance by id.'],
  ['stop_instance', 'Gracefully stop a specific instance by id.'],
  ['stop_server', 'Gracefully stop the server.'],
  ['force_stop_server', 'Kill the server process tree.'],
  ['delete_content', 'Delete a plugin/mod/datapack file.'],
  ['delete_backup', 'Delete a backup ZIP.'],
  ['restore_backup', 'Restore a backup (overwrites worlds).'],
].map(([name, description]) => ({ name, description, inputSchema: { type: 'object', properties: {} } }));

// ---- JSON-RPC over stdio ----
function write(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { write({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2025-06-18',
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
      serverInfo: { name: 'observerlauncher', version: (readConfig() || {}).appVersion || 'dev' },
      instructions: INSTRUCTIONS,
    });
  }
  if (method === 'notifications/initialized') return; // no response
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    const tools = await fetchTools();
    return reply(id, { tools });
  }
  if (method === 'resources/list') {
    return reply(id, { resources: STATIC_RESOURCES });
  }
  if (method === 'resources/read') {
    const uri = params && params.uri;
    const r = uri ? await fetchResource(uri) : null;
    if (!r || !r.ok) return replyError(id, -32602, (r && r.error) || 'Resource not available (is ObserverLauncher running?).');
    const text = typeof r.text === 'string' ? r.text : JSON.stringify(r.data ?? r, null, 2);
    return reply(id, { contents: [{ uri, mimeType: r.mimeType || 'application/json', text }] });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const r = await callApp(name, args);
    const payload = r.ok ? (r.result === undefined ? { ok: true } : r.result) : { ok: false, error: r.error || 'unknown' };
    const text = r.ok ? JSON.stringify(payload, null, 2) : ('Error: ' + (r.error || 'unknown'));
    // structuredContent (MCP 2025-06-18): the machine-readable form, so a client can act on fields
    // (e.g. doctor checks[].level/fix) without re-parsing the text blob.
    return reply(id, { content: [{ type: 'text', text }], structuredContent: payload, isError: !r.ok });
  }
  if (id !== undefined && id !== null) replyError(id, -32601, 'Method not found: ' + method);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg).catch(e => { if (msg && msg.id != null) replyError(msg.id, -32603, e?.message || String(e)); });
  }
});
process.stdin.on('end', () => process.exit(0));

module.exports = { callApp, bridgeConfigPath, STATIC_TOOLS };
