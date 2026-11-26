// src/main/server-upgrade.js — v9.1.0 Guided Minecraft Version Upgrade Assistant.
//
// Safely upgrades an existing server instance to a newer (or chosen) Minecraft version:
//   1. Preflight (read-only): checks required Java version (21/25 via Mojang manifest or mapping)
//      and scans installed mods/plugins against the target MC version (compatible / incompatible /
//      untracked) before touching a single file.
//   2. Execute (transactional): creates a safety world backup first, archives the previous server
//      jar into observerlauncher-content-backups/ (restoring it automatically if download/SHA-256
//      fails), downloads the target server build, optionally updates compatible mods/plugins via
//      applyUpdates({ version }) (preserving 120s stability auto-rollback), and optionally disables
//      incompatible jars so first boot does not crash.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { serverFiles } = require('./server-files.js');
const { detectServerTarget } = require('./server-compat.js');
const { requiredJavaForJar, javaMajor } = require('./java.js');
const { readJsonList, safeTarget } = require('./fs-utils.js');
const { updatable, CONTENT_BACKUP_DIR } = require('./content-updates.js');

const DIRECT_JAR_ENGINES = new Set(['vanilla', 'paper', 'purpur', 'leaf', 'fabric', 'folia', 'velocity']);
const UPGRADEABLE_ENGINES = new Set(['vanilla', 'paper', 'purpur', 'leaf', 'fabric', 'folia', 'velocity', 'forge', 'neoforge', 'spigot']);

function normalizeUpgradeSoftware(detectedSoftware, override) {
  const raw = String(override || detectedSoftware || '').trim().toLowerCase();
  if (UPGRADEABLE_ENGINES.has(raw)) return raw;
  return null;
}

