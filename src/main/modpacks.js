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
// ============ MODPACK COMPATIBILITY (0.8.0) ============
// A .mrpack declares its target in modrinth.index.json's `dependencies`:
//   { "minecraft": "1.20.1", "forge": "47.2.0" }  (or neoforge / fabric-loader / quilt-loader)
// Import used to ignore this entirely, so a Fabric 1.20.1 pack could be dropped into a Paper
// 1.21 server and silently break. These helpers are pure (no I/O) so the mapping is unit-tested.
const LOADER_KEYS = ['neoforge', 'forge', 'fabric-loader', 'quilt-loader'];
// Finer loader detection than server-files.detectSoftware (which folds forge+neoforge into 'forge'):
// compatibility needs to tell Forge from NeoForge and Fabric from Quilt.
function detectServerCompat(info) {
  const name = String((info && (info.jar || info.launchScript)) || '').toLowerCase();
  if (/velocity|bungee|waterfall/.test(name)) return { mc: null, loader: 'proxy' };
  if (/neoforge/.test(name)) return { mc: mcFromJar(name), loader: 'neoforge' };
  if (/forge/.test(name)) return { mc: mcFromJar(name), loader: 'forge' };
  if (/quilt/.test(name)) return { mc: mcFromJar(name), loader: 'quilt' };
  if (/fabric/.test(name)) return { mc: mcFromJar(name), loader: 'fabric' };
  if (/paper|purpur|leaf|folia/.test(name) || (info && info.hasSpigotConfig)) return { mc: mcFromJar(name), loader: 'paper' };
  return { mc: mcFromJar(name), loader: 'vanilla' };
}
function mcFromJar(name) {
  const m = String(name || '').match(/\b(1\.\d{1,2}(?:\.\d{1,2})?|26\.\d{1,2})\b/);
  return m ? m[1] : null;
}
// Compare a pack's declared dependencies against the current server.
//   deps:   index.dependencies (may be missing/empty)
//   server: { mc, loader } from detectServerCompat
// Returns { mc:{want,have,ok}, loader:{want,have,ok}, warnings:[...] } — warnings empty = compatible.
function mrpackCompat(deps, server) {
  deps = deps || {};
  server = server || {};
  const wantMc = deps.minecraft || null;
  const loaderKey = LOADER_KEYS.find(k => deps[k]);
  const wantLoader = loaderKey || null;
  const warnings = [];
  const mc = { want: wantMc, have: server.mc || null, ok: true };
  // Only flag a MISMATCH when both sides are known — unknown version is not a warning.
  if (wantMc && server.mc && wantMc !== server.mc) { mc.ok = false; warnings.push('mc'); }
  const loader = { want: wantLoader, have: server.loader || null, ok: true };
  if (wantLoader) {
    const h = server.loader;
    // Quilt/Fabric are interchangeable at the loader level for compatibility purposes.
    const fabricGroup = ['fabric', 'quilt'];
    const ok =
      (wantLoader === 'forge' && h === 'forge') ||
      (wantLoader === 'neoforge' && h === 'neoforge') ||
      (wantLoader === 'fabric-loader' && fabricGroup.includes(h)) ||
      (wantLoader === 'quilt-loader' && fabricGroup.includes(h));
    if (h && !ok) { loader.ok = false; warnings.push('loader'); }
  } else {
    // Pack declares no loader → vanilla pack. Warn if the server runs a mod loader, since the
    // pack's files may still be fine but the expectation differs.
    if (server.loader && server.loader !== 'vanilla' && server.loader !== 'paper') { loader.ok = true; }
  }
  return { mc, loader, warnings };
}

// Shared with the MCP export_modpack tool so the two exports can't drift. Pure-ish (reads the
// server folder) but no Electron dialog — the caller does the user-facing warnings.
function buildMrpackEntries(root, manifest, destFolders) {
  const { fileHashes, safeTarget } = require('./fs-utils.js');
  const out = [];
  for (const entry of manifest) {
    const folder = destFolders[entry.kind] || 'plugins';
    // SECURITY: entry.fileName comes from a hand-editable manifest on disk. Only accept a plain
    // basename and resolve through safeTarget, so a crafted entry can neither escape the server
    // folder nor step into another subfolder.
    const fileName = String(entry.fileName || '');
    if (!fileName || fileName !== path.basename(fileName)) continue;
    const fp = safeTarget(root, path.join(folder, fileName));
    if (!fp || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) continue;
    const st = fs.statSync(fp);
    out.push({ path: `${folder.replace(/\\/g, '/')}/${fileName}`, hashes: fileHashes(fp), downloads: [entry.sourceUrl], fileSize: st.size, env: { client: 'optional', server: 'required' } });
  }
  return out;
}
// Real Modrinth dependencies (MC version + loader) from the detected server, so other launchers
// know what to build. Paper-like servers get only `minecraft`.
function dependenciesFor(serverInfo) {
  const sc = detectServerCompat(serverInfo);
  const dependencies = {};
  if (sc.mc) dependencies.minecraft = sc.mc;
  const loaderKey = { neoforge: 'neoforge', forge: 'forge', fabric: 'fabric-loader', quilt: 'quilt-loader' }[sc.loader];
  if (loaderKey) dependencies[loaderKey] = 'latest';
  return dependencies;
}

