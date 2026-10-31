// tests/horizon-config.test.js — Unit tests for Horizon server.toml configuration parser and synchronizer
const assert = require('assert');
const {
  parseSimpleToml,
  syncTomlToProperties,
  syncPropertiesToToml,
  getDefaultHorizonToml,
  cleanHorizonToml,
} = require('../src/main/horizon-config.js');

let passed = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  passed++;
}

// 1. Basic parsing
const sampleToml = `
# Server configuration
[server]
motd = "Horizon Rust Server"
port = 25565
bind = "0.0.0.0"

[engine]
path = "horizon-server.exe"
restart_on_crash = false
threads = 4

[properties]
online-mode = false
difficulty = "hard"
max-players = 50
level-name = "world_rust"
`;

const parsed = parseSimpleToml(sampleToml);
ok('parsed is object', typeof parsed === 'object');
ok('parsed server.motd', parsed.server.motd === 'Horizon Rust Server');
ok('parsed server.port', parsed.server.port === 25565);
ok('parsed server.bind', parsed.server.bind === '0.0.0.0');
ok('parsed engine.restart_on_crash', parsed.engine.restart_on_crash === false);
ok('parsed engine.threads', parsed.engine.threads === 4);
ok('parsed properties.online-mode', parsed.properties['online-mode'] === false);
ok('parsed properties.difficulty', parsed.properties.difficulty === 'hard');
ok('parsed properties.max-players', parsed.properties['max-players'] === 50);

// 2. syncTomlToProperties
const props = syncTomlToProperties(sampleToml);
ok('sync: motd', props.motd === 'Horizon Rust Server');
ok('sync: server-port', props['server-port'] === '25565');
ok('sync: server-ip', props['server-ip'] === '0.0.0.0');
ok('sync: online-mode', props['online-mode'] === 'false');
ok('sync: difficulty', props.difficulty === 'hard');
ok('sync: max-players', props['max-players'] === '50');
ok('sync: level-name', props['level-name'] === 'world_rust');

// 3. syncPropertiesToToml (updates existing without wiping comments)
const updatedToml = syncPropertiesToToml(sampleToml, {
  motd: 'Updated MOTD',
  'server-port': 25570,
  difficulty: 'peaceful',
  'new-setting': 'custom-value',
});

ok('preserves comment', updatedToml.includes('# Server configuration'));
ok('updated motd', updatedToml.includes('motd = "Updated MOTD"'));
ok('updated port', updatedToml.includes('port = 25570'));
ok('updated difficulty', updatedToml.includes('difficulty = "peaceful"'));
ok('added new setting', updatedToml.includes('new-setting = "custom-value"'));

const reParsed = parseSimpleToml(updatedToml);
ok('re-parsed motd', reParsed.server.motd === 'Updated MOTD');
ok('re-parsed port', reParsed.server.port === 25570);
ok('re-parsed difficulty', reParsed.properties.difficulty === 'peaceful');
ok('re-parsed new-setting', reParsed.properties['new-setting'] === 'custom-value');

// 4. Default TOML generation
const defaultToml = getDefaultHorizonToml({
  properties: {
    motd: 'Custom Default',
    'server-port': 25566,
    difficulty: 'normal',
  },
});
ok('default has header comment', defaultToml.includes('# Horizon Dedicated Server Configuration'));
ok('default has custom motd', defaultToml.includes('motd = "Custom Default"'));
ok('default has custom port', defaultToml.includes('port = 25566'));
ok('default has [properties]', defaultToml.includes('[properties]'));
ok('default does not have enable-rcon', !defaultToml.includes('enable-rcon'));
ok('default does not have rcon.port', !defaultToml.includes('rcon.port'));

// 5. cleanHorizonToml sanitization
const brokenToml = `[properties]
broadcast-rcon-to-ops = true
rcon = "{ password = \\"obs-secret\\", port = 25575 }"
enable-rcon = true
rcon.port = 25585
rcon.password = "secret"
difficulty = "hard"
`;
const sanitized = cleanHorizonToml(brokenToml);
ok('sanitized strips rcon string', !sanitized.includes('rcon = "'));
ok('sanitized strips rcon.port', !sanitized.includes('rcon.port'));
ok('sanitized strips rcon.password', !sanitized.includes('rcon.password'));
ok('sanitized strips enable-rcon', !sanitized.includes('enable-rcon'));
ok('sanitized preserves valid properties', sanitized.includes('difficulty = "hard"'));

// 6. syncPropertiesToToml filters rcon properties
const syncedWithoutRcon = syncPropertiesToToml(sanitized, {
  'enable-rcon': 'true',
  'rcon.port': 25590,
  'rcon.password': 'forbidden',
  difficulty: 'normal',
});
ok('sync drops rcon keys', !syncedWithoutRcon.includes('rcon.port'));
ok('sync drops enable-rcon', !syncedWithoutRcon.includes('enable-rcon'));
ok('sync updates difficulty', syncedWithoutRcon.includes('difficulty = "normal"'));

// 7. Prototype pollution guard
const evilToml = `[__proto__]
polluted = true

[server]
__proto__ = "evil"
constructor = "evil"
motd = "Safe"
`;
const evilParsed = parseSimpleToml(evilToml);
ok('prototype pollution: __proto__ section does not pollute Object.prototype', ({}).polluted === undefined);
ok('prototype pollution: __proto__ key does not pollute Object.prototype', ({}).evil === undefined);
ok('prototype pollution: safe keys still parsed', evilParsed.server && evilParsed.server.motd === 'Safe');

console.log(`\nAll ${passed} horizon-config tests passed.`);

