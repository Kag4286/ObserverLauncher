// linux-full-boot.js — A1b: boot a REAL Minecraft server on Linux, end to end, headless.
//
// WHY this is a SCRIPT, not a tests/*.test.js: it needs ~1-2 GB RAM and ~60s+ (Java download + world
// generation), so it must NOT run in the default `npm test` matrix. It runs in the separate `linux-boot`
// CI job (workflow_dispatch + nightly). It exercises the INTEGRATED flow the unit tests cannot:
// download a real server jar -> headless boot -> server:start -> wait for `Done (` -> server:stop ->
// assert the process tree is gone. This is the last Linux gap called out in docs/v3.0.0-plan.md (A1b).
//
// Run: node scripts/linux-full-boot.js   (Linux only; needs a JDK on PATH or an auto-installed one)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let failures = 0;
const check = (name, cond, detail) => cond ? console.log('PASS ' + name) : (failures++, console.log('FAIL ' + name + (detail ? ' — ' + detail : '')));
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (process.platform !== 'linux') {
  console.log('SKIP linux-full-boot: not Linux (platform=' + process.platform + ')');
  process.exit(0);
}

// Isolate ALL data + the server folder into temp dirs (never touch a real install).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-fullboot-'));
const dataDir = path.join(root, 'data');
const serverDir = path.join(root, 'server');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(serverDir, { recursive: true });
process.env.OBSERVER_DATA_DIR = dataDir;
process.env.OBSERVER_CONFIRM_MODE = 'auto-deny';

// Pre-write settings so the headless backend points at OUR server folder with autoEula on. No RCON
// port / password conflicts: pick a high port and let the app enable RCON itself.
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
  version: 4, onboarded: true, mcpEnabled: false,
  instances: [{ id: 'default', name: 'fullboot', serverPath: serverDir, autoEula: true, memoryMin: 1, memoryMax: 2, rconPort: 0, rconPassword: '' }],
  activeInstanceId: 'default',
}, null, 2));

const cleanup = () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} };

(async () => {
  let rt = null;
  try {
    // 1) Download a real Paper jar via the SAME adapter the wizard uses (no Electron needed).
    const { downloadFillProject } = require('../src/main/adapters/papermc.js');
    const { download } = require('../src/main/http.js');
    const dl = await downloadFillProject('paper', null); // newest STABLE build
    check('resolved a Paper build', !!dl && !!dl.url, JSON.stringify(dl && dl.version));
    const jarPath = path.join(serverDir, dl.name);
    await download(dl.url, jarPath, null, null, { maxBytes: 1024 * 1024 * 1024 });
    check('downloaded the server jar', fs.existsSync(jarPath) && fs.statSync(jarPath).size > 0, dl.name);

    // 2) Boot headless and start the server through the shim (the real IPC path).
    const headless = require('../src/headless.js');
    rt = headless.createHeadless();
    await headless.initHeadless(rt.ctx);
    if (!(rt.ctx.javaInfo && rt.ctx.javaInfo.ok)) {
      console.log('SKIP linux-full-boot: no usable java detected (install a JDK to run the boot)');
      try { if (rt) headless.stop(rt.ctx); } catch {}
      cleanup();
      process.exit(0);
    }
    check('java detected for boot', true);

    // server:start takes the FLAT settings view (serverPath/autoEula/memory...).
    const { loadSettings } = require('../src/main/settings.js');
    const start = await rt.shim.invoke('server:start', loadSettings());
    check('server:start accepted', start && start.ok !== false, JSON.stringify(start));

    // 3) Wait for the server to report running + print its `Done (` line.
    let done = false;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !done) {
      const buf = (rt.ctx.consoleBuffer || []).map(l => l.text || '').join('\n');
      if (/Done \(|Done in/.test(buf) && rt.ctx.serverStatus === 'running') done = true;
      else if (rt.ctx.serverStatus === 'stopped' && buf.length) break; // died early
      else await sleep(1000);
    }
    check('server reached running + printed Done', done, 'status=' + rt.ctx.serverStatus);

    // 4) Graceful stop, then wait for the process to be gone.
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
    // Best-effort: no leftover java from OUR temp dir should survive.
    try { spawnSync('pkill', ['-f', serverDir], { stdio: 'ignore' }); } catch {}
    cleanup();
  }

  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll linux-full-boot checks passed.');
  process.exit(failures ? 1 : 0);
})();
