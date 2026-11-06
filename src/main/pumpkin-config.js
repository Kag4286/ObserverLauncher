// src/main/pumpkin-config.js — Parser, serializer, and property synchronizer for Pumpkin's Pumpkin.toml
// Supports native Pumpkin dedicated server configuration without external dependencies.

const { parseSimpleToml } = require('./horizon-config.js');

const DEFAULT_MINECRAFT_PROPERTIES = {
  'motd': 'A blazingly fast Pumpkin server!',
  'max-players': '20',
  'difficulty': 'normal',
  'gamemode': 'survival',
  'hardcore': 'false',
  'pvp': 'true',
  'force-gamemode': 'false',
  'allow-flight': 'false',
  'spawn-monsters': 'true',
  'spawn-animals': 'true',
  'spawn-npcs': 'true',
  'allow-nether': 'true',
  'player-idle-timeout': '0',
  'level-name': 'world',
  'level-seed': '',
  'level-type': 'minecraft:normal',
  'generate-structures': 'true',
  'generator-settings': '{}',
  'spawn-protection': '16',
  'max-world-size': '29999984',
  'view-distance': '10',
  'simulation-distance': '8',
  'entity-broadcast-range-percentage': '100',
  'max-tick-time': '60000',
  'server-port': '25565',
  'server-ip': '',
  'network-compression-threshold': '256',
  'use-native-transport': 'true',
  'prevent-proxy-connections': 'false',
  'enable-jmx-monitoring': 'false',
  'online-mode': 'true',
  'white-list': 'false',
  'enforce-whitelist': 'false',
  'op-permission-level': '4',
  'function-permission-level': '2',
  'enable-command-block': 'false',
  'enable-rcon': 'false',
  'rcon.port': '25575',
  'rcon.password': '',
  'broadcast-console-to-ops': 'true',
  'broadcast-rcon-to-ops': 'true',
  'enable-query': 'false',
  'query.port': '25565',
  'resource-pack': '',
  'resource-pack-sha1': '',
  'resource-pack-prompt': '',
  'require-resource-pack': 'false',
};

