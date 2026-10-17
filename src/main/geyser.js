// geyser.js — inspect a GeyserMC (Bedrock <-> Java) install and report config problems that
// commonly stop Bedrock players from joining (5.7.0). Pure: reads files, never writes, never throws.
//
// Geyser is a plugin OR a mod, so its config lives in one of several folders. The config is YAML,
// and the project ships no YAML dependency, so a tiny indentation parser handles just the flat /
// one-level-nested keys we care about (no lists, no anchors). Anything it cannot parse is ignored.
const fs = require('fs');
const path = require('path');

// Where Geyser drops its config. Geyser's folder name differs per platform (Geyser-Spigot,
// Geyser-Velocity, Geyser-Fabric, ...) AND a Spigot plugin can also live in a subfolder. Rather than
// hard-code every name (which missed the user's actual folder), scan plugins/ and mods/ for any
// directory whose name contains "geyser" and use its config.yml. CONFIG_CANDIDATES is only a
// fallback for the case where the folder was renamed to something without "geyser".
const CONFIG_CANDIDATES = [
  'plugins/Geyser-Spigot/config.yml',
  'plugins/Geyser-Velocity/config.yml',
  'plugins/Geyser-BungeeCord/config.yml',
  'mods/Geyser-Fabric/config.yml',
  'mods/GeyserForge/config.yml',
  'mods/Geyser-NeoForge/config.yml',
];
// Find a Geyser config by scanning for a geyser-named folder under plugins/ and mods/. Returns the
// path relative to root (for the display) or null. Pure-ish (readdir only).
function findGeyserConfig(root) {
  for (const base of ['plugins', 'mods']) {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, base), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || !/geyser/i.test(e.name)) continue;
      const rel = `${base}/${e.name}/config.yml`;
      try { if (fs.existsSync(path.join(root, rel))) return rel; } catch {}
    }
  }
  return null;
}

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

