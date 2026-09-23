// Backup handlers (extracted from main.js — behaviour unchanged).
//
// Owns: manual + auto backup creation (createBackupInternal shared by both),
// restore, delete. Guards: backupInProgress flag, save-off/save-all/save-on
// around the zip so worlds are never archived mid-write.
const fs = require('fs');
const path = require('path');
const { serverFiles } = require('./server-files.js');
const { safeTarget } = require('./fs-utils.js');
const { isSafeBackupName } = require('./validate.js');
const platform = require('./platform');

function resolveBackupFile(ctx, name) {
  // SECURITY: `name` used to go straight into path.join() with only a .zip
  // suffix check — `../world/x.zip` stays inside the server folder (so
  // safeTarget passes) but points OUTSIDE observerlauncher-backups, letting
  // restore/delete touch arbitrary zips. Require a plain basename AND verify
  // the resolved parent is exactly the backups dir.
  if (!ctx.currentServerPath || !isSafeBackupName(name)) return null;
  const backupsDir = safeTarget(ctx.currentServerPath, 'observerlauncher-backups');
  if (!backupsDir) return null;
  const backup = safeTarget(ctx.currentServerPath, path.join('observerlauncher-backups', name));
  if (!backup || path.dirname(backup) !== backupsDir) return null;
  return backup;
}

async function createBackupInternal(ctx, opts = {}) {
  if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  // Snapshot the root once — the renderer can change ctx.currentServerPath (settings:save)
  // while this async runs, which would otherwise mix two folders in one backup.
  const root = ctx.currentServerPath;
  const info = serverFiles(root);
  if (!info.worlds.length) return { ok: false, error: 'No world folders found.' };
  if (ctx.backupInProgress) return { ok: false, error: 'A backup is already in progress — wait for it to finish.' };
  ctx.backupInProgress = true;
  try {
    if (ctx.serverProcess) { try { ctx.serverProcess.stdin.write('save-off\r\n'); ctx.serverProcess.stdin.write('save-all\r\n'); } catch {} }
    const dir = safeTarget(root, 'observerlauncher-backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Auto backups get their own prefix so retention can prune ONLY them — a manual backup is a
    // deliberate user action and must never be deleted by the rotation.
    const prefix = opts.auto ? 'world-backup-auto-' : 'world-backup-';
    const out = path.join(dir, `${prefix}${stamp}.zip`);
    const r = await platform.createBackup({ serverPath: root, worlds: info.worlds, destZip: out });
    return r.ok ? { ok: true, files: serverFiles(root), name: path.basename(out) } : { ok: false, error: r.error };
  } finally {
    try { if (ctx.serverProcess && ctx.serverProcess.stdin.writable) ctx.serverProcess.stdin.write('save-on\r\n'); } catch {}
    ctx.backupInProgress = false;
  }
}

// Keep the newest `keep` auto-backups, delete older ones. ISO timestamps sort lexically, so a
// plain name sort is chronological. Never touches manual backups. Best-effort (never throws).
function pruneBackups(ctx, keep) {
  keep = Math.max(1, Number(keep) || 10);
  try {
    const dir = safeTarget(ctx.currentServerPath, 'observerlauncher-backups');
    if (!dir || !fs.existsSync(dir)) return;
    const autos = fs.readdirSync(dir).filter(n => /^world-backup-auto-.*\.zip$/i.test(n)).sort();
    for (let i = 0; i < autos.length - keep; i++) {
      try { fs.unlinkSync(path.join(dir, autos[i])); } catch {}
    }
  } catch {}
}

// v2.0.0: run auto-backups for EVERY instance, not just the active one — autoBackupMinutes is a
// per-instance setting, so each instance keeps its own cadence. Each tick runs inside
// ctx.runInInstance(id) so createBackupInternal's ctx.currentServerPath / lastAutoBackupAt resolve
// to the right instance. One interval, N instances (mirrors startMetrics / startScheduler).
function startAutoBackupWatcher(ctx) {
  clearInterval(ctx.autoBackupTimer);
  const { loadSettingsFor } = require('./settings.js');
  ctx.autoBackupTimer = setInterval(async () => {
    const ids = ctx.instances ? [...ctx.instances.keys()] : [];
    if (!ids.length) ids.push(ctx.inst());
    for (const id of ids) {
      await ctx.runInInstance(id, async () => {
        let settings;
        try { settings = loadSettingsFor(id); } catch { return; }
        const minutes = Number(settings.autoBackupMinutes) || 0;
        if (minutes <= 0 || !ctx.currentServerPath) return;
        if (Date.now() - ctx.lastAutoBackupAt < minutes * 60 * 1000) return;
        const result = await createBackupInternal(ctx, { auto: true });
        if (result.ok) {
          ctx.lastAutoBackupAt = Date.now();
          ctx.appendLog(`Auto-backup: ${result.name}`, 'system');
          pruneBackups(ctx, settings.backupRetention);
        }
      }).catch(() => {});
    }
  }, 60 * 1000);
}

function registerBackups(ipcMain, ctx) {
  ipcMain.handle('backup:create', async () => {
    const r = await createBackupInternal(ctx);
    if (r.ok) ctx.lastAutoBackupAt = Date.now();
    return r;
  });
  ipcMain.handle('backup:restore', async (_, name) => {
    if (ctx.serverProcess) return { ok: false, error: 'Stop the server before restoring a backup.' };
    if (ctx.backupInProgress) return { ok: false, error: 'A backup is currently being created — wait for it to finish before restoring.' };
    const backup = resolveBackupFile(ctx, name);
    if (!backup || !fs.existsSync(backup)) return { ok: false, error: 'Backup not found.' };
    const r = await platform.restoreBackup({ destPath: ctx.currentServerPath, zipPath: backup });
    return r.ok ? { ok: true, files: serverFiles(ctx.currentServerPath) } : { ok: false, error: r.error };
  });
  ipcMain.handle('backup:delete', async (_, name) => {
    const backup = resolveBackupFile(ctx, name);
    if (!backup || !fs.existsSync(backup)) return { ok: false, error: 'Backup not found.' };
    try { fs.unlinkSync(backup); return { ok: true, files: serverFiles(ctx.currentServerPath) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
}

module.exports = { createBackupInternal, startAutoBackupWatcher, registerBackups, resolveBackupFile, pruneBackups };
