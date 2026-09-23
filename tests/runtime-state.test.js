// v2.0.0 (M3) runtime-state: per-instance process identity persisted to
// userData/runtime.json so orphan cleanup survives an app crash. Pure file ops.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-runtime-state-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const rs = require('../src/main/runtime-state.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// no file yet -> empty
ok('empty: getInstanceProcess -> null', rs.getInstanceProcess('default') === null);
ok('empty: list -> []', Array.isArray(rs.listInstanceProcesses()) && rs.listInstanceProcesses().length === 0);

// set then read back
rs.setInstanceProcess('default', { pid: 4242, processStartedAt: 1700000000000, serverPath: '/srv/a' });
const got = rs.getInstanceProcess('default');
ok('set: pid stored', got && got.pid === 4242);
ok('set: startedAt stored', got && got.processStartedAt === 1700000000000);
ok('set: serverPath stored', got && got.serverPath === '/srv/a');
ok('set: updatedAt number', got && Number.isFinite(got.updatedAt));

// persistence: a FRESH module view reads the same file
const raw = JSON.parse(fs.readFileSync(rs.runtimePath(), 'utf8'));
ok('file on disk has the process', raw.processes.default.pid === 4242);

// second instance
rs.setInstanceProcess('abc123', { pid: 7, processStartedAt: 5, serverPath: '/srv/b' });
ok('two instances listed', rs.listInstanceProcesses().length === 2);

// clear one -> the other survives
rs.clearInstanceProcess('default');
ok('cleared -> null', rs.getInstanceProcess('default') === null);
ok('other instance kept', rs.getInstanceProcess('abc123').pid === 7);

// no-pid write is ignored (never persist a half spawn)
rs.setInstanceProcess('x', { pid: null });
ok('no-pid ignored', rs.getInstanceProcess('x') === null);

// missing instanceId falls back to default
rs.setInstanceProcess(undefined, { pid: 99, processStartedAt: 1, serverPath: '' });
ok('undefined id -> default key', rs.getInstanceProcess('default').pid === 99);

// M8: setInstanceStatus records the last status on the existing record (no-op if absent).
rs.setInstanceStatus('default', 'running');
ok('status set on record', rs.getInstanceProcess('default').status === 'running');
rs.setInstanceStatus('missing-id', 'running');
ok('status no-op for unknown id', rs.getInstanceProcess('missing-id') === null);

fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
process.exit(0);
