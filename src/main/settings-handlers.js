// Settings / network / Java handlers (extracted from main.js — behaviour unchanged).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');
const { loadSettings, saveSettings } = require('./settings.js');
const { detectJava, requiredJavaForJar } = require('./java.js');
const { serverFiles, emptyServerFiles, detectSoftware, readEula } = require('./server-files.js');
const { localIPv4s } = require('./network.js');
const { download, marketplaceError, psQuote, runPowerShell, withTimeout } = require('./http.js');
const { findFileRecursive } = require('./fs-utils.js');
const platform = require('./platform');

let javaInstalling = false;

function registerSettings(ipcMain, ctx) {
  // BUGFIX: this is the very first IPC the renderer calls at boot. It must
  // NEVER reject (a throw here used to abort the whole boot sequence, leaving
  // default/empty state with no error shown). Folder reads are guarded so a
  // half-initialized backend or an unreadable folder still yields a usable
  // snapshot; the UI refreshes for real on the next files push / save.
  ipcMain.handle('settings:get', async () => {
    const settings = loadSettings();
    let files = emptyServerFiles(), eulaAccepted = false, javaRequired = null;
    try {
      files = serverFiles(ctx.currentServerPath);
      eulaAccepted = readEula(ctx.currentServerPath);
      javaRequired = requiredJavaForJar(files.jar) || null;
    } catch {}
    return {
      settings,
      java: ctx.javaInfo,
      files,
      eulaAccepted,
      status: ctx.serverStatus,
      running: ctx.serverStatus === 'running',
      logs: ctx.consoleBuffer,
      live: ctx.live,
      systemMemoryGB: Math.round(os.totalmem() / (1024 ** 3)),
      javaRequired
    };
  });

  ipcMain.handle('dialog:server-folder', async (_, opts) => {
    const suggested = path.join(app.getPath('documents'), 'ObserverLauncher Servers');
    if (opts?.suggestNew) { try { fs.mkdirSync(suggested, { recursive: true }); } catch {} }
    const r = await dialog.showOpenDialog(ctx.win, {
      properties: ['openDirectory', ...(opts?.suggestNew ? ['createDirectory'] : [])],
      title: opts?.title || 'Select Minecraft server folder',
      defaultPath: opts?.suggestNew ? suggested : undefined
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('settings:save', async (_, settings) => {
    const merged = { ...loadSettings(), ...settings };
    ctx.currentServerPath = merged.serverPath;
    ctx.watchServerFolder();
    saveSettings(merged);
    ctx.javaInfo = await detectJava(merged.javaPath || 'java');
    return {
      java: ctx.javaInfo,
      files: serverFiles(ctx.currentServerPath),
      eulaAccepted: readEula(ctx.currentServerPath),
      javaRequired: requiredJavaForJar(serverFiles(ctx.currentServerPath).jar) || null
    };
  });

  ipcMain.handle('onboarding:complete', async () => {
    const s = loadSettings();
    s.onboarded = true;
    saveSettings(s);
    return { ok: true };
  });

  ipcMain.handle('network:info', async () => {
    const info = serverFiles(ctx.currentServerPath);
    const isProxy = detectSoftware(info) === 'proxy';
    const port = Number(info.properties['server-port']) || (isProxy ? 25577 : 25565);
    return { ok: true, localIps: localIPv4s(), port };
  });

  ipcMain.handle('network:public-ip', async () => {
    try {
      const { signal, cancel } = withTimeout(10000);
      const r = await fetch('https://api.ipify.org?format=json', { signal }).finally(cancel);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const d = await r.json();
      return { ok: true, ip: d.ip };
    } catch {
      return { ok: false, error: 'Could not reach the internet to look up your public IP. Check your connection.' };
    }
  });

  ipcMain.handle('network:allow-firewall', async (_, port) => {
    const p = Number(port);
    if (!Number.isFinite(p) || p < 1 || p > 65535) return { ok: false, error: 'Invalid port.' };
    return platform.allowFirewall(p);
  });

  ipcMain.handle('java:auto-install', async () => {
    if (javaInstalling) return { ok: false, error: 'A Java install is already in progress — check the Console tab.' };
    if (ctx.javaInfo?.ok) return { ok: false, error: 'Java is already detected — no need to install it again.' };
    javaInstalling = true;
    let zipPath;
    try {
      let jar = null;
      try { jar = serverFiles(ctx.currentServerPath).jar; } catch {}
      const required = requiredJavaForJar(jar);
      const major = required && required < 21 ? 21 : 25;
      ctx.appendLog(`Downloading a portable Java ${major} runtime from Adoptium (Eclipse Temurin)…`, 'system');
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
      const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/${arch}/jre/hotspot/normal/eclipse`;
      zipPath = path.join(app.getPath('temp'), `observerlauncher-jre-${Date.now()}.zip`);
      await download(url, zipPath, (received, total) => ctx.send('java:progress', { received, total }));
      const targetDir = path.join(app.getPath('userData'), `jre${major}`);
      // BUGFIX (a bad install could wipe a working Java): the old code deleted the existing
      // jre<major> folder BEFORE extracting. If the extract then failed, the user lost the
      // Java they already had. Extract into a staging folder first; only swap it into place
      // after java.exe is confirmed present, so a failure leaves the previous install intact.
      const stagingDir = `${targetDir}.staging-${Date.now()}`;
      ctx.appendLog('Extracting Java runtime…', 'system');
      try {
        fs.mkdirSync(stagingDir, { recursive: true });
        const r = await runPowerShell(`Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(stagingDir)} -Force`, 300000);
        if (!r.ok) throw new Error(r.error || 'Could not extract the Java runtime.');
        const stagedJava = findFileRecursive(stagingDir, 'java.exe');
        if (!stagedJava) throw new Error('Java runtime was downloaded but java.exe was not found after extracting.');
        // Success — replace the old install with the freshly verified one.
        try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
        fs.renameSync(stagingDir, targetDir);
      } catch (e) {
        try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
        throw e;
      }
      const javaExe = findFileRecursive(targetDir, 'java.exe');
      if (!javaExe) throw new Error('Java runtime was downloaded but java.exe was not found after extracting.');
      const settings = loadSettings();
      settings.javaPath = javaExe;
      saveSettings(settings);
      ctx.javaInfo = await detectJava(javaExe);
      if (!ctx.javaInfo.ok) throw new Error('Java was installed but could not be verified — try setting the path manually.');
      ctx.appendLog(`Java ready: ${ctx.javaInfo.version} (${javaExe})`, 'system');
      return { ok: true, java: ctx.javaInfo, settings };
    } catch (error) {
      ctx.appendLog(`Java auto-install failed: ${error?.message || error}`, 'error');
      return marketplaceError(error);
    } finally {
      javaInstalling = false;
      try { if (zipPath) fs.rmSync(zipPath, { force: true }); } catch {}
    }
  });
}

module.exports = { registerSettings };
