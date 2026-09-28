// headless.test.js — proves the backend boots with NO Electron (v3.0.0 Phase B3).
//
// WHY: headless.js is the new no-window entry point. If any module it requires still had a top-level
// `require('electron')`, this plain-Node require would throw. So simply requiring + booting it here
// is the strongest smoke test that B1+B2+B3 actually de-Electroned the backend. It also checks the
// shim exposed the core IPC channels and that settings:get runs, and that GUI confirm stays absent
// (headless write/destroy must auto-deny, never hang).
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

// Isolate: point the data dir at a throwaway temp folder BEFORE the backend reads it.
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-headless-'));
process.env.OBSERVER_DATA_DIR = tmpData;

(async () => {
  let headless;
  try {
    headless = require('../src/headless.js');
  } catch (e) {
    fail++;
    console.log('FAIL require(src/headless.js) threw — backend not headless yet:\n' + (e && e.stack ? e.stack : e));
    console.log(`\n${fail} check(s) failed.`);
    process.exit(1);
  }
  check('require(headless.js) does not throw in plain Node', true);

  let rt;
  try {
    rt = headless.createHeadless();
    check('createHeadless returns ctx + shim', !!rt.ctx && !!rt.shim && typeof rt.shim.invoke === 'function');
  } catch (e) {
    fail++;
    console.log('FAIL createHeadless threw: ' + (e && e.stack ? e.stack : e));
    console.log(`\n${fail} check(s) failed.`);
    process.exit(1);
  }

  // Core channels every feature module should have registered.
  const channels = rt.shim.listChannels();
  for (const ch of ['settings:get', 'settings:save', 'server:start', 'server:stop', 'backup:create', 'instances:list', 'files:get']) {
    check('channel registered: ' + ch, channels.includes(ch));
  }
  check('registered a healthy number of channels', channels.length >= 30, 'got ' + channels.length);

  // B7: every preload `invoke` channel must be registered headless TOO, except the GUI-only
  // app:* update channels (setupAutoUpdater is never registered without a window). This catches a
  // feature module that silently skips registration headless. Channels are parsed from preload.js.
  {
    const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
    const invokeChannels = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\(\s*'([\w:.-]+)'/g)].map(m => m[1]))];
    const GUI_ONLY = new Set(['app:check-update', 'app:download-update', 'app:quit-install']);
    const missing = invokeChannels.filter(ch => !GUI_ONLY.has(ch) && !channels.includes(ch));
    check(`all ${invokeChannels.length} preload invoke channels registered headless (minus app:*)`, missing.length === 0, 'missing: ' + missing.join(', '));
  }

  // initHeadless must run without Electron and without throwing.
  try {
    await headless.initHeadless(rt.ctx);
    check('initHeadless ran without throwing', true);
  } catch (e) {
    fail++;
    console.log('FAIL initHeadless threw: ' + (e && e.stack ? e.stack : e));
  }

  // A real IPC call works headless (settings:get is the first thing the renderer calls at boot).
  const sg = await rt.shim.invoke('settings:get');
  check('invoke(settings:get) returns a snapshot', sg && typeof sg === 'object' && !!sg.settings, JSON.stringify(sg && Object.keys(sg)));

  // B7: dataDir honours OBSERVER_DATA_DIR (the headless/CLI/Docker override).
  {
    const { dataDir } = require('../src/main/data-dir.js');
    check('dataDir honours OBSERVER_DATA_DIR', dataDir() === tmpData, dataDir());
  }

  // B7: a write tool call with no window returns a CLEAN policy error (not a 60s hang / crash).
  {
    const { callTool } = require('../src/mcp/server.js');
    const t0 = Date.now();
    const r = await callTool(rt.ctx, 'stop_server', {}, { autoAllowWrite: false, readOnly: false });
    check('write/destroy tool denied cleanly headless', r && r.ok === false, JSON.stringify(r));
    check('denial is fast (no 60s timer)', Date.now() - t0 < 2000, String(Date.now() - t0));
  }

  // Headless has NO GUI confirm -> server.js confirmOnGui auto-denies.
  check('ctx.onMcpConfirm stays undefined (GUI confirm not registered)', rt.ctx.onMcpConfirm === undefined || rt.ctx.onMcpConfirm === null);

  // Full program boot path (what `node src/headless.js` runs): start() = createHeadless + initHeadless
  // + MCP-if-enabled. mcpEnabled defaults false, so no port opens here — proves the whole boot
  // sequence works in-process without Electron.
  try {
    const rt2 = await headless.start();
    check('start() boots the full runtime', !!rt2.ctx && rt2.shim.listChannels().length >= 30);
    headless.stop(rt2.ctx);
  } catch (e) {
    fail++;
    console.log('FAIL start() threw: ' + (e && e.stack ? e.stack : e));
  }

  // stop() must be safe when nothing is running.
  let stopThrew = null;
  try { headless.stop(rt.ctx); } catch (e) { stopThrew = e; }
  check('stop() is safe with nothing running', !stopThrew, stopThrew && stopThrew.message);

  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
  console.log(fail ? `\n${fail} check(s) failed.` : `\nAll headless checks passed (${pass}).`);
  process.exit(fail ? 1 : 0);
})();
