// content-updates.js (v3.3.0, CB4): report which installed plugins/mods have a newer build.
//
// Uses the observerlauncher-manifest.json identity (projectId/versionId/gameVersion written at
// install since CB2) + the SAME marketplace resolver as install, so a reported update is exactly
// what install_from_market would fetch. READ-ONLY: it never changes a file.
const fs = require('fs');
const path = require('path');
const { readJsonList } = require('./fs-utils.js');

// Keep a bounded set of content backups so repeated updates do not litter plugins/ with .bak files.
// Backups live in <folder>/observerlauncher-content-backups/ and the newest MAX are kept.
const CONTENT_BACKUP_DIR = 'observerlauncher-content-backups';
const CONTENT_BACKUP_MAX = 10;
function writeContentBackup(folderAbs, srcFile, originalName) {
  const dir = path.join(folderAbs, CONTENT_BACKUP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRel = path.join(CONTENT_BACKUP_DIR, `${stamp}-${originalName}`);
  fs.copyFileSync(srcFile, path.join(folderAbs, backupRel));
  // Prune: name sort == chronological (timestamp prefix), keep the newest MAX.
  try {
    const files = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort();
    for (const f of files.slice(0, Math.max(0, files.length - CONTENT_BACKUP_MAX))) fs.rmSync(path.join(dir, f), { force: true });
  } catch {}
  return backupRel;
}

// PURE: an entry can be update-checked only when it recorded a projectId + source (CB2). Old
// entries (pre-3.3.0) have neither -> reported as 'unknown' instead of a false 'current'.
function updatable(entry) {
  if (!entry || !entry.fileName || !entry.projectId || !entry.source) return null;
  return { kind: entry.kind || 'plugin', projectId: entry.projectId, versionId: entry.versionId || null, gameVersion: entry.gameVersion || null, source: entry.source };
}

function inspectJarVersion(folder, fileName) {
  try {
    const { openJar } = require('./jar-read.js');
    const { classifyJar } = require('./mod-metadata.js');
    const jar = openJar(path.join(folder, fileName));
    const cls = classifyJar(jar.read, fileName);
    return (cls && cls.version) ? cls.version : null;
  } catch {
    return null;
  }
}

// opts.resolve is injectable so tests run offline. Returns { ok, checked, updates, items:[...] }.
async function checkUpdates(root, opts) {
  const o = opts || {};
  const resolve = o.resolve || require('./marketplace.js').resolveMarketDownload;
  const entries = (readJsonList(root, 'observerlauncher-manifest.json') || []).filter(e => e && e.fileName);
  // v6.0.0 FIX: only count entries whose file STILL exists in its folder. A manifest can hold a stale
  // entry for a file the user deleted by hand, and counting it produced a bogus "N update(s)" on a
  // server with zero installed content. Resolve the file's folder from its kind + level-name.
  let levelName = 'world';
  try { levelName = require('./server-files.js').serverFiles(root).properties['level-name'] || 'world'; } catch {}
  const { contentFolder } = require('./content-ops.js');
  const present = entries.filter(e => {
    try {
      const dir = contentFolder(e.kind || 'plugin', levelName);
      return fs.existsSync(path.join(root, dir, e.fileName));
    } catch { return false; }
  });
  const items = [];
  for (const e of present) {
    const u = updatable(e);
    if (!u) {
      const folder = contentFolder(e.kind || 'plugin', levelName);
      const version = e.version || inspectJarVersion(path.join(root, folder), e.fileName);
      items.push({ fileName: e.fileName, source: e.source || null, status: 'unknown', version, reason: 'installed before update tracking (no project id)' });
      continue;
    }
    // Spigot has no public version API, so versionId is always null - report it explicitly instead
    // of 'current' or a bogus 'update', so an AI does not keep guessing.
    if (u.source === 'spigot') { items.push({ fileName: e.fileName, source: 'spigot', status: 'manual', reason: 'Spigot has no version API - check the resource page manually.' }); continue; }
    try {
      const dl = await resolve({ id: u.projectId, source: u.source, kind: u.kind, version: u.gameVersion || undefined });
      if (!dl || dl.versionId == null) { items.push({ fileName: e.fileName, source: u.source, status: 'unknown', current: u.versionId }); continue; }
      const newer = String(dl.versionId) !== String(u.versionId || '');
      items.push({
        fileName: e.fileName, source: u.source, status: newer ? 'update' : 'current',
        current: u.versionId, latest: String(dl.versionId),
        version: e.version || null, latestNumber: dl.versionNumber || null,
        latestFileName: dl.filename || null,
      });
    } catch (err) {
      items.push({ fileName: e.fileName, source: u.source, status: 'error', error: err?.message || String(err) });
    }
  }

  // v6.1.0 C1: inspect loose jars on disk that have no manifest entry so their versions appear on the UI
  const manifestFiles = new Set(present.map(e => String(e.fileName).toLowerCase()));
  const sFiles = require('./server-files.js').serverFiles(root);
  const loose = [];
  for (const f of sFiles.plugins || []) {
    if (!manifestFiles.has(String(f).toLowerCase())) loose.push({ fileName: f, kind: 'plugin' });
  }
  for (const f of sFiles.mods || []) {
    if (!manifestFiles.has(String(f).toLowerCase())) loose.push({ fileName: f, kind: 'mod' });
  }
  for (const it of loose) {
    const folder = contentFolder(it.kind, levelName);
    const version = inspectJarVersion(path.join(root, folder), it.fileName);
    items.push({
      fileName: it.fileName,
      source: null,
      status: 'unknown',
      version,
      reason: 'manually installed jar (no project id)'
    });
  }

  return { ok: true, checked: present.length, updates: items.filter(i => i.status === 'update').length, items };
}

// Apply the updates checkUpdates found: download the newer build over the old, backing up the old
// file to <name>.bak first (inert — the server never loads a .bak). Injectable download/resolve/verify
// so tests run offline. ONE call handles a whole batch (like assemble_modpack). opts.names limits to
// specific fileNames; omit to update every item that has a newer build.
const UPDATE_SESSIONS_FILE = 'observerlauncher-update-sessions.json';
const MAX_SESSIONS = 10;

function recordUpdateSession(root, session) {
  const { readJsonList, writeJsonList } = require('./fs-utils.js');
  try {
    const list = readJsonList(root, UPDATE_SESSIONS_FILE) || [];
    list.push(session);
    const pruned = list.slice(-MAX_SESSIONS);
    writeJsonList(root, UPDATE_SESSIONS_FILE, pruned);
  } catch {}
}

function getLastUpdateSession(root) {
  const { readJsonList } = require('./fs-utils.js');
  try {
    const list = readJsonList(root, UPDATE_SESSIONS_FILE) || [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].status !== 'rolled_back') return list[i];
    }
  } catch {}
  return null;
}

