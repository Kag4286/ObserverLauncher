// Settings / network / Java handlers (extracted from main.js — behaviour unchanged).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');
const { loadSettings, saveSettings, listInstances, addInstance, switchInstance, renameInstance, removeInstance } = require('./settings.js');
const { detectJava, requiredJavaForJar, javaMajor, javaRuntimeOs, javaRuntimeExt, javaBinName } = require('./java.js');
const { requiredJavaForServer } = require('./server-java.js');
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
    const inst = listInstances();
    let files = emptyServerFiles(), eulaAccepted = false, javaRequired = null;
    try {
      files = serverFiles(ctx.currentServerPath);
      eulaAccepted = readEula(ctx.currentServerPath);
      javaRequired = requiredJavaForServer(ctx.currentServerPath, serverFiles) || null;
    } catch {}
    return {
      settings,
      instances: inst.instances,
      activeInstanceId: inst.activeInstanceId,
      java: ctx.javaInfo,
      files,
      eulaAccepted,
      status: ctx.serverStatus,
      running: ctx.serverStatus === 'running',
      logs: ctx.consoleBuffer,
      live: ctx.live,
      // M5/B4: the active instance's sampled history (ring buffer) so the renderer can repaint
      // the chart immediately after an instance switch instead of waiting for fresh metrics.
      metricsHistory: ctx.metricsHistory,
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
    // CurseForge API key: trim + length-cap only. Never logged. Sent solely to api.curseforge.com.
    if (merged.curseforgeApiKey !== undefined) merged.curseforgeApiKey = String(merged.curseforgeApiKey || '').trim().slice(0, 64);
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
      javaRequired: requiredJavaForServer(ctx.currentServerPath, serverFiles) || null,
      mcp: mcpStatus
    };
  });

  // --- v2.0.0 multi-instance CRUD (Phase B backend) ---
  // Every mutation re-seeds ctx so activeInstanceId + the merged instance state stay in
  // sync. With a single instance nothing here is user-reachable, so behaviour is unchanged.
  ipcMain.handle('instances:list', async () => listInstances());

  // Q3: does a folder ALREADY contain a Minecraft server? Lets the Add-instance wizard offer
  // "import as-is" instead of downloading a fresh jar. Read-only probe, never throws.
  ipcMain.handle('instances:probe', async (_, folder) => {
    const root = String(folder || '');
    if (!root) return { ok: false };
    try {
      const info = serverFiles(root);
      return { ok: true, looksLikeServer: !!(info.jar || info.launchScript), jar: info.jar || null, launchScript: info.launchScript || null };
    } catch { return { ok: false }; }
  });

  // M11/B4: one-shot snapshot of ANY instance (not just the active one) without switching — status,
  // console tail, metrics history, files, java. Lets the renderer paint an instance before/without
  // making it active. Unknown id -> {ok:false}.
  ipcMain.handle('instances:snapshot', async (_, id) => {
    const key = String(id || '');
    const st = ctx.instances && ctx.instances.get(key);
    if (!st) return { ok: false, error: 'Unknown instance.' };
    const root = st.currentServerPath || st.serverPath || '';
    let files = emptyServerFiles(), eulaAccepted = false, javaRequired = null;
    try {
      files = serverFiles(root);
      eulaAccepted = readEula(root);
      javaRequired = requiredJavaForServer(root, serverFiles) || null;
    } catch {}
    return {
      ok: true,
      id: key,
      status: st.serverStatus || 'stopped',
      running: st.serverStatus === 'running',
      logs: Array.isArray(st.consoleBuffer) ? st.consoleBuffer : [],
      live: st.live || { tps: null, mspt: null, players: [] },
      metricsHistory: Array.isArray(st.metricsHistory) ? st.metricsHistory : [],
      java: st.javaInfo || null,
      files, eulaAccepted, javaRequired,
      active: key === ctx.activeInstanceId,
    };
  });

  ipcMain.handle('instances:add', async (_, payload) => {
    const r = addInstance(payload || {});
    if (!r.ok) return r;
    try { ctx.seedInstances(); } catch {}
    return { ok: true, id: r.id };
  });

  ipcMain.handle('instances:switch', async (_, id) => {
    const r = switchInstance(String(id || ''));
    if (!r.ok) return r;
    try { ctx.seedInstances(); } catch {}
    // CRITICAL (2.2.0 bugfix): this IPC handler runs inside the ALS scope of the PREVIOUS active
    // instance (the ipcMain proxy wraps it with runInInstance(activeInstanceId) at call time).
    // After switchInstance() the active id is the TARGET, but the ALS store is still the OLD id —
    // so writing ctx.currentServerPath / watchServerFolder / javaInfo here would clobber the OLD
    // instance with the NEW instance's folder (the reported 'wizard checks the wrong server folder,
    // sees another instance's purpur.jar'). Re-enter the TARGET instance's scope first.
    const targetId = r.activeInstanceId;
    return await ctx.runInInstance(targetId, async () => {
      // Point THIS instance's runtime state at its own folder and refresh its watchers/files.
      let merged = {};
      try { merged = loadSettings(); ctx.currentServerPath = merged.serverPath || ''; } catch {}
      try { ctx.watchServerFolder(); } catch {}
      // M7: detect THIS instance's Java (per-instance javaPath) so its javaInfo is correct — a
      // background instance never overwrites the active instance's detected Java again.
      try { ctx.javaInfo = await detectJava(merged.javaPath || 'java'); } catch {}
      return { ok: true, activeInstanceId: ctx.activeInstanceId, java: ctx.javaInfo };
    });
  });

  ipcMain.handle('instances:rename', async (_, { id, name } = {}) => {
    const r = renameInstance(String(id || ''), name);
    if (r.ok) { try { ctx.seedInstances(); } catch {} }
    return r;
  });

  ipcMain.handle('instances:remove', async (_, id) => {
    const r = removeInstance(String(id || ''));
    if (!r.ok) return r;
    try { ctx.seedInstances(); } catch {}
    try { ctx.currentServerPath = loadSettings().serverPath || ''; } catch {}
    try { ctx.watchServerFolder(); } catch {}
    return { ok: true, activeInstanceId: ctx.activeInstanceId, instances: r.instances };
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

  // 2.2.0 (Java D): list the Java runtimes this app has downloaded into userData (jre8/jre11/jre17/
  // jre21/jre25). Lets the Settings UI offer a pick-list instead of forcing one Java for everything
  // - a multi-instance setup may need Java 8 for an old server AND Java 21 for a new one.
  ipcMain.handle('java:list', async () => {
    const out = [];
    try {
      const ud = app.getPath('userData');
      for (const major of [8, 11, 17, 21, 25]) {
        const dir = path.join(ud, `jre${major}`);
        if (!fs.existsSync(dir)) continue;
        const binName = javaBinName();
        const exe = findFileRecursive(dir, binName);
        if (!exe) continue;
        let version = null;
        try { const info = await detectJava(exe); if (info.ok) version = info.version; } catch {}
        out.push({ major, path: exe, version });
      }
    } catch {}
    return { ok: true, runtimes: out };
  });

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
      // Phase C (item 17): scrub IPv4/email before the console is written to a shareable file.
      const { scrubPII } = require('../mcp/doctor.js');
      const body = lines.map(l => `[${l.time}] ${scrubPII(l.text)}`).join('\n') + '\n';
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
    // 2.2.0 (fix A): allow installing even when SOME Java is detected, as long as it is the WRONG
    // version for this server. Only refuse when the detected Java already satisfies the requirement.
    const _need = requiredJavaForServer(ctx.currentServerPath, serverFiles);
    const _have = ctx.javaInfo?.ok ? javaMajor(ctx.javaInfo.version) : null;
    // Refuse only when the detected Java is EXACTLY what this server wants. If it is older OR
    // newer (e.g. Java 25 detected for a 1.21.1 server that wants 21), allow the install so the
    // user can switch to the exact version.
    // 2.2.0: the user may want a MANAGED Java even when the PATH Java "works" — e.g. a run.bat
    // (NeoForge) server has no jar, so we cannot tell which Java it needs, and pinning a runtime is
    // reasonable. So refuse ONLY when a managed javaPath is already set AND it exactly matches the
    // known requirement. An empty javaPath (PATH java) or any mismatch/unknown -> allow the install.
    let _managed = '';
    try { _managed = String(loadSettings().javaPath || '').trim(); } catch {}
    if (_managed && ctx.javaInfo?.ok && _need && _have != null && _have === _need) {
      return { ok: false, error: 'Java is already set and matches this server\'s requirement — no need to install it again.' };
    }
    javaInstalling = true;
    let zipPath;
    try {
      const required = requiredJavaForServer(ctx.currentServerPath, serverFiles);
      // 2.2.0 (fix A): install the Java the SERVER actually needs, not always the newest. Old
      // servers (1.16.5 and older -> Java 8) do NOT run on Java 17+, so installing Java 21/25 for
      // them left the server unable to start. Adoptium ships LTS builds only (8/11/17/21/25); a
      // 1.17 jar that wants Java 16 gets 17 (nearest LTS, the documented fallback). Unknown jar ->
      // Java 21 (safe default for the common modern case).
      const major = required
        ? (required <= 8 ? 8 : required <= 11 ? 11 : required <= 17 ? 17 : required <= 21 ? 21 : 25)
        : 21;
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
