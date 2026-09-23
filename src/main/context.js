// Shared mutable runtime state for the Electron main process.
//
// main.js grew to 1000+ lines with every IPC handler closing over the same
// module-level `let` variables (win, serverProcess, currentServerPath, ...).
// Splitting handlers into separate files is only safe if they all share ONE
// state object instead of each copying the variables (which would diverge).
//
// Usage:
//   const ctx = require('./context.js').createContext();
//   require('./players.js').registerPlayers(ipcMain, ctx);
// All handlers read/write `ctx.*` and call `ctx.send / ctx.appendLog / ...`
// so behaviour stays identical to the old monolithic main.js.
const fs = require('fs');
const path = require('path');
const { serverFiles, readEula } = require('./server-files.js');
const { AsyncLocalStorage } = require('async_hooks');

// M5: channels that carry the ACTIVE instance's live state and are therefore gated in send()
// so N background instances do not each push IPC + renderer redraws for an unseen view.
// server:state is deliberately ABSENT (it is always sent - see setServerStatus).
const GATED_CHANNELS = new Set(['server:metrics', 'server:live', 'server:files', 'server:log']);

function createContext() {
  const ctx = {
    win: null,
    // tunnel* / mcp* are global. Per-instance fields (incl. serverStatus, javaInfo) are accessors
    // defined below (freshInstState + INST_FIELDS).
    // Public tunnel (src/main/tunnel.js): Playit agent process + state, null until started.
    tunnelProcess: null,
    tunnelProvider: null,
    tunnelStatus: 'stopped',
    tunnelAddress: null,
    tunnelClaimUrl: null,
    tunnelStartedByApp: false,
    tunnelRefreshing: false,
    // M10: which instances still want the (GLOBAL) Playit daemon. Stopping B must not kill a daemon
    // A still needs. Set<instanceId>; see tunnel-manager.js.
    tunnelDaemonUsers: new Set(),
    // MCP integration (src/mcp/server.js): HTTP server + token, null until started.
    mcpServer: null,
    mcpToken: null,
    mcpPort: null,
    onMcpConfirm: null, // set by the renderer bridge when a write/destroy tool needs approval
    // v2.0.0 multi-instance: per-instance state map + the active id. AsyncLocalStorage
    // carries the CURRENT instance across awaits (ctx.inst()) so a handler can never
    // race another by mutating a global. See docs/v2.0.0-plan.md "ctx access model".
    instances: new Map(),
    activeInstanceId: null,
  };

  // --- M4b: per-instance accessors ---
  // Runtime state object for the CURRENT instance (ctx.inst() = ALS store, else the active
  // id, else 'default'). Created lazily so a handler can run before seedInstances().
  function freshInstState() {
    return {
      currentServerPath: '',
      serverProcess: null,
      javaInfo: null, // M7: detected Java for THIS instance (per-instance JRE isolation)
      consoleBuffer: [],
      sampleTimer: null,
      previousCpu: null,
      monitoredPid: null,
      live: { tps: null, mspt: null, players: [] },
      metricsHistory: [],
      currentSoftware: null,
      autoPollTimer: null,
      suppressStatusUntil: 0,
      lastManualCommandAt: 0,
      manualStop: false,
      restartTimer: null,
      restartAttempts: 0,
      shutdownTimer: null,
      adoptWatchTimer: null, // M8 re-attach: liveness poll for an adopted (foreign) process
      autoBackupTimer: null,
      schedulerTimer: null,
      schedulerLastFired: { start: null, stop: null },
      serverStatus: 'stopped', // 'stopped' | 'starting' | 'running' | 'stopping'
      waitingForDone: false,
      runtimeInstanceId: null,
      backupInProgress: false,
      lastAutoBackupAt: 0,
      buildProcess: null,
      rcon: null, // M6: live RconClient for this instance, or null (stdin fallback)
      wizardAbort: null,
      contentWatcher: null,
      contentWatchers: null,
      contentWatchDebounce: null,
      edWatcher: null,
      edWatchMtime: 0,
      edWatchDebounce: null,
    };
  }
  function instState() {
    const id = ctx.inst();
    let s = ctx.instances.get(id);
    if (!s) { s = freshInstState(); ctx.instances.set(id, s); }
    return s;
  }
  // Define one per-instance accessor over the current instance's state object. Keeps plain
  // property syntax at every call-site while ALS routes each read/write to the right instance.
  function defInst(name) {
    Object.defineProperty(ctx, name, {
      get() { return instState()[name]; },
      set(v) { instState()[name] = v; },
      enumerable: true,
      configurable: true,
    });
  }
  // Single source of truth: every per-instance field. Keep in sync with freshInstState().
  const INST_FIELDS = [
    'currentServerPath', 'serverProcess', 'javaInfo', 'consoleBuffer', 'sampleTimer',
    'previousCpu', 'monitoredPid', 'live', 'metricsHistory', 'currentSoftware',
    'autoPollTimer', 'suppressStatusUntil', 'lastManualCommandAt', 'manualStop',
    'restartTimer', 'restartAttempts', 'shutdownTimer', 'adoptWatchTimer', 'autoBackupTimer', 'schedulerTimer',
    'schedulerLastFired', 'serverStatus', 'waitingForDone', 'runtimeInstanceId',
    'backupInProgress', 'lastAutoBackupAt', 'buildProcess', 'rcon',
    'wizardAbort', 'contentWatcher', 'contentWatchers', 'contentWatchDebounce',
    'edWatcher', 'edWatchMtime', 'edWatchDebounce',
  ];
  for (const f of INST_FIELDS) defInst(f);

  // Raw push to the renderer. Use send() (below) for gated channels so background instances
  // do not spam the UI; sendRaw is for error lines and non-gated channels.
  function sendRaw(channel, data) {
    if (ctx.win && !ctx.win.isDestroyed()) ctx.win.webContents.send(channel, data);
  }

  // M5: gated channels reach the renderer only for the ACTIVE instance. ctx.inst() is the
  // instance for THIS call chain (IPC handlers are wrapped in runInInstance); a background
  // instance's push is dropped. Non-gated channels (app:update-*, tunnel:*, market:*, ...)
  // pass through unchanged. server:state is NOT in GATED_CHANNELS (always sent).
  function send(channel, data) {
    if (GATED_CHANNELS.has(channel)) {
      const active = ctx.activeInstanceId || 'default';
      if (ctx.inst() !== active) return;
    }
    sendRaw(channel, data);
  }

  function appendLog(text, type = 'server') {
    const line = { time: new Date().toLocaleTimeString(), text: String(text).replace(/\r?\n$/, ''), type, instanceId: ctx.inst() };
    ctx.consoleBuffer.push(line);
    if (ctx.consoleBuffer.length > 2000) ctx.consoleBuffer.shift();
    // Error lines BYPASS the gate: a background instance's crash must still reach the rail badge.
    const isError = type === 'error' || /\b(ERROR|Exception)\b/.test(line.text);
    if (isError) sendRaw('server:log', line); else send('server:log', line);
  }

  // The ONLY place that pushes 'server:state' — keeps the 4-state machine consistent.
  function setServerStatus(status) {
    ctx.serverStatus = status;
    // M8: reflect the status on the persisted runtime record (if any) so orphan cleanup can pick
    // a tier after a crash. Lazy require + guard so context.js keeps working in bare unit tests.
    try { require('./runtime-state.js').setInstanceStatus(ctx.inst(), status); } catch {}
    // NOT gated: the rail status dot must reflect a background instance's crash/stop.
    send('server:state', { status, running: status !== 'stopped', instanceId: ctx.inst() });
  }

  function pushFiles() {
    try {
      const files = serverFiles(ctx.currentServerPath);
      // Include eulaAccepted so a server start (which writes eula.txt) is reflected in the UI —
      // the renderer merges this in onFiles; without it the Overview EULA chip stayed "pending".
      let eulaAccepted = false;
      try { eulaAccepted = readEula(ctx.currentServerPath); } catch {}
      send('server:files', { files, eulaAccepted, javaRequired: null });
    } catch {}
  }

  // Live content updates: rescan on disk changes while NOT running (running
  // servers write logs constantly — rescanning then would hammer the disk).
  function watchServerFolder() {
    // Close any previous watchers (a single one on win/mac, several on linux).
    try { if (ctx.contentWatcher) ctx.contentWatcher.close(); } catch {}
    if (ctx.contentWatchers) { for (const w of ctx.contentWatchers) { try { w.close(); } catch {} } }
    ctx.contentWatcher = null;
    ctx.contentWatchers = null;
    if (!ctx.currentServerPath) return;
    const onChange = () => {
      clearTimeout(ctx.contentWatchDebounce);
      ctx.contentWatchDebounce = setTimeout(() => {
        // Rescan ONLY while the server is fully stopped. While it is starting/running/stopping it
        // writes logs/ and world/ constantly, so `fs.watch` fires nonstop; each rescan pushed
        // server:files -> refreshUI -> full re-render of the Players/Content lists, which replayed
        // their stagger animations (the visible 'flicker' while the console was busy). Those writes
        // do not change what serverFiles() reports, so there is nothing to refresh mid-run anyway.
        if (ctx.serverStatus === 'stopped') pushFiles();
      }, 800);
    };
    // BUGFIX (Linux): fs.watch recursive:true is only supported on Windows/macOS; on Linux it
    // throws (or silently does nothing), so live content refresh never worked there. Use the
    // recursive watcher where available, and on Linux watch the root + each top-level subfolder
    // manually (covers plugins/, mods/, config/, world/datapacks — the folders we list).
    if (process.platform !== 'linux') {
      try { ctx.contentWatcher = fs.watch(ctx.currentServerPath, { recursive: true }, onChange); } catch {}
      return;
    }
    const watchers = [];
    const watchDir = dir => { try { watchers.push(fs.watch(dir, onChange)); } catch {} };
    watchDir(ctx.currentServerPath);
    try {
      for (const e of fs.readdirSync(ctx.currentServerPath, { withFileTypes: true })) {
        if (e.isDirectory()) watchDir(path.join(ctx.currentServerPath, e.name));
      }
    } catch {}
    ctx.contentWatchers = watchers;
  }

  // Watch the file currently open in the editor for external changes.
  function edWatchFile(target, initialMtime) {
    try { if (ctx.edWatcher) ctx.edWatcher.close(); } catch {}
    ctx.edWatcher = null;
    ctx.edWatchMtime = initialMtime || 0;
    if (!target) return;
    try {
      ctx.edWatcher = fs.watch(target, () => {
        clearTimeout(ctx.edWatchDebounce);
        ctx.edWatchDebounce = setTimeout(() => {
          let m = 0;
          try { m = fs.statSync(target).mtimeMs; } catch {}
          if (m && m !== ctx.edWatchMtime) { ctx.edWatchMtime = m; send('editor:external', { mtime: m }); }
        }, 300);
      });
    } catch {}
  }

  // --- multi-instance (v2.0.0, M4a) ---
  // AsyncLocalStorage: the current instance id for THIS async call chain. A handler
  // wrapped by runInInstance(id, fn) sees id from inst() across awaits, independent of
  // ctx.activeInstanceId (which other concurrent handlers may change). No global mutation.
  const als = new AsyncLocalStorage();
  ctx.inst = () => als.getStore() || ctx.activeInstanceId || 'default';
  ctx.runInInstance = (id, fn) => als.run(id || 'default', fn);
  ctx.setActiveInstance = (id) => { ctx.activeInstanceId = id || null; };
  // Seed ctx.instances from the nested settings store. Safe to call repeatedly (boot,
  // and after settings change). Returns the active id. Never throws.
  ctx.seedInstances = () => {
    try {
      const store = require('./settings.js').loadSettingsStore();
      const list = Array.isArray(store.instances) ? store.instances : [];
      // Merge, do NOT replace: settings fields (serverPath, name, ...) come from the store,
      // but RUNTIME fields (currentServerPath, serverProcess, metrics, ...) live only in the
      // existing state object and must survive a re-seed (settings change). freshInstState()
      // supplies defaults for a brand-new instance id.
      const next = new Map();
      for (const i of list) {
        const prev = ctx.instances && ctx.instances.get(i.id);
        next.set(i.id, Object.assign(freshInstState(), prev, i));
      }
      ctx.instances = next;
      ctx.activeInstanceId = store.activeInstanceId || (list[0] && list[0].id) || 'default';
    } catch {
      if (!(ctx.instances instanceof Map)) ctx.instances = new Map();
      if (!ctx.activeInstanceId) ctx.activeInstanceId = 'default';
    }
    return ctx.activeInstanceId;
  };

  ctx.send = send;
  ctx.appendLog = appendLog;
  ctx.setServerStatus = setServerStatus;
  ctx.pushFiles = pushFiles;
  ctx.watchServerFolder = watchServerFolder;
  ctx.edWatchFile = edWatchFile;

  return ctx;
}

module.exports = { createContext };
