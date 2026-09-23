// v2.0.0 Phase A (A7 port lease + A8 cross-instance path safety).
//  A7: checkPortLease refuses a second instance on a port already leased by a running one.
//  A8: safeTarget is confined to the INSTANCE root — a path that resolves into ANOTHER
//      instance's folder must be rejected (the root is ctx.currentServerPath, per-instance).
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-port-path-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

// Two real server folders with different server-port values.
const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-srvA-'));
const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-srvB-'));
fs.writeFileSync(path.join(rootA, 'server.properties'), 'server-port=25565\n');
fs.writeFileSync(path.join(rootB, 'server.properties'), 'server-port=25565\n');

const { createContext } = require('../src/main/context.js');
const { checkPortLease } = require('../src/main/server-lifecycle.js');
const { safeTarget } = require('../src/main/fs-utils.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const ctx = createContext();
ctx.setActiveInstance('A');
ctx.instances.set('A', { serverStatus: 'stopped', serverPath: rootA });
ctx.instances.set('B', { serverStatus: 'stopped', serverPath: rootB });

// A7: B is stopped -> A can use 25565.
ok('A7: no clash while B stopped', checkPortLease(ctx, 'A', { serverPath: rootA }).block === false);
// B running on the same port -> A is blocked.
ctx.instances.get('B').serverStatus = 'running';
const clash = checkPortLease(ctx, 'A', { serverPath: rootA });
ok('A7: same-port running instance blocks', clash.block === true);
ok('A7: message mentions the clash', /port/i.test(clash.message) && /instance/i.test(clash.message));
// Give B a different port -> no clash.
fs.writeFileSync(path.join(rootB, 'server.properties'), 'server-port=25566\n');
ok('A7: different port -> no block', checkPortLease(ctx, 'A', { serverPath: rootA }).block === false);

// A8: safeTarget confined to the instance root.
ok('A8: in-root file ok', safeTarget(rootA, 'server.properties') === path.join(rootA, 'server.properties'));
ok('A8: traversal out of A rejected', safeTarget(rootA, '../' + path.basename(rootB) + '/server.properties') === null);
ok('A8: absolute B path rejected from A', safeTarget(rootA, path.join(rootB, 'server.properties')) === null);
// The per-instance root really is what callers use: ctx.currentServerPath is a PER-INSTANCE
// runtime field (set from settings by the handlers), so A and B can point at different folders.
ctx.runInInstance('A', () => { ctx.currentServerPath = rootA; });
ctx.runInInstance('B', () => { ctx.currentServerPath = rootB; });
ctx.runInInstance('A', () => { ok('A8: ctx.currentServerPath(A) = rootA', ctx.currentServerPath === rootA); });
ctx.runInInstance('B', () => { ok('A8: ctx.currentServerPath(B) = rootB', ctx.currentServerPath === rootB); });
ctx.runInInstance('A', () => { ok('A8: A cannot see B root', ctx.currentServerPath !== rootB); });

fs.rmSync(rootA, { recursive: true, force: true });
fs.rmSync(rootB, { recursive: true, force: true });
fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
