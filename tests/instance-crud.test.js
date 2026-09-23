// v2.0.0 (Phase B / B1) instance CRUD: add/switch/rename/remove on the nested settings
// store. addInstance must refuse a folder already owned by another instance (two processes
// on one serverPath corrupt the world); removeInstance must never touch the folder on disk.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-instance-crud-userdata');
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
  // Fresh store: no instances yet.
  ok('fresh: no instances', S.listInstances().instances.length === 0);
  ok('fresh: active is null', S.listInstances().activeInstanceId === null);

  // Add the first instance (becomes active).
  const a = S.addInstance({ serverPath: '/srv/Survival' });
  ok('add A ok', a.ok === true && typeof a.id === 'string' && a.id.length === 8);
  ok('add A: name = basename', a.instance.name === 'Survival');
  let list = S.listInstances();
  ok('after add A: 1 instance', list.instances.length === 1);
  ok('after add A: A is active', list.activeInstanceId === a.id);
  ok('flat view points at A', S.loadSettings().serverPath === '/srv/Survival');

  // Add a second instance (active stays A).
  const b = S.addInstance({ name: 'Creative', serverPath: '/srv/Creative' });
  ok('add B ok', b.ok === true && b.id !== a.id);
  list = S.listInstances();
  ok('after add B: 2 instances', list.instances.length === 2);
  ok('after add B: A still active', list.activeInstanceId === a.id);
  // Q2: listInstances now carries the two per-instance tunnel fields the overview table reads.
  ok('list: tunnel fields present', 'tunnelAddress' in list.instances[0] && 'autoTunnel' in list.instances[0]);
  ok('list: tunnel defaults empty/false', list.instances[0].tunnelAddress === '' && list.instances[0].autoTunnel === false);

  // Duplicate folder refused.
  const dup = S.addInstance({ serverPath: '/srv/Creative' });
  ok('duplicate folder refused', dup.ok === false);
  ok('duplicate did not add', S.listInstances().instances.length === 2);

  // Switch to B.
  const sw = S.switchInstance(b.id);
  ok('switch to B ok', sw.ok === true);
  ok('switch: active is B', S.listInstances().activeInstanceId === b.id);
  ok('switch: flat view points at B', S.loadSettings().serverPath === '/srv/Creative');
  ok('switch: unknown id refused', S.switchInstance('nope').ok === false);

  // Rename B.
  const rn = S.renameInstance(b.id, '  My Creative  ');
  ok('rename ok + trimmed', rn.ok === true && rn.name === 'My Creative');
  ok('rename persisted', S.listInstances().instances.find(i => i.id === b.id).name === 'My Creative');

  // Remove B (active) -> falls back to A.
  const rm = S.removeInstance(b.id);
  ok('remove B ok', rm.ok === true);
  ok('remove: 1 instance left', rm.instances.length === 1 && rm.instances[0].id === a.id);
  ok('remove: active falls back to A', rm.activeInstanceId === a.id);
  ok('remove persisted', S.listInstances().instances.length === 1);
  ok('remove: unknown id refused', S.removeInstance('nope').ok === false);

  // Remove the last instance -> none, active null, flat view uses defaults.
  const rmLast = S.removeInstance(a.id);
  ok('remove last ok', rmLast.ok === true);
  ok('remove last: 0 instances', S.listInstances().instances.length === 0);
  ok('remove last: active null', S.listInstances().activeInstanceId === null);
  ok('remove last: flat view safe', typeof S.loadSettings().memoryMax === 'number');

  // Persistence: a second load reads what we wrote (instance array survives a round-trip).
  S.addInstance({ serverPath: '/srv/Persist' });
  const raw = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  ok('persisted: has instances[]', Array.isArray(raw.instances) && raw.instances.length === 1);
  ok('persisted: per-instance keys inside instance', raw.instances[0].serverPath === '/srv/Persist' && 'memoryMax' in raw.instances[0]);
  ok('persisted: no flat serverPath at top', raw.serverPath === undefined);
} finally {
  fs.rmSync(userData, { recursive: true, force: true });
}
console.log(`\n${passed} passed, 0 failed`);
