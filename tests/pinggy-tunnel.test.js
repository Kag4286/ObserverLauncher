// v6.0.0 A2.3: regression tests for pinggy-tunnel.js after the A2 review fixes.
// Covers: (1) a child that exits while 'starting' must become 'error', not hang on 'starting'
// (the reported "stuck starting" bug); (2) stopAllPinggy reaches every instance's child on quit;
// (3) startPinggy does NOT clobber the Playit tunnelAddress field; (4) a valid start stores the
// udp:// address on ctx.pinggyAddress. Uses a real createContext (electron mocked) and a fake spawn.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-pg-tunnel-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const { createContext } = require('../src/main/context.js');
const P = require('../src/main/pinggy.js');
const PT = require('../src/main/pinggy-tunnel.js');
const { loadSettingsFor, saveSettingsFor } = require('../src/main/settings.js');
const { EventEmitter } = require('events');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// Fake spawn: returns a controllable EventEmitter child + an addressPromise we resolve/reject.
function installFakeSpawn() {
  const real = { spawnPinggy: P.spawnPinggy, findSshBinary: P.findSshBinary };
  P.findSshBinary = () => 'ssh';
  let last = null;
  P.spawnPinggy = () => {
    const child = new EventEmitter();
    child.pid = 7000 + Math.floor(Math.random() * 1000);
    child.killed = false;
    child.kill = () => { child.killed = true; };
    let resolveAddr;
    const addressPromise = new Promise(r => { resolveAddr = r; });
    last = { child, resolveAddr };
    return { ok: true, child, addressPromise };
  };
  return { real, last: () => last };
}
function restore({ real }) { P.spawnPinggy = real.spawnPinggy; P.findSshBinary = real.findSshBinary; }

(async () => {
  // --- 1. STUCK STARTING FIX: child exits while 'starting' -> status becomes 'error' ---
  {
    const fake = installFakeSpawn();
    const ctx = createContext();
    ctx.activeInstanceId = 'A';
    const startPromise = ctx.runInInstance('A', () => PT.startPinggy(ctx, 'udp'));
    // While starting, simulate ssh exiting before any address arrives.
    await new Promise(r => setTimeout(r, 20));
    const f = fake.last();
    ok('starting: spawn happened', !!f);
    // emit exit; the addressPromise never resolves, so startPinggy waits; but the exit handler
    // must flip status away from 'starting'.
    f.child.emit('exit', 255);
    await new Promise(r => setTimeout(r, 20));
    let status;
    ctx.runInInstance('A', () => { status = ctx.pinggyStatus; });
    ok('starting->error on premature exit (not stuck on starting)', status === 'error');
    // Clean up: resolve the address promise so startPinggy returns.
    f.resolveAddr({ ok: false, error: 'gone' });
    await startPromise.catch(() => {});
    restore(fake);
    ctx.runInInstance('A', () => PT.stopPinggy(ctx));
  }

  // --- 2. VALID START stores udp:// on ctx.pinggyAddress; does NOT touch tunnelAddress ---
  {
    const fake = installFakeSpawn();
    const ctx = createContext();
    ctx.activeInstanceId = 'B';
    // Seed a Playit tunnelAddress for B so we can prove it is untouched.
    try { const s = loadSettingsFor('B'); s.tunnelAddress = 'survival.tun.ply.gg'; saveSettingsFor('B', s); } catch {}
    const p = ctx.runInInstance('B', () => PT.startPinggy(ctx, 'udp'));
    await new Promise(r => setTimeout(r, 20));
    const f = fake.last();
    f.resolveAddr({ ok: true, address: { proto: 'udp', host: 'bg.run.pinggy-free.link', port: 30099 }, raw: '' });
    const res = await p;
    ok('valid start: ok + address', res.ok === true && /^udp:\/\/bg\.run\.pinggy-free\.link:30099$/.test(res.address));
    let addr;
    ctx.runInInstance('B', () => { addr = ctx.pinggyAddress; });
    ok('valid start: ctx.pinggyAddress set', addr === 'udp://bg.run.pinggy-free.link:30099');
    // BUG 3 fix: the Playit tunnelAddress for B must still be the Java address.
    const persisted = (() => { try { return loadSettingsFor('B').tunnelAddress || ''; } catch { return ''; } })();
    ok('valid start: Playit tunnelAddress NOT clobbered', persisted === 'survival.tun.ply.gg');
    restore(fake);
    ctx.runInInstance('B', () => PT.stopPinggy(ctx));
  }

  // --- 3. stopAllPinggy kills every instance's child (BUG 2 fix) ---
  {
    const fake = installFakeSpawn();
    const ctx = createContext();
    ctx.activeInstanceId = 'X';
    const children = [];
    for (const id of ['X', 'Y']) {
      const p = ctx.runInInstance(id, () => PT.startPinggy(ctx, 'udp'));
      await new Promise(r => setTimeout(r, 20));
      const f = fake.last();
      children.push(f.child);
      f.resolveAddr({ ok: true, address: { proto: 'udp', host: `${id}.run.pinggy-free.link`, port: 3000 + children.length }, raw: '' });
      await p;
    }
    ok('two tunnels running', children.length === 2 && children.every(c => !c.killed));
    PT.stopAllPinggy(ctx);
    ok('stopAllPinggy killed instance X child', children[0].killed === true);
    ok('stopAllPinggy killed instance Y child', children[1].killed === true);
    restore(fake);
  }

  // --- 4. GATED_CHANNELS includes pinggy:status (BUG 5 fix) ---
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'context.js'), 'utf8');
    const m = src.match(/GATED_CHANNELS = new Set\(\[([^\]]+)\]\)/);
    ok('GATED_CHANNELS present', !!m);
    ok("GATED_CHANNELS includes 'pinggy:status'", !!m && /'pinggy:status'/.test(m[1]));
  }

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