function capitalize(s) {
  if (!s) return '';
  const str = String(s);
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function getDefaultPumpkinToml(opts = {}) {
  const p = opts.properties || {};
  const port = Number(p['server-port']) || 25565;
  const maxPlayers = Number(p['max-players']) || 20;
  const onlineMode = p['online-mode'] === 'false' ? false : true;
  const motd = p['motd'] || 'A blazingly fast Pumpkin server!';
  const seed = p['level-seed'] || '';
  const diff = capitalize(p['difficulty'] || 'Normal');
  const gm = capitalize(p['gamemode'] || 'Survival');
  const vDist = Number(p['view-distance']) || 10;
  const simDist = Number(p['simulation-distance']) || 8;
  const hc = p['hardcore'] === 'true';
  const levelName = p['level-name'] || 'world';

  return `# Pumpkin Minecraft Server Configuration (managed by ObserverLauncher)
default_level_name = ${JSON.stringify(String(levelName))}
seed = ${JSON.stringify(String(seed))}
default_difficulty = ${JSON.stringify(diff)}
default_gamemode = ${JSON.stringify(gm)}
force_gamemode = ${p['force-gamemode'] === 'true' ? 'true' : 'false'}
allow_nether = ${p['allow-nether'] === 'false' ? 'false' : 'true'}
allow_end = true
hardcore = ${hc ? 'true' : 'false'}
white_list = ${p['white-list'] === 'true' ? 'true' : 'false'}
enforce_whitelist = ${p['enforce-whitelist'] === 'true' ? 'true' : 'false'}
spawn_protection = ${Number(p['spawn-protection']) || 16}
op_permission_level = ${Number(p['op-permission-level']) || 4}
tps = 20.0

[pvp]
enabled = ${p['pvp'] === 'false' ? 'false' : 'true'}

[world]
autosave_ticks = 6000

[world.chunk]
type = "anvil"

[networking.java]
enabled = true
address = "0.0.0.0:${port}"
encryption = true
online_mode = ${onlineMode ? 'true' : 'false'}
max_players = ${maxPlayers}
view_distance = ${vDist}
simulation_distance = ${simDist}
motd = ${JSON.stringify(String(motd))}

[networking.java.compression]
enabled = true
threshold = ${Number(p['network-compression-threshold']) || 256}

[networking.java.authentication]
prevent_proxy_connections = ${p['prevent-proxy-connections'] === 'true' ? 'true' : 'false'}

[commands]
broadcast_console_to_ops = ${p['broadcast-console-to-ops'] === 'false' ? 'false' : 'true'}
`;
}

function syncPumpkinTomlToProperties(tomlText) {
  const parsed = parseSimpleToml(tomlText);
  const props = Object.assign({}, DEFAULT_MINECRAFT_PROPERTIES);

  if (parsed.default_level_name !== undefined) props['level-name'] = String(parsed.default_level_name);
  if (parsed.seed !== undefined) props['level-seed'] = String(parsed.seed);
  if (parsed.default_difficulty !== undefined) props['difficulty'] = String(parsed.default_difficulty).toLowerCase();
  if (parsed.default_gamemode !== undefined) props['gamemode'] = String(parsed.default_gamemode).toLowerCase();
  if (parsed.force_gamemode !== undefined) props['force-gamemode'] = String(parsed.force_gamemode);
  if (parsed.allow_nether !== undefined) props['allow-nether'] = String(parsed.allow_nether);
  if (parsed.hardcore !== undefined) props['hardcore'] = String(parsed.hardcore);
  if (parsed.white_list !== undefined) props['white-list'] = String(parsed.white_list);
  if (parsed.enforce_whitelist !== undefined) props['enforce-whitelist'] = String(parsed.enforce_whitelist);
  if (parsed.spawn_protection !== undefined) props['spawn-protection'] = String(parsed.spawn_protection);
  if (parsed.op_permission_level !== undefined) props['op-permission-level'] = String(parsed.op_permission_level);

  const pvp = parsed.pvp || {};
  if (pvp.enabled !== undefined) props['pvp'] = String(pvp.enabled);

  const net = parsed['networking.java'] || parsed;
  if (net.address !== undefined) {
    const s = String(net.address);
    const m = s.match(/:(\d+)$/);
    if (m) props['server-port'] = m[1];
    const host = s.split(':')[0];
    if (host && host !== '0.0.0.0') props['server-ip'] = host;
  }
  if (net.max_players !== undefined) props['max-players'] = String(net.max_players);
  if (net.online_mode !== undefined) props['online-mode'] = String(net.online_mode);
  if (net.motd !== undefined) props['motd'] = String(net.motd);
  if (net.view_distance !== undefined) props['view-distance'] = String(net.view_distance);
  if (net.simulation_distance !== undefined) props['simulation-distance'] = String(net.simulation_distance);

  const comp = parsed['networking.java.compression'] || {};
  if (comp.threshold !== undefined) props['network-compression-threshold'] = String(comp.threshold);

  const auth = parsed['networking.java.authentication'] || {};
  if (auth.prevent_proxy_connections !== undefined) props['prevent-proxy-connections'] = String(auth.prevent_proxy_connections);

  const query = parsed['networking.query'] || {};
  if (query.enabled !== undefined) props['enable-query'] = String(query.enabled);
  if (query.address !== undefined) {
    const m = String(query.address).match(/:(\d+)$/);
    if (m) props['query.port'] = m[1];
  }

  const rp = parsed['resource_pack.java'] || {};
  if (rp.url !== undefined) props['resource-pack'] = String(rp.url);
  if (rp.sha1 !== undefined) props['resource-pack-sha1'] = String(rp.sha1);
  if (rp.prompt_message !== undefined) props['resource-pack-prompt'] = String(rp.prompt_message);
  if (rp.force !== undefined) props['require-resource-pack'] = String(rp.force);

  const cmd = parsed.commands || {};
  if (cmd.broadcast_console_to_ops !== undefined) props['broadcast-console-to-ops'] = String(cmd.broadcast_console_to_ops);

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
        if (key === 'default_level_name' && props['level-name'] !== undefined) {
          outLines.push(`default_level_name = ${JSON.stringify(String(props['level-name']))}`);
          continue;
        }
        if (key === 'seed' && props['level-seed'] !== undefined) {
          outLines.push(`seed = ${JSON.stringify(String(props['level-seed']))}`);
          continue;
        }
        if (key === 'default_difficulty' && props['difficulty'] !== undefined) {
          outLines.push(`default_difficulty = ${JSON.stringify(capitalize(props['difficulty']))}`);
          continue;
        }
        if (key === 'default_gamemode' && props['gamemode'] !== undefined) {
          outLines.push(`default_gamemode = ${JSON.stringify(capitalize(props['gamemode']))}`);
          continue;
        }
        if (key === 'force_gamemode' && props['force-gamemode'] !== undefined) {
          outLines.push(`force_gamemode = ${props['force-gamemode'] === 'true' ? 'true' : 'false'}`);
          continue;
        }
        if (key === 'allow_nether' && props['allow-nether'] !== undefined) {
          outLines.push(`allow_nether = ${props['allow-nether'] === 'false' ? 'false' : 'true'}`);
          continue;
        }
        if (key === 'hardcore' && props['hardcore'] !== undefined) {
          outLines.push(`hardcore = ${props['hardcore'] === 'true' ? 'true' : 'false'}`);
          continue;
        }
        if (key === 'white_list' && props['white-list'] !== undefined) {
          outLines.push(`white_list = ${props['white-list'] === 'true' ? 'true' : 'false'}`);
          continue;
        }
        if (key === 'enforce_whitelist' && props['enforce-whitelist'] !== undefined) {
          outLines.push(`enforce_whitelist = ${props['enforce-whitelist'] === 'true' ? 'true' : 'false'}`);
          continue;
        }
        if (key === 'spawn_protection' && props['spawn-protection'] !== undefined) {
          outLines.push(`spawn_protection = ${Number(props['spawn-protection']) || 16}`);
          continue;
        }
        if (key === 'op_permission_level' && props['op-permission-level'] !== undefined) {
          outLines.push(`op_permission_level = ${Number(props['op-permission-level']) || 4}`);
          continue;
        }
      }

      if (currentSection === 'pvp') {
        if (key === 'enabled' && props['pvp'] !== undefined) {
          outLines.push(`enabled = ${props['pvp'] === 'false' ? 'false' : 'true'}`);
          continue;
        }
      }

      if (currentSection === 'networking.java') {
        if (key === 'address' && props['server-port'] !== undefined) {
          const host = (props['server-ip'] || '').trim() || '0.0.0.0';
          outLines.push(`address = "${host}:${Number(props['server-port']) || 25565}"`);
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

      if (currentSection === 'networking.java.compression') {
        if (key === 'threshold' && props['network-compression-threshold'] !== undefined) {
          outLines.push(`threshold = ${Number(props['network-compression-threshold']) || 256}`);
          continue;
        }
      }

      if (currentSection === 'networking.java.authentication') {
        if (key === 'prevent_proxy_connections' && props['prevent-proxy-connections'] !== undefined) {
          outLines.push(`prevent_proxy_connections = ${props['prevent-proxy-connections'] === 'true' ? 'true' : 'false'}`);
          continue;
        }
      }

      if (currentSection === 'networking.query') {
        if (key === 'enabled' && props['enable-query'] !== undefined) {
          outLines.push(`enabled = ${props['enable-query'] === 'true' ? 'true' : 'false'}`);
          continue;
        }
        if (key === 'address' && (props['query.port'] !== undefined || props['server-port'] !== undefined)) {
          const port = Number(props['query.port']) || Number(props['server-port']) || 25565;
          outLines.push(`address = "0.0.0.0:${port}"`);
          continue;
        }
      }

      if (currentSection === 'resource_pack.java') {
        if (key === 'url' && props['resource-pack'] !== undefined) {
          outLines.push(`url = ${JSON.stringify(String(props['resource-pack']))}`);
          continue;
        }
        if (key === 'sha1' && props['resource-pack-sha1'] !== undefined) {
          outLines.push(`sha1 = ${JSON.stringify(String(props['resource-pack-sha1']))}`);
          continue;
        }
        if (key === 'prompt_message' && props['resource-pack-prompt'] !== undefined) {
          outLines.push(`prompt_message = ${JSON.stringify(String(props['resource-pack-prompt']))}`);
          continue;
        }
        if (key === 'force' && props['require-resource-pack'] !== undefined) {
          outLines.push(`force = ${props['require-resource-pack'] === 'true' ? 'true' : 'false'}`);
          continue;
        }
        if (key === 'enabled' && props['resource-pack'] !== undefined) {
          outLines.push(`enabled = ${Boolean(props['resource-pack'] && props['resource-pack'].trim())}`);
          continue;
        }
      }

      if (currentSection === 'commands') {
        if (key === 'broadcast_console_to_ops' && props['broadcast-console-to-ops'] !== undefined) {
          outLines.push(`broadcast_console_to_ops = ${props['broadcast-console-to-ops'] === 'false' ? 'false' : 'true'}`);
          continue;
        }
      }
    }

    outLines.push(line);
  }

  let res = outLines.join(eol);
  if (!res.includes('[world.chunk]')) {
    res += `${eol}${eol}[world.chunk]${eol}type = "anvil"${eol}`;
  }
  return res;
}

module.exports = {
  DEFAULT_MINECRAFT_PROPERTIES,
  getDefaultPumpkinToml,
  syncPumpkinTomlToProperties,
  syncPropertiesToPumpkinToml,
  parseSimpleToml,
  parsePumpkinToml: parseSimpleToml,
};
