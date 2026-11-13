// In-launcher text file editor — backend.
// Safety rails: extension allowlist, binary sniff, size caps (view 8MB / edit 2MB), path
// traversal protection via safeTarget, atomic writes via writeFileAtomic, and an mtime
// conflict check so two editors never silently overwrite each other.
const fs = require('fs');
const path = require('path');

// .mcfunction = datapack function files; .snbt = structure/NBT text files. Both are plain text and
// are what most folder-based datapacks are made of, so the editor + MCP write/edit can touch them.
const ALLOWED = ['.json', '.txt', '.yml', '.yaml', '.toml', '.properties', '.mcmeta', '.cfg', '.conf', '.js', '.lang', '.csv', '.md', '.mcfunction', '.snbt'];
const MAX_VIEW = 8 * 1024 * 1024;   // 8 MB — beyond this we refuse to load at all
const MAX_EDIT = 2 * 1024 * 1024;   // 2 MB — beyond this the file opens READ-ONLY
const SKIP_DIRS = new Set(['libraries', 'cache', 'logs', 'versions', '.git', 'observerlauncher-backups']);
const LIST_CAP = 800;
const WALK_DEPTH = 5;

function resolveSafe(root, rel) {
  // safeTarget lives in fs-utils; require lazily to keep this module standalone-testable.
  const { safeTarget } = require('./fs-utils.js');
  return safeTarget(root, rel);
}

function extAllowed(rel) {
  return ALLOWED.includes(String(require('path').extname(String(rel || ''))).toLowerCase());
}
function isSkippedPath(root, target) {
  const relFromRoot = path.relative(path.resolve(root || '.'), target);
  if (!relFromRoot || relFromRoot === '') return true;
  const parts = relFromRoot.split(/[\\/]/).filter(Boolean);
  return parts.some(p => SKIP_DIRS.has(p) || p.startsWith('.'));
}
function validateEditorTarget(root, rel) {
  // SECURITY: only allowlisted text extensions are readable/editable, never traversing outside
  // root, and never entering SKIP_DIRS (.git, observerlauncher-backups, libraries, etc.) or hidden files.
  if (!extAllowed(rel)) return { error: 'notAllowed' };
  const target = resolveSafe(root, rel);
  if (!target) return { error: 'notFound' };
  if (isSkippedPath(root, target)) return { error: 'notAllowed' };
  return { target };
}
function openFile(root, rel) {
  const chk = validateEditorTarget(root, rel);
  if (chk.error) return { ok: false, error: chk.error };
  const target = chk.target;
  let stat;
  try { stat = fs.statSync(target); } catch { return { ok: false, error: 'notFound' }; }
  if (!stat.isFile()) return { ok: false, error: 'notFound' };
  if (stat.size > MAX_VIEW) return { ok: false, error: 'tooBig', size: stat.size, maxView: MAX_VIEW };
  let buf;
  try { buf = fs.readFileSync(target); } catch (e) { return { ok: false, error: e.code || 'readError' }; }
  if (buf.slice(0, 8192).includes(0)) return { ok: false, error: 'binary' };
  return {
    ok: true,
    rel: String(rel).replace(/\\/g, '/'),
    content: buf.toString('utf8'),
    mtime: stat.mtimeMs,
    size: stat.size,
    readOnly: stat.size > MAX_EDIT,
  };
}

function saveFile(root, rel, content, baseMtime, force) {
  const chk = validateEditorTarget(root, rel);
  if (chk.error) return { ok: false, error: chk.error };
  const target = chk.target;
  const body = String(content ?? '');
  if (Buffer.byteLength(body, 'utf8') > MAX_EDIT) return { ok: false, error: 'tooBigSave', maxEdit: MAX_EDIT };
  let stat;
  try { stat = fs.statSync(target); } catch { return { ok: false, error: 'notFound' }; }
  if (!force && Number(baseMtime) !== stat.mtimeMs) {
    return { ok: false, conflict: true, mtime: stat.mtimeMs };
  }
  try {
    const { writeFileAtomic } = require('./fs-utils.js');
    writeFileAtomic(target, body);
  } catch (e) { return { ok: false, error: e.code || 'writeError' }; }
  let after;
  try { after = fs.statSync(target); } catch {}
  return { ok: true, mtime: after ? after.mtimeMs : Date.now(), size: Buffer.byteLength(body, 'utf8') };
}

function listFiles(root) {
  if (!root || !fs.existsSync(root)) return { ok: true, files: [] };
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > WALK_DEPTH || out.length >= LIST_CAP) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= LIST_CAP) return;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), relPath, depth + 1);
      } else if (e.isFile()) {
        if (e.name.startsWith('.')) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!ALLOWED.includes(ext)) continue;
        let size = 0;
        try { size = fs.statSync(path.join(dir, e.name)).size; } catch { continue; }
        if (size > MAX_VIEW) continue;
        out.push({ path: relPath, size, ext });
      }
    }
  };
  walk(root, '', 0);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return { ok: true, files: out, capped: out.length >= LIST_CAP };
}

module.exports = { openFile, saveFile, listFiles, ALLOWED, MAX_VIEW, MAX_EDIT, extAllowed };
