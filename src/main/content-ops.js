// content-ops.js (v3.3.0, CB6): content operations shared by the GUI and the MCP tools.
//
// WHY: enable/disable, validate and extract all need the SAME name safety + folder resolution,
// so they live here once and the GUI (content:*) and MCP tools both call them. Without this the
// two paths drift (gotcha #20).
const fs = require('fs');
const path = require('path');
const os = require('os');
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

// v6.0.0 C5a: validate a datapack's pack_format against the server's Minecraft version. Reads
// pack.mcmeta from a folder OR a .zip (via jar-read) and classifies the result. Read-only.
// The MC version comes from detectServerTarget, which reads the server jar's version; when that
// is unknown the classifier returns 'unknown' rather than a false 'ok' (see datapack.js).
function validateDatapack(root, name) {
  const raw = String(name || '');
  if (!raw || path.basename(raw) !== raw) return { ok: false, error: 'Invalid file name.' };
  let levelName = 'world';
  try { levelName = require('./server-files.js').serverFiles(root).properties['level-name'] || 'world'; } catch {}
  const target = safeTarget(root, path.join(contentFolder('datapack', levelName), raw));
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'Datapack not found.' };
  const isDir = fs.statSync(target).isDirectory();
  const { readPackMeta, parsePackMeta, classifyFormat } = require('./datapack.js');
  const kind = isDir ? 'folder' : 'zip';
  const metaRaw = readPackMeta(target, isDir);
  if (!metaRaw.ok) return { ok: true, result: { name: raw, kind, level: 'unknown', note: metaRaw.error } };
  const meta = parsePackMeta(metaRaw.text);
  if (meta.error) return { ok: true, result: { name: raw, kind, level: 'warn', note: meta.error } };
  let mc = null;
  try { const { detectServerTarget } = require('./server-compat.js'); mc = (detectServerTarget(root, require('./server-files.js').serverFiles(root)) || {}).mc || null; } catch {}
  return { ok: true, result: { name: raw, kind, mc, ...classifyFormat(meta, mc) } };
}

// v6.0.0 C5b: extract a .zip datapack into a sibling folder. Reuses platform.extractArchive, which
// has the zip-slip guard. A pack zip often wraps everything in ONE top folder; we flatten that so
// pack.mcmeta + data/ land directly in the new folder (matching a hand-made datapack).
async function extractDatapack(root, name, opts) {
  const o = opts || {};
  const raw = String(name || '');
  if (!raw || path.basename(raw) !== raw) return { ok: false, error: 'Invalid file name.' };
  if (!/\.zip$/i.test(raw)) return { ok: false, error: 'Only a .zip datapack can be extracted.' };
  let levelName = 'world';
  try { levelName = require('./server-files.js').serverFiles(root).properties['level-name'] || 'world'; } catch {}
  const folder = contentFolder('datapack', levelName);
  const zipAbs = safeTarget(root, path.join(folder, raw));
  if (!zipAbs || !fs.existsSync(zipAbs)) return { ok: false, error: 'Datapack .zip not found.' };
  const destName = raw.replace(/\.zip$/i, '');
  const destAbs = safeTarget(root, path.join(folder, destName));
  if (!destAbs) return { ok: false, error: 'Unsafe destination path.' };
  if (fs.existsSync(destAbs)) return { ok: false, error: `A folder named ${destName} already exists.` };
  const platform = require('./platform');
  const tmp = path.join(os.tmpdir(), 'ob-dp-' + Date.now());
  try {
    fs.mkdirSync(tmp, { recursive: true });
    const r = await platform.extractArchive(zipAbs, tmp);
    if (!r.ok) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} return { ok: false, error: r.error || 'Could not extract the datapack.' }; }
    let srcRoot = tmp;
    const top = fs.readdirSync(tmp);
    if (top.length === 1 && fs.statSync(path.join(tmp, top[0])).isDirectory()) srcRoot = path.join(tmp, top[0]);
    fs.mkdirSync(destAbs, { recursive: true });
    for (const e of fs.readdirSync(srcRoot)) fs.cpSync(path.join(srcRoot, e), path.join(destAbs, e), { recursive: true });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    if (o.removeZip) { try { fs.rmSync(zipAbs, { force: true }); } catch {} }
    return { ok: true, folder: destName };
  } catch (e) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    return { ok: false, error: e?.message || 'Could not extract the datapack.' };
  }
}

module.exports = { contentFolder, toggledName, toggleContent, validateDatapack, extractDatapack };
