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

// Static tool list mirrored from src/mcp/tools.js (name + description + schema). Kept in sync
// manually; the app is the source of truth for behaviour, this is just the advertisement.
const STATIC_TOOLS = [
  ['get_status', 'Server status, folder, jar, software and Java info.'],
  ['read_console', 'Recent console/log lines.'],
  ['list_players', 'Online, whitelisted, banned, op and known players.'],
  ['get_player_data', 'Read one player .dat (stats/inventory).'],
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
  ['search_marketplace', 'Search Modrinth for plugins/mods/datapacks/modpacks.'],
  ['list_market_versions', 'Versions of a Modrinth project.'],
  ['start_server', 'Start the server.'],
  ['send_console_command', 'Send one command to the running server.'],
  ['set_property', 'Set one server.properties key.'],
  ['set_raw_properties', 'Replace velocity.toml content.'],
  ['write_file', 'Write a text file inside the server folder.'],
  ['edit_file', 'Replace oldString with newString in a file.'],
  ['create_backup', 'Create a world backup (ZIP).'],
  ['install_from_market', 'Install a plugin/mod/datapack from Modrinth.'],
  ['install_local_jar', 'Copy a local .jar into plugins/mods.'],
  ['import_modpack_path', 'Import a .mrpack from a local path.'],
  ['export_modpack', 'Export current setup to a .mrpack at a path.'],
  ['save_player_data', 'Apply edits to a player .dat.'],
  ['op_player', 'Grant/revoke operator.'],
  ['whitelist_player', 'Add/remove from whitelist.'],
  ['ban_player', 'Ban/unban a player.'],
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
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'observerlauncher', version: (readConfig() || {}).appVersion || 'dev' },
    });
  }
  if (method === 'notifications/initialized') return; // no response
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    const tools = await fetchTools();
    return reply(id, { tools });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const r = await callApp(name, args);
    const text = r.ok ? JSON.stringify(r.result === undefined ? { ok: true } : r.result, null, 2) : ('Error: ' + (r.error || 'unknown'));
    return reply(id, { content: [{ type: 'text', text }], isError: !r.ok });
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
