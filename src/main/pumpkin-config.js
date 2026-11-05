// src/main/pumpkin-config.js — Parser, serializer, and property synchronizer for Pumpkin's Pumpkin.toml
// Supports native Pumpkin dedicated server configuration without external dependencies.

const { parseSimpleToml } = require('./horizon-config.js');

function getDefaultPumpkinToml(opts = {}) {
  const p = opts.properties || {};
  const port = Number(p['server-port']) || 25565;
  const maxPlayers = Number(p['max-players']) || 20;
  const onlineMode = p['online-mode'] === 'false' ? false : true;
  const motd = p['motd'] || 'A blazingly fast Pumpkin server!';
  const seed = p['level-seed'] || '';
  const diff = p['difficulty'] || 'Normal';
  const vDist = Number(p['view-distance']) || 10;
  const simDist = Number(p['simulation-distance']) || 8;
  const hc = p['hardcore'] === 'true';

  return `# Pumpkin Minecraft Server Configuration (managed by ObserverLauncher)
seed = ${JSON.stringify(String(seed))}
default_difficulty = ${JSON.stringify(String(diff))}
allow_nether = true
allow_end = true
hardcore = ${hc ? 'true' : 'false'}
tps = 20.0

[networking.java]
enabled = true
address = "0.0.0.0:${port}"
encryption = true
online_mode = ${onlineMode ? 'true' : 'false'}
max_players = ${maxPlayers}
view_distance = ${vDist}
simulation_distance = ${simDist}
motd = ${JSON.stringify(String(motd))}
`;
}

function syncPumpkinTomlToProperties(tomlText) {
  const parsed = parseSimpleToml(tomlText);
  const props = {};

  if (parsed.seed !== undefined) props['level-seed'] = String(parsed.seed);
  if (parsed.default_difficulty !== undefined) props['difficulty'] = String(parsed.default_difficulty).toLowerCase();
  if (parsed.hardcore !== undefined) props['hardcore'] = String(parsed.hardcore);

  const net = parsed['networking.java'] || parsed;
  if (net.address !== undefined) {
    const s = String(net.address);
    const m = s.match(/:(\d+)$/);
    if (m) props['server-port'] = m[1];
  }
  if (net.max_players !== undefined) props['max-players'] = String(net.max_players);
  if (net.online_mode !== undefined) props['online-mode'] = String(net.online_mode);
  if (net.motd !== undefined) props['motd'] = String(net.motd);
  if (net.view_distance !== undefined) props['view-distance'] = String(net.view_distance);
  if (net.simulation_distance !== undefined) props['simulation-distance'] = String(net.simulation_distance);

  return props;
}

function syncPropertiesToPumpkinToml(tomlText, props) {
  if (typeof tomlText !== 'string' || !tomlText.trim()) {
    return getDefaultPumpkinToml({ properties: props });
  }

  const lines = tomlText.split(/\r?\n/);
  const eol = tomlText.includes('\r\n') ? '\r\n' : '\n';
  const outLines = [];
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const sec = (trimmed.startsWith('[') && trimmed.endsWith(']')) ? trimmed.slice(1, -1) : null;
    if (sec) {
      currentSection = sec;
      outLines.push(line);
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1 && !trimmed.startsWith('#')) {
      const key = line.slice(0, eqIdx).trim();

      if (!currentSection) {
        if (key === 'seed' && props['level-seed'] !== undefined) {
          outLines.push(`seed = ${JSON.stringify(String(props['level-seed']))}`);
          continue;
        }
        if (key === 'default_difficulty' && props['difficulty'] !== undefined) {
          const cap = String(props['difficulty']).charAt(0).toUpperCase() + String(props['difficulty']).slice(1).toLowerCase();
          outLines.push(`default_difficulty = ${JSON.stringify(cap)}`);
          continue;
        }
        if (key === 'hardcore' && props['hardcore'] !== undefined) {
          outLines.push(`hardcore = ${props['hardcore'] === 'true' ? 'true' : 'false'}`);
          continue;
        }
      }

      if (currentSection === 'networking.java') {
        if (key === 'address' && props['server-port'] !== undefined) {
          outLines.push(`address = "0.0.0.0:${Number(props['server-port']) || 25565}"`);
          continue;
        }
        if (key === 'max_players' && props['max-players'] !== undefined) {
          outLines.push(`max_players = ${Number(props['max-players']) || 20}`);
          continue;
        }
        if (key === 'online_mode' && props['online-mode'] !== undefined) {
          outLines.push(`online_mode = ${props['online-mode'] === 'false' ? 'false' : 'true'}`);
          continue;
        }
        if (key === 'motd' && props['motd'] !== undefined) {
          outLines.push(`motd = ${JSON.stringify(String(props['motd']))}`);
          continue;
        }
        if (key === 'view_distance' && props['view-distance'] !== undefined) {
          outLines.push(`view_distance = ${Number(props['view-distance']) || 10}`);
          continue;
        }
        if (key === 'simulation_distance' && props['simulation-distance'] !== undefined) {
          outLines.push(`simulation_distance = ${Number(props['simulation-distance']) || 8}`);
          continue;
        }
      }
    }

    outLines.push(line);
  }

  return outLines.join(eol);
}

module.exports = {
  getDefaultPumpkinToml,
  syncPumpkinTomlToProperties,
  syncPropertiesToPumpkinToml,
  parseSimpleToml,
  parsePumpkinToml: parseSimpleToml,
};