async function importMrpackFromPath(ctx, mrpackPath, onInfo, source = 'local') {
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
    // COMPAT: compare the pack's declared loader/MC against the current server. For a local
    // import we ask the user before installing a mismatched pack ("Install anyway" allowed);
    // for the Marketplace path the renderer already shows a warning panel, so we only report.
    const compat = mrpackCompat(index.dependencies, detectServerCompat(serverFiles(ctx.currentServerPath)));
    if (compat.warnings.length) {
      onInfo?.({ phase: 'compat', warnings: compat.warnings, mc: compat.mc, loader: compat.loader });
      if (source === 'local') {
        const lines = [];
        if (compat.warnings.includes('mc')) lines.push(`• Minecraft version: pack targets ${compat.mc.want}, this server is ${compat.mc.have}`);
        if (compat.warnings.includes('loader')) lines.push(`• Loader: pack targets ${compat.loader.want}, this server is ${compat.loader.have}`);
        const choice = await dialog.showMessageBox(ctx.win, {
          type: 'warning', buttons: ['Cancel', 'Install anyway'], defaultId: 0, cancelId: 0,
          title: 'Modpack may not be compatible',
          message: 'This modpack does not match your server:',
          detail: lines.join('\n') + '\n\nInstalling it may make the server fail to start. Continue anyway?'
        });
        if (choice.response !== 1) return { ok: false, cancelled: true };
      }
    }
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
      // List EVERY override that would replace an existing file (not just server.properties/eula.txt),
      // so the user sees exactly what the pack is about to overwrite. `sensitive` (config the user
      // edited by hand) gets a stronger warning; anything else is still listed for transparency.
      const sensitiveSet = new Set(['server.properties', 'eula.txt']);
      const clobbered = [];
      const walk = (rel) => {
        let entries; try { entries = fs.readdirSync(path.join(overridesDir, rel), { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) { walk(r); continue; }
          if (fs.existsSync(path.join(ctx.currentServerPath, r))) clobbered.push(r);
        }
      };
      walk('');
      let proceed = true;
      if (clobbered.length) {
        const sensitiveHit = clobbered.filter(f => sensitiveSet.has(f));
        const head = clobbered.slice(0, 8).join('\n');
        const more = clobbered.length > 8 ? `\n…and ${clobbered.length - 8} more` : '';
        const detail = head + more + (sensitiveHit.length ? '\n\n⚠ This includes server.properties/eula.txt you may have configured yourself.' : '');
        const choice = await dialog.showMessageBox(ctx.win, {
          type: 'warning', buttons: ['Cancel', 'Overwrite'], defaultId: 0, cancelId: 0,
          title: 'Modpack will overwrite existing files',
          message: `This modpack includes ${clobbered.length} file(s) that already exist in your server folder and would be replaced:`,
          detail: detail + '\n\nOverwrite them?'
        });
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
      return await importMrpackFromPath(ctx, tempMrpack, info => ctx.send('market:progress', info), 'market');
    } catch (error) { return marketplaceError(error); }
    finally { try { if (tempMrpack) fs.rmSync(tempMrpack, { force: true }); } catch {} }
  });

  ipcMain.handle('modpack:import', async () => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    const picked = await dialog.showOpenDialog(ctx.win, { title: 'Import a modpack (.mrpack)', properties: ['openFile'], filters: [{ name: 'Modrinth modpack', extensions: ['mrpack', 'zip'] }] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
    return importMrpackFromPath(ctx, picked.filePaths[0], undefined, 'local');
  });

  ipcMain.handle('modpack:export', async () => {
    let stagingDir;
    try {
      if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
      const manifest = readJsonList(ctx.currentServerPath, 'observerlauncher-manifest.json');
      if (!manifest.length) return { ok: false, error: 'Nothing to export yet — only plugins/mods installed through the Marketplace are tracked. Manually copied files can\'t be traced back to a download URL.' };
      const server = serverFiles(ctx.currentServerPath);
      const levelName = server.properties['level-name'] || 'world';
      const destFolders = { plugin: 'plugins', forge: 'mods', fabric: 'mods', datapack: path.join(levelName, 'datapacks'), mod: 'mods' };
      const files = [];
      // Shared with the MCP export_modpack tool so the two can never drift.
      files.push(...buildMrpackEntries(ctx.currentServerPath, manifest, destFolders));
      const tracked = new Set(files.map(f => f.path));
      if (!files.length) return { ok: false, error: 'None of the previously installed plugins/mods still exist on disk.' };
      // Warn about jars that are NOT tracked (manually copied) — they will be left out of the pack,
      // which can surprise the user when a friend imports it and something is missing.
      const untracked = [];
      for (const [folder, list] of [['plugins', server.plugins], ['mods', server.mods]]) {
        for (const name of (list || [])) if (!tracked.has(`${folder}/${name}`)) untracked.push(name);
      }
      if (untracked.length) {
        const choice = await dialog.showMessageBox(ctx.win, {
          type: 'info', buttons: ['Continue', 'Cancel'], defaultId: 0, cancelId: 1,
          title: 'Some files can\'t be exported',
          message: `${untracked.length} plugin/mod file(s) weren't installed through the Marketplace and can't be traced to a download URL.`,
          detail: untracked.slice(0, 8).join('\n') + (untracked.length > 8 ? `\n…and ${untracked.length - 8} more` : '') + '\n\nThey will be left out of the exported pack. Continue?'
        });
        if (choice.response !== 0) return { ok: false, cancelled: true };
      }
      const folderName = path.basename(ctx.currentServerPath) || 'ObserverLauncher server';
      // Write real dependencies (MC version + loader) so other launchers know what to build.
      // Paper-like servers get only `minecraft` (Modrinth has no "paper" loader key; paper packs
      // are usually distributed as plugin lists, not loader packs).
      const dependencies = dependenciesFor(server);
      const index = { formatVersion: 1, game: 'minecraft', versionId: `${folderName}-${Date.now()}`, name: folderName, summary: `Exported from ObserverLauncher — ${files.length} item(s).`, files, dependencies };
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

module.exports = { importMrpackFromPath, registerModpacks, mrpackCompat, detectServerCompat, mcFromJar, buildMrpackEntries, dependenciesFor };
