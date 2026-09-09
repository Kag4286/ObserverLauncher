// ObserverLauncher — Electron main process (wiring only).
//
// This file used to be 1000+ lines holding every IPC handler inline. It is
// now a thin composition root: shared state lives in ./main/context.js and
// each feature area registers its own handlers:
//
//   context.js          shared mutable state + send/appendLog/status helpers
//   server-lifecycle.js start/stop/command, auto-poll, metrics, auto-restart
//   backups.js          manual + auto world backups, restore, delete
//   players.js          read/save player data, whitelist/ban/op
//   marketplace.js      market search/detail/install, .mrpack import/export
//   wizard.js           create-server wizard (adapters + BuildTools)
//   settings-handlers.js settings/dialog/network/Java auto-install
//   content-handlers.js files/properties/content import/editor/worldmap
//   app-lifecycle.js    window, auto-update, graceful quit
//
// IPC channel names are UNCHANGED so preload.js / renderer need no edits.
const { app, ipcMain, protocol } = require('electron');

const { createContext } = require('./main/context.js');
const { registerServer } = require('./main/server-lifecycle.js');
const { registerBackups } = require('./main/backups.js');
const { registerPlayers } = require('./main/players.js');
const { registerMarketplace } = require('./main/marketplace.js');
const { registerWizard } = require('./main/wizard.js');
const { registerSettings } = require('./main/settings-handlers.js');
const { registerContent } = require('./main/content-handlers.js');
const { createWindow, setupAutoUpdater, setupQuitHandler, initApp } = require('./main/app-lifecycle.js');

// Custom tex:// icon scheme — MUST be registered as privileged before the
// app is ready, or Chromium treats it as non-standard and <img> loads fail.
protocol.registerSchemesAsPrivileged([{ scheme: 'tex', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const ctx = createContext();

registerServer(ipcMain, ctx);
registerBackups(ipcMain, ctx);
registerPlayers(ipcMain, ctx);
registerMarketplace(ipcMain, ctx);
registerWizard(ipcMain, ctx);
registerSettings(ipcMain, ctx);
registerContent(ipcMain, ctx);

app.whenReady().then(async () => {
  // BUGFIX (Start dead on launch): initApp used to run AFTER createWindow, so the
  // renderer's first settings:get was served while ctx.javaInfo was still null.
  // refreshUI() disables Start when java is missing (canStart needs j.ok), and
  // nothing ever refreshed state.java afterwards — only re-choosing the folder
  // (settings:save re-detects Java) revived the button. Backend is now ready
  // (server path + Java detected) BEFORE the window loads, so the first
  // snapshot is already correct. All initApp steps are win-independent
  // (ctx.send guards a missing window).
  await initApp(ctx, ipcMain);
  await createWindow(ctx);
  setupAutoUpdater(ctx, ipcMain);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
setupQuitHandler(ctx);

// Exported for smoke tests (require without launching Electron windows).
module.exports = { ctx };