function confirmUpdateSession(root, sessionId) {
  const { readJsonList, writeJsonList } = require('./fs-utils.js');
  try {
    const list = readJsonList(root, UPDATE_SESSIONS_FILE) || [];
    let updated = false;
    for (const s of list) {
      if (s && s.status === 'pending' && (!sessionId || s.id === sessionId)) {
        s.status = 'confirmed';
        s.confirmedAt = new Date().toISOString();
        updated = true;
      }
    }
    if (updated) writeJsonList(root, UPDATE_SESSIONS_FILE, list);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function rollbackLastUpdate(root, sessionId) {
  const { safeTarget, readJsonList, writeJsonList } = require('./fs-utils.js');
  const list = readJsonList(root, UPDATE_SESSIONS_FILE) || [];
  let targetSession = null;
  if (sessionId) {
    targetSession = list.find(s => s && s.id === sessionId && s.status !== 'rolled_back');
  } else {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].status !== 'rolled_back') { targetSession = list[i]; break; }
    }
  }
  if (!targetSession || !Array.isArray(targetSession.items) || !targetSession.items.length) {
    return { ok: false, error: 'No update session available to roll back.' };
  }

  const rolledBack = [];
  const errors = [];
  let manifest = readJsonList(root, 'observerlauncher-manifest.json') || [];

  for (const item of targetSession.items) {
    try {
      const folderAbs = safeTarget(root, item.folder || 'plugins');
      if (!folderAbs) {
        errors.push({ fileName: item.from, error: 'Unsafe folder path.' });
        continue;
      }
      const newPath = safeTarget(folderAbs, item.to);
      const oldPath = safeTarget(folderAbs, item.from);
      const backupPath = item.backupRel ? safeTarget(folderAbs, item.backupRel) : null;

      if (!backupPath || !fs.existsSync(backupPath)) {
        errors.push({ fileName: item.from, error: `Backup file not found for ${item.from}.` });
        continue;
      }

      if (newPath && fs.existsSync(newPath)) {
        try { fs.rmSync(newPath, { force: true }); } catch {}
      }

      if (oldPath) {
        fs.copyFileSync(backupPath, oldPath);
      }

      manifest = manifest.filter(e => e && e.fileName !== item.to && e.fileName !== item.from);
      if (item.previousManifestEntry) {
        manifest.push(item.previousManifestEntry);
      }

      rolledBack.push({ from: item.to, to: item.from });
    } catch (err) {
      errors.push({ fileName: item.from, error: err?.message || String(err) });
    }
  }

  try { writeJsonList(root, 'observerlauncher-manifest.json', manifest); } catch {}
  targetSession.status = 'rolled_back';
  targetSession.rolledBackAt = new Date().toISOString();
  try { writeJsonList(root, UPDATE_SESSIONS_FILE, list); } catch {}

  return { ok: true, rolledBackCount: rolledBack.length, rolledBack, errors };
}

