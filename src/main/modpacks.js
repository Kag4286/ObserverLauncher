// Modpack handlers (.mrpack import/export) — split from marketplace.js.
// Owns: importMrpackFromPath + modpack:install-from-market/import/export.
// Progress events go through ctx.send; renderer wiring untouched.
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { serverFiles } = require('./server-files.js');
const { readJsonList, fileHashes, safeTarget } = require('./fs-utils.js');
const { json, download, marketplaceError } = require('./http.js');
const platform = require('./platform');
async function importMrpackFromPath(ctx, mrpackPath, onInfo) {
  let tempZip, extractDir;
  try {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    onInfo?.({ phase: 'extract', name: 'Extracting modpack archive…', received: 0, total: 0 });
    const stamp = Date.now();
    tempZip = path.join(app.getPath('temp'), `observerlauncher-import-${stamp}.zip`);
    extractDir = path.join(app.getPath('temp'), `observerlauncher-import-${stamp}`);
    fs.copyFileSync(mrpackPath, tempZip);
    const r = await platform.extractArchive(tempZip, extractDir);
    if (!r.ok) throw new Error(r.error || 'Could not extract the modpack archive.');
    const indexPath = path.join(extractDir, 'modrinth.index.json');
    if (!fs.existsSync(indexPath)) throw new Error('Not a valid .mrpack file (missing modrinth.index.json).');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    let installed = 0, skipped = 0;
    const installable = [];
    for (const file of index.files || []) {
      if (file.env?.server === 'unsupported') { skipped++; continue; }
      const url = file.downloads?.[0];
      if (!url) { skipped++; continue; }
      const { isSafeDownloadUrl } = require('./validate.js');
      if (!isSafeDownloadUrl(url)) { skipped++; continue; }
      const dest = safeTarget(ctx.currentServerPath, file.path);
      if (!dest) throw new Error(`This modpack's file list contains an unsafe path ("${file.path}") — import stopped for safety.`);
      installable.push({ url, dest, name: path.basename(dest), size: file.fileSize || 0 });
    }
    for (let i = 0; i < installable.length; i++) {
      const f = installable[i];
      onInfo?.({ phase: 'modpack', index: i + 1, total: installable.length, name: f.name, received: 0, fileTotal: f.size });
      fs.mkdirSync(path.dirname(f.dest), { recursive: true });
      await download(f.url, f.dest, (received, total) => onInfo?.({ phase: 'modpack', index: i + 1, total: installable.length, name: f.name, received, fileTotal: total || f.size }));
      installed++;
    }
    const overridesDir = path.join(extractDir, 'overrides');
    if (fs.existsSync(overridesDir)) {
      const sensitive = ['server.properties', 'eula.txt'].filter(f => fs.existsSync(path.join(overridesDir, f)) && fs.existsSync(path.join(ctx.currentServerPath, f)));
      let proceed = true;
      if (sensitive.length) {
        const choice = await dialog.showMessageBox(ctx.win, { type: 'warning', buttons: ['Cancel', 'Overwrite'], defaultId: 0, cancelId: 0, title: 'Modpack wants to overwrite existing config', message: `This modpack includes its own ${sensitive.join(' and ')}, which would replace what you already have configured. Overwrite?` });
        proceed = choice.response === 1;
      }
      if (proceed) fs.cpSync(overridesDir, ctx.currentServerPath, { recursive: true });
    }
    return { ok: true, installed, skipped, name: index.name || 'Modpack', files: serverFiles(ctx.currentServerPath) };
  } catch (error) { return marketplaceError(error); }
  finally { try { if (tempZip) fs.rmSync(tempZip, { force: true }); if (extractDir) fs.rmSync(extractDir, { recursive: true, force: true }); } catch {} }
}

