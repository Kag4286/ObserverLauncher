// 5.7.0: GeyserMC config inspection. parseSimpleYaml reads the flat/nested config; inspectGeyser
// flags the common mistakes that stop Bedrock players from joining. Pure (reads temp files only).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectGeyser, parseSimpleYaml } = require('../src/main/geyser.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- parseSimpleYaml ---
{
  const y = parseSimpleYaml('bedrock:\n  port: 19132\n  clone-remote-port: false\nremote:\n  auth-type: floodgate\n# comment\n');
  ok('yaml: nested port', y.bedrock.port === '19132');
  ok('yaml: nested bool as text', y.bedrock['clone-remote-port'] === 'false');
  ok('yaml: second top-level key', y.remote['auth-type'] === 'floodgate');
  const q = parseSimpleYaml('a: "quoted"\nb: \'single\'\n');
  ok('yaml: strips double quotes', q.a === 'quoted');
  ok('yaml: strips single quotes', q.b === 'single');
  ok('yaml: empty safe', Object.keys(parseSimpleYaml('')).length === 0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-geyser-'));
fs.mkdirSync(path.join(root, 'plugins', 'Geyser-Spigot'), { recursive: true });
const cfg = path.join(root, 'plugins', 'Geyser-Spigot', 'config.yml');

// --- no jar / no config -> found=false ---
ok('no config: found true, configPath null', (() => { const r = inspectGeyser(root); return r.found === true && r.configPath === null; })());
ok('no config: warns to start once', inspectGeyser(root).issues.some(i => i.key === 'config'));

// --- clone-remote-port true -> error ---
fs.writeFileSync(cfg, 'bedrock:\n  port: 19132\n  clone-remote-port: true\nremote:\n  auth-type: floodgate\n');
{
  const r = inspectGeyser(root, { floodgate: true });
  ok('config path found', r.configPath === 'plugins/Geyser-Spigot/config.yml');
  ok('clone-remote-port true -> error', r.issues.some(i => i.level === 'error' && i.key === 'bedrock.clone-remote-port'));
  ok('auth-type floodgate -> no auth error', !r.issues.some(i => i.key === 'remote.auth-type'));
}

// --- non-default bedrock port -> warn ---
fs.writeFileSync(cfg, 'bedrock:\n  port: 20000\n  clone-remote-port: false\n');
ok('non-default port -> warn', inspectGeyser(root).issues.some(i => i.key === 'bedrock.port'));

// --- floodgate present but auth-type online -> error ---
fs.writeFileSync(cfg, 'bedrock:\n  port: 19132\n  clone-remote-port: false\nremote:\n  auth-type: online\n');
ok('floodgate + auth-type online -> error', inspectGeyser(root, { floodgate: true }).issues.some(i => i.key === 'remote.auth-type'));

// --- haproxy false -> warn ---
fs.writeFileSync(cfg, 'bedrock:\n  port: 19132\n  clone-remote-port: false\nadvanced:\n  bedrock:\n    use-haproxy-protocol: false\n');
ok('haproxy false -> warn', inspectGeyser(root).issues.some(i => i.key === 'advanced.bedrock.use-haproxy-protocol'));

// --- port conflict: query enabled on the Geyser UDP port -> error ---
fs.writeFileSync(cfg, 'bedrock:\n  port: 19132\n  clone-remote-port: false\n');
fs.writeFileSync(path.join(root, 'server.properties'), 'enable-query=true\nquery.port=19132\n');
ok('query port clash -> error', inspectGeyser(root).issues.some(i => i.key === 'query.port'));
fs.writeFileSync(path.join(root, 'server.properties'), 'enable-query=true\nquery.port=19133\n');
ok('query on another port -> no clash', !inspectGeyser(root).issues.some(i => i.key === 'query.port'));
fs.writeFileSync(path.join(root, 'server.properties'), 'enable-query=false\nquery.port=19132\n');
ok('query disabled -> no clash', !inspectGeyser(root).issues.some(i => i.key === 'query.port'));

// --- java version: below 21 -> error ---
ok('java 17 -> error', inspectGeyser(root, { javaMajor: 17 }).issues.some(i => i.key === 'java'));
ok('java 21 -> no java error', !inspectGeyser(root, { javaMajor: 21 }).issues.some(i => i.key === 'java'));
ok('java unknown -> no java error', !inspectGeyser(root, {}).issues.some(i => i.key === 'java'));

// --- clean config -> no issues ---
fs.writeFileSync(path.join(root, 'server.properties'), '');
fs.writeFileSync(cfg, 'bedrock:\n  port: 19132\n  clone-remote-port: false\nremote:\n  auth-type: floodgate\nadvanced:\n  bedrock:\n    use-haproxy-protocol: true\n');
ok('clean config -> no issues', inspectGeyser(root, { floodgate: true, javaMajor: 21 }).issues.length === 0);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
