// 3.2.5 F1/F2: instances:remove safety. F2 = refuse to remove a RUNNING instance (backend guard,
// not renderer-only). F1 = when the ACTIVE instance is removed, the post-remove runtime work runs
// inside the NEW active instance's ALS scope, so it never recreates the deleted id as a ghost entry.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-rmguard-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const { registerSettings } = require('../src/main/settings-handlers.js');
const S = require('../src/main/settings.js');
const { createContext } = require('../src/main/context.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// Two real instances on disk so seedInstances/watchServerFolder have something to point at.
const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-rmA-'));
const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-rmB-'));
for (const r of [rootA, rootB]) { fs.writeFileSync(path.join(r, 'server.jar'), 'x'); fs.writeFileSync(path.join(r, 'server.properties'), 'server-port=25565\n'); }

const ctx = createContext();
const handlers = {};
const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; } };
registerSettings(fakeIpc, ctx);
const remove = handlers['instances:remove'];

(async () => {
  const a = S.addInstance({ name: 'A', serverPath: rootA });
  const b = S.addInstance({ name: 'B', serverPath: rootB });
  S.switchInstance(a.id);
  ctx.seedInstances();

  // --- F2: refuse to remove a RUNNING instance ---
  ctx.instances.get(b.id).serverStatus = 'running';
  const blocked = await remove(null, b.id);
  ok('F2: running instance refused', blocked && blocked.ok === false);
  ok('F2: refused instance still listed', S.listInstances().instances.some(i => i.id === b.id));
  ctx.instances.get(b.id).serverStatus = 'stopped';

  // --- F1: remove the ACTIVE instance -> no ghost entry, new active gets its folder ---
  // Make A active again, seed, then remove it.
  S.switchInstance(a.id); ctx.seedInstances();
  ok('setup: A active', ctx.activeInstanceId === a.id);
  const before = ctx.activeInstanceId;
  const r = await remove(null, a.id);
  ok('F1: remove active ok', r && r.ok === true);
  ok('F1: active moved to B', ctx.activeInstanceId === b.id && ctx.activeInstanceId !== before);
  ok('F1: no ghost entry for deleted id', !ctx.instances.has(a.id));
  ok('F1: map has exactly B', ctx.instances.size === 1 && ctx.instances.has(b.id));
  ok('F1: new active currentServerPath points at B', ctx.instances.get(b.id).currentServerPath === rootB);

  fs.rmSync(rootA, { recursive: true, force: true });
  fs.rmSync(rootB, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
  // watchServerFolder() opened fs.watch handles that keep the event loop alive - exit explicitly so
  // the test runner does not hang (the real app keeps them on purpose).
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
