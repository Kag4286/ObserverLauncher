// Content / properties / editor / worldmap handlers (extracted from main.js).
const fs = require('fs');
const path = require('path');
const { dialog, shell } = require('electron');
const { serverFiles, emptyServerFiles, buildPropertiesContent } = require('./server-files.js');
const { requiredJavaForJar } = require('./java.js');
const { writeFileAtomic, safeTarget } = require('./fs-utils.js');
const editor = require('./editor.js');
const worldmap = require('./worldmap.js');

function registerContent(ipcMain, ctx) {
  ipcMain.handle('files:get', async () => {
    try {
      const files = serverFiles(ctx.currentServerPath);
      return { ok: true, files, javaRequired: requiredJavaForJar(files.jar) || null };
    } catch (error) {
      return { ok: true, files: emptyServerFiles(), javaRequired: null };
    }
  });

  ipcMain.handle('files:open', async (_, relative) => {
    const target = safeTarget(ctx.currentServerPath, relative);
    if (target && fs.existsSync(target)) await shell.openPath(target);
    return true;
  });

  ipcMain.handle('properties:save', async (_, props) => {
    if (!ctx.currentServerPath) return { ok: false };
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
    writeFileAtomic(path.join(ctx.currentServerPath, 'velocity.toml'), content);
    return { ok: true };
  });

  ipcMain.handle('content:delete', async (_, { kind, fileName }) => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    const levelName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
    const folders = { plugin: 'plugins', mod: 'mods', datapack: path.join(levelName, 'datapacks') };
    const folder = folders[kind];
    if (!folder) return { ok: false, error: 'Unknown content type.' };
    const target = safeTarget(ctx.currentServerPath, path.join(folder, fileName));
    if (!target || !fs.existsSync(target)) return { ok: false, error: 'File not found.' };
    fs.unlinkSync(target);
    return { ok: true, files: serverFiles(ctx.currentServerPath) };
  });

  ipcMain.handle('content:import', async (_, kind) => {
    const levelName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
    const folders = { plugin: 'plugins', mod: 'mods', datapack: path.join(levelName, 'datapacks') };
    const folder = folders[kind];
    if (!folder || !ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    const r = await dialog.showOpenDialog(ctx.win, { title: `Import ${kind}`, properties: ['openFile', 'multiSelections'], filters: [{ name: kind === 'datapack' ? 'Datapacks' : 'Java archives', extensions: kind === 'datapack' ? ['zip', 'jar'] : ['jar'] }] });
    if (r.canceled) return { ok: false, cancelled: true };
    const target = safeTarget(ctx.currentServerPath, folder);
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
    for (const file of r.filePaths) fs.copyFileSync(file, path.join(target, path.basename(file)));
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

  ipcMain.handle('worldmap:load', async () => {
    const lvlName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
    return {
      level: await worldmap.readLevel(ctx.currentServerPath, lvlName),
      players: await worldmap.readPlayers(ctx.currentServerPath, lvlName),
      waypoints: worldmap.readWaypoints(ctx.currentServerPath),
      levelName: lvlName
    };
  });
  ipcMain.handle('worldmap:chunks', async (_, dim) => {
    const lvlName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
    const set = worldmap.scanExploredChunks(ctx.currentServerPath, lvlName, dim || 'overworld');
    return { ok: true, dim: dim || 'overworld', chunks: [...set], truncated: set.size >= 200000 };
  });
  ipcMain.handle('worldmap:waypoints:set', async (_, list) => worldmap.writeWaypoints(ctx.currentServerPath, Array.isArray(list) ? list : []));
}

module.exports = { registerContent };
