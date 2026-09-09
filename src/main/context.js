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
const { serverFiles } = require('./server-files.js');

function createContext() {
  const ctx = {
    win: null,
    serverProcess: null,
    currentServerPath: '',
    javaInfo: null,
    consoleBuffer: [],
    sampleTimer: null,
    previousCpu: null,
    monitoredPid: null,
    live: { tps: null, mspt: null, players: [] },
    currentSoftware: null,
    autoPollTimer: null,
    suppressStatusUntil: 0,
    lastManualCommandAt: 0,
    manualStop: false,
    restartTimer: null,
    restartAttempts: 0,
    autoBackupTimer: null,
    backupInProgress: false,
    lastAutoBackupAt: 0,
    buildProcess: null,
    serverStatus: 'stopped', // 'stopped' | 'starting' | 'running' | 'stopping'
    contentWatcher: null,
    contentWatchDebounce: null,
    edWatcher: null,
    edWatchMtime: 0,
    edWatchDebounce: null,
  };

  function send(channel, data) {
    if (ctx.win && !ctx.win.isDestroyed()) ctx.win.webContents.send(channel, data);
  }

  function appendLog(text, type = 'server') {
    const line = { time: new Date().toLocaleTimeString(), text: String(text).replace(/\r?\n$/, ''), type };
    ctx.consoleBuffer.push(line);
    if (ctx.consoleBuffer.length > 2000) ctx.consoleBuffer.shift();
    send('server:log', line);
  }

  // The ONLY place that pushes 'server:state' — keeps the 4-state machine consistent.
  function setServerStatus(status) {
    ctx.serverStatus = status;
    send('server:state', { status, running: status !== 'stopped' });
  }

  function pushFiles() {
    try {
      send('server:files', serverFiles(ctx.currentServerPath));
    } catch {}
  }

  // Live content updates: rescan on disk changes while NOT running (running
  // servers write logs constantly — rescanning then would hammer the disk).
  function watchServerFolder() {
    try { if (ctx.contentWatcher) ctx.contentWatcher.close(); } catch {}
    ctx.contentWatcher = null;
    if (!ctx.currentServerPath) return;
    try {
      ctx.contentWatcher = fs.watch(ctx.currentServerPath, { recursive: true }, () => {
        clearTimeout(ctx.contentWatchDebounce);
        ctx.contentWatchDebounce = setTimeout(() => {
          if (ctx.serverStatus !== 'running') pushFiles();
        }, 800);
      });
    } catch {}
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

  ctx.send = send;
  ctx.appendLog = appendLog;
  ctx.setServerStatus = setServerStatus;
  ctx.pushFiles = pushFiles;
  ctx.watchServerFolder = watchServerFolder;
  ctx.edWatchFile = edWatchFile;

  return ctx;
}

module.exports = { createContext };
