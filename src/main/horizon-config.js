// src/main/horizon-config.js — Parser, serializer, and property synchronizer for Horizon's server.toml
// Supports native Horizon dedicated server configuration without external dependencies.
const fs = require('fs');
const path = require('path');

function formatTomlValue(val) {
  if (val === 'true' || val === true) return 'true';
  if (val === 'false' || val === false) return 'false';
  if (/^-?\d+$/.test(String(val))) return String(val);
  return JSON.stringify(String(val));
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Parse a simple TOML string into a nested JavaScript object.
 * Supports [sections], string values ("..."), numbers, booleans, and comments (# ...).
 * Guards against prototype pollution from untrusted TOML content.
 */
function parseSimpleToml(text) {
  if (typeof text !== 'string') return {};
  const lines = text.split(/\r?\n/);
  const result = {};
  let currentSection = null;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for section header: [section]
    const sectionMatch = trimmed.match(/^\[([A-Za-z0-9_-]+)\]$/);
    if (sectionMatch) {
      const sec = sectionMatch[1];
      if (DANGEROUS_KEYS.has(sec)) {
        currentSection = null;
        continue;
      }
      currentSection = sec;
      if (!Object.prototype.hasOwnProperty.call(result, currentSection)) {
        result[currentSection] = {};
      }
      continue;
    }

    // Check for key = value (strip inline comments not within quotes)
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      if (DANGEROUS_KEYS.has(key)) continue;

      let rawVal = trimmed.slice(eqIdx + 1).trim();

      // Remove trailing comments if not inside quotes
      if (!rawVal.startsWith('"')) {
        const commentIdx = rawVal.indexOf('#');
        if (commentIdx >= 0) rawVal = rawVal.slice(0, commentIdx).trim();
      } else {
        // Quoted string: find closing quote
        const endQuote = rawVal.lastIndexOf('"');
        if (endQuote > 0) {
          rawVal = rawVal.slice(0, endQuote + 1);
        }
      }

      let parsedVal = rawVal;
      if (rawVal === 'true') parsedVal = true;
      else if (rawVal === 'false') parsedVal = false;
      else if (/^-?\d+$/.test(rawVal)) parsedVal = parseInt(rawVal, 10);
      else if (/^-?\d+\.\d+$/.test(rawVal)) parsedVal = parseFloat(rawVal);
      else if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
        parsedVal = rawVal.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }

      if (currentSection) {
        if (!Object.prototype.hasOwnProperty.call(result, currentSection)) result[currentSection] = {};
        result[currentSection][key] = parsedVal;
      } else {
        result[key] = parsedVal;
      }
    }
  }

  return result;
}

/**
 * Convert server.toml contents into a flat properties map compatible with server.properties.
 */
function syncTomlToProperties(tomlText) {
  const parsed = parseSimpleToml(tomlText);
  const props = {};

  // Standard properties section
  if (parsed.properties && typeof parsed.properties === 'object') {
    for (const [k, v] of Object.entries(parsed.properties)) {
      props[k] = String(v);
    }
  }

  // Map server section keys into standard property names
  if (parsed.server && typeof parsed.server === 'object') {
    if (parsed.server.motd !== undefined) props['motd'] = String(parsed.server.motd);
    if (parsed.server.port !== undefined) props['server-port'] = String(parsed.server.port);
    if (parsed.server.bind !== undefined) props['server-ip'] = String(parsed.server.bind);
    if (parsed.server.max_players !== undefined) props['max-players'] = String(parsed.server.max_players);
    if (parsed.server.online_mode !== undefined) props['online-mode'] = String(parsed.server.online_mode);
    if (parsed.server.whitelist !== undefined) props['white-list'] = String(parsed.server.whitelist);
    if (parsed.server.enforce_whitelist !== undefined) props['enforce-whitelist'] = String(parsed.server.enforce_whitelist);
    if (parsed.server.view_distance !== undefined) props['view-distance'] = String(parsed.server.view_distance);
    if (parsed.server.simulation_distance !== undefined) props['simulation-distance'] = String(parsed.server.simulation_distance);
  }

  // Map world section keys into standard property names
  if (parsed.world && typeof parsed.world === 'object') {
    if (parsed.world.name !== undefined) props['level-name'] = String(parsed.world.name);
    if (parsed.world.seed !== undefined) props['level-seed'] = String(parsed.world.seed);
    if (parsed.world.game_mode !== undefined) props['gamemode'] = String(parsed.world.game_mode);
    if (parsed.world.difficulty !== undefined) props['difficulty'] = String(parsed.world.difficulty);
    if (parsed.world.hardcore !== undefined) props['hardcore'] = String(parsed.world.hardcore);
  }

  return props;
}

const RESERVED_TOML_KEYS = new Set([
  'motd', 'server-port', 'server-ip', 'max-players', 'online-mode',
  'white-list', 'enforce-whitelist', 'view-distance', 'simulation-distance',
  'level-name', 'level-seed', 'gamemode', 'difficulty', 'hardcore',
  'enable-rcon', 'rcon', 'rcon.port', 'rcon.password', 'rcon.ip',
]);

/**
 * Sanitizes server.toml content to strip any broken or conflicting RCON entries.
 * Horizon is pure Rust native and uses its own IPC control socket (engine.json).
 * In TOML, defining an `rcon` string and a dotted `rcon.port` key causes a fatal parse error.
 */
function cleanHorizonToml(tomlText) {
  if (typeof tomlText !== 'string') return '';
  return tomlText
    .split(/\r?\n/)
    .filter(line => !/^\s*(rcon|enable-rcon)(\.|=|\s)/.test(line))
    .join('\n');
}

/**
 * Update an existing server.toml string with values from a properties object while preserving
 * comments and layout where possible.
 */