async function poolMap(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

// Pure classifier turning manifest + disk content into preflight buckets.
async function checkContentForVersion(root, targetVersion, opts = {}) {
  const info = serverFiles(root);
  const manifest = readJsonList(root, 'observerlauncher-manifest.json') || [];
  const resolveFn = opts.resolveMarket || require('./marketplace.js').resolveMarketDownload;
  const loader = opts.loader || null;

  const byFile = new Map();
  for (const e of manifest) {
    if (e && e.fileName) byFile.set(e.fileName, e);
  }

  const diskItems = [
    ...(info.plugins || []).map(f => ({ kind: 'plugin', fileName: f })),
    ...(info.mods || []).map(f => ({ kind: 'mod', fileName: f })),
  ].filter(x => x.fileName && !/\.disabled$/i.test(x.fileName));

  const compatible = [];
  const incompatible = [];
  const untracked = [];

  const tracked = [];
  for (const item of diskItems) {
    const entry = byFile.get(item.fileName);
    const u = entry ? updatable(entry) : null;
    if (!u) {
      untracked.push({ fileName: item.fileName, kind: item.kind, reason: 'no manifest project id' });
    } else {
      tracked.push({ item, entry, u });
    }
  }

  const pushIncompat = (item, entry, reason) => incompatible.push({
    fileName: item.fileName, kind: item.kind, title: entry.title || item.fileName, reason,
  });

  await poolMap(tracked, 4, async ({ item, entry, u }) => {
    try {
      const dl = await resolveFn({
        id: u.projectId,
        source: u.source,
        kind: loader && item.kind === 'mod' ? loader : u.kind,
        version: targetVersion,
        loader: loader || undefined,
      });
      if (dl && dl.versionId != null) {
        compatible.push({
          fileName: item.fileName,
          kind: item.kind,
          title: entry.title || item.fileName,
          projectId: u.projectId,
          source: u.source,
          nextFileName: dl.filename || item.fileName,
          nextVersion: dl.versionNumber || String(dl.versionId),
        });
      } else {
        pushIncompat(item, entry, `No compatible build found for ${targetVersion}.`);
      }
    } catch (err) {
      pushIncompat(item, entry, err?.message || `Not published for ${targetVersion}.`);
    }
  });

  return { compatible, incompatible, untracked };
}

async function preflightUpgrade(ctx, opts = {}, deps = {}) {
  if (!ctx || !ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  if (ctx.serverStatus && ctx.serverStatus !== 'stopped') {
    return { ok: false, error: 'Stop the server before running a version upgrade.' };
  }
  const root = ctx.currentServerPath;
  const info = serverFiles(root);
  if (info.engineType === 'native' || info.nativeBinary) {
    return { ok: false, error: 'Native Rust servers (Horizon / Pumpkin) update their binary directly instead of Minecraft JAR upgrades.' };
  }

  const target = detectServerTarget(root, info);
  const software = normalizeUpgradeSoftware(target.software || target.loader, opts.software);
  if (!software) {
    return { ok: false, error: 'Could not identify the current server software (Paper, Purpur, Fabric, Vanilla, etc.).' };
  }
  const targetVersion = String(opts.targetVersion || '').trim();
  if (!targetVersion || targetVersion.length > 64) {
    return { ok: false, error: 'Choose a target Minecraft version first.' };
  }

  // Java compatibility check against Mojang manifest (fallback to local mapping).
  let javaRequired = null;
  if (software === 'velocity') {
    javaRequired = 17;
  } else {
    try {
      const javaForFn = deps.javaVersionFor || require('./adapters/mojang.js').javaVersionFor;
      javaRequired = await javaForFn(targetVersion);
    } catch {}
    if (!javaRequired) javaRequired = requiredJavaForJar(targetVersion);
  }
  const javaActual = ctx.javaInfo && ctx.javaInfo.ok ? javaMajor(ctx.javaInfo.version) : null;
  const javaOk = !javaRequired || (javaActual != null && javaActual >= javaRequired);

  const loader = ['fabric', 'quilt', 'forge', 'neoforge'].includes(software) ? software : null;
  const content = await checkContentForVersion(root, targetVersion, {
    resolveMarket: deps.resolveMarket,
    loader,
  });

  return {
    ok: true,
    software,
    currentVersion: target.mc || null,
    currentJar: info.jar || info.launchScript || null,
    targetVersion,
    javaRequired: javaRequired || null,
    javaActual,
    javaOk,
    hasWorlds: (info.worlds || []).length > 0,
    compatible: content.compatible,
    incompatible: content.incompatible,
    untracked: content.untracked,
  };
}

async function executeUpgrade(ctx, opts = {}, deps = {}) {
  if (!ctx || !ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  if (ctx.serverProcess || (ctx.serverStatus && ctx.serverStatus !== 'stopped')) {
    return { ok: false, error: 'Stop the server before upgrading.' };
  }
  const root = ctx.currentServerPath;
  const info = serverFiles(root);
  if (info.engineType === 'native' || info.nativeBinary) {
    return { ok: false, error: 'Native Rust servers do not use the JAR upgrade assistant.' };
  }

  const target = detectServerTarget(root, info);
  const software = normalizeUpgradeSoftware(target.software || target.loader, opts.software);
  if (!software) return { ok: false, error: 'Unknown server software.' };
  const targetVersion = String(opts.targetVersion || '').trim();
  if (!targetVersion || targetVersion.length > 64) return { ok: false, error: 'Target version is required.' };

  // 1) Pre-upgrade safety world backup (if requested and at least one world exists).
  let backupName = null;
  if (opts.createBackup !== false && (info.worlds || []).length > 0) {
    const createBackupFn = deps.createBackup || require('./backups.js').createBackupInternal;
    const br = await createBackupFn(ctx, { auto: false });
    if (!br || !br.ok) {
      return { ok: false, error: `Pre-upgrade backup failed: ${(br && br.error) || 'unknown error'}. Upgrade aborted safely.` };
    }
    backupName = br.name || null;
  }

  // 2) Archive current server jar so we can restore atomically if the download fails.
  const oldJar = info.jar || null;
  let archivedOldJarPath = null;
  const oldJarPath = oldJar ? safeTarget(root, oldJar) : null;
  if (oldJarPath && fs.existsSync(oldJarPath)) {
    const bdir = safeTarget(root, CONTENT_BACKUP_DIR);
    if (!bdir) return { ok: false, error: 'Unsafe backup directory.' };
    fs.mkdirSync(bdir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    archivedOldJarPath = path.join(bdir, `server-jar-${stamp}-${path.basename(oldJar)}`);
    fs.renameSync(oldJarPath, archivedOldJarPath);
  }

  const restoreArchivedJar = () => {
    try {
      if (archivedOldJarPath && oldJarPath && fs.existsSync(archivedOldJarPath) && !fs.existsSync(oldJarPath)) {
        fs.renameSync(archivedOldJarPath, oldJarPath);
      }
    } catch {}
  };

  // 3) Download / install the new server build.
  let newJar = null;
  try {
    if (DIRECT_JAR_ENGINES.has(software)) {
      const wizard = require('./wizard.js');
      const resolveServerBuild = deps.resolveServerBuild || wizard.RESOLVERS[software];
      const downloadFn = deps.download || require('./http.js').download;
      if (typeof resolveServerBuild !== 'function') throw new Error(`No resolver for ${software}.`);
      const resolved = await resolveServerBuild(targetVersion);
      if (!resolved || !resolved.url || !resolved.name) throw new Error(`Could not resolve ${software} ${targetVersion}.`);
      const safeName = path.basename(resolved.name);
      const dest = safeTarget(root, safeName);
      if (!dest) throw new Error('Unsafe server jar destination.');
      await downloadFn(resolved.url, dest, null, null, { maxBytes: 1024 * 1024 * 1024 });
      if (resolved.sha256) {
        const got = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
        if (got !== String(resolved.sha256).toLowerCase()) {
          try { fs.rmSync(dest, { force: true }); } catch {}
          throw new Error(`Downloaded ${safeName} failed SHA-256 verification and was removed.`);
        }
      }
      newJar = safeName;
    } else {
      // Forge / NeoForge / Spigot go through createServerFiles (handles installer / BuildTools).
      const createFn = deps.createServerFiles || require('./wizard.js').createServerFiles;
      const cr = await createFn(ctx, { software, version: targetVersion });
      if (!cr || !cr.ok) throw new Error((cr && cr.error) || `Failed to install ${software} ${targetVersion}.`);
      newJar = cr.name || null;
    }
  } catch (err) {
    restoreArchivedJar();
    return { ok: false, error: `Server download failed (previous server jar restored): ${err?.message || err}` };
  }

  // 4) Optional content update to targetVersion (records pending session -> 120s stability rollback).
  let updatedContent = [];
  const errors = [];
  if (opts.updateContent !== false) {
    try {
      const applyUpdatesFn = deps.applyUpdates || require('./content-updates.js').applyUpdates;
      const ur = await applyUpdatesFn(root, { version: targetVersion });
      if (ur && Array.isArray(ur.updated)) updatedContent = ur.updated;
      if (ur && Array.isArray(ur.errors)) {
        for (const e of ur.errors) errors.push(e);
      }
    } catch (err) {
      errors.push({ phase: 'content-update', error: err?.message || String(err) });
    }
  }

  // 5) Optional auto-disable of incompatible mods/plugins so first boot stays clean.
  const disabledContent = [];
  if (opts.disableIncompatible && Array.isArray(opts.incompatibleFiles)) {
    const toggleFn = deps.toggleContent || require('./content-ops.js').toggleContent;
    for (const item of opts.incompatibleFiles) {
      if (!item || !item.fileName) continue;
      const kind = item.kind === 'plugin' ? 'plugin' : 'mod';
      try {
        const tr = toggleFn(root, kind, String(item.fileName), 'disable');
        if (tr && tr.ok) disabledContent.push(tr.to || item.fileName);
      } catch {}
    }
  }

  try { ctx.appendLog && ctx.appendLog(`Upgraded ${software} server to ${targetVersion} (${newJar || 'done'}).`, 'system'); } catch {}
  return {
    ok: true,
    software,
    targetVersion,
    backupName,
    oldJar,
    newJar,
    updatedContent,
    disabledContent,
    errors,
    files: serverFiles(root),
  };
}

function registerUpgrade(ipcMain, ctx) {
  ipcMain.handle('server:upgrade-preflight', async (_, payload) => {
    try { return await preflightUpgrade(ctx, payload || {}); }
    catch (e) { return { ok: false, error: e?.message || 'Preflight check failed.' }; }
  });
  ipcMain.handle('server:upgrade-run', async (_, payload) => {
    try { return await executeUpgrade(ctx, payload || {}); }
    catch (e) { return { ok: false, error: e?.message || 'Server upgrade failed.' }; }
  });
}

module.exports = {
  DIRECT_JAR_ENGINES,
  UPGRADEABLE_ENGINES,
  normalizeUpgradeSoftware,
  checkContentForVersion,
  preflightUpgrade,
  executeUpgrade,
  registerUpgrade,
};
