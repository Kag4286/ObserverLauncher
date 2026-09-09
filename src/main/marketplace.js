// Marketplace + modpack handlers (extracted from main.js — behaviour unchanged).
//
// Owns: market:versions/search/detail/install, modpack:import,
// modpack:install-from-market, modpack:export. All progress events go
// through ctx.send so the renderer wiring is untouched.
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { serverFiles } = require('./server-files.js');
const { readJsonList, fileHashes, safeTarget, recordManifestEntry } = require('./fs-utils.js');
const { json, download, marketplaceError, psQuote, runPowerShell } = require('./http.js');

async function importMrpackFromPath(ctx, mrpackPath, onInfo) {
  let tempZip, extractDir;
  try {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    onInfo?.({ phase: 'extract', name: 'Extracting modpack archive…', received: 0, total: 0 });
    const stamp = Date.now();
    tempZip = path.join(app.getPath('temp'), `observerlauncher-import-${stamp}.zip`);
    extractDir = path.join(app.getPath('temp'), `observerlauncher-import-${stamp}`);
    fs.copyFileSync(mrpackPath, tempZip);
    const r = await runPowerShell(`Expand-Archive -LiteralPath ${psQuote(tempZip)} -DestinationPath ${psQuote(extractDir)} -Force`, 300000);
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

function registerMarketplace(ipcMain, ctx) {
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
      const r = await runPowerShell(`Compress-Archive -Path ${psQuote(path.join(stagingDir, '*'))} -DestinationPath ${psQuote(saveDialog.filePath)} -Force`, 300000);
      if (!r.ok) throw new Error(r.error || 'Could not create the .mrpack archive.');
      return { ok: true, count: files.length, path: saveDialog.filePath };
    } catch (error) { return marketplaceError(error); }
    finally { try { if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {} }
  });

  ipcMain.handle('market:versions', async () => {
    try {
      const versions = await json('https://api.modrinth.com/v2/tag/game_version');
      const releases = versions.filter(x => x.version_type === 'release').sort((a, b) => new Date(b.date) - new Date(a.date));
      return { ok: true, versions: releases.map(x => x.version) };
    } catch (error) { return marketplaceError(error); }
  });

  ipcMain.handle('market:search', async (_, { source, kind, query, version, sort, offset }) => {
    const skip = Math.max(0, Number(offset) || 0);
    try {
      if (source === 'modrinth') {
        const loaderGroups = {
          plugin: ['loaders:paper', 'loaders:spigot', 'loaders:purpur', 'loaders:folia', 'loaders:bukkit'],
          forge: ['loaders:forge', 'loaders:neoforge'],
          fabric: ['loaders:fabric', 'loaders:quilt'],
        };
        const index = sort === 'latest' ? 'newest' : sort === 'downloads' ? 'downloads' : 'relevance';
        let lastTotal = null;
        const runSearch = async filters => {
          const facets = encodeURIComponent(JSON.stringify(filters));
          const data = await json(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query || '')}&limit=20&offset=${skip}&index=${index}&facets=${facets}`);
          lastTotal = data.total_hits ?? null;
          return data.hits || [];
        };
        let hits, relaxed = null;
        if (kind === 'modpack') {
          hits = await runSearch([['project_type:modpack']]);
        } else if (kind === 'datapack') {
          hits = await runSearch([['project_type:datapack']]);
          if (!hits.length && skip === 0) { hits = await runSearch([['project_type:mod'], ['loaders:datapack']]); if (hits.length) relaxed = 'loader'; }
          if (!hits.length && skip === 0) { hits = await runSearch([['project_type:mod'], ['categories:datapack']]); if (hits.length) relaxed = 'loader'; }
        } else {
          const loaderGroup = loaderGroups[kind] || loaderGroups.plugin;
          let filters = [['project_type:mod'], loaderGroup];
          if (version) filters.push([`versions:${version}`]);
          hits = await runSearch(filters);
          if (!hits.length && skip === 0 && version) { hits = await runSearch([['project_type:mod'], loaderGroup]); if (hits.length) relaxed = 'version'; }
          if (!hits.length && skip === 0) { hits = await runSearch([['project_type:mod']]); if (hits.length) relaxed = 'loader'; }
        }
        return { ok: true, relaxed, total: lastTotal, items: hits.map(x => ({ source, id: x.project_id, title: x.title, author: x.author, description: x.description, icon: x.icon_url, downloads: x.downloads, version, env: x.env || null, loaders: x.loaders || [], date: x.date_created || null })) };
      }
      if (source === 'hangar') {
        const order = sort === 'downloads' ? '-downloads' : sort === 'latest' ? '-updatedAt' : '-stars';
        const data = await json(`https://hangar.papermc.io/api/v1/projects?query=${encodeURIComponent(query || '')}&limit=20&offset=${skip}&sort=${encodeURIComponent(order)}`);
        const rows = data.result || data.projects || [];
        return { ok: true, total: data.pagination?.count ?? null, items: rows.map(x => ({ source, id: `${x.namespace?.owner || x.namespace}/${x.name || x.slug}`, title: x.name || x.slug, author: x.namespace?.owner || x.owner || 'Hangar', description: x.description || '', downloads: x.stats?.downloads || 0, version })) };
      }
      const page = Math.floor(skip / 20) + 1;
      const data = await json(`https://api.spiget.org/v2/search/resources/${encodeURIComponent(query || 'plugin')}?size=20&page=${page}&sort=${sort === 'latest' ? '-releaseDate' : '-downloads'}`);
      return { ok: true, total: null, items: data.map(x => ({ source: 'spigot', id: String(x.id), title: x.name, author: x.author?.username || 'Spigot author', description: x.tag || x.description || '', downloads: x.downloads || 0, version })) };
    } catch (error) { return marketplaceError(error); }
  });

  ipcMain.handle('market:detail', async (_, item) => {
    try {
      if (!item || item.source !== 'modrinth') {
        return { ok: true, title: item?.title || '', description: item?.description || '', icon: item?.icon || '', author: item?.author || '', env: item?.env || null, loaders: item?.loaders || null, versions: null };
      }
      const proj = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}`);
      const versions = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}/version`);
      const map = v => {
        const f = (v.files || []).find(x => x.primary) || (v.files || [])[0] || {};
        return { id: v.id, number: v.version_number, name: v.name || v.version_number, date: v.date_published, gameVersions: v.game_versions || [], loaders: v.loaders || [], size: f.size || 0 };
      };
      return { ok: true, title: proj.title, description: proj.description, body: String(proj.body || '').slice(0, 1500), icon: proj.icon_url || item.icon || '', author: item.author || (proj.owner || ''), env: item.env || null, loaders: item.loaders || null, versions: versions.map(map) };
    } catch (error) { return { ok: false, error: marketplaceError(error).error }; }
  });

  ipcMain.handle('market:install', async (_, item) => {
    try {
      if (!ctx.currentServerPath) return { ok: false, error: 'Choose and apply a server folder first.' };
      const kind = ['forge', 'fabric', 'datapack'].includes(item.kind) ? item.kind : 'plugin';
      const levelName = serverFiles(ctx.currentServerPath).properties['level-name'] || 'world';
      const destFolders = { plugin: 'plugins', forge: 'mods', fabric: 'mods', datapack: path.join(levelName, 'datapacks') };
      const destDir = safeTarget(ctx.currentServerPath, destFolders[kind]);
      fs.mkdirSync(destDir, { recursive: true });
      let url, filename;
      if (item.source === 'modrinth') {
        const versions = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}/version`);
        const wantedLoaders = { plugin: ['paper', 'spigot', 'purpur', 'folia', 'bukkit'], forge: ['forge', 'neoforge'], fabric: ['fabric', 'quilt'], datapack: ['datapack', 'minecraft'] }[kind];
        const byVersion = versions.filter(v => !item.version || (v.game_versions || []).includes(item.version));
        let target = null;
        if (item.versionId) target = versions.find(v => v.id === item.versionId) || null;
        if (!target) {
          target = byVersion.find(v => (v.loaders || []).some(l => wantedLoaders.includes(l))) || byVersion[0] || versions[0];
        }
        if (!target?.files?.[0]) throw new Error('No downloadable version was found.');
        url = target.files.find(f => f.primary)?.url || target.files[0].url;
        filename = target.files.find(f => f.primary)?.filename || target.files[0].filename;
      } else if (item.source === 'hangar') {
        const [owner, slug] = String(item.id).split('/');
        const versions = await json(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/versions?limit=20`);
        const target = (versions.result || []).find(v => v.downloads?.PAPER?.downloadUrl);
        const file = target?.downloads?.PAPER;
        if (!file) throw new Error('No Paper download was found for this Hangar project.');
        url = file.downloadUrl;
        filename = file.fileInfo?.name || `${slug}.jar`;
      } else if (item.source === 'spigot') {
        url = `https://api.spiget.org/v2/resources/${encodeURIComponent(item.id)}/download`;
        filename = `${item.title.replace(/[^\w.-]+/g, '_')}.jar`;
      } else throw new Error('Unsupported marketplace source.');
      const dest = path.join(destDir, path.basename(filename));
      await download(url, dest, (received, total) => ctx.send('market:progress', { phase: 'file', name: filename, received, total }));
      recordManifestEntry(ctx.currentServerPath, { kind, fileName: path.basename(filename), sourceUrl: url, source: item.source, title: item.title, installedAt: new Date().toISOString() });
      return { ok: true, files: serverFiles(ctx.currentServerPath), name: filename };
    } catch (error) { return marketplaceError(error); }
  });
}

module.exports = { importMrpackFromPath, registerMarketplace };
