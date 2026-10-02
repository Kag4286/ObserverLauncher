// modpack-boot-smoke.js — build a modpack.json into a real server folder, then BOOT it headless
// (v3.2.0 Phase D1). HEAVY (~1-2 GB RAM, ~60s+) so it is NOT in the default `npm test` matrix - it
// runs in a GATED CI job (label `e2e` / nightly / workflow_dispatch).
//
// WHY this is the integrated proof the unit tests cannot give: verify+build are pure/offline, but only
// a real boot proves the RESOLVED + BUILT pack actually starts a Minecraft server. It reuses the same
// headless entry point the Docker image and the CLI use, so it exercises the real path.
//
// The shared mechanical harness (temp env, Paper fetch, wait/stop, checker) lives in boot-harness.js.
//
// Run: node scripts/modpack-boot-smoke.js   (needs a JDK on PATH or an auto-installed one; Linux)
const fs = require('fs');
const path = require('path');
const { makeChecker, setupTempEnv, fetchPaper, waitForDone, stopAndWait, killLeftover } = require('./boot-harness.js');

const { check, state } = makeChecker();

if (process.platform !== 'linux') {
  console.log('SKIP modpack-boot-smoke: not Linux (platform=' + process.platform + ')');
  process.exit(0);
}

const { root, serverDir, cleanup } = setupTempEnv('ol-packsmoke-', 'packsmoke');

// A MINIMAL but valid manifest. `items: []` keeps the smoke DETERMINISTIC (no registry dependency) -
// the point here is "a built folder boots", not item resolution (which verify/build unit tests cover).
const manifest = { name: 'smoke', version: '0.0.1', minecraft: 'latest', loader: 'paper', items: [] };
const manifestPath = path.join(root, 'modpack.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

(async () => {
  let rt = null;
  try {
    // 1) Build the (empty) pack into the server folder via the CLI - exercises modpack build end to end.
    const { run } = require('../src/cli.js');
    const built = await run(['modpack', 'build', manifestPath, '--offline', '--out', serverDir, '--json'], { print: false });
    check('modpack build accepted', built && built.ok === true, JSON.stringify(built && built.result));

    // 2) Download a real Paper jar into the SAME folder (the pack has none of its own).
    const paper = await fetchPaper(serverDir);
    if (!paper.ok) { console.log('SKIP modpack-boot-smoke: PaperMC is unavailable (' + paper.error + ')'); cleanup(); process.exit(0); }
    const dl = paper.dl;
    check('resolved a Paper build', !!dl && !!dl.url, JSON.stringify(dl && dl.version));
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
    const done = await waitForDone(rt.ctx);
    check('server reached running + printed Done', done, 'status=' + rt.ctx.serverStatus);

    // 5) The stability state should have a run-start recorded (D4 wiring).
    const rec = require('../src/main/stability.js').getRecord('default');
    check('stability recorded a run start', !!rec && Number.isFinite(rec.startedAt), JSON.stringify(rec));

    // 6) Graceful stop + assert the process is gone.
    if (done) {
      const gone = await stopAndWait(rt.shim, rt.ctx);
      check('server stopped (no process left)', gone, 'status=' + rt.ctx.serverStatus);
    }
  } catch (e) {
    state.failures++;
    console.log('FAIL unexpected error — ' + (e && e.stack ? e.stack : e));
  } finally {
    try { if (rt) require('../src/headless.js').stop(rt.ctx); } catch {}
    killLeftover(serverDir);
    cleanup();
  }

  console.log(state.failures ? `\n${state.failures} check(s) failed.` : '\nAll modpack-boot-smoke checks passed.');
  process.exit(state.failures ? 1 : 0);
})();
