// v6.0.0 E2: Start-all / Stop-all decision helpers. Pure functions only, no DOM, no spawn.
const assert = require('assert');
const B = require('../src/main/bulk-instances.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// statusOf from a plain map.
const mk = (m) => (id) => m[id];

// --- planStartAll ---
{
  const r = B.planStartAll([], mk({}));
  ok('start empty list -> nothing', r.start.length === 0 && r.skip.length === 0);
}
{
  const r = B.planStartAll([{ id: 'a', serverPath: '/x' }], mk({ a: 'stopped' }));
  ok('start one stopped -> start', r.start.length === 1 && r.start[0] === 'a');
}
{
  const r = B.planStartAll([{ id: 'a', serverPath: '/x' }], mk({ a: 'running' }));
  ok('start running -> skipped running', r.start.length === 0 && r.skip[0].reason === 'running');
}
{
  const r = B.planStartAll([{ id: 'a', serverPath: '/x' }], mk({ a: 'starting' }));
  ok('start starting -> skipped starting', r.start.length === 0 && r.skip[0].reason === 'starting');
}
{
  const r = B.planStartAll([{ id: 'a', serverPath: '/x' }], mk({ a: 'stopping' }));
  ok('start stopping -> skipped stopping', r.start.length === 0 && r.skip[0].reason === 'stopping');
}
{
  const r = B.planStartAll([{ id: 'a', serverPath: '/x', missing: true }], mk({ a: 'stopped' }));
  ok('start missing -> skipped missing', r.start.length === 0 && r.skip[0].reason === 'missing');
}
{
  const r = B.planStartAll([{ id: 'a', serverPath: '' }], mk({ a: 'stopped' }));
  ok('start no path -> skipped no-path', r.start.length === 0 && r.skip[0].reason === 'no-path');
}
{
  // Mixed: preserves list order.
  const r = B.planStartAll(
    [{ id: 'a', serverPath: '/x' }, { id: 'b', serverPath: '/y' }, { id: 'c', serverPath: '/z' }],
    mk({ a: 'running', b: 'stopped', c: 'stopped' })
  );
  ok('start mixed -> start order preserved', r.start.length === 2 && r.start[0] === 'b' && r.start[1] === 'c');
  ok('start mixed -> skip running', r.skip.length === 1 && r.skip[0].id === 'a');
}
{
  // Entry with no id is dropped silently, never crashed on.
  const r = B.planStartAll([null, { }, { id: 'a', serverPath: '/x' }], mk({ a: 'stopped' }));
  ok('start drops invalid entries', r.start.length === 1 && r.start[0] === 'a');
}

// --- planStopAll ---
{
  const r = B.planStopAll([], mk({}));
  ok('stop empty list -> nothing', r.stop.length === 0 && r.skip.length === 0);
}
{
  const r = B.planStopAll([{ id: 'a' }], mk({ a: 'running' }));
  ok('stop running -> stop', r.stop.length === 1 && r.stop[0] === 'a');
}
{
  const r = B.planStopAll([{ id: 'a' }], mk({ a: 'stopped' }));
  ok('stop stopped -> skipped stopped', r.stop.length === 0 && r.skip[0].reason === 'stopped');
}
{
  const r = B.planStopAll([{ id: 'a' }], mk({ a: 'stopping' }));
  ok('stop stopping -> skipped stopping', r.stop.length === 0 && r.skip[0].reason === 'stopping');
}
{
  const r = B.planStopAll([{ id: 'a' }], mk({ a: 'starting' }));
  ok('stop starting -> stop (a started but not yet running server still needs stopping)', r.stop.length === 1 && r.stop[0] === 'a');
}
{
  const r = B.planStopAll([{ id: 'a' }, { id: 'b' }], mk({ a: 'running', b: 'stopped' }));
  ok('stop mixed -> stop only running', r.stop.length === 1 && r.stop[0] === 'a');
}

// --- integration shape guard ---
// listInstances() returns { instances, activeInstanceId }, NOT a bare array. The IPC handler must
// pass .instances; passing the object makes planStartAll/planStopAll silently see an empty list
// (Array.isArray(object) === false) and report 'nothing to do'. Assert the handler unwraps it.
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'settings-handlers.js'), 'utf8');
  ok('start-all unwraps listInstances().instances', /planStartAll\(listInstances\(\)\.instances\b/.test(src));
  ok('stop-all unwraps listInstances().instances', /planStopAll\(listInstances\(\)\.instances\b/.test(src));
  ok('start-all does NOT pass the wrapper object', !/planStartAll\(listInstances\(\)\s*,/.test(src));
  ok('stop-all does NOT pass the wrapper object', !/planStopAll\(listInstances\(\)\s*,/.test(src));
}

console.log(`\n${passed} passed, 0 failed`);
