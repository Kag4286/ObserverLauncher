// v6.0.0 E1: Velocity proxy-config helpers. Line-level parse/add/remove, no disk writes.
const assert = require('assert');
const P = require('../src/main/proxy-config.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const BASE = `# Config version\nconfig-version = "2.6"\n\n[servers]\n# This is the lobby\nlobby = "127.0.0.1:25565"\nsurvival = "127.0.0.1:25566"\ntry = [\n  "lobby",\n  "survival"\n]\n\n[forced-hosts]\n`;

// --- parseVelocityServers ---
{
  const r = P.parseVelocityServers(BASE);
  ok('parses two servers', r.servers.lobby === '127.0.0.1:25565' && r.servers.survival === '127.0.0.1:25566');
  ok('parses try list (multi-line)', r.try.length === 2 && r.try[0] === 'lobby' && r.try[1] === 'survival');
}
{
  const oneLine = `[servers]\na = "1.1.1.1:1"\ntry = ["a"]\n`;
  const r = P.parseVelocityServers(oneLine);
  ok('one-line try array', r.try.length === 1 && r.try[0] === 'a');
}
ok('empty text -> empty servers', Object.keys(P.parseVelocityServers('').servers).length === 0);
ok('no [servers] -> empty', Object.keys(P.parseVelocityServers('config-version = "2.6"').servers).length === 0);

// --- addVelocityServer ---
{
  const r = P.addVelocityServer(BASE, 'creative', '127.0.0.1:25567');
  ok('add returns ok', r.ok === true);
  ok('add inserts line', r.text.includes('creative = "127.0.0.1:25567"'));
  ok('add preserves comment', r.text.includes('# This is the lobby'));
  ok('add preserves other sections', r.text.includes('[forced-hosts]'));
  const re = P.parseVelocityServers(r.text);
  ok('re-parse sees 3 servers', Object.keys(re.servers).length === 3);
}
ok('add invalid name refused', !P.addVelocityServer(BASE, 'bad name!', '1.1.1.1:1').ok);
ok('add invalid address refused', !P.addVelocityServer(BASE, 'x', '1.1.1.1').ok);
ok('add duplicate name refused', !P.addVelocityServer(BASE, 'lobby', '2.2.2.2:2').ok);

// No [servers] block -> one is created
{
  const r = P.addVelocityServer('config-version = "2.6"', 'lobby', '127.0.0.1:25565');
  ok('creates [servers] when missing', r.ok === true && /\[servers\]/.test(r.text) && /lobby = /.test(r.text));
}

// --- removeVelocityServer ---
{
  const r = P.removeVelocityServer(BASE, 'survival');
  ok('remove returns ok', r.ok === true);
  ok('remove drops server line', !r.text.includes('survival = "127.0.0.1:25566"'));
  ok('remove drops try entry', !/"survival"/.test(r.text));
  ok('remove keeps lobby', r.text.includes('lobby = "127.0.0.1:25565"'));
  ok('remove keeps comment + other sections', r.text.includes('# This is the lobby') && r.text.includes('[forced-hosts]'));
}
ok('remove invalid name refused', !P.removeVelocityServer(BASE, 'bad name!').ok);

console.log(`\n${passed} passed, 0 failed`);