function registerModpacks(ipcMain, ctx) {
  ipcMain.handle('modpack:install-from-market', async (_, { id, version, versionId }) => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    let tempMrpack;
    try {
      const versions = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version`);
      const byVersion = versions.filter(v => !version || (v.game_versions || []).includes(version));
      const hasMrpack = v => (v.files || []).some(f => /\.mrpack$/i.test(f.filename));
      let target = versionId ? versions.find(v => v.id === versionId && hasMrpack(v)) : null;
      if (!target) target = (byVersion.length ? byVersion : versions).find(hasMrpack);
      const file = target?.files?.find(f => /\.mrpack$/i.test(f.filename));
      if (!file) throw new Error('No .mrpack file was found for this modpack.');
      tempMrpack = path.join(app.getPath('temp'), `observerlauncher-market-modpack-${Date.now()}.mrpack`);
      await download(file.url, tempMrpack, (received, total) => ctx.send('market:progress', { phase: 'pack', name: file.filename, received, total }));
      return await importMrpackFromPath(ctx, tempMrpack, info => ctx.send('market:progress', info));
    } catch (error) { return marketplaceError(error); }
    finally { try { if (tempMrpack) fs.rmSync(tempMrpack, { force: true }); } catch {} }
  });

  ipcMain.handle('modpack:import', async () => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    const picked = await dialog.showOpenDialog(ctx.win, { title: 'Import a modpack (.mrpack)', properties: ['openFile'], filters: [{ name: 'Modrinth modpack', extensions: ['mrpack', 'zip'] }] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
    return importMrpackFromPath(ctx, picked.filePaths[0]);
  });

  ipcMain.handle('modpack:export', async () => {
    let stagingDir;
    try {
      if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
      const manifest = readJsonList(ctx.currentServerPath, 'observerlauncher-manifest.json');
      if (!manifest.length) return { ok: false, error: 'Nothing to export yet — only plugins/mods installed through the Marketplace are tracked. Manually copied files can\'t be traced back to a download URL.' };
      const levelName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
      const destFolders = { plugin: 'plugins', forge: 'mods', fabric: 'mods', datapack: path.join(levelName, 'datapacks'), mod: 'mods' };
      const files = [];
      for (const entry of manifest) {
        const folder = destFolders[entry.kind] || 'plugins';
        const filePath = path.join(ctx.currentServerPath, folder, entry.fileName);
        if (!fs.existsSync(filePath)) continue;
        const stat = fs.statSync(filePath);
        files.push({ path: `${folder.replace(/\\/g, '/')}/${entry.fileName}`, hashes: fileHashes(filePath), downloads: [entry.sourceUrl], fileSize: stat.size, env: { client: 'optional', server: 'required' } });
      }
      if (!files.length) return { ok: false, error: 'None of the previously installed plugins/mods still exist on disk.' };
      const folderName = path.basename(ctx.currentServerPath) || 'ObserverLauncher server';
      const index = { formatVersion: 1, game: 'minecraft', versionId: `${folderName}-${Date.now()}`, name: folderName, summary: `Exported from ObserverLauncher — ${files.length} item(s).`, files, dependencies: {} };
      const saveDialog = await dialog.showSaveDialog(ctx.win, { title: 'Export modpack', defaultPath: `${folderName}.mrpack`, filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] });
      if (saveDialog.canceled || !saveDialog.filePath) return { ok: false, cancelled: true };
      stagingDir = path.join(app.getPath('temp'), `observerlauncher-export-${Date.now()}`);
      fs.mkdirSync(path.join(stagingDir, 'overrides'), { recursive: true });
      fs.writeFileSync(path.join(stagingDir, 'modrinth.index.json'), JSON.stringify(index, null, 2));
      try { fs.copyFileSync(path.join(ctx.currentServerPath, 'server.properties'), path.join(stagingDir, 'overrides', 'server.properties')); } catch {}
      const r = await platform.createArchive(stagingDir, saveDialog.filePath);
      if (!r.ok) throw new Error(r.error || 'Could not create the .mrpack archive.');
      return { ok: true, count: files.length, path: saveDialog.filePath };
    } catch (error) { return marketplaceError(error); }
    finally { try { if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {} }
  });
}

module.exports = { importMrpackFromPath, registerModpacks };
