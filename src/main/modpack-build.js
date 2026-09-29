// modpack-build.js — assemble a modpack.json into a real server folder (v3.2.0 Phase D2).
//
// WHY: verify proves a pack is CONSISTENT; build is what actually produces the artifact the boot-smoke
// job (D1) consumes and that "publish" (D3) ships. It reuses the EXISTING download + hash-verify +
// manifest-entry code paths (http.download, fs-utils.verifyFileHash, recordManifestEntry,
// validate.isSafeDownloadUrl) so a built pack is identical to one installed through the GUI/MCP.
//
// Split for testability:
//   - planBuild() is PURE: resolved items -> an ordered list of { dest, dir, url, hashes } (no I/O).
//   - buildPack() does the I/O, is INJECTABLE (opts.download / opts.verify / opts.safeTarget) so tests
//     run offline against fake writers. Network + disk only happen in the real caller (the CLI).
const fs = require('fs');
const path = require('path');
const { safeTarget, verifyFileHash, recordManifestEntry } = require('./fs-utils.js');
const { isSafeDownloadUrl } = require('./validate.js');
const { serverFiles } = require('./server-files.js');

// Map an item kind to its destination folder under the server root. Mirrors folderForKind but only for
// the kinds a BUILD can place (a 'modpack' item is a nested pack, not a single file -> not buildable).
function destDirForKind(kind, levelName) {
  if (kind === 'datapack') return path.join(levelName || 'world', 'datapacks');
  if (kind === 'mod' || kind === 'forge' || kind === 'fabric' || kind === 'neoforge') return 'mods';
  if (kind === 'plugin') return 'plugins';
  return null;
}

// PURE: turn resolved items into an ordered build plan. Each entry: { id, source, kind, dir,
// fileName, url, hashes }. Rejects (returns in `skipped`) an item with no url/filename or an
// unsupported kind - the caller decides whether that is fatal (a strict CI build should be).
//   resolved: [{ id, source, kind, folder, filename, url, hashes }]
//   opts: { levelName?: string }
// Returns { steps: [...], skipped: [{ id, reason }] }.
function planBuild(resolved, opts) {
  const o = opts || {};
  const steps = [];
  const skipped = [];
  for (const it of resolved || []) {
    const kind = it.kind || 'mod';
    const dir = it.folder || destDirForKind(kind, o.levelName);
    if (!dir) { skipped.push({ id: it.id, reason: 'unsupported-kind' }); continue; }
    if (!it.url) { skipped.push({ id: it.id, reason: 'no-url' }); continue; }
    if (!it.filename) { skipped.push({ id: it.id, reason: 'no-filename' }); continue; }
    steps.push({ id: it.id, source: it.source, kind, dir, fileName: path.basename(it.filename), url: it.url, hashes: it.hashes || null });
  }
  return { steps, skipped };
}

// Build a pack into `root` (the server folder). Resolved items must be already resolved (see
// modpack-resolve.js). Progress via opts.onProgress(phase, detail).
//   opts: { levelName?, download?, verify?, onProgress?, maxBytes? }
// Returns { ok, root, installed: [{id,fileName}], skipped: [...], errors: [...] }.
async function buildPack(root, resolved, opts) {
  const o = opts || {};
  const download = o.download || require('./http.js').download;
  const verify = o.verify || verifyFileHash;
  const onProgress = typeof o.onProgress === 'function' ? o.onProgress : () => {};
  const out = { ok: true, root, installed: [], skipped: [], errors: [] };

  // Detect the level-name from the folder so datapacks land in the right world; fall back to 'world'.
  let levelName = o.levelName;
  if (!levelName) { try { levelName = serverFiles(root).properties['level-name'] || 'world'; } catch { levelName = 'world'; } }

  const { steps, skipped } = planBuild(resolved, { levelName });
  out.skipped = skipped;

  for (const step of steps) {
    try {
      // SECURITY (SSRF): the URL comes from a registry API - never fetch a non-public host.
      if (!isSafeDownloadUrl(step.url)) { out.errors.push({ id: step.id, error: 'Refused: the download URL is not on an allowlisted public host.' }); continue; }
      const destDir = safeTarget(root, step.dir);
      fs.mkdirSync(destDir, { recursive: true });
      const dest = path.join(destDir, step.fileName);
      onProgress('download', { id: step.id, fileName: step.fileName });
      await download(step.url, dest, null, null, { maxBytes: o.maxBytes || 2 * 1024 * 1024 * 1024 });
      // SECURITY (supply-chain): verify against the registry hash before keeping the file.
      const vh = verify(dest, step.hashes);
      if (!vh.ok) { try { fs.rmSync(dest, { force: true }); } catch {} out.errors.push({ id: step.id, error: vh.error }); continue; }
      recordManifestEntry(root, { kind: step.kind, fileName: step.fileName, sourceUrl: step.url, source: step.source, installedAt: new Date().toISOString() });
      out.installed.push({ id: step.id, fileName: step.fileName });
    } catch (e) {
      out.errors.push({ id: step.id, error: (e && e.message) || String(e) });
    }
  }
  out.ok = out.errors.length === 0;
  return out;
}

module.exports = { planBuild, buildPack, destDirForKind };