// Apply the updates checkUpdates found: download the newer build over the old, backing up the old
// file first. Injectable download/resolve/verify so tests run offline. ONE call handles a whole batch.
// opts.names limits to specific fileNames; omit to update every item that has a newer build.
async function applyUpdates(root, opts) {
  const o = opts || {};
  const resolve = o.resolve || require('./marketplace.js').resolveMarketDownload;
  const download = o.download || require('./http.js').download;
  const verify = o.verify || require('./fs-utils.js').verifyFileHash;
  const { safeTarget, readJsonList, writeJsonList, recordManifestEntry } = require('./fs-utils.js');
  const { contentFolder } = require('./content-ops.js');
  const fs = require('fs'), path = require('path');
  let levelName = 'world';
  try { levelName = require('./server-files.js').serverFiles(root).properties['level-name'] || 'world'; } catch {}
  const targets = Array.isArray(o.names) && o.names.length ? o.names : null;
  // (5) optional MC-version override: resolving with a NEW game version lets an update also move the
  // pack to a different Minecraft version (a mod that has a build for the newer MC is picked).
  const gameVersion = String(o.version || '').trim() || null;
  const manifest = readJsonList(root, 'observerlauncher-manifest.json') || [];
  const out = { ok: true, updated: [], skipped: [], errors: [] };
  const sessionItems = [];
  for (const e of manifest) {
    if (!e || !e.fileName) continue;
    if (targets && !targets.includes(e.fileName)) continue;
    const u = updatable(e);
    if (!u) { out.skipped.push({ fileName: e.fileName, reason: 'no project id' }); continue; }
    try {
      const dl = await resolve({ id: u.projectId, source: u.source, kind: u.kind, version: gameVersion || u.gameVersion || undefined });
      if (!dl || dl.versionId == null) { out.skipped.push({ fileName: e.fileName, reason: 'no version' }); continue; }
      if (String(dl.versionId) === String(u.versionId || '')) { out.skipped.push({ fileName: e.fileName, reason: 'current' }); continue; }
      const folder = contentFolder(u.kind, levelName);
      const newName = path.basename(dl.filename || e.fileName);
      const destNew = safeTarget(root, path.join(folder, newName));
      const oldPath = safeTarget(root, path.join(folder, e.fileName));
      if (!destNew) { out.errors.push({ fileName: e.fileName, error: 'Unsafe destination path.' }); continue; }
      fs.mkdirSync(path.dirname(destNew), { recursive: true });
      let backupRel = null;
      if (oldPath && fs.existsSync(oldPath)) {
        try { backupRel = writeContentBackup(path.dirname(oldPath), oldPath, e.fileName); } catch {}
      }
      await download(dl.url, destNew, null, null, { maxBytes: 512 * 1024 * 1024 });
      const vh = verify(destNew, dl.hashes);
      if (!vh.ok) { try { fs.rmSync(destNew, { force: true }); } catch {} out.errors.push({ fileName: e.fileName, error: vh.error }); continue; }
      if (newName !== e.fileName && oldPath && fs.existsSync(oldPath)) { try { fs.rmSync(oldPath, { force: true }); } catch {} }
      recordManifestEntry(root, { kind: u.kind, fileName: newName, sourceUrl: dl.url, source: u.source, title: e.title, env: e.env, projectId: u.projectId, versionId: String(dl.versionId), gameVersion: gameVersion || u.gameVersion, version: dl.versionNumber || undefined, installedAt: new Date().toISOString() });
      if (newName !== e.fileName) {
        try {
          const list = (readJsonList(root, 'observerlauncher-manifest.json') || []).filter(x => x && x.fileName !== e.fileName);
          writeJsonList(root, 'observerlauncher-manifest.json', list);
        } catch {}
      }
      out.updated.push({ from: e.fileName, to: newName });
      sessionItems.push({
        kind: u.kind,
        folder,
        from: e.fileName,
        to: newName,
        backupRel,
        previousManifestEntry: { ...e }
      });
    } catch (err) { out.errors.push({ fileName: e.fileName, error: err?.message || String(err) }); }
  }

  if (sessionItems.length > 0) {
    const sessionId = 'upd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const session = {
      id: sessionId,
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      status: 'pending',
      items: sessionItems
    };
    recordUpdateSession(root, session);
    out.sessionId = sessionId;
  }

  return out;
}

module.exports = {
  updatable,
  checkUpdates,
  applyUpdates,
  writeContentBackup,
  CONTENT_BACKUP_DIR,
  rollbackLastUpdate,
  getLastUpdateSession,
  confirmUpdateSession,
  recordUpdateSession
};

