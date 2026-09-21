// Settings / network / Java handlers (extracted from main.js — behaviour unchanged).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');
const { loadSettings, saveSettings } = require('./settings.js');
const { detectJava, requiredJavaForJar, javaRuntimeOs, javaRuntimeExt, javaBinName } = require('./java.js');
const { serverFiles, emptyServerFiles, detectSoftware, readEula } = require('./server-files.js');
const { localIPv4s } = require('./network.js');
const { download, marketplaceError, withTimeout } = require('./http.js');
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
      javaRequired,
      mcp: (() => {
        const running = !!ctx.mcpPort;
        // Client config: prefer the extracted launcher (userData/mcp/bridge.js + OBSERVER_MCP_USERDATA)
        // because that is the ONE path that works in both dev and a packaged build. Fall back to the
        // raw bridge path only if the launcher could not be created.
        let config = null;
        try {
          if (ctx.mcpLauncher && ctx.mcpLauncher.bridgeDst) {
            config = { command: ctx.mcpLauncher.command || process.execPath, args: [ctx.mcpLauncher.bridgeDst], env: { ELECTRON_RUN_AS_NODE: '1', OBSERVER_MCP_USERDATA: require('electron').app.getPath('userData') } };
          } else {
            // Fallback before the launcher has been generated: still use the app binary as Node so
            // the config never depends on a system Node.js install.
            const { bridgeScriptPath } = require('../mcp/server.js');
            config = { command: process.execPath, args: [bridgeScriptPath()], env: { ELECTRON_RUN_AS_NODE: '1', OBSERVER_MCP_USERDATA: require('electron').app.getPath('userData') } };
          }
        } catch {}
        return { enabled: !!ctx.mcpServer, running, port: ctx.mcpPort || null, autoAllowWrite: !!settings.mcpAutoAllowWrite, config };
      })()
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

  // Pick the Playit agent executable directly, so users don't have to type/paste the path by hand.
  ipcMain.handle('dialog:playit-file', async () => {
    const r = await dialog.showOpenDialog(ctx.win, {
      title: 'Select the Playit agent executable',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Executable', extensions: ['exe'] }] : [],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('settings:save', async (_, settings) => {
    const merged = { ...loadSettings(), ...settings };
    // SECURITY/VALIDATION: memoryMin/Max arrive from the renderer and become -Xms/-Xmx. Clamp them
    // to a sane 1..64 GB integer range (the MCP set_setting path already validates this) so a bad
    // value can never produce an invalid JVM flag or a nonsensical swap (max < min).
    const clampMem = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(64, Math.max(1, n)) : null; };
    if (merged.memoryMin !== undefined) { const m = clampMem(merged.memoryMin); if (m !== null) merged.memoryMin = m; }
    if (merged.memoryMax !== undefined) { const m = clampMem(merged.memoryMax); if (m !== null) merged.memoryMax = m; }
    if (Number(merged.memoryMax) < Number(merged.memoryMin)) merged.memoryMax = merged.memoryMin;
    // Animation level: 'full' (default, rich motion) or 'lite' (weak PCs — kills ambience/boot/
    // proximity/spotlight/stagger). Persisted so it survives restarts.
    if (!['full', 'lite'].includes(merged.motionLevel)) merged.motionLevel = 'full';
    // Normalize scheduleDays to NUMBERS (0=Sun..6=Sat) — the shape scheduler.shouldFire() compares
    // against now.getDay(). Accepts names too, so a name-based value can never silently never-fire.
    if (merged.scheduleDays !== undefined) {
      const NAME_TO_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      const arr = Array.isArray(merged.scheduleDays) ? merged.scheduleDays : [];
      merged.scheduleDays = [...new Set(arr.map(d => typeof d === 'string' ? NAME_TO_NUM[d.toLowerCase().slice(0, 3)] : Number(d)).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))];
    }
    // SECURITY: serverPath becomes the root for EVERY file operation (backup, editor save,
    // player data, content delete). It arrives from the renderer, so refuse anything that is
    // not an existing directory instead of trusting it verbatim.
    if (merged.serverPath) {
      let ok = false;
      try { ok = fs.statSync(merged.serverPath).isDirectory(); } catch { ok = false; }
      if (!ok) return { ok: false, error: 'That server folder does not exist or is not a folder.' };
    }
    // STATE CONSISTENCY (audit #4): ctx.currentServerPath is the root for EVERY file operation —
    // metrics, player data, world map, backups, editor, content. If it were changed to Server B
    // while the live process is still running Server A, those features would silently mix data
    // from two folders. Refuse to switch folders while a server is starting/running/stopping;
    // other settings (memory, Java, locale, args) still save normally. Smallest safe fix — no
    // session abstraction needed for a single-server launcher.
    if (merged.serverPath !== ctx.currentServerPath && ctx.serverStatus !== 'stopped') {
      return { ok: false, error: 'Stop the server before changing the server folder.' };
    }
    // MCP toggle: start the loopback server when enabled, stop it when disabled (done before
    // saveSettings so the saved value matches the running state). ctx exposes
    // startMcpServer/stopMcpServer from main.js after ready.
    const wasMcp = !!ctx.currentMcpEnabled;
    const nowMcp = !!merged.mcpEnabled;
    if (nowMcp && !wasMcp && typeof ctx.startMcpServer === 'function') { try { ctx.startMcpServer(); } catch {} }
    else if (!nowMcp && wasMcp && typeof ctx.stopMcpServer === 'function') { try { ctx.stopMcpServer(); } catch {} }
    ctx.currentMcpEnabled = nowMcp;
    // startMcpServer sets ctx.mcpPort from listen()'s async callback — wait briefly so the status
    // we return (and the UI shows) is accurate instead of a stale null "stopped".
    if (nowMcp) { for (let i = 0; i < 50 && !ctx.mcpPort; i++) await new Promise(r => setTimeout(r, 20)); }
    ctx.currentServerPath = merged.serverPath;
    ctx.watchServerFolder();
    saveSettings(merged);
    ctx.javaInfo = await detectJava(merged.javaPath || 'java');
    const mcpStatus = { enabled: !!ctx.mcpServer, running: !!ctx.mcpPort, port: ctx.mcpPort || null, autoAllowWrite: !!merged.mcpAutoAllowWrite };
    return {
      ok: true,
      java: ctx.javaInfo,
      files: serverFiles(ctx.currentServerPath),
      eulaAccepted: readEula(ctx.currentServerPath),
      javaRequired: requiredJavaForJar(serverFiles(ctx.currentServerPath).jar) || null,
      mcp: mcpStatus
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
    return { ok: true, localIps: localIPv4s(), port, platform: process.platform };
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

  ipcMain.handle('java:auto-install', async () => autoInstallJava(ctx));

  // FEATURE (0.9.0): export the in-memory console buffer to a text file the user picks. The buffer
  // lives in the main process (ctx.consoleBuffer, capped 2000 lines) so it survives renderer clears.
  ipcMain.handle('console:export', async () => {
    try {
      const lines = Array.isArray(ctx.consoleBuffer) ? ctx.consoleBuffer : [];
      if (!lines.length) return { ok: false, error: 'Nothing to export yet.' };
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const saveDialog = await dialog.showSaveDialog(ctx.win, {
        title: 'Export console log',
        defaultPath: `server-console-${stamp}.txt`,
        filters: [{ name: 'Text file', extensions: ['txt'] }],
      });
      if (saveDialog.canceled || !saveDialog.filePath) return { ok: false, cancelled: true };
      const body = lines.map(l => `[${l.time}] ${l.text}`).join('\n') + '\n';
      fs.writeFileSync(saveDialog.filePath, body, 'utf8');
      return { ok: true, path: saveDialog.filePath, count: lines.length };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not export the console log.' };
    }
  });
}

// Shared by the IPC handler and the MCP tool. Downloads a portable Adoptium JRE chosen from the
// server jar's requirement (min Java 21), stages it, verifies the binary, then swaps it in.
async function autoInstallJava(ctx) {
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
      const osName = javaRuntimeOs(), ext = javaRuntimeExt(osName), binName = javaBinName(osName);
      const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
      zipPath = path.join(app.getPath('temp'), `observerlauncher-jre-${Date.now()}.${ext}`);
      // A JDK/JRE archive is typically 40-200 MB; cap at 512 MB.
      await download(url, zipPath, (received, total) => ctx.send('java:progress', { received, total }), null, { maxBytes: 512 * 1024 * 1024 });
      const targetDir = path.join(app.getPath('userData'), `jre${major}`);
      // BUGFIX (a bad install could wipe a working Java): extract into a staging folder first; only
      // swap it in after the java binary is confirmed present, so a failure leaves the previous install
      // intact. Cross-platform: PowerShell on Windows, unzip/tar on Linux/mac (was Windows-only).
      const stagingDir = `${targetDir}.staging-${Date.now()}`;
      ctx.appendLog('Extracting Java runtime…', 'system');
      try {
        fs.mkdirSync(stagingDir, { recursive: true });
        const r = await platform.extractArchive(zipPath, stagingDir);
        if (!r.ok) throw new Error(r.error || 'Could not extract the Java runtime.');
        const stagedJava = findFileRecursive(stagingDir, binName);
        if (!stagedJava) throw new Error(`Java runtime was downloaded but ${binName} was not found after extracting.`);
        // Success — replace the old install with the freshly verified one.
        try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
        fs.renameSync(stagingDir, targetDir);
      } catch (e) {
        try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
        throw e;
      }
      const javaExe = findFileRecursive(targetDir, binName);
      if (!javaExe) throw new Error(`Java runtime was downloaded but ${binName} was not found after extracting.`);
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
}

module.exports = { registerSettings, autoInstallJava };
