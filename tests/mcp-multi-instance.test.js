// v2.0.0 (M11): MCP multi-instance helpers. resolveInstanceId maps an optional instance param to
// a real id (or null); loadSettingsFor flattens a SPECIFIC instance (not the active one).
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-mcp-mi-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const S = require('../src/main/settings.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

try {
  // Two instances with distinct folders.
  const a = S.addInstance({ serverPath: '/srv/A', name: 'Alpha' });
  const b = S.addInstance({ serverPath: '/srv/B', name: 'Beta' });
  S.switchInstance(a.id); // active = A

  // resolveInstanceId: omitted -> active; known -> id; unknown -> null.
  ok('resolve: omitted -> active', S.resolveInstanceId(null) === a.id);
  ok('resolve: known id -> id', S.resolveInstanceId(b.id) === b.id);
  ok('resolve: unknown -> null', S.resolveInstanceId('nope') === null);

  // loadSettingsFor: a SPECIFIC instance, even when another is active.
  ok('loadSettingsFor B while A active', S.loadSettingsFor(b.id).serverPath === '/srv/B');
  ok('loadSettingsFor A', S.loadSettingsFor(a.id).serverPath === '/srv/A');
  ok('loadSettingsFor active default', S.loadSettingsFor().serverPath === '/srv/A');
  ok('loadSettingsFor unknown -> active', S.loadSettingsFor('nope').serverPath === '/srv/A');
  ok('loadSettingsFor has no instances key', S.loadSettingsFor(b.id).instances === undefined);
} finally {
  fs.rmSync(userData, { recursive: true, force: true });
}
console.log(`\n${passed} passed, 0 failed`);
