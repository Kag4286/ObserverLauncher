// App window lifecycle + auto-update + graceful quit (extracted from main.js).
const path = require('path');
const { app, BrowserWindow, protocol } = require('electron');
const { killTree } = require('./kill.js');
const { loadSettings } = require('./settings.js');
const { detectJava } = require('./java.js');
const { serverFiles } = require('./server-files.js');
const { startMetrics } = require('./server-lifecycle.js');
const { startAutoBackupWatcher } = require('./backups.js');
const { startScheduler } = require('./scheduler.js');
const { cleanOrphanTmp } = require('./fs-utils.js');
const textures = require('./textures');

async function createWindow(ctx) {
  if (process.platform === 'win32') app.setAppUserModelId('dev.observerlauncher.minecraftservercontrol');
  const winOpts = {
    width: 1480, height: 930, minWidth: 1080, minHeight: 720,
    backgroundColor: '#08090a',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icons', 'observer.png'),
    // 2.4.0 (perf): backgroundThrottling lets Chromium throttle timers/rAF when the window is
    // hidden, cutting renderer CPU while the app sits in the tray. The live charts keep updating
    // because they are driven by IPC pushes, not rAF.
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true }
  };
  if (process.platform === 'win32') Object.assign(winOpts, { titleBarStyle: 'hidden', titleBarOverlay: { color: '#08090a', symbolColor: '#e9edf0', height: 42 } });
  ctx.win = new BrowserWindow(winOpts);
  // SECURITY: the renderer must never navigate away from the local UI, and no
  // window.open() should ever create a real window. Without this, a stray link
  // or injected markup could replace the app with a remote page.
  ctx.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ctx.win.webContents.on('will-navigate', (e, url) => { if (!String(url).startsWith('file://')) e.preventDefault(); });
  await ctx.win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// v6.0.0 H4: resolve the update policy from a settings object. Falls back to the old
// `autoCheckUpdates` boolean ONCE so an existing profile is not lost: true -> 'ask', false -> 'off'.
// Pure + exported so a test can pin it without electron-updater.
const UPDATE_POLICIES = ['auto', 'ask', 'off'];
function updatePolicyOf(settings) {
  const s = settings || {};
  if (UPDATE_POLICIES.includes(s.updatePolicy)) return s.updatePolicy;
  if (s.autoCheckUpdates === false) return 'off';
  return 'ask';
}

function setupAutoUpdater(ctx, ipcMain) {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  const policy = (() => { try { return updatePolicyOf(loadSettings()); } catch { return 'ask'; } })();
  autoUpdater.on('update-available', v => {
    ctx.send('app:update-available', v);
    // 'auto' downloads the update as soon as it is known; 'ask'/'off' wait for the user.
    if (policy === 'auto') { try { autoUpdater.downloadUpdate().catch(() => {}); } catch {} }
  });
  autoUpdater.on('update-not-available', () => ctx.send('app:update-none', {}));
  autoUpdater.on('download-progress', p => ctx.send('app:update-progress', p));
  autoUpdater.on('update-downloaded', () => ctx.send('app:update-downloaded', {}));
  // BUGFIX: no error handler meant a failed check/download (offline, 404 asset, bad signature)
  // silently did nothing — the button stayed on "Checking…" forever. Surface it to the renderer.
  autoUpdater.on('error', err => ctx.send('app:update-error', { message: err?.message || String(err) }));
  // Only check automatically when actually packaged — electron-updater has no app-update.yml in dev.
  // 'off' skips the startup check entirely; the manual button still works either way.
  if (app.isPackaged && policy !== 'off') autoUpdater.checkForUpdates().catch(err => ctx.send('app:update-error', { message: err?.message || String(err) }));

  // Every handler resolves {ok:false} instead of rejecting, so the renderer's await never throws
  // an unhandled rejection and the UI can always show a reason.
  const guard = fn => async (...args) => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only available in the installed build.' };
    try { return { ok: true, result: await fn(...args) }; }
    catch (err) { const message = err?.message || String(err); ctx.send('app:update-error', { message }); return { ok: false, error: message }; }
  };
  ipcMain.handle('app:check-update', guard(() => autoUpdater.checkForUpdates()));
  ipcMain.handle('app:download-update', guard(() => autoUpdater.downloadUpdate()));
  ipcMain.handle('app:quit-install', async () => {
    try {
      // BUGFIX (2.5.0): quitAndInstall() triggers an app quit -> before-quit. setupQuitHandler
      // preventDefault()s that event while a server is running (to let the world save), which can
      // leave the NSIS installer half-triggered / the update not applied. So STOP the server FIRST
      // and wait for the process to exit, then install with a clean quit path.
      if (ctx.serverProcess && ctx.serverStatus !== 'stopped') {
        ctx.manualStop = true;               // the exit handler must not auto-restart
        try { clearTimeout(ctx.restartTimer); } catch {}
        try { const { sendConsoleCommand } = require('./server-lifecycle.js'); await sendConsoleCommand(ctx, 'stop'); }
        catch { try { if (ctx.serverProcess?.stdin?.writable) ctx.serverProcess.stdin.write('stop\r\n'); } catch {} }
        const deadline = Date.now() + 30000;
        while (ctx.serverProcess && Date.now() < deadline) await new Promise(r => setTimeout(r, 300));
        // Still alive after 30s -> force-kill so the installer can proceed (world may not be fully saved).
        if (ctx.serverProcess) { try { require('./kill.js').killTree(ctx.serverProcess.pid); } catch {} await new Promise(r => setTimeout(r, 500)); }
      }
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });
}

