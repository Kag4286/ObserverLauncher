// v2.0.0 (M4a) instance context: AsyncLocalStorage-backed ctx.inst(). The whole
// point is that the CURRENT instance travels with the async call chain, so two
// concurrent handlers cannot leak their instance id into each other.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-instance-ctx-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const { createContext } = require('../src/main/context.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const ctx = createContext();

  // Defaults before any seeding.
  ok('fresh ctx: instances is a Map', ctx.instances instanceof Map);
  ok('fresh ctx: inst() falls back to default', ctx.inst() === 'default');

  // setActiveInstance changes the fallback.
  ctx.setActiveInstance('A');
  ok('active A -> inst() A', ctx.inst() === 'A');

  // ALS isolation: two interleaved chains keep their own id.
  const got = {};
  await Promise.all([
    ctx.runInInstance('A', async () => { await sleep(15); got.A1 = ctx.inst(); await sleep(5); got.A2 = ctx.inst(); }),
    ctx.runInInstance('B', async () => { await sleep(5); got.B1 = ctx.inst(); await sleep(15); got.B2 = ctx.inst(); }),
  ]);
  ok('chain A stays A (first read)', got.A1 === 'A');
  ok('chain A stays A (after awaits)', got.A2 === 'A');
  ok('chain B stays B (first read)', got.B1 === 'B');
  ok('chain B stays B (after awaits)', got.B2 === 'B');

  // Outside any als.run, inst() falls back to the active id.
  ok('outside als -> active id', ctx.inst() === 'A');

  // runInInstance with no id -> 'default'.
  let dflt;
  await ctx.runInInstance(undefined, async () => { dflt = ctx.inst(); });
  ok('runInInstance(undefined) -> default', dflt === 'default');

  // seedInstances reads a real v4 store.
  const settingsPath = path.join(userData, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({
    version: 4,
    instances: [
      { id: 'default', name: 'Survival', serverPath: '/srv/a', memoryMax: 4 },
      { id: 'b2c3d4e5', name: 'Creative', serverPath: '/srv/b', memoryMax: 8 },
    ],
    activeInstanceId: 'b2c3d4e5',
    locale: 'en', mcpEnabled: false,
  }, null, 2));
  const active = ctx.seedInstances();
  ok('seed: returns active id', active === 'b2c3d4e5');
  ok('seed: map has 2 instances', ctx.instances.size === 2);
  ok('seed: instance data copied', ctx.instances.get('default').name === 'Survival');
  ok('seed: active id set', ctx.activeInstanceId === 'b2c3d4e5');
  ok('seed: inst() returns seeded active', ctx.inst() === 'b2c3d4e5');

  // Re-seed is idempotent (boot + settings change both call it).
  ctx.seedInstances();
  ok('re-seed: still 2 instances', ctx.instances.size === 2);

  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
