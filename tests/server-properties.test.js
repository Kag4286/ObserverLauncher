// D1 (v2.1.0): buildPropertiesContent is the ONE choke point for server.properties writes (IPC grid
// + MCP set_property). It is pure (reads the original text, returns the new text) and carries a
// SECURITY filter (no newline injection, no prototype-pollution keys). This test pins both the
// text-preservation behaviour AND the filter.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { buildPropertiesContent } = require('../src/main/server-files.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const root = path.join(os.tmpdir(), 'ob-props-test');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const write = txt => fs.writeFileSync(path.join(root, 'server.properties'), txt);

// --- edits values IN PLACE, preserves comments/order/unknown keys ---
write('#Minecraft server properties\n#Fri Sep 24\nmotd=A Minecraft Server\nserver-port=25565\nview-distance=10\n');
let out = buildPropertiesContent(root, { 'server-port': '25566' });
ok('replaces an existing value', out.includes('server-port=25566'));
ok('does NOT duplicate the changed key', out.split('\n').filter(l => l.startsWith('server-port=')).length === 1);
ok('preserves a comment line', out.includes('#Minecraft server properties'));
ok('preserves untouched keys', out.includes('motd=A Minecraft Server') && out.includes('view-distance=10'));
ok('keeps original order (port line stays 4th)', out.split('\n')[3] === 'server-port=25566');

// --- appends a key that does not exist yet ---
out = buildPropertiesContent(root, { 'enable-rcon': 'true' });
ok('appends a new key', out.includes('enable-rcon=true'));
ok('append lands at the end', out.trimEnd().endsWith('enable-rcon=true'));

// --- CRLF is preserved ---
write('motd=x\r\nserver-port=25565\r\n');
out = buildPropertiesContent(root, { 'server-port': '1' });
ok('preserves CRLF line endings', out.includes('\r\n') && !/[^\r]\n/.test(out));

// --- SECURITY: newline injection dropped ---
write('motd=x\n');
out = buildPropertiesContent(root, { 'evil\nop-level=4': 'x' });
ok('key with newline dropped', !out.includes('op-level'));
out = buildPropertiesContent(root, { 'motd': 'hi\ninjected=true' });
ok('value with newline dropped', !out.includes('injected=true') && out.includes('motd=x'));

// --- SECURITY: prototype-pollution keys dropped ---
out = buildPropertiesContent(root, { '__proto__': 'x', 'constructor': 'y', 'prototype': 'z' });
ok('proto/constructor/prototype dropped', !out.includes('__proto__') && !out.includes('constructor=') && !out.includes('prototype='));

// --- SECURITY: key charset (allows real MC keys with . and -) ---
write('rcon.port=0\n');
out = buildPropertiesContent(root, { 'rcon.port': '25575', 'bad key': 'x', 'key$': 'x' });
ok('dot key allowed', out.includes('rcon.port=25575'));
ok('space key dropped', !out.includes('bad key'));
ok('dollar key dropped', !out.includes('key$='));

// --- missing file -> builds a fresh one, no throw ---
fs.rmSync(path.join(root, 'server.properties'), { force: true });
out = buildPropertiesContent(root, { motd: 'fresh', 'server-port': '25565' });
ok('missing file -> content built', out.includes('motd=fresh') && out.includes('server-port=25565'));
ok('ends with a newline', out.endsWith('\n') && !out.endsWith('\n\n'));

// --- null/undefined values become empty string (not 'null'/'undefined') ---
write('motd=x\n');
out = buildPropertiesContent(root, { 'level-name': null });
ok('null value -> empty', out.includes('level-name=') && !out.includes('level-name=null'));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