function setupQuitHandler(ctx) {
  let quitHandled = false;
  // v6.0.0 FIX (process leak): collect the pids to stop for EVERY instance, not just the active one.
  // A background instance's java, or a detached java whose cmd.exe is gone, must be killed on quit or
  // it survives the launcher. Returns [{ id, serverPid, extraPids[] }] inside the instance's ALS scope.
  const gatherRunningInstances = () => {
    const out = [];
    let ids = [];
    try { ids = [...ctx.instances.keys()]; } catch {}
    // Always include the active instance even if it is not in the map yet.
    const active = ctx.activeInstanceId || 'default';
    if (!ids.includes(active)) ids.push(active);
    for (const id of ids) {
      try {
        ctx.runInInstance(id, () => {
          const proc = ctx.serverProcess;
          const build = ctx.buildProcess;
          if (!proc && !build) return;
          const extra = [];
          if (ctx.monitoredPid) extra.push(ctx.monitoredPid);
          // The runtime record may carry a detached java pid the in-memory handle never saw.
          try {
            const rec = require('./runtime-state.js').getInstanceProcess(id);
            if (rec && rec.javaPid) extra.push(rec.javaPid);
          } catch {}
          out.push({ id, serverPid: proc && proc.pid ? proc.pid : (build && build.pid ? build.pid : null), proc, extraPids: extra.filter(Boolean) });
          ctx.manualStop = true;
          try { if (proc && proc.stdin && proc.stdin.writable) proc.stdin.write('stop\r\n'); } catch {}
          if (build) { try { killTree(build.pid); } catch {} }
        });
      } catch {}
    }
    return out;
  };
  app.on('before-quit', event => {
    clearTimeout(ctx.restartTimer);
    clearInterval(ctx.sampleTimer);
    clearInterval(ctx.autoPollTimer);
    clearInterval(ctx.autoBackupTimer);
    clearInterval(ctx.schedulerTimer);
    // 2.4.0: stop the persistent PowerShell host so its process does not linger after quit.
    try { require('./platform/ps-host.js').dispose(); } catch {}
    if (quitHandled) return;
    const targets = gatherRunningInstances();
    if (!targets.length) return;
    event.preventDefault();
    quitHandled = true;
    const deadline = Date.now() + 10000;
    const waitStop = setInterval(() => {
      // Still inside the timeout? Check every instance's server pid again.
      let anyAlive = false;
      for (const t of targets) { if (t.serverPid) { anyAlive = true; break; } }
      if (anyAlive && Date.now() < deadline) return;
      clearInterval(waitStop);
      for (const t of targets) {
        if (t.serverPid) { try { killTree(t.serverPid); } catch {} }
        for (const p of t.extraPids) { try { killTree(p); } catch {} }
      }
      setTimeout(() => app.quit(), 200);
    }, 250);
  });
}

async function initApp(ctx, ipcMain) {
  // Remove any .tmp-* orphan left by a crash mid-atomic-write (settings.json etc.).
  cleanOrphanTmp(app.getPath('userData'));
  textures.init({
    serverNames: () => {
      try {
        const root = ctx.currentServerPath || ctx.instances?.get(ctx.activeInstanceId || ctx.inst())?.serverPath || loadSettings().serverPath;
        const i = serverFiles(root);
        return [i.jar, i.launchScript, i.target && i.target.mc, i.nativeBinary].filter(Boolean);
      } catch { return []; }
    },
    // FEATURE (v6.0.0): mod item icons read their PNG straight from the server's mods/*.jar,
    // because the PrismarineJS mirror is vanilla-only. A getter so the active instance can change.
    modsDir: () => {
      const root = ctx.currentServerPath || ctx.instances?.get(ctx.activeInstanceId || ctx.inst())?.serverPath || loadSettings().serverPath;
      return root ? path.join(root, 'mods') : null;
    }
  });
  protocol.handle('tex', textures.handle);
  ctx.currentServerPath = loadSettings().serverPath;
  ctx.watchServerFolder();
  ctx.javaInfo = await detectJava(loadSettings().javaPath || 'java');
  startMetrics(ctx);
  startAutoBackupWatcher(ctx);
  startScheduler(ctx);
}

module.exports = { killTree, createWindow, setupAutoUpdater, setupQuitHandler, initApp, updatePolicyOf, UPDATE_POLICIES };
