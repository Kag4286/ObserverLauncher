// App window lifecycle + auto-update + graceful quit (extracted from main.js).
const path = require('path');
const { app, BrowserWindow, protocol } = require('electron');
const { killTree } = require('./kill.js');
const { loadSettings } = require('./settings.js');
const { detectJava } = require('./java.js');
const { serverFiles } = require('./server-files.js');
const { startMetrics } = require('./server-lifecycle.js');
const { startAutoBackupWatcher } = require('./backups.js');
const textures = require('./textures');

async function createWindow(ctx) {
  if (process.platform === 'win32') app.setAppUserModelId('dev.observerlauncher.minecraftservercontrol');
  const winOpts = {
    width: 1480, height: 930, minWidth: 1080, minHeight: 720,
    backgroundColor: '#08090a',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icons', 'observer.png'),
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
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

function setupAutoUpdater(ctx, ipcMain) {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.on('update-available', v => ctx.send('app:update-available', v));
  autoUpdater.on('update-not-available', () => ctx.send('app:update-none', {}));
  autoUpdater.on('download-progress', p => ctx.send('app:update-progress', p));
  autoUpdater.on('update-downloaded', () => ctx.send('app:update-downloaded', {}));
  // BUGFIX: no error handler meant a failed check/download (offline, 404 asset, bad signature)
  // silently did nothing — the button stayed on "Checking…" forever. Surface it to the renderer.
  autoUpdater.on('error', err => ctx.send('app:update-error', { message: err?.message || String(err) }));
  // Only check automatically when actually packaged — electron-updater has no app-update.yml in dev.
  if (app.isPackaged) autoUpdater.checkForUpdates().catch(err => ctx.send('app:update-error', { message: err?.message || String(err) }));

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
    try { autoUpdater.quitAndInstall(); return { ok: true }; }
    catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });
}

function setupQuitHandler(ctx) {
  let quitHandled = false;
  app.on('before-quit', event => {
    clearTimeout(ctx.restartTimer);
    clearInterval(ctx.sampleTimer);
    clearInterval(ctx.autoPollTimer);
    clearInterval(ctx.autoBackupTimer);
    if (quitHandled || (!ctx.serverProcess && !ctx.buildProcess)) return;
    event.preventDefault();
    quitHandled = true;
    ctx.manualStop = true;
    try { if (ctx.serverProcess?.stdin?.writable) ctx.serverProcess.stdin.write('stop\r\n'); } catch {}
    if (ctx.buildProcess) killTree(ctx.buildProcess.pid);
    const deadline = Date.now() + 10000;
    const waitStop = setInterval(() => {
      if (ctx.serverProcess && Date.now() < deadline) return;
      clearInterval(waitStop);
      if (ctx.serverProcess) killTree(ctx.serverProcess.pid);
      setTimeout(() => app.quit(), 200);
    }, 250);
  });
}

async function initApp(ctx, ipcMain) {
  textures.init({
    serverNames: () => {
      try { const i = serverFiles(ctx.currentServerPath); return [i.jar, i.launchScript].filter(Boolean); }
      catch { return []; }
    }
  });
  protocol.handle('tex', textures.handle);
  ctx.currentServerPath = loadSettings().serverPath;
  ctx.watchServerFolder();
  ctx.javaInfo = await detectJava(loadSettings().javaPath || 'java');
  startMetrics(ctx);
  startAutoBackupWatcher(ctx);
}

module.exports = { killTree, createWindow, setupAutoUpdater, setupQuitHandler, initApp };
