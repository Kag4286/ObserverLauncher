// Settings / network / Java handlers (extracted from main.js — behaviour unchanged).
const fs = require('fs');
const os = require('os');
const path = require('path');
// B1 (v3.0.0): no top-level electron require (throws in plain Node). Data paths go through
// dataDir()/tempDir(); `dialog`/`app` are required LAZILY inside the GUI-only handlers.
const { dataDir, tempDir } = require('./data-dir.js');
const { loadSettings, saveSettings, listInstances, addInstance, switchInstance, renameInstance, setInstanceStyle, removeInstance, relinkInstance, loadSettingsFor, loadSettingsStore } = require('./settings.js');
const { detectJava, requiredJavaForJar, javaMajor, javaRuntimeOs, javaRuntimeExt, javaBinName } = require('./java.js');
const { requiredJavaForServer } = require('./server-java.js');
const { serverFiles, emptyServerFiles, detectSoftware, readEula } = require('./server-files.js');
const { localIPv4s } = require('./network.js');
const { download, marketplaceError, withTimeout } = require('./http.js');
const { findFileRecursive } = require('./fs-utils.js');
const platform = require('./platform');
const { planStartAll, planStopAll } = require('./bulk-instances.js');

let javaInstalling = false;

// v6.0.0 H3: decide whether a server folder may be DELETED recursively. Fail-closed: anything
// suspicious returns { ok:false }. Blocks drive roots, the home dir, and Windows system folders so a
// mis-set serverPath can never wipe C:\ or a user's profile. A normal server folder deep under a
// user folder passes.
const WIN_SYSTEM_DIRS = ['windows', 'program files', 'program files (x86)', 'programdata'];
function safeServerFolderToDelete(folder) {
  const raw = String(folder || '').trim();
  if (!raw) return { ok: false, error: 'This profile has no folder to delete.' };
  let resolved;
  try { resolved = path.resolve(raw); } catch { return { ok: false, error: 'The folder path is invalid.' }; }
  let stat;
  try { stat = fs.statSync(resolved); } catch { return { ok: false, error: 'The folder no longer exists on disk.' }; }
  if (!stat.isDirectory()) return { ok: false, error: 'The server path is not a folder.' };
  const parsed = path.parse(resolved);
  // Must have real depth (a drive root has root === dir).
  if (parsed.root === resolved + path.sep || parsed.root === resolved) return { ok: false, error: 'Refusing to delete a drive root.' };
  const segs = resolved.split(/[\\/]+/).filter(Boolean);
  if (segs.length < 2) return { ok: false, error: 'Refusing to delete a top-level folder.' };
  const home = String(process.env.USERPROFILE || process.env.HOME || '');
  if (home && path.resolve(home) === resolved) return { ok: false, error: 'Refusing to delete your home folder.' };
  const lower = resolved.toLowerCase();
  for (const sys of WIN_SYSTEM_DIRS) {
    const sysPath = path.resolve(parsed.root, sys);
    if (lower === sysPath.toLowerCase() || lower === parsed.root.toLowerCase()) return { ok: false, error: 'Refusing to delete a system folder.' };
  }
  // A real server folder contains at least a jar / run script / world / server.properties. Require
  // SOME Minecraft marker so we never nuke an arbitrary unrelated folder the user mis-picked.
  const markers = ['server.properties', 'eula.txt', 'world', 'world_nether', 'world_the_end', 'mods', 'plugins', 'logs'];
  let hasMarker = false;
  for (const m of markers) { try { if (fs.existsSync(path.join(resolved, m))) { hasMarker = true; break; } } catch {} }
  if (!hasMarker) {
    try { if (fs.readdirSync(resolved).some(f => /\.jar$|^run\.(bat|sh)$/i.test(f))) hasMarker = true; } catch {}
  }
  if (!hasMarker) return { ok: false, error: 'This folder does not look like a Minecraft server, so its files were not deleted.' };
  return { ok: true };
}

