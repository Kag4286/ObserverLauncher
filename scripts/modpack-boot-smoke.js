// modpack-boot-smoke.js — build a modpack.json into a real server folder, then BOOT it headless
// (v3.2.0 Phase D1). HEAVY (~1-2 GB RAM, ~60s+) so it is NOT in the default `npm test` matrix - it
// runs in a GATED CI job (label `e2e` / nightly / workflow_dispatch).
//
// WHY this is the integrated proof the unit tests cannot give: verify+build are pure/offline, but only
// a real boot proves the RESOLVED + BUILT pack actually starts a Minecraft server. It reuses the same
// headless entry point the Docker image and the CLI use, so it exercises the real path.
//
// Run: node scripts/modpack-boot-smoke.js   (needs a JDK on PATH or an auto-installed one; Linux)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let failures = 0;
const check = (name, cond, detail) => cond ? console.log('PASS ' + name) : (failures++, console.log('FAIL ' + name + (detail ? ' — ' + detail : '')));
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (process.platform !== 'linux') {
  console.log('SKIP modpack-boot-smoke: not Linux (platform=' + process.platform + ')');
  process.exit(0);
}

// Isolate ALL data + the server folder into temp dirs (never touch a real install).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-packsmoke-'));
const dataDir = path.join(root, 'data');
const serverDir = path.join(root, 'server');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(serverDir, { recursive: true });
process.env.OBSERVER_DATA_DIR = dataDir;
process.env.OBSERVER_CONFIRM_MODE = 'auto-deny';

fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
  version: 4, onboarded: true, mcpEnabled: false,
  instances: [{ id: 'default', name: 'packsmoke', serverPath: serverDir, autoEula: true, memoryMin: 1, memoryMax: 2, rconPort: 0, rconPassword: '' }],
  activeInstanceId: 'default',
}, null, 2));

// A MINIMAL but valid manifest. `items: []` keeps the smoke DETERMINISTIC (no registry dependency) -
// the point here is "a built folder boots", not item resolution (which verify/build unit tests cover).
const manifest = {
  name: 'smoke', version: '0.0.1', minecraft: 'latest', loader: 'paper', items: [],
};
const manifestPath = path.join(root, 'modpack.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const cleanup = () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} };

(async () => {
  let rt = null;
  try {
    // 1) Build the (empty) pack into the server folder via the CLI - exercises modpack build end to end.
    const { run } = require('../src/cli.js');
    const built = await run(['modpack', 'build', manifestPath, '--offline', '--out', serverDir, '--json'], { print: false });
    check('modpack build accepted', built && built.ok === true, JSON.stringify(built && built.result));

    // 2) Download a real Paper jar into the SAME folder (the pack has none of its own).
    const { downloadFillProject } = require('../src/main/adapters/papermc.js');
    const { download } = require('../src/main/http.js');
    const dl = await downloadFillProject('paper', null);
    check('resolved a Paper build', !!dl && !!dl.url, JSON.stringify(dl && dl.version));
    await download(dl.url, path.join(serverDir, dl.name), null, null, { maxBytes: 1024 * 1024 * 1024 });
    check('downloaded the server jar', fs.existsSync(path.join(serverDir, dl.name)));

    // 3) Boot headless and start through the shim (the real IPC path).
    const headless = require('../src/headless.js');
    rt = headless.createHeadless();
    await headless.initHeadless(rt.ctx);
    if (!(rt.ctx.javaInfo && rt.ctx.javaInfo.ok)) {
      console.log('SKIP modpack-boot-smoke: no usable java detected');
      try { if (rt) headless.stop(rt.ctx); } catch {}
      cleanup();
      process.exit(0);
    }
    const { loadSettings } = require('../src/main/settings.js');
    const start = await rt.shim.invoke('server:start', loadSettings());
    check('server:start accepted', start && start.ok !== false, JSON.stringify(start));

    // 4) Wait for `Done (` + running.
    let done = false;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !done) {
      const buf = (rt.ctx.consoleBuffer || []).map(l => l.text || '').join('\n');
      if (/Done \(|Done in/.test(buf) && rt.ctx.serverStatus === 'running') done = true;
      else if (rt.ctx.serverStatus === 'stopped' && buf.length) break;
      else await sleep(1000);
    }
    check('server reached running + printed Done', done, 'status=' + rt.ctx.serverStatus);

    // 5) The stability state should have a run-start recorded (D4 wiring).
    const rec = require('../src/main/stability.js').getRecord('default');
    check('stability recorded a run start', !!rec && Number.isFinite(rec.startedAt), JSON.stringify(rec));

    // 6) Graceful stop + assert the process is gone.
    if (done) {
      await rt.shim.invoke('server:stop');
      const stopDeadline = Date.now() + 60000;
      while (Date.now() < stopDeadline && rt.ctx.serverProcess) await sleep(1000);
      check('server stopped (no process left)', !rt.ctx.serverProcess, 'status=' + rt.ctx.serverStatus);
    }
  } catch (e) {
    failures++;
    console.log('FAIL unexpected error — ' + (e && e.stack ? e.stack : e));
  } finally {
    try { if (rt) require('../src/headless.js').stop(rt.ctx); } catch {}
    try { spawnSync('pkill', ['-f', serverDir], { stdio: 'ignore' }); } catch {}
    cleanup();
  }

  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll modpack-boot-smoke checks passed.');
  process.exit(failures ? 1 : 0);
})();
