// Content / properties / editor / worldmap handlers (extracted from main.js).
const fs = require('fs');
const path = require('path');
// B1 (v3.0.0): no top-level electron require (throws in plain Node). `dialog`/`shell` are
// required LAZILY inside the two GUI-only handlers that use them (files:open, content:import).
const { serverFiles, emptyServerFiles, buildPropertiesContent } = require('./server-files.js');
const { requiredJavaForServer } = require('./server-java.js');
const { writeFileAtomic, safeTarget } = require('./fs-utils.js');
const editor = require('./editor.js');
const worldmap = require('./worldmap.js');

function registerContent(ipcMain, ctx) {
  ipcMain.handle('files:get', async () => {
    try {
      const files = serverFiles(ctx.currentServerPath);
      return { ok: true, files, javaRequired: requiredJavaForServer(ctx.currentServerPath, serverFiles) || null };
    } catch (error) {
      return { ok: true, files: emptyServerFiles(), javaRequired: null };
    }
  });

  ipcMain.handle('files:open', async (_, relative) => {
    const target = safeTarget(ctx.currentServerPath, relative);
    if (target && fs.existsSync(target)) {
      const { shell } = require('electron'); // GUI-only: opens a file in the OS default app
      await shell.openPath(target);
    }
    return true;
  });

  // v4.0.0 UX: reveal a file/dir IN the OS file manager (Explorer/Finder highlights it).
  // Unlike files:open (which launches the default app for a file), this shows the containing
  // folder with the item selected — the natural "where is this on disk?" action. Path is
  // confined to the server root via safeTarget; a plain folder opens directly.
  ipcMain.handle('files:reveal', async (_, relative) => {
    const target = safeTarget(ctx.currentServerPath, relative);
    if (!target || !fs.existsSync(target)) return { ok: false };
    try {
      const { shell } = require('electron'); // GUI-only
      if (fs.statSync(target).isDirectory()) await shell.openPath(target);
      else shell.showItemInFolder(target);
      return { ok: true };
    } catch { return { ok: false }; }
  });

  ipcMain.handle('properties:save', async (_, props) => {
    if (!ctx.currentServerPath) return { ok: false };
    // SECURITY: cap the total size so a runaway/oversized payload can't write a huge file.
    let total = 0;
    for (const [k, v] of Object.entries(props || {})) total += String(k).length + String(v).length;
    if (total > 1024 * 1024) return { ok: false, error: 'Properties payload is too large (max 1 MB).' };
    writeFileAtomic(path.join(ctx.currentServerPath, 'server.properties'), buildPropertiesContent(ctx.currentServerPath, props));
    return { ok: true };
  });

  ipcMain.handle('properties:raw-get', async () => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    try { return { ok: true, content: fs.readFileSync(path.join(ctx.currentServerPath, 'velocity.toml'), 'utf8') }; }
    catch { return { ok: true, content: '' }; }
  });

  ipcMain.handle('properties:raw-save', async (_, content) => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    if (String(content || '').length > 1024 * 1024) return { ok: false, error: 'velocity.toml is too large (max 1 MB).' };
    writeFileAtomic(path.join(ctx.currentServerPath, 'velocity.toml'), content);
    return { ok: true };
  });

  ipcMain.handle('content:delete', async (_, { kind, fileName }) => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    const levelName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
    const folders = { plugin: 'plugins', mod: 'mods', datapack: path.join(levelName, 'datapacks') };
    const folder = folders[kind];
    if (!folder) return { ok: false, error: 'Unknown content type.' };
    // SECURITY: fileName arrives from the renderer (or an MCP delete_content call). Require a plain
    // basename — `../../server.properties` stays inside the server root so safeTarget alone would
    // allow it, letting a crafted name delete files OUTSIDE plugins/mods/datapacks.
    if (typeof fileName !== 'string' || !fileName || path.basename(fileName) !== fileName) {
      return { ok: false, error: 'Invalid file name.' };
    }
    const target = safeTarget(ctx.currentServerPath, path.join(folder, fileName));
    if (!target || !fs.existsSync(target)) return { ok: false, error: 'File not found.' };
    // CB1 (v3.3.0): an unzipped datapack is a directory — unlinkSync throws on it. Detect the
    // type first and remove a directory recursively (a file keeps the unlinkSync path).
    let isDir = false;
    try { isDir = fs.statSync(target).isDirectory(); } catch {}
    try {
      isDir ? fs.rmSync(target, { recursive: true, force: true }) : fs.unlinkSync(target);
    } catch {
      // BUGFIX (#8): on Windows a running server keeps plugin/mod jars open, so unlink
      // fails with EBUSY/EPERM. Return a clear error instead of rejecting the IPC,
      // which used to leave the renderer hanging with no toast.
      return { ok: false, error: `Could not delete ${fileName} — it may be locked by the running server. Stop the server and try again.` };
    }
    return { ok: true, files: serverFiles(ctx.currentServerPath) };
  });

  // CB6 (v3.3.0): enable/disable a content file by renaming <name> <-> <name>.disabled. Shared
  // with the MCP toggle_content tool via content-ops.js so the naming + path logic cannot drift.
  ipcMain.handle('content:toggle', async (_, { kind, fileName, action }) => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    const { toggleContent } = require('./content-ops.js');
    const r = toggleContent(ctx.currentServerPath, kind || 'plugin', String(fileName || ''), action);
    if (!r.ok) return r;
    return { ok: true, from: r.from, to: r.to, files: serverFiles(ctx.currentServerPath) };
  });

  // CB4/CB5 (v3.3.0): update lifecycle in the GUI. Read-only check + a write that installs newer
  // builds (backs up the old file). Update is refused while the server runs (Windows locks jars).
  ipcMain.handle('content:updates', async () => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    try { const { checkUpdates } = require('./content-updates.js'); return await checkUpdates(ctx.currentServerPath); }
    catch (e) { return { ok: false, error: e?.message || 'Could not check for updates.' }; }
  });
  ipcMain.handle('content:update', async (_, { names } = {}) => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    if (ctx.serverProcess) return { ok: false, error: 'Stop the server before updating content - a running server locks its jars.' };
    try {
      const { applyUpdates } = require('./content-updates.js');
      const r = await applyUpdates(ctx.currentServerPath, { names: Array.isArray(names) ? names : null });
      return { ...r, files: serverFiles(ctx.currentServerPath) };
    } catch (e) { return { ok: false, error: e?.message || 'Could not update content.' }; }
  });

  ipcMain.handle('content:import', async (_, kind) => {
    const levelName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
    const folders = { plugin: 'plugins', mod: 'mods', datapack: path.join(levelName, 'datapacks') };
    const folder = folders[kind];
    if (!folder || !ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    const { dialog } = require('electron'); // GUI-only: the file-picker below
    const r = await dialog.showOpenDialog(ctx.win, { title: `Import ${kind}`, properties: ['openFile', 'multiSelections'], filters: [{ name: kind === 'datapack' ? 'Datapacks' : 'Java archives', extensions: kind === 'datapack' ? ['zip', 'jar'] : ['jar'] }] });
    if (r.canceled) return { ok: false, cancelled: true };
    const target = safeTarget(ctx.currentServerPath, folder);
    // Defensive: safeTarget returns null when the path escapes the server root (e.g. a weird
    // level-name). Without this guard, fs.mkdirSync(null) would throw inside the handler and
    // reject the IPC. The folder is a fixed literal today, but the level-name is user-controlled.
    if (!target) return { ok: false, error: 'Could not resolve the destination folder inside the server.' };
    fs.mkdirSync(target, { recursive: true });
    const MAX_IMPORT_BYTES = 500 * 1024 * 1024;
    for (const file of r.filePaths) {
      let stat;
      try { stat = fs.statSync(file); } catch { return { ok: false, error: `${path.basename(file)} could not be read.` }; }
      if (stat.size > MAX_IMPORT_BYTES) return { ok: false, error: `${path.basename(file)} is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max 500 MB per file.` };
      if (stat.size === 0) return { ok: false, error: `${path.basename(file)} is empty.` };
      const ext = path.extname(file).toLowerCase();
      if (kind === 'datapack' && !['.zip', '.jar'].includes(ext)) return { ok: false, error: `${path.basename(file)} is not a .zip/.jar datapack.` };
      if (kind !== 'datapack' && ext !== '.jar') return { ok: false, error: `${path.basename(file)} is not a .jar file.` };
    }
    // BUGFIX (#8): a running server can lock an existing jar of the same name, so
    // copyFileSync may fail (EBUSY/EPERM). Report which file failed instead of
    // rejecting the IPC and leaving the UI stuck.
    for (const file of r.filePaths) {
      try { fs.copyFileSync(file, path.join(target, path.basename(file))); }
      catch { return { ok: false, error: `${path.basename(file)} could not be copied — it may be locked by the running server. Stop the server and try again.` }; }
    }
    return { ok: true, files: serverFiles(ctx.currentServerPath) };
  });

  ipcMain.handle('editor:open', async (_, rel) => {
    const r = editor.openFile(ctx.currentServerPath, rel);
    if (r.ok) ctx.edWatchFile(safeTarget(ctx.currentServerPath, rel), r.mtime);
    return r;
  });
  ipcMain.handle('editor:save', async (_, { rel, content, baseMtime, force }) => {
    const r = editor.saveFile(ctx.currentServerPath, rel, content, baseMtime, force);
    if (r.ok) ctx.edWatchMtime = r.mtime;
    return r;
  });
  ipcMain.handle('editor:list', async () => editor.listFiles(ctx.currentServerPath));

  // Never rejects: the Map tab renders the 'none' view on {level:null} and
  // toasts r.error — a throw here used to leave the tab blank with no message.
  ipcMain.handle('worldmap:load', async () => {
    try {
      const lvlName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
      return {
        level: await worldmap.readLevel(ctx.currentServerPath, lvlName),
        players: await worldmap.readPlayers(ctx.currentServerPath, lvlName),
        waypoints: worldmap.readWaypoints(ctx.currentServerPath),
        dimensions: worldmap.listDimensions(ctx.currentServerPath, lvlName),
        levelName: lvlName
      };
    } catch (error) {
      return { level: null, players: { players: [] }, waypoints: [], levelName: 'world', error: error?.message || 'Could not read world data.' };
    }
  });
  ipcMain.handle('worldmap:chunks', async (_, dim) => {
    try {
      const lvlName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
      const set = worldmap.scanExploredChunks(ctx.currentServerPath, lvlName, dim || 'overworld');
      return { ok: true, dim: dim || 'overworld', chunks: [...set], truncated: set.size >= 200000 };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not scan chunks.' };
    }
  });
  ipcMain.handle('worldmap:waypoints:set', async (_, list) => {
    // SECURITY: cap count + total size so a runaway list can't write a huge JSON file.
    const arr = Array.isArray(list) ? list : [];
    if (arr.length > 500 || JSON.stringify(arr).length > 512 * 1024) return { ok: false, error: 'Waypoint list is too large (max 500).' };
    return worldmap.writeWaypoints(ctx.currentServerPath, arr);
  });

  // Real biome preview: reads the actual paletted biome containers from region files.
  // The rect is the chunk range visible in the viewport, so only intersecting regions
  // (and only in-view chunks) are parsed. Never rejects — the map falls back to the
  // seed-coloured approximation on {ok:false}.
  ipcMain.handle('worldmap:biomes', async (_, rect) => {
    try {
      const lvlName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
      const dim = rect?.dim || 'overworld';
      const out = await worldmap.readBiomes(ctx.currentServerPath, lvlName, dim, {
        cx0: Number(rect?.cx0) || 0, cz0: Number(rect?.cz0) || 0,
        cx1: Number(rect?.cx1) || 0, cz1: Number(rect?.cz1) || 0,
      });
      return { ok: true, ...out };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not read biome data.', biomes: [] };
    }
  });
}

module.exports = { registerContent };
