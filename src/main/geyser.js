// geyser.js — inspect a GeyserMC (Bedrock <-> Java) install and report config problems that
// commonly stop Bedrock players from joining (5.7.0). Pure: reads files, never writes, never throws.
//
// Geyser is a plugin OR a mod, so its config lives in one of several folders. The config is YAML,
// and the project ships no YAML dependency, so a tiny indentation parser handles just the flat /
// one-level-nested keys we care about (no lists, no anchors). Anything it cannot parse is ignored.
const fs = require('fs');
const path = require('path');

// Where Geyser drops its config, most-likely first. Covers Spigot/Paper (plugins) and Fabric/Forge/
// NeoForge (mods), plus the common jar name variants.
const CONFIG_CANDIDATES = [
  'plugins/Geyser-Spigot/config.yml',
  'plugins/Geyser-Velocity/config.yml',
  'plugins/Geyser-BungeeCord/config.yml',
  'mods/Geyser-Fabric/config.yml',
  'mods/GeyserForge/config.yml',
  'mods/Geyser-NeoForge/config.yml',
];

// Minimal YAML reader: returns a nested object from 2-space-indented `key: value` lines. List items
// (`- ...`) and everything after a `#` comment are skipped; a blank/comment line never breaks the
// indent stack. Values keep their raw string (quotes stripped); booleans/numbers are left as text
// and compared as text by the caller. Good enough for Geyser's flat config.
function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (!line.trim() || /^\s*#/.test(line) || /^\s*-/.test(line)) continue;
    const m = line.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2].trim();
    let val = m[3].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (val === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = val;
    }
  }
  return root;
}

function readConfig(root, rel) {
  try {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return null;
    return parseSimpleYaml(fs.readFileSync(abs, 'utf8'));
  } catch { return null; }
}

// Inspect a server root that has a Geyser jar. Returns { found, configPath, config, issues }.
// Each issue is { level: 'error'|'warn', key, message, fix }. Never throws.
function inspectGeyser(root, opts = {}) {
  const out = { found: false, configPath: null, config: null, issues: [] };
  if (!root) return out;
  let config = null, configPath = null;
  for (const rel of CONFIG_CANDIDATES) {
    const c = readConfig(root, rel);
    if (c) { config = c; configPath = rel; break; }
  }
  out.found = true;
  out.config = config;
  out.configPath = configPath;
  if (!config) {
    // Jar present but no config yet — Geyser writes it on first run.
    out.issues.push({ level: 'warn', key: 'config', message: 'Geyser config.yml was not found. Start the server once so Geyser creates it, then re-check.', fix: 'Start the server, stop it, then reopen this panel.' });
    return out;
  }
  const bedrock = (config.bedrock && typeof config.bedrock === 'object') ? config.bedrock : {};
  const remote = (config.remote && typeof config.remote === 'object') ? config.remote : {};
  const adv = (config.advanced && typeof config.advanced === 'object') ? config.advanced : {};
  const advBedrock = (adv.bedrock && typeof adv.bedrock === 'object') ? adv.bedrock : {};

  // clone-remote-port MUST be false: when true, Geyser ignores `bedrock.port` and reuses the Java
  // port, so a Playit UDP tunnel pointed at the Bedrock port would never reach Geyser.
  if (String(bedrock['clone-remote-port']).toLowerCase() === 'true') {
    out.issues.push({ level: 'error', key: 'bedrock.clone-remote-port', message: 'clone-remote-port is true, so Geyser ignores your Bedrock port and reuses the Java port. A Playit UDP tunnel then points at the wrong port.', fix: 'Set bedrock.clone-remote-port to false.' });
  }
  const bp = String(bedrock.port || '').trim();
  if (bp && bp !== '19132') {
    out.issues.push({ level: 'warn', key: 'bedrock.port', message: `Geyser's Bedrock port is ${bp}, not the default 19132. Your Playit UDP tunnel must forward to ${bp}.`, fix: `Create the Bedrock UDP tunnel with local port ${bp}, or set bedrock.port back to 19132.` });
  }
  // Floodgate present -> auth-type must be floodgate, else Bedrock players are asked for a Java account.
  if (opts.floodgate) {
    const at = String(remote['auth-type'] || '').toLowerCase();
    if (at && at !== 'floodgate') {
      out.issues.push({ level: 'error', key: 'remote.auth-type', message: `Floodgate is installed but remote.auth-type is "${at}". Bedrock players will be asked for a Java account and fail to join.`, fix: 'Set remote.auth-type to floodgate.' });
    }
  }
  // Playit forwards with proxy-protocol-v2; without haproxy protection Geyser sees the proxy IP and
  // Bedrock clients get "Unable to connect to world".
  if (String(advBedrock['use-haproxy-protocol']).toLowerCase() === 'false') {
    out.issues.push({ level: 'warn', key: 'advanced.bedrock.use-haproxy-protocol', message: 'use-haproxy-protocol is false. Playit forwards the player IP with proxy-protocol-v2; without this, Bedrock clients often fail to connect.', fix: 'Set advanced.bedrock.use-haproxy-protocol to true (Playit uses proxy protocol v2).' });
  }
  return out;
}

module.exports = { inspectGeyser, parseSimpleYaml, CONFIG_CANDIDATES };
