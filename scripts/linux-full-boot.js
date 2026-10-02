// linux-full-boot.js — A1b: boot a REAL Minecraft server on Linux, end to end, headless.
//
// WHY this is a SCRIPT, not a tests/*.test.js: it needs ~1-2 GB RAM and ~60s+ (Java download + world
// generation), so it must NOT run in the default `npm test` matrix. It runs in the separate `linux-boot`
// CI job (workflow_dispatch + nightly). It exercises the INTEGRATED flow the unit tests cannot:
// download a real server jar -> headless boot -> server:start -> wait for `Done (` -> server:stop ->
// assert the process tree is gone. This is the last Linux gap called out in docs/v3.0.0-plan.md (A1b).
//
// The shared mechanical harness (temp env, Paper fetch, wait/stop, checker) lives in boot-harness.js.
//
// Run: node scripts/linux-full-boot.js   (Linux only; needs a JDK on PATH or an auto-installed one)
const { makeChecker, setupTempEnv, fetchPaper, waitForDone, stopAndWait, killLeftover } = require('./boot-harness.js');

const { check, state } = makeChecker();

if (process.platform !== 'linux') {
  console.log('SKIP linux-full-boot: not Linux (platform=' + process.platform + ')');
  process.exit(0);
}

const { serverDir, cleanup } = setupTempEnv('ol-fullboot-', 'fullboot');

(async () => {
  let rt = null;
  try {
    // 1) Download a real Paper jar (pinned 26.2 / JDK 25; PaperMC outage -> SKIP).
    const paper = await fetchPaper(serverDir);
    if (!paper.ok) { console.log('SKIP linux-full-boot: PaperMC is unavailable (' + paper.error + ')'); cleanup(); process.exit(0); }
    const dl = paper.dl;
    check('resolved a Paper build', !!dl && !!dl.url, JSON.stringify(dl && dl.version));
    check('downloaded the server jar', require('fs').existsSync(require('path').join(serverDir, dl.name)));

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
    const done = await waitForDone(rt.ctx);
    check('server reached running + printed Done', done, 'status=' + rt.ctx.serverStatus);

    // 4) Graceful stop, then wait for the process to be gone.
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

  console.log(state.failures ? `\n${state.failures} check(s) failed.` : '\nAll linux-full-boot checks passed.');
  process.exit(state.failures ? 1 : 0);
})();
