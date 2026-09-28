// ipc-shim.test.js — guards the headless ipcMain shim (v3.0.0 Phase B2).
//
// WHY: headless has no Electron ipcMain, so feature modules register against a fake one. This test
// proves the shim exposes the backend API the same way Electron does, AND that it reproduces the
// ALS pinning main.js's Proxy applies (every handler runs inside runInInstance(activeInstanceId)) —
// the property that keeps multi-instance state from leaking.
const { createContext } = require('../src/main/context.js');
const { createIpcShim } = require('../src/main/ipc-shim.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

(async () => {
  const ctx = createContext();
  ctx.seedInstances(); // establishes activeInstanceId ('default' on a fresh store)
  const { ipcMain, invoke, emit, listChannels } = createIpcShim(ctx);

  // 1) handle + invoke round-trip (with an arg).
  ipcMain.handle('demo:add', async (_e, a, b) => ({ ok: true, sum: a + b }));
  const r = await invoke('demo:add', 2, 3);
  check('invoke returns handler result', r && r.ok === true && r.sum === 5, JSON.stringify(r));
  check('listChannels includes registered channel', listChannels().includes('demo:add'));

  // 2) unknown channel -> clean {ok:false}, never a throw.
  const u = await invoke('nope:missing');
  check('unknown channel -> {ok:false}', u && u.ok === false && /unknown channel/.test(u.error), JSON.stringify(u));

  // 3) duplicate channel is a programming error (matches Electron).
  let threw = false;
  try { ipcMain.handle('demo:add', async () => ({})); } catch { threw = true; }
  check('duplicate handle throws', threw);

  // 4) handler that throws -> invoke surfaces {ok:false}, does not reject.
  ipcMain.handle('demo:boom', async () => { throw new Error('kaboom'); });
  const b = await invoke('demo:boom');
  check('throwing handler -> {ok:false}', b && b.ok === false && /kaboom/.test(b.error), JSON.stringify(b));

  // 5) ALS parity: handler sees the ACTIVE instance's per-instance state.
  ctx.activeInstanceId = 'A';
  ctx.runInInstance('A', () => { ctx.currentServerPath = 'C:/server-A'; });
  ctx.activeInstanceId = 'B';
  ctx.runInInstance('B', () => { ctx.currentServerPath = 'C:/server-B'; });
  // The shim pins to activeInstanceId at call time -> B.
  ipcMain.handle('demo:path', async () => ({ ok: true, path: ctx.currentServerPath }));
  const p = await invoke('demo:path');
  check('invoke runs inside runInInstance(active)', p && p.path === 'C:/server-B', JSON.stringify(p));

  // 6) on() + emit() fire listeners (used by mcp-confirm / orphan-prompt).
  let got = null;
  ipcMain.on('demo:event', (_e, payload) => { got = payload; });
  await emit('demo:event', { hello: 'world' });
  check('emit fires on() listeners', got && got.hello === 'world', JSON.stringify(got));

  // 7) removeHandler / removeAllListeners
  ipcMain.removeHandler('demo:add');
  check('removeHandler drops channel', !listChannels().includes('demo:add'));

  console.log(fail ? `\n${fail} check(s) failed.` : `\nAll ipc-shim checks passed (${pass}).`);
  process.exit(fail ? 1 : 0);
})();
