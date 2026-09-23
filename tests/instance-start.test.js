// v2.0.0 (B5) concurrent-start foundation: serverStatus is per-instance (two instances can each
// be independently stopped/running), and checkRamBudget sums running instances' memoryMax against
// total system RAM (blocks >100%, warns >80%).
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-instance-start-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const { createContext } = require('../src/main/context.js');
const { checkRamBudget } = require('../src/main/server-lifecycle.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

(async () => {
  const ctx = createContext();
  ctx.setActiveInstance('A');

  // serverStatus is per-instance: A running does not make B running.
  await ctx.runInInstance('A', async () => { ctx.setServerStatus('running'); });
  await ctx.runInInstance('B', async () => { ok('B starts stopped (A running does not leak)', ctx.serverStatus === 'stopped'); });
  await ctx.runInInstance('A', async () => { ok('A still running', ctx.serverStatus === 'running'); });
  await ctx.runInInstance('B', async () => { ctx.setServerStatus('starting'); });
  await ctx.runInInstance('A', async () => { ok('A unaffected by B starting', ctx.serverStatus === 'running'); });
  ok('A stored separately', ctx.instances.get('A').serverStatus === 'running');
  ok('B stored separately', ctx.instances.get('B').serverStatus === 'starting');

  // waitingForDone + runtimeInstanceId are per-instance too.
  await ctx.runInInstance('A', async () => { ctx.waitingForDone = true; ctx.runtimeInstanceId = 'A'; });
  await ctx.runInInstance('B', async () => { ok('B waitingForDone independent', ctx.waitingForDone === false); });
  ok('A runtimeInstanceId set', ctx.instances.get('A').runtimeInstanceId === 'A');

  // checkRamBudget: mock instances. Use a fake total via a huge memoryMax to force block.
  const totalGB = os.totalmem() / (1024 ** 3);
  const c2 = createContext();
  c2.setActiveInstance('X');
  c2.instances.set('X', { serverStatus: 'stopped', memoryMax: 2 });
  c2.instances.set('Y', { serverStatus: 'running', memoryMax: 4 });
  const small = checkRamBudget(c2, 'X', { memoryMax: 2 });
  ok('small request not blocked', small.block === false);

  // A request larger than total RAM must block.
  const huge = checkRamBudget(c2, 'X', { memoryMax: Math.ceil(totalGB) + 64 });
  ok('over-RAM request blocked', huge.block === true);
  ok('block message mentions RAM', /RAM/i.test(huge.message));

  // >80% of total (but <100%) warns, not blocks.
  const c3 = createContext();
  c3.setActiveInstance('X');
  c3.instances.set('X', { serverStatus: 'stopped' });
  const nearlyFull = checkRamBudget(c3, 'X', { memoryMax: Math.floor(totalGB * 0.85) });
  if (totalGB > 4) { ok('85% request warns', nearlyFull.warn === true && nearlyFull.block === false); }

  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
