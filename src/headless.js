// headless.js — the NO-WINDOW entry point (v3.0.0 Phase B3).
//
// WHY: the launcher's whole backend (feature modules + MCP tools) is already window-free after B1
// (dataDir) and B2 (ipc shim). This entry boots that same backend under plain `node src/headless.js`
// with NO Electron: no BrowserWindow, no auto-updater, no tex:// protocol, no single-instance lock.
// An AI / CLI then drives it over the existing MCP loopback server (Phase C) or via the shim (CLI).
//
// What it DOES reuse (identical to main.js):
//   - createContext() + every feature register*(ipcWrap, ctx) call
//   - the backend init steps of app-lifecycle.initApp() (java detect, folder watcher, metrics,
//     auto-backup watcher, scheduler) MINUS the GUI-only pieces (textures + tex protocol)
// What it DROPS (GUI-only):
//   - createWindow / setupAutoUpdater / setupQuitHandler / protocol scheme registration
//   - registerMcpConfirm + registerOrphanPrompt: they push GUI dialogs. Leaving ctx.onMcpConfirm
//     undefined makes server.js's confirmOnGui auto-DENY write/destroy cleanly (no 60s hang).
const { createContext } = require('./main/context.js');
const { createIpcShim } = require('./main/ipc-shim.js');
const { dataDir } = require('./main/data-dir.js');

// Feature modules (same set main.js registers, minus the two GUI-confirm ones).
const { registerServer } = require('./main/server-lifecycle.js');
const { registerBackups } = require('./main/backups.js');
const { registerPlayers } = require('./main/players.js');
const { registerMarketplace } = require('./main/marketplace.js');
const { registerModpacks } = require('./main/modpacks.js');
const { registerWizard } = require('./main/wizard.js');
const { registerSettings } = require('./main/settings-handlers.js');
const { registerContent } = require('./main/content-handlers.js');
const { registerTunnel, stopTunnel } = require('./main/tunnel.js');

const { startMcpServer, stopMcpServer } = require('./mcp/server.js');
const { loadSettings } = require('./main/settings.js');
const { detectJava } = require('./main/java.js');
const { cleanOrphanTmp } = require('./main/fs-utils.js');
const { startMetrics } = require('./main/server-metrics.js');
const { startAutoBackupWatcher } = require('./main/backups.js');
const { startScheduler } = require('./main/scheduler.js');

// Build the headless runtime: ctx + shim + all feature handlers registered. Returns everything a
// caller (CLI, tests) needs to drive the backend. Pure wiring — safe to call from a test process.
function createHeadless() {
  const ctx = createContext();
  const shim = createIpcShim(ctx);
  const ipcWrap = shim.ipcMain;

  registerServer(ipcWrap, ctx);
  registerBackups(ipcWrap, ctx);
  registerPlayers(ipcWrap, ctx);
  registerMarketplace(ipcWrap, ctx);
  registerModpacks(ipcWrap, ctx);
  registerWizard(ipcWrap, ctx);
  registerSettings(ipcWrap, ctx);
  registerContent(ipcWrap, ctx);
  registerTunnel(ipcWrap, ctx);

  // B4 (v3.0.0): explicit confirm policy. Headless has no dialog, so write/destroy are DENIED by
  // default (deliberate, audited) instead of relying on ctx.onMcpConfirm being undefined. Override
  // with OBSERVER_CONFIRM_MODE=allowlist + OBSERVER_CONFIRM_ALLOW=tool_a,tool_b for automation.
  const VALID_MODES = ['gui', 'auto-deny', 'allowlist'];
  const envMode = String(process.env.OBSERVER_CONFIRM_MODE || '').trim();
  ctx.confirmMode = VALID_MODES.includes(envMode) ? envMode : 'auto-deny';
  ctx.confirmAllow = String(process.env.OBSERVER_CONFIRM_ALLOW || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  // Wire the MCP toggle the same way main.js does, so settings:save can start/stop it.
  ctx.startMcpServer = () => startMcpServer(ctx);
  ctx.stopMcpServer = () => stopMcpServer(ctx);

  return { ctx, shim, ipcWrap };
}

// Backend-only init mirroring app-lifecycle.initApp() minus the GUI pieces.
async function initHeadless(ctx) {
  // Remove any .tmp-* orphan left by a crash mid-atomic-write (settings.json etc.).
  try { cleanOrphanTmp(dataDir()); } catch {}
  try { ctx.seedInstances(); } catch {}
  try { ctx.currentServerPath = loadSettings().serverPath || ''; } catch {}
  try { ctx.watchServerFolder(); } catch {}
  try { ctx.javaInfo = await detectJava(loadSettings().javaPath || 'java'); } catch {}
  try { startMetrics(ctx); } catch {}
  try { startAutoBackupWatcher(ctx); } catch {}
  try { startScheduler(ctx); } catch {}
}

// Full boot: init backend then start the MCP server if the user enabled it. Returns the runtime.
async function start() {
  const rt = createHeadless();
  await initHeadless(rt.ctx);
  try {
    const mcpOn = !!loadSettings().mcpEnabled;
    rt.ctx.currentMcpEnabled = mcpOn;
    if (mcpOn) startMcpServer(rt.ctx);
  } catch {}
  return rt;
}

// Graceful shutdown: stop the tunnel + MCP server. Safe to call when neither is running.
function stop(ctx) {
  try { stopTunnel(ctx); } catch {}
  try { if (typeof ctx.stopMcpServer === 'function') ctx.stopMcpServer(); } catch {}
}

// Only auto-boot when run as a program (`node src/headless.js`), NOT when required by a test.
if (require.main === module) {
  process.on('uncaughtException', err => { try { console.error('[headless] uncaughtException:', err); } catch {} });
  process.on('unhandledRejection', reason => { try { console.error('[headless] unhandledRejection:', reason); } catch {} });
  const shutdown = (sig) => {
    try { console.error(`[headless] received ${sig}, shutting down…`); } catch {}
    try { if (module.exports.__ctx) stop(module.exports.__ctx); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  start().then(rt => {
    module.exports.__ctx = rt.ctx;
    try { console.error(`[headless] ready — dataDir=${dataDir()} — MCP ${rt.ctx.mcpPort ? 'on :' + rt.ctx.mcpPort : 'off'}`); } catch {}
  }).catch(err => { try { console.error('[headless] boot failed:', err); } catch {} process.exit(1); });
}

module.exports = { createHeadless, initHeadless, start, stop };