function registerSettings(ipcMain, ctx) {
  // GUI-only Electron modules. Required lazily and destructured loosely: in a headless process
  // require('electron') is a string, so these are undefined — but no headless code path calls
  // the dialog/app handlers below (they only run with a renderer).
  const { dialog, app } = require('electron');
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
    // v5.7.0 GEYSER: when a Geyser/Floodgate jar is present, inspect its config.yml so the Overview
    // panel can flag the common mistakes (clone-remote-port, auth-type, haproxy, non-default port).
    let geyser = null;
    try {
      if (files.geyser) {
        const { inspectGeyser } = require('./geyser.js');
        const { javaMajor } = require('./java.js');
        const hasFloodgate = [...(files.plugins || []), ...(files.mods || [])].some(x => /floodgate/i.test(x));
        geyser = inspectGeyser(ctx.currentServerPath, { floodgate: hasFloodgate, javaMajor: javaMajor(ctx.javaInfo && ctx.javaInfo.version) });
      }
    } catch { geyser = null; }
    return {
      settings,
      instances: inst.instances,
      activeInstanceId: inst.activeInstanceId,
      java: ctx.javaInfo,
      files,
      geyser,
      eulaAccepted,
      status: ctx.serverStatus,
      running: ctx.serverStatus === 'running',
      logs: ctx.consoleBuffer,
      live: ctx.live,
      // M5/B4: the active instance's sampled history (ring buffer) so the renderer can repaint
      // the chart immediately after an instance switch instead of waiting for fresh metrics.
      metricsHistory: ctx.metricsHistory,
      // v5.3.0: the coarser 6h ring, so the 1h/6h chart ranges repaint immediately on load/switch.
      metricsLong: ctx.metricsLong,
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
            config = { command: ctx.mcpLauncher.command || process.execPath, args: [ctx.mcpLauncher.bridgeDst], env: { ELECTRON_RUN_AS_NODE: '1', OBSERVER_MCP_USERDATA: dataDir() } };
          } else {
            // Fallback before the launcher has been generated: still use the app binary as Node so
            // the config never depends on a system Node.js install.
            const { bridgeScriptPath } = require('../mcp/server.js');
            config = { command: process.execPath, args: [bridgeScriptPath()], env: { ELECTRON_RUN_AS_NODE: '1', OBSERVER_MCP_USERDATA: dataDir() } };
          }
        } catch {}
        return { enabled: !!ctx.mcpServer, running, port: ctx.mcpPort || null, autoAllowWrite: !!settings.mcpAutoAllowWrite, config };
      })(),
      // 3.3.0 remote: friendly status + the addresses to show. Token is NOT sent here (it stays in
      // the settings blob the UI copies only when the user asks); the raw settings already carry it.
      remote: (() => {
        const { remoteSnapshot, remoteAddresses } = require('./remote.js');
        const snap = remoteSnapshot(settings);
        return { ...snap, running: !!ctx.remotePort, port: ctx.remotePort || snap.port || null, addresses: remoteAddresses(ctx.remotePort || snap.port || 0) };
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
    const prev = loadSettings();
    const merged = { ...prev, ...settings };
    // 4.3.0: optional remote-token rotation. The flag is a SIGNAL, never persisted; clearing the
    // stored token makes startRemote() mint a fresh one on the next start.
    const rotateRemoteToken = !!(settings && settings.rotateRemoteToken === true);
    delete merged.rotateRemoteToken;
    if (rotateRemoteToken) merged.remoteToken = '';
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
    // 3.3.0 remote: a bad bind address used to fail silently at listen() time (only a log line).
    // Validate BEFORE saving so the Settings screen can show a clear error. Blank = 127.0.0.1.
    if (merged.remoteBind !== undefined) {
      const b = String(merged.remoteBind || '').trim();
      const { isSafeIp } = require('./validate.js');
      if (b && b !== 'localhost' && !isSafeIp(b)) return { ok: false, error: 'Remote bind address must be a valid IP address (or blank to use 127.0.0.1).' };
      merged.remoteBind = b;
    }
    // Remote port: clamp to a valid TCP port (0 = pick a free one).
    if (merged.remotePort !== undefined) {
      const p = Math.trunc(Number(merged.remotePort));
      merged.remotePort = (Number.isFinite(p) && p >= 0 && p <= 65535) ? p : 0;
    }
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
    // 4.3.0: persist BEFORE the remote toggle so startRemoteServer() reads the NEW values — it loads
    // settings from disk. Previously the save happened after the toggle, so the very first "Enable
    // remote" did not start the server until an app restart.
    saveSettings(merged);
    // 3.3.0/4.3.0 remote toggle: start on enable, stop on disable, and RESTART on a live config
    // change (bind / allowlist / read-only / port) so tightening one takes effect immediately —
    // previously the running server kept its stale config until a restart.
    const wasRemote = !!ctx.currentRemoteEnabled;
    const nowRemote = !!merged.remoteEnabled;
    const remoteCfgChanged = prev.remoteBind !== merged.remoteBind
      || prev.remoteAllow !== merged.remoteAllow
      || (prev.remoteReadOnly !== false) !== (merged.remoteReadOnly !== false)
      || Number(prev.remotePort || 0) !== Number(merged.remotePort || 0);
    if (nowRemote && !wasRemote && typeof ctx.startRemoteServer === 'function') { try { await ctx.startRemoteServer(); } catch {} }
    else if (!nowRemote && wasRemote && typeof ctx.stopRemoteServer === 'function') { try { ctx.stopRemoteServer(); } catch {} }
    else if (nowRemote && wasRemote && (remoteCfgChanged || rotateRemoteToken)) {
      try { if (typeof ctx.stopRemoteServer === 'function') ctx.stopRemoteServer(); } catch {}
      try { if (typeof ctx.startRemoteServer === 'function') await ctx.startRemoteServer(); } catch {}
    }
    ctx.currentRemoteEnabled = nowRemote;
    // startMcpServer sets ctx.mcpPort from listen()'s async callback — wait briefly so the status
    // we return (and the UI shows) is accurate instead of a stale null "stopped".
    if (nowMcp) { for (let i = 0; i < 50 && !ctx.mcpPort; i++) await new Promise(r => setTimeout(r, 20)); }
    ctx.currentServerPath = merged.serverPath;
    ctx.watchServerFolder();
    ctx.javaInfo = await detectJava(merged.javaPath || 'java');
    const mcpStatus = { enabled: !!ctx.mcpServer, running: !!ctx.mcpPort, port: ctx.mcpPort || null, autoAllowWrite: !!merged.mcpAutoAllowWrite };
    return {
      ok: true,
      java: ctx.javaInfo,
      files: serverFiles(ctx.currentServerPath),
      eulaAccepted: readEula(ctx.currentServerPath),
      javaRequired: requiredJavaForServer(ctx.currentServerPath, serverFiles) || null,
      mcp: mcpStatus,
      // 4.3.0: mirror the live remote status so the UI refreshes right after Save (it already
      // consumes r.remote in 08-shell.js). Never includes the token.
      remote: (() => { try { const { remoteSnapshot } = require('./remote.js'); return { ...remoteSnapshot(merged), running: !!ctx.remotePort, port: ctx.remotePort || null }; } catch { return undefined; } })(),
    };
  });

  // 4.3.0 remote: reveal the long-lived token so a user can configure a client. Auth is implicit —
  // this is the trusted renderer only (contextIsolation, no remote page). Never logged.
  ipcMain.handle('remote:token', async () => {
    try { const s = loadSettings(); return { ok: true, token: String(s.remoteToken || '') }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  // --- v2.0.0 multi-instance CRUD (Phase B backend) ---
  // Every mutation re-seeds ctx so activeInstanceId + the merged instance state stay in
  // sync. With a single instance nothing here is user-reachable, so behaviour is unchanged.
  ipcMain.handle('instances:list', async () => listInstances());

  // v6.0.0 E2: start/stop every instance from the rail. The DECISION is pure (bulk-instances.js)
  // so the skip rules are unit-tested; this handler is a thin SEQUENTIAL loop. Sequential, not
  // parallel, because N servers booting at once spike CPU and race for the same port. Each call
  // re-enters that instance's ALS scope (mirror scheduler.js) so a start/stop can never write
  // another instance's runtime state.
  function statusOf(id) {
    const st = ctx.instances && ctx.instances.get(id);
    return (st && st.serverStatus) || 'stopped';
  }
  ipcMain.handle('instances:start-all', async () => {
    const { startServerInternal } = require('./server-lifecycle.js');
    const { detectJava } = require('./java.js');
    const plan = planStartAll(listInstances().instances, statusOf);
    const failed = [];
    let started = 0;
    for (const id of plan.start) {
      try {
        // A background instance that was never ACTIVE this session still has javaInfo = null, and
        // startServerInternal's validateStart() would reject with 'Java was not detected'. Prime
        // this instance's folder + detected Java (per-instance javaPath) inside its own ALS scope,
        // exactly what instances:switch does for the active one.
        const r = await ctx.runInInstance(id, async () => {
          let s; try { s = loadSettingsFor(id); } catch { s = null; }
          if (!s) return { ok: false, error: 'Could not read this instance\u2019s settings.' };
          try { ctx.currentServerPath = s.serverPath || ''; } catch {}
          try { ctx.javaInfo = await detectJava(s.javaPath || 'java'); } catch { ctx.javaInfo = { ok: false }; }
          return startServerInternal(ctx, s);
        });
        if (r && r.ok === false) failed.push({ id, error: r.error || 'start failed' });
        else started++;
      } catch (e) { failed.push({ id, error: e?.message || String(e) }); }
    }
    return { ok: true, started, failed, skipped: plan.skip };
  });
  ipcMain.handle('instances:stop-all', async () => {
    const { requestStop } = require('./server-lifecycle.js');
    const plan = planStopAll(listInstances().instances, statusOf);
    const failed = [];
    let stopped = 0;
    for (const id of plan.stop) {
      try {
        const r = await ctx.runInInstance(id, () => requestStop(ctx));
        if (r && r.ok === false) failed.push({ id, error: r.error || 'stop failed' });
        else stopped++;
      } catch (e) { failed.push({ id, error: e?.message || String(e) }); }
    }
    return { ok: true, stopped, failed, skipped: plan.skip };
  });

  // v6.0.0 E3: set (or clear) an instance's rail group label. Returns the sanitised value so the
  // renderer can reflect it without a full reload.
  ipcMain.handle('instances:set-group', async (_, { id, group } = {}) => {
    const r = require('./settings.js').setInstanceGroup(String(id || ''), group);
    if (!r.ok) return r;
    try { ctx.seedInstances(); } catch {}
    return r;
  });

  // v6.0.0 E4: a live, read-only snapshot of every instance for the cross-instance dashboard. No
  // disk I/O: reads the in-memory metricsHistory tail and live players per instance.
  ipcMain.handle('instances:snapshots', async () => {
    try {
      const { buildSnapshots } = require('./instances-snapshot.js');
      const list = listInstances().instances;
      return { ok: true, rows: buildSnapshots(list, (id) => (ctx.instances ? ctx.instances.get(id) : null)) };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

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

  // v6.0.0 D1: load a long window (7d/30d) of metrics for the ACTIVE instance from disk. The raw
  // in-memory ring only holds 24h, so 7d/30d read the 1m/1h rollup files. `range` is '7d' or '30d'.
  // Returns { ok, samples } oldest-first, downsampled by the caller. Unknown range -> 24h raw.
  ipcMain.handle('metrics:long', async (_, range) => {
    try {
      const store = require('./metrics-store.js');
      const map = { '7d': store.RETENTION_MINUTE_MS, '30d': store.RETENTION_HOUR_MS };
      const age = map[String(range || '')] || store.RETENTION_MS;
      const id = typeof ctx.inst === 'function' ? ctx.inst() : 'default';
      return { ok: true, samples: store.loadSamples(id, age) };
    } catch (e) { return { ok: false, error: e?.message || 'Could not read metrics history.' }; }
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
      metricsLong: Array.isArray(st.metricsLong) ? st.metricsLong : [],
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

  // 5.4.0: point an instance at a new folder after its old one went missing. Re-seeds ctx so the
  // runtime folder/watcher/java follow, the same way instances:switch does.
  ipcMain.handle('instances:relink', async (_, { id, serverPath } = {}) => {
    const target = String(id || '');
    const r = relinkInstance(target, serverPath);
    if (!r.ok) return r;
    try { ctx.seedInstances(); } catch {}
    // If the relinked instance is the ACTIVE one, repoint its runtime folder + watcher now.
    if (ctx.activeInstanceId === target) {
      return await ctx.runInInstance(target, async () => {
        try { ctx.currentServerPath = loadSettings().serverPath || ''; } catch {}
        try { ctx.watchServerFolder(); } catch {}
        return { ok: true, instances: r.instances };
      });
    }
    return { ok: true, instances: r.instances };
  });

  ipcMain.handle('instances:rename', async (_, { id, name } = {}) => {
    const r = renameInstance(String(id || ''), name);
    if (r.ok) { try { ctx.seedInstances(); } catch {} }
    return r;
  });

  // 4.5.0: per-instance appearance (accent palette key + avatar art seed). Validated + clamped in
  // settings.setInstanceStyle; no ctx seed needed (appearance is not runtime state). Returns the
  // sanitised values so the renderer can update the picker immediately.
  ipcMain.handle('instances:style', async (_, { id, accent, artSeed } = {}) => {
    return setInstanceStyle(String(id || ''), { accent, artSeed });
  });

  ipcMain.handle('instances:remove', async (_, id, opts) => {
    const target = String(id || '');
    // F2 (defense in depth): refuse to remove an instance whose server is running. Removing it drops
    // the id from settings, seedInstances rebuilds ctx.instances WITHOUT it, and the serverProcess
    // handle is lost -> an orphaned Java process. The renderer also guards this, but only for the
    // ACTIVE instance, so a background running instance could still be removed. Enforce it here.
    const st = ctx.instances && ctx.instances.get(target);
    if (st && st.serverStatus && st.serverStatus !== 'stopped') {
      return { ok: false, error: 'Stop this instance\u2019s server before removing it.' };
    }
    // v6.0.0 H3: optional DELETE FILES. The user picks "delete profile only" (default) or "delete
    // profile AND files" in a dialog. Deleting files is destructive, so this path is guarded hard:
    // the server must be stopped (checked above), the folder must be a REAL, non-trivial path, it
    // must NOT be a drive root / home / a Windows system dir, and it must not be shared with another
    // instance. The folder is removed only after the instance is removed from settings.
    const deleteFiles = !!(opts && opts.deleteFiles === true);
    const instBefore = (() => { try { return loadSettingsFor(target); } catch { return null; } })();
    const folder = instBefore && instBefore.serverPath ? String(instBefore.serverPath) : '';
    if (deleteFiles) {
      const guard = safeServerFolderToDelete(folder);
      if (!guard.ok) return guard;
      // Refuse if another instance still points at the same folder (deleting it would break them).
      try {
        const others = loadSettingsStore().instances.filter(i => i.id !== target && i.serverPath && path.resolve(i.serverPath) === path.resolve(folder));
        if (others.length) return { ok: false, error: 'Another server still uses this folder. Remove that one first.' };
      } catch {}
    }
    const r = removeInstance(target);
    if (!r.ok) return r;
    if (deleteFiles) {
      try { fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 }); }
      catch (e) { return { ok: false, error: 'The profile was removed, but its folder could not be deleted: ' + (e?.message || e) }; }
    }
    try { ctx.seedInstances(); } catch {}
    // 5.4.0: drop the instance's persisted metrics file so it does not linger on disk.
    try { require('./metrics-store.js').deleteStore(target); } catch {}
    try { require('./properties-history.js').deleteHistory(target); } catch {}
    // F1 (mirror the 2.2.0 instances:switch fix): this handler still runs inside the ALS scope of the
    // PREVIOUS active instance - which is the one just DELETED when the active instance was removed.
    // Writing ctx.currentServerPath here would call instState() -> instances.get(deletedId) -> undefined
    // -> RECREATE a ghost entry, and the NEW active instance would never get its folder/watcher.
    // Re-enter the (possibly null -> 'default') new active instance before touching runtime state.
    const targetId = ctx.activeInstanceId || 'default';
    return await ctx.runInInstance(targetId, async () => {
      try { ctx.currentServerPath = loadSettings().serverPath || ''; } catch {}
      try { ctx.watchServerFolder(); } catch {}
      return { ok: true, activeInstanceId: ctx.activeInstanceId, instances: r.instances };
    });
  });

  // v5.7.0 GEYSER: run Geyser's own `connectiontest` and hand the reply back so the Overview panel
  // can show it. Needs the server running (the command goes through the console). Read-only.
  ipcMain.handle('geyser:test', async () => {
    try {
      if (ctx.serverStatus !== 'running' || !ctx.serverProcess) return { ok: false, error: 'Start the server first — Geyser needs to be loaded to run the test.' };
      const files = serverFiles(ctx.currentServerPath);
      const hasFloodgate = [...(files.plugins || []), ...(files.mods || [])].some(x => /floodgate/i.test(x));
      const { inspectGeyser } = require('./geyser.js');
      const info = inspectGeyser(ctx.currentServerPath, { floodgate: hasFloodgate });
      const bedrock = (info.config && info.config.bedrock && typeof info.config.bedrock === 'object') ? info.config.bedrock : {};
      const port = String(bedrock.port || '').trim() || '19132';
      const { sendConsoleCommand } = require('./server-lifecycle.js');
      // Mark where the reply should start: Geyser's response is logged a moment AFTER the command.
      const before = (ctx.consoleBuffer || []).length;
      const r = await sendConsoleCommand(ctx, `geyser connectiontest 127.0.0.1 ${port}`);
      if (!r || r.ok === false) return { ok: false, error: (r && r.error) || 'Could not send the test command.' };
      // Geyser logs the result ("Success! ..." or an error). Wait briefly, then collect any NEW
      // console lines that look like the reply. If none arrive, tell the user to read the Console.
      await new Promise(res => setTimeout(res, 1500));
      const tail = (ctx.consoleBuffer || []).slice(before).map(l => String((l && l.text) || '')).filter(Boolean);
      const reply = tail.find(t => /connection|success|fail|refused|timeout|geyser/i.test(t)) || tail[tail.length - 1] || '';
      return { ok: true, reply: String(reply || '').trim() || 'Test sent — check the Console tab for the result.' };
    } catch (e) { return { ok: false, error: e?.message || 'Could not run the Geyser test.' }; }
  });

  // A1 (v6.0.0): apply the SAFE Geyser config fixes in one click. The renderer confirms first;
  // this handler re-inspects (never trusts a renderer-supplied plan), plans, and writes at the
  // LINE level with a backup. opts.includeBedrockPort opts into resetting bedrock.port to 19132.
  ipcMain.handle('geyser:apply-fix', async (_, opts) => {
    try {
      if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
      const files = serverFiles(ctx.currentServerPath);
      if (!files.geyser) return { ok: false, error: 'This server has no Geyser or Floodgate jar.' };
      const { inspectGeyser, planGeyserFix, applyGeyserFix } = require('./geyser.js');
      const hasFloodgate = [...(files.plugins || []), ...(files.mods || [])].some(x => /floodgate/i.test(x));
      const info = inspectGeyser(ctx.currentServerPath, { floodgate: hasFloodgate });
      if (!info.configPath) return { ok: false, error: 'Geyser config.yml was not found. Start the server once so Geyser creates it.' };
      const plan = planGeyserFix(info, { includeBedrockPort: !!(opts && opts.includeBedrockPort) });
      if (plan.length === 0) return { ok: true, changed: [], skipped: [], backup: null };
      const res = applyGeyserFix(ctx.currentServerPath, info.configPath, plan);
      if (res.ok && res.changed && res.changed.length) ctx.appendLog(`Geyser config repaired (${res.changed.length} change(s)); backup: ${res.backup}`, 'system');
      return res;
    } catch (e) { return { ok: false, error: e?.message || 'Could not repair the Geyser config.' }; }
  });

  // v6.0.0 F1: send a test message to the configured webhook so the user can confirm the URL works.
  ipcMain.handle('webhook:test', async () => {
    try {
      const s = loadSettings();
      if (!s.webhookUrl) return { ok: false, error: 'Set a webhook URL first.' };
      if (!require('./webhook.js').isSafeWebhookUrl(s.webhookUrl)) return { ok: false, error: 'That URL is not a public http(s) address.' };
      const r = await require('./webhook.js').fire({ ...s, webhookEvents: require('./webhook.js').EVENTS }, { type: 'start', instance: 'ObserverLauncher test' });
      if (!r.sent) return { ok: false, error: r.reason || 'The webhook did not accept the message.' };
      return { ok: true, status: r.status };
    } catch (e) { return { ok: false, error: e?.message || 'Could not send the test.' }; }
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
      const ud = dataDir();
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
      zipPath = path.join(tempDir(), `observerlauncher-jre-${Date.now()}.${ext}`);
      // A JDK/JRE archive is typically 40-200 MB; cap at 512 MB.
      await download(url, zipPath, (received, total) => ctx.send('java:progress', { received, total }), null, { maxBytes: 512 * 1024 * 1024 });
      const targetDir = path.join(dataDir(), `jre${major}`);
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

module.exports = { registerSettings, autoInstallJava, safeServerFolderToDelete };
