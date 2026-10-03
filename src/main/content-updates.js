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
  fs.copyFileSync(srcFile, path.join(dir, `${stamp}-${originalName}`));
  // Prune: name sort == chronological (timestamp prefix), keep the newest MAX.
  try {
    const files = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort();
    for (const f of files.slice(0, Math.max(0, files.length - CONTENT_BACKUP_MAX))) fs.rmSync(path.join(dir, f), { force: true });
  } catch {}
}

// PURE: an entry can be update-checked only when it recorded a projectId + source (CB2). Old
// entries (pre-3.3.0) have neither -> reported as 'unknown' instead of a false 'current'.
function updatable(entry) {
  if (!entry || !entry.fileName || !entry.projectId || !entry.source) return null;
  return { kind: entry.kind || 'plugin', projectId: entry.projectId, versionId: entry.versionId || null, gameVersion: entry.gameVersion || null, source: entry.source };
}

// opts.resolve is injectable so tests run offline. Returns { ok, checked, updates, items:[...] }.
async function checkUpdates(root, opts) {
  const o = opts || {};
  const resolve = o.resolve || require('./marketplace.js').resolveMarketDownload;
  const entries = (readJsonList(root, 'observerlauncher-manifest.json') || []).filter(e => e && e.fileName);
  const items = [];
  for (const e of entries) {
    const u = updatable(e);
    if (!u) { items.push({ fileName: e.fileName, source: e.source || null, status: 'unknown', version: e.version || null, reason: 'installed before update tracking (no project id)' }); continue; }
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
  return { ok: true, checked: entries.length, updates: items.filter(i => i.status === 'update').length, items };
}

// Apply the updates checkUpdates found: download the newer build over the old, backing up the old
// file to <name>.bak first (inert — the server never loads a .bak). Injectable download/resolve/verify
// so tests run offline. ONE call handles a whole batch (like assemble_modpack). opts.names limits to
// specific fileNames; omit to update every item that has a newer build.
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
      if (oldPath && fs.existsSync(oldPath)) { try { writeContentBackup(path.dirname(oldPath), oldPath, e.fileName); } catch {} }
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
    } catch (err) { out.errors.push({ fileName: e.fileName, error: err?.message || String(err) }); }
  }
  return out;
}

module.exports = { updatable, checkUpdates, applyUpdates, writeContentBackup, CONTENT_BACKUP_DIR };