// server.properties is key=value (not YAML). Small dedicated reader so the port-conflict check can
// see enable-query / query.port without pulling in the bigger server-files module.
function readServerProperties(root) {
  const out = {};
  try {
    const abs = path.join(root, 'server.properties');
    if (!fs.existsSync(abs)) return out;
    for (const line of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0 && !line.startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {}
  return out;
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
  // Dynamic scan first (handles any platform folder name), then the fixed fallback list.
  const scanned = findGeyserConfig(root);
  const tries = scanned ? [scanned, ...CONFIG_CANDIDATES] : CONFIG_CANDIDATES;
  for (const rel of tries) {
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
  // PORT CONFLICT: the Minecraft query service also listens on a UDP port. If it is enabled on the
  // same UDP port Geyser uses, one of them cannot bind. server.properties is key=value, not YAML.
  try {
    const props = readServerProperties(root);
    const geyserPort = Number(bp) || 19132;
    if (String(props['enable-query']).toLowerCase() === 'true') {
      const qp = Number(props['query.port']);
      if (Number.isFinite(qp) && qp === geyserPort) {
        out.issues.push({ level: 'error', key: 'query.port', message: `The Minecraft query service uses UDP port ${qp}, the same port as Geyser. One of them will fail to start.`, fix: `Set query.port in server.properties to a different port (e.g. ${geyserPort + 1}), or disable enable-query.` });
      }
    }
  } catch {}
  // JAVA VERSION: Geyser needs Java 21+ (class file version 65). A server on Java 17 makes Geyser
  // fail to load. opts.javaMajor is the detected major (from java.js), when known.
  if (Number.isFinite(opts.javaMajor) && opts.javaMajor < 21) {
    out.issues.push({ level: 'error', key: 'java', message: `GeyserMC needs Java 21 or newer, but the detected Java is ${opts.javaMajor}. Geyser will fail to load.`, fix: 'Install Java 21 (Settings → Java), or use a Geyser build that matches your Java.' });
  }
  return out;
}

// --- A1 (v6.0.0): one-click config repair -------------------------------------------------------
// inspectGeyser only READS. These functions WRITE back the safe fixes. The config is YAML with
// comments and list items that parseSimpleYaml DROPS, so the parsed object must NEVER be
// re-serialized (that would destroy the file). Every fix is a LINE-level value swap: find the line
// whose key path matches, keep its indent and any trailing comment, replace only the value text.

// Which issue keys can be auto-fixed, and to what value. `bedrock.port` is optional because
// changing it also changes which local UDP port the tunnel must match; the caller opts in.
const FIXABLE = {
  'bedrock.clone-remote-port': { path: ['bedrock', 'clone-remote-port'], value: 'false' },
  'remote.auth-type': { path: ['remote', 'auth-type'], value: 'floodgate' },
  'advanced.bedrock.use-haproxy-protocol': { path: ['advanced', 'bedrock', 'use-haproxy-protocol'], value: 'true' },
};
const OPTIONAL_FIXABLE = {
  'bedrock.port': { path: ['bedrock', 'port'], value: '19132' },
};

// Map every leaf key path in the YAML text to its 0-based line index. Mirrors the indent walk in
// parseSimpleYaml but records the LINE, so a fix can rewrite exactly one line. Comments, blank lines
// and list items are skipped; a branch (`key:` with no value) pushes a level.
function yamlKeyLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const map = new Map();
  const stack = [{ indent: -1, keys: [] }];
  for (let i = 0; i < lines.length; i++) {
    const noComment = lines[i].replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (!noComment.trim() || /^\s*#/.test(noComment) || /^\s*-/.test(noComment)) continue;
    const m = noComment.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2].trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const path = [...stack[stack.length - 1].keys, key];
    if (m[3].trim() === '') stack.push({ indent, keys: path });
    else map.set(path.join('.'), i);
  }
  return { lines, map };
}

// Replace the VALUE on a YAML line, keeping indent, key and any trailing `# comment` byte-exact.
function replaceYamlValue(line, newValue) {
  const m = line.match(/^(\s*)([^:]+):(.*)$/);
  if (!m) return null;
  const cm = m[3].match(/^(.*?)(\s+#.*)$/);
  const comment = cm ? cm[2] : '';
  return `${m[1]}${m[2]}: ${newValue}${comment}`;
}

// Build the edits that can be applied safely, from an inspectGeyser result. Returns
// [{ key, path (dotted yaml path), to }]. Empty when nothing is safely fixable.
function planGeyserFix(inspection, opts = {}) {
  const issues = (inspection && Array.isArray(inspection.issues)) ? inspection.issues : [];
  const table = opts.includeBedrockPort ? { ...FIXABLE, ...OPTIONAL_FIXABLE } : FIXABLE;
  const plan = [];
  for (const issue of issues) {
    const spec = table[issue.key];
    if (!spec) continue;
    plan.push({ key: issue.key, path: spec.path.join('.'), to: spec.value });
  }
  return plan;
}

// Apply a plan to the Geyser config.yml. Edits are line-level; the file is backed up first, then
// written atomically. Returns { ok, changed, skipped, backup } or { ok:false, error }.
function applyGeyserFix(root, configRel, plan) {
  const { writeFileAtomic } = require('./fs-utils.js');
  if (!root || !configRel) return { ok: false, error: 'No Geyser config to edit.' };
  if (!Array.isArray(plan) || plan.length === 0) return { ok: false, error: 'Nothing to fix.' };
  const abs = path.join(root, configRel);
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return { ok: false, error: 'Could not read the Geyser config.' }; }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const { lines, map } = yamlKeyLines(text);
  const changed = [];
  const skipped = [];
  for (const edit of plan) {
    const idx = map.get(edit.path);
    if (idx == null) { skipped.push(edit.key); continue; }
    const replaced = replaceYamlValue(lines[idx], edit.to);
    if (replaced == null || replaced === lines[idx]) { skipped.push(edit.key); continue; }
    lines[idx] = replaced;
    changed.push({ key: edit.key, to: edit.to });
  }
  if (changed.length === 0) return { ok: true, changed: [], skipped, backup: null };
  // Backup before writing so the user can always go back.
  const backup = `${abs}.bak-${Date.now()}`;
  try { fs.copyFileSync(abs, backup); } catch { return { ok: false, error: 'Could not create a backup of the Geyser config.' }; }
  try { writeFileAtomic(abs, lines.join(eol)); } catch (e) { return { ok: false, error: e?.message || 'Could not write the Geyser config.' }; }
  return { ok: true, changed, skipped, backup };
}

module.exports = { inspectGeyser, parseSimpleYaml, CONFIG_CANDIDATES, readServerProperties, findGeyserConfig, planGeyserFix, applyGeyserFix, yamlKeyLines, FIXABLE, OPTIONAL_FIXABLE };
