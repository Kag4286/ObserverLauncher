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
function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}
function readJsonList(root, name) { try { return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); } catch { return []; } }
function writeJsonList(root, name, list) { writeFileAtomic(path.join(root, name), JSON.stringify(list, null, 2)); }
function fileHashes(filePath) {
  const buffer = fs.readFileSync(filePath);
  return { sha1: crypto.createHash('sha1').update(buffer).digest('hex'), sha512: crypto.createHash('sha512').update(buffer).digest('hex') };
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
function safeTarget(root, relative) { const base = path.resolve(root || '.'); const target = path.resolve(base, relative); return target.startsWith(base + path.sep) || target === base ? target : null; }
// FEATURE: extracted from main.js — takes `root` explicitly (same reasoning as safeTarget above).
function recordManifestEntry(root, entry) {
  if (!root) return;
  const list = readJsonList(root, 'observerlauncher-manifest.json').filter(x => x.fileName !== entry.fileName);
  list.push(entry);
  writeJsonList(root, 'observerlauncher-manifest.json', list);
}

module.exports = { writeFileAtomic, readJsonList, writeJsonList, fileHashes, findFileRecursive, safeTarget, recordManifestEntry };
