const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// FEATURE: writes to a temp file in the same directory, then renames into place. A plain
// fs.writeFileSync can leave a truncated/corrupt file behind if the app crashes or is killed mid-write
// (e.g. mid-JSON-stringify-flush) — the file that was being written is the one that's now broken, and
// there's no way back. Writing to a differently-named temp file first means the ORIGINAL file is never
// touched until the new content is fully on disk; the rename step itself is a single atomic filesystem
// operation (POSIX rename(2), and Windows' MoveFileEx which fs.renameSync uses does the same,
// replacing the destination). Same-directory temp file is required so the rename can't cross
// filesystems/volumes, which would silently turn "atomic rename" into "non-atomic copy".
// Synchronous sleep without spawning a process (Atomics.wait works on Node's main thread).
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ }
}
function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, content);
  // BUGFIX (5.4.0): on Windows fs.renameSync onto an EXISTING file can throw EPERM/EACCES when
  // another process (antivirus scanning the fresh temp file, an editor, or the running server)
  // holds a transient handle on the destination. Retry a few times — the rename is atomic when it
  // succeeds — then fall back to a copy + unlink so a save never hard-fails on a momentary lock.
  const retryable = e => e && (e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY');
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, filePath); return; }
    catch (e) {
      lastErr = e;
      // A non-retryable error (ENOENT, EXDEV, ...) is a real failure — clean the temp and rethrow
      // instead of masking it with a copy that would only fail the same way.
      if (!retryable(e)) { try { fs.unlinkSync(tmp); } catch {} throw e; }
      sleepSync(60);
    }
  }
  // Rename kept getting a transient lock: fall back to copy + unlink so the save still lands.
  try { fs.copyFileSync(tmp, filePath); fs.unlinkSync(tmp); return; }
  catch { try { fs.unlinkSync(tmp); } catch {} throw lastErr; }
}
function readJsonList(root, name) { try { return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); } catch { return []; } }
function writeJsonList(root, name, list) { writeFileAtomic(path.join(root, name), JSON.stringify(list, null, 2)); }
function fileHashes(filePath) {
  const buffer = fs.readFileSync(filePath);
  return { sha1: crypto.createHash('sha1').update(buffer).digest('hex'), sha512: crypto.createHash('sha512').update(buffer).digest('hex') };
}
// SECURITY (supply-chain, v3.0.0): the marketplace registries (Modrinth/CurseForge) publish a file
// hash for every download, but the install paths fetched the jar and used it WITHOUT checking — a
// compromised CDN or a MITM could serve a trojaned .jar that then runs on the user's server. This
// verifies the downloaded file against the registry's hash before it is kept. `hashes` is
// { sha512?, sha1?, md5? } (any subset); a missing hash is a SKIP (ok:true) so a source with no
// hash data never blocks an install. Any mismatch fails. Pure (reads the file).
function verifyFileHash(filePath, hashes) {
  if (!hashes || typeof hashes !== 'object') return { ok: true, skipped: true };
  const wanted = [];
  if (hashes.sha512) wanted.push(['sha512', String(hashes.sha512).toLowerCase()]);
  if (hashes.sha256) wanted.push(['sha256', String(hashes.sha256).toLowerCase()]);
  if (hashes.sha1) wanted.push(['sha1', String(hashes.sha1).toLowerCase()]);
  if (hashes.md5) wanted.push(['md5', String(hashes.md5).toLowerCase()]);
  if (!wanted.length) return { ok: true, skipped: true };
  let buffer;
  try { buffer = fs.readFileSync(filePath); } catch (e) { return { ok: false, error: e?.message || 'Could not read the downloaded file.' }; }
  for (const [algo, expected] of wanted) {
    const got = crypto.createHash(algo).update(buffer).digest('hex');
    if (got !== expected) return { ok: false, algo, expected, got, error: `Downloaded file failed its ${algo} checksum.` };
  }
  return { ok: true };
}
function findFileRecursive(dir, filename, depth = 5) {
  if (depth < 0) return null;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === filename) return path.join(dir, e.name);
  for (const e of entries) if (e.isDirectory()) { const found = findFileRecursive(path.join(dir, e.name), filename, depth - 1); if (found) return found; }
  return null;
}
// FEATURE: extracted from main.js — now takes `root` explicitly instead of closing over the
// module-level currentServerPath variable, so this stays a pure, testable function.
function safeTarget(root, relative) {
  const base = path.resolve(root || '.');
  const target = path.resolve(base, relative);
  if (!(target.startsWith(base + path.sep) || target === base)) return null;
  // SECURITY (symlink escape): path.resolve only normalises the string — a symlink INSIDE the
  // root (e.g. plugins -> /etc) would still pass the check while reading/writing outside it.
  // Resolve the real path and re-check. If the target does not exist yet, resolve its parent
  // (the file is about to be created there) and verify that stays inside the real root.
  // SECURITY (fail-CLOSED, 5.0.0): resolve the nearest EXISTING ancestor of the target and require
  // it to stay inside the real root. Walk up from the target: the first level realpath can resolve
  // is the deepest ancestor that exists; its real path must be inside the real root, else the target
  // escapes via a symlink (e.g. root/link -> /etc with link/sub/new.txt still being created). If the
  // ROOT itself cannot be resolved, refuse (null). This allows creating a new file inside a new
  // sub-folder under the root (the walk stops at the root, which resolves inside itself).
  let realBase;
  try { realBase = fs.realpathSync.native ? fs.realpathSync.native(base) : fs.realpathSync(base); }
  catch { return null; }
  let cur = target;
  for (let i = 0; i < 64; i++) {
    let real;
    try { real = fs.realpathSync.native ? fs.realpathSync.native(cur) : fs.realpathSync(cur); }
    catch {
      const parent = path.dirname(cur);
      if (parent === cur) return null; // reached the filesystem root without resolving any ancestor
      cur = parent;
      continue;
    }
    return (real === realBase || real.startsWith(realBase + path.sep)) ? target : null;
  }
  return null;
}
// Startup cleanup (debt #7): writeFileAtomic leaves a `.name.tmp-<pid>-<ts>` file behind if the
// app is killed between writeFileSync and renameSync. Those orphans never get renamed and just
// accumulate. Remove any file matching that exact temp shape in `dir` — nothing else matches, so
// a real file (e.g. settings.json) can never be deleted. Best-effort: errors are ignored.
function cleanOrphanTmp(dir) {
  let removed = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      if (!/^\..+\.tmp-\d+-\d+$/.test(e.name)) continue;
      try { fs.unlinkSync(path.join(dir, e.name)); removed++; } catch {}
    }
  } catch {}
  return removed;
}
// FEATURE: extracted from main.js — takes `root` explicitly (same reasoning as safeTarget above).
function recordManifestEntry(root, entry) {
  if (!root) return;
  const list = readJsonList(root, 'observerlauncher-manifest.json').filter(x => x.fileName !== entry.fileName);
  list.push(entry);
  writeJsonList(root, 'observerlauncher-manifest.json', list);
}

module.exports = { writeFileAtomic, readJsonList, writeJsonList, fileHashes, verifyFileHash, findFileRecursive, safeTarget, recordManifestEntry, cleanOrphanTmp };
