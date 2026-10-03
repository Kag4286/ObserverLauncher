// content-ops.js (v3.3.0, CB6): enable/disable a content file by renaming <name> <-> <name>.disabled.
//
// WHY: delete is the only way the GUI/MCP could remove a plugin; disabling keeps the file on disk
// (reversible, no re-download) and the server simply stops loading it. Shared by the GUI (content:*)
// and the MCP toggle_content tool so the naming + path logic cannot drift.
const fs = require('fs');
const path = require('path');
const { safeTarget } = require('./fs-utils.js');

// Where a kind's files live, relative to the server root.
function contentFolder(kind, levelName) {
  if (kind === 'datapack') return path.join(levelName || 'world', 'datapacks');
  if (kind === 'mod') return 'mods';
  return 'plugins';
}

// Pure: the target name after an action ('enable' | 'disable' | anything else = toggle).
// Returns null when the action would be a no-op (disable an already-disabled file, etc.).
function toggledName(name, action) {
  const s = String(name || '');
  const isDisabled = /\.disabled$/i.test(s);
  const enable = action === 'enable' || (action !== 'disable' && isDisabled);
  if (enable) return isDisabled ? s.replace(/\.disabled$/i, '') : null;
  return isDisabled ? null : s + '.disabled';
}

// Rename <name> -> its toggled name inside the kind's folder. Refuses a name that is not a plain
// basename (path escape) and reports a locked file clearly (Windows keeps running jars open).
function toggleContent(root, kind, name, action) {
  const raw = String(name || '');
  if (!raw || path.basename(raw) !== raw) return { ok: false, error: 'Invalid file name.' };
  const next = toggledName(raw, action);
  if (!next) return { ok: false, error: (action === 'enable' || /\.disabled$/i.test(raw)) ? 'That file is not disabled.' : 'That file is already disabled.' };
  let levelName = 'world';
  try { levelName = require('./server-files.js').serverFiles(root).properties['level-name'] || 'world'; } catch {}
  const folder = contentFolder(kind, levelName);
  const from = safeTarget(root, path.join(folder, raw));
  const to = safeTarget(root, path.join(folder, next));
  if (!from || !to) return { ok: false, error: 'Could not resolve the file inside the server.' };
  if (!fs.existsSync(from)) return { ok: false, error: 'File not found.' };
  try { fs.renameSync(from, to); }
  catch { return { ok: false, error: `Could not ${raw.endsWith('.disabled') ? 'enable' : 'disable'} ${raw} — it may be locked by the running server. Stop the server and try again.` }; }
  return { ok: true, from: raw, to: next };
}

module.exports = { contentFolder, toggledName, toggleContent };