function syncPropertiesToToml(tomlText, props) {
  if (typeof tomlText !== 'string' || !tomlText.trim()) {
    return getDefaultHorizonToml({ properties: props });
  }

  // Pre-clean to remove any conflicting or invalid rcon dotted keys
  const cleaned = cleanHorizonToml(tomlText);
  const lines = cleaned.split(/\r?\n/);
  const eol = tomlText.includes('\r\n') ? '\r\n' : '\n';
  const outLines = [];
  let currentSection = null;
  const handledKeys = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const sectionMatch = trimmed.match(/^\[([A-Za-z0-9_-]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      outLines.push(line);
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx > 0 && !trimmed.startsWith('#')) {
      const key = line.slice(0, eqIdx).trim();

      if (currentSection === 'server') {
        if (key === 'motd' && props['motd'] !== undefined) {
          outLines.push(`motd = ${JSON.stringify(String(props['motd']))}`);
          handledKeys.add('motd');
          continue;
        }
        if (key === 'port' && props['server-port'] !== undefined) {
          outLines.push(`port = ${Number(props['server-port']) || 25565}`);
          handledKeys.add('server-port');
          continue;
        }
        if (key === 'bind' && props['server-ip'] !== undefined) {
          outLines.push(`bind = ${JSON.stringify(String(props['server-ip']))}`);
          handledKeys.add('server-ip');
          continue;
        }
        if (key === 'max_players' && props['max-players'] !== undefined) {
          outLines.push(`max_players = ${Number(props['max-players']) || 20}`);
          handledKeys.add('max-players');
          continue;
        }
        if (key === 'online_mode' && props['online-mode'] !== undefined) {
          outLines.push(`online_mode = ${props['online-mode'] === 'false' ? 'false' : 'true'}`);
          handledKeys.add('online-mode');
          continue;
        }
        if (key === 'whitelist' && props['white-list'] !== undefined) {
          outLines.push(`whitelist = ${props['white-list'] === 'true' ? 'true' : 'false'}`);
          handledKeys.add('white-list');
          continue;
        }
      } else if (currentSection === 'world') {
        if (key === 'name' && props['level-name'] !== undefined) {
          outLines.push(`name = ${JSON.stringify(String(props['level-name']))}`);
          handledKeys.add('level-name');
          continue;
        }
        if (key === 'game_mode' && props['gamemode'] !== undefined) {
          outLines.push(`game_mode = ${JSON.stringify(String(props['gamemode']))}`);
          handledKeys.add('gamemode');
          continue;
        }
        if (key === 'difficulty' && props['difficulty'] !== undefined) {
          outLines.push(`difficulty = ${JSON.stringify(String(props['difficulty']))}`);
          handledKeys.add('difficulty');
          continue;
        }
      } else if (currentSection === 'properties') {
        if (props[key] !== undefined) {
          outLines.push(`${key} = ${formatTomlValue(props[key])}`);
          handledKeys.add(key);
          continue;
        }
      }
    }

    outLines.push(line);
  }

  // Ensure [properties] section exists if there are unhandled non-reserved properties
  const remainingKeys = Object.keys(props || {}).filter(k =>
    !handledKeys.has(k) &&
    !RESERVED_TOML_KEYS.has(k) &&
    /^[A-Za-z0-9._-]+$/.test(k)
  );

  if (remainingKeys.length > 0) {
    let propSectionIdx = -1;
    for (let i = 0; i < outLines.length; i++) {
      if (outLines[i].trim() === '[properties]') {
        propSectionIdx = i;
        break;
      }
    }

    const newPropLines = remainingKeys.map(k => `${k} = ${formatTomlValue(props[k])}`);

    if (propSectionIdx >= 0) {
      outLines.splice(propSectionIdx + 1, 0, ...newPropLines);
    } else {
      outLines.push('', '[properties]', ...newPropLines);
    }
  }

  return outLines.join(eol);
}

/**
 * Return default server.toml text for fresh Horizon instances.
 */
function getDefaultHorizonToml(opts = {}) {
  const p = opts.properties || {};
  const motd = p['motd'] || 'A Minecraft Server (Horizon Native)';
  const port = Number(p['server-port']) || (Number(opts.port) || 25565);
  const bind = p['server-ip'] || '';

  return `# Horizon Dedicated Server Configuration (server.toml)
# Native Minecraft 26.3 server written in Rust

[server]
motd = ${JSON.stringify(motd)}
port = ${port}
bind = ${JSON.stringify(bind)}
max_players = ${Number(p['max-players']) || 20}
online_mode = ${p['online-mode'] === 'false' ? 'false' : 'true'}
whitelist = ${p['white-list'] === 'true' ? 'true' : 'false'}
enforce_whitelist = ${p['enforce-whitelist'] === 'true' ? 'true' : 'false'}
view_distance = ${Number(p['view-distance']) || 10}
simulation_distance = ${Number(p['simulation-distance']) || 10}

[world]
name = ${JSON.stringify(p['level-name'] || 'world')}
seed = ${JSON.stringify(p['level-seed'] || '')}
game_mode = ${JSON.stringify(p['gamemode'] || 'survival')}
difficulty = ${JSON.stringify(p['difficulty'] || 'easy')}
hardcore = ${p['hardcore'] === 'true' ? 'true' : 'false'}

[properties]
# Additional Minecraft server.properties supported by Horizon

[engine]
path = ""
resources = ""
restart_on_crash = false

[backups]
every = "0"
keep = 5

[updates]
keep = 1

[panel]
bind = "127.0.0.1:8130"
allow_public = false
`;
}

module.exports = {
  formatTomlValue,
  parseSimpleToml,
  cleanHorizonToml,
  syncTomlToProperties,
  syncPropertiesToToml,
  getDefaultHorizonToml,
};
