// Modpack handlers (.mrpack import/export) — split from marketplace.js.
// Owns: importMrpackFromPath + modpack:install-from-market/import/export.
// Progress events go through ctx.send; renderer wiring untouched.
const fs = require('fs');
const path = require('path');
// B1 (v3.0.0): no top-level electron require (throws in plain Node). tempDir() covers staging
// paths; `dialog` is required lazily inside the GUI-only import/export handlers below.
const { tempDir } = require('./data-dir.js');
const { serverFiles } = require('./server-files.js');
const { readJsonList, fileHashes, safeTarget } = require('./fs-utils.js');
const { json, download, marketplaceError } = require('./http.js');
const platform = require('./platform');
const cf = require('./curseforge.js');
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
  const { dialog } = require('electron'); // GUI-only: the compat/overwrite prompts below
  let tempZip, extractDir;
  try {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    onInfo?.({ phase: 'extract', name: 'Extracting modpack archive…', received: 0, total: 0 });
    const stamp = Date.now();
    tempZip = path.join(tempDir(), `observerlauncher-import-${stamp}.zip`);
    extractDir = path.join(tempDir(), `observerlauncher-import-${stamp}`);
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
      installable.push({ url, dest, name: path.basename(dest), size: file.fileSize || 0, hashes: file.hashes || null });
    }
    // v6.0.0 H1: transactional. Every installed file is journalled; on ANY failure (download error,
    // hash mismatch) the whole import rolls back so a failed pack never leaves a half-written mods/.
    const { FileTransaction } = require('./fs-utils.js');
    const tx = new FileTransaction();
    try {
      // SECURITY (supply-chain): the .mrpack index carries {sha1,sha512} per file - verify it before
      // keeping the downloaded content (a tampered pack/CDN must not silently install a bad jar).
      const { verifyFileHash } = require('./fs-utils.js');
      const done = await installFilesTransactional(tx, installable, {
        onInfo,
        verify: (it) => verifyFileHash(it.dest, it.hashes),
      });
      installed = done.length;
      const overridesDir = path.join(extractDir, 'overrides');
      // DRY (v3.1.0): use the SHARED overrides copy (same logic the CurseForge path uses) instead of a
      // second inline copy. It lists every file that would be clobbered and confirms with the user.
      // The transaction stays open across the copy so a failed copy rolls the whole import back.
      await copyOverridesWithConfirm(ctx, overridesDir, tx);
    } catch (e) {
      // Roll back every file this import wrote, then report the failure.
      const rolledBack = tx.rollback();
      const err = marketplaceError(e);
      return { ...err, rolledBack };
    }
    tx.commit();
    return { ok: true, installed, skipped, name: index.name || 'Modpack', files: serverFiles(ctx.currentServerPath) };
  } catch (error) { return marketplaceError(error); }
  finally { try { if (tempZip) fs.rmSync(tempZip, { force: true }); if (extractDir) fs.rmSync(extractDir, { recursive: true, force: true }); } catch {} }
}

// Install a list of resolved files into the server folder as ONE transaction.
//
// Every destination is journalled BEFORE it is written, so a failure part-way through restores
// the bytes that were there before and removes what was newly created. A pack import that dies
// on file 20 of 25 must not leave the first 19 in mods/ with no way back.
//
// Shared by the .mrpack and the CurseForge path so the two cannot drift; the no-dup guard
// rejects a copied loop.
async function installFilesTransactional(tx, items, opts = {}) {
  const { onInfo, phase = 'modpack', verify, download: dl } = opts;
  const downloadFn = dl || download;
  const installed = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const report = (received, total) => onInfo?.({ phase, index: i + 1, total: items.length, name: it.name, received, fileTotal: total || it.size || 0 });
    onInfo?.({ phase, index: i + 1, total: items.length, name: it.name, received: 0, fileTotal: it.size || 0 });
    fs.mkdirSync(path.dirname(it.dest), { recursive: true });
    tx.touch(it.dest);
    // Individual files inside a modpack (mods/configs): 512 MB each is plenty.
    await downloadFn(it.url, it.dest, report, null, { maxBytes: 512 * 1024 * 1024 });
    if (verify) {
      const vh = verify(it);
      if (!vh.ok) throw new Error(`Modpack file "${it.name}" ${vh.error} Import stopped.`);
    }
    installed.push(it);
  }
  return installed;
}

// Shared overrides copy (used by BOTH the .mrpack and CurseForge import paths). Lists every file
// that would be clobbered before copying, and confirms with the user.
//
// `tx` is the caller's FileTransaction. Every destination the copy would write is journalled
// first, so a copy that dies half-way leaves the original files in place instead of a mixture of
// old and new configs.
async function copyOverridesWithConfirm(ctx, overridesDir, tx) {
  const { dialog } = require('electron'); // GUI-only: the overwrite prompt below
  if (!fs.existsSync(overridesDir)) return { cancelled: false };
  const sensitiveSet = new Set(['server.properties', 'eula.txt']);
  const clobbered = [];
  const walkRel = (rel) => {
    let entries; try { entries = fs.readdirSync(path.join(overridesDir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walkRel(r); continue; }
      const dest = safeTarget(ctx.currentServerPath, r);
      if (!dest) continue; // unsafe path: the copy must not write outside the server folder
      if (tx) tx.touch(dest);
      if (fs.existsSync(dest)) clobbered.push(r);
    }
  };
  walkRel('');
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
      detail: detail + '\n\nOverwrite them?',
    });
    proceed = choice.response === 1;
  }
  if (!proceed) return { cancelled: true };
  fs.cpSync(overridesDir, ctx.currentServerPath, { recursive: true });
  return { cancelled: false };
}

// CurseForge modpack import: resolves each {projectID,fileID} through the CF API (needs the user's
// key), downloads what is distributable, copies overrides, and RETURNS the list of mods whose
// author blocked third-party downloads so the renderer can offer the manual fallback.
async function importCfModpack(ctx, extractDir, index, onInfo) {
  const { dialog } = require('electron'); // GUI-only: the compat prompt below
  const headers = (() => { try { const k = String(require('./settings.js').loadSettings().curseforgeApiKey || '').trim(); return k ? { 'x-api-key': k } : null; } catch { return null; } })();
  if (!headers) return { ok: false, error: 'Importing a CurseForge modpack needs your CurseForge API key. Add it in Settings, then try again.' };
  const name = index.name || 'CurseForge modpack';
  const lf = cf.cfLoaderFromManifest(index.loaders);
  // COMPAT: same check/confirm the .mrpack path uses.
  const loaderKey = { forge: 'forge', neoforge: 'neoforge', fabric: 'fabric-loader', quilt: 'quilt-loader' }[lf.loader];
  const deps = {}; if (index.mc) deps.minecraft = index.mc; if (loaderKey) deps[loaderKey] = lf.version || 'latest';
  const compat = mrpackCompat(deps, detectServerCompat(serverFiles(ctx.currentServerPath)));
  if (compat.warnings.length) {
    onInfo?.({ phase: 'compat', warnings: compat.warnings, mc: compat.mc, loader: compat.loader });
    const lines = [];
    if (compat.warnings.includes('mc')) lines.push(`• Minecraft: pack targets ${compat.mc.want}, this server is ${compat.mc.have}`);
    if (compat.warnings.includes('loader')) lines.push(`• Loader: pack targets ${compat.loader.want}, this server is ${compat.loader.have}`);
    const choice = await dialog.showMessageBox(ctx.win, { type: 'warning', buttons: ['Cancel', 'Install anyway'], defaultId: 0, cancelId: 0, title: 'Modpack may not be compatible', message: 'This modpack does not match your server:', detail: lines.join('\n') + '\n\nContinue anyway?' });
    if (choice.response !== 1) return { ok: false, cancelled: true };
  }
  onInfo?.({ phase: 'extract', name: 'Resolving CurseForge files…', received: 0, total: 0 });
  let resolved;
  try { resolved = await cf.resolveCfFileIds(index.files.map(f => f.fileID), headers); }
  catch (e) { return { ok: false, error: e?.message || 'Could not resolve the modpack files from CurseForge.' }; }
  const { installable, blocked } = cf.partitionCfFiles(resolved);
  const modsFolder = (lf.loader === 'forge' || lf.loader === 'neoforge' || lf.loader === 'fabric' || lf.loader === 'quilt') ? 'mods' : 'plugins';
  const { isSafeDownloadUrl } = require('./validate.js');
  // v6.0.0 H1: the CurseForge path was still best-effort - a download that failed on file 20 of
  // 25 left the first 19 jars in mods/ with no manifest and no way back. It now runs in the same
  // FileTransaction as the .mrpack path, so any failure rolls the whole import back.
  const { FileTransaction, recordManifestEntry } = require('./fs-utils.js');
  const tx = new FileTransaction();
  const files = [];
  for (const f of installable) {
    if (!isSafeDownloadUrl(f.url)) { blocked.push(f); continue; }
    const dest = safeTarget(ctx.currentServerPath, path.join(modsFolder, path.basename(f.fileName || `cf-${f.fileID}.jar`)));
    if (!dest) { blocked.push(f); continue; }
    files.push({ url: f.url, dest, name: path.basename(dest), size: f.fileSize || 0, fileName: path.basename(dest) });
  }
  let installed = 0;
  let done = [];
  try {
    done = await installFilesTransactional(tx, files, { onInfo });
    installed = done.length;
    // The overrides copy runs INSIDE the transaction, so a failed copy rolls the jars back too.
    await copyOverridesWithConfirm(ctx, path.join(extractDir, index.overrides || 'overrides'), tx);
  } catch (e) {
    const rolledBack = tx.rollback();
    return { ok: false, error: e?.message || 'The CurseForge modpack import failed.', rolledBack };
  }
  tx.commit();
  // The manifest is written only AFTER the transaction commits. Writing it during the loop left
  // entries pointing at files a rollback had already deleted.
  for (const f of done) {
    try { recordManifestEntry(ctx.currentServerPath, { kind: modsFolder === 'mods' ? 'mod' : 'plugin', fileName: f.fileName, sourceUrl: f.url, source: 'curseforge', installedAt: new Date().toISOString() }); } catch {}
  }
  return { ok: true, installed, blocked, name, destFolder: modsFolder, files: serverFiles(ctx.currentServerPath) };
}

// Dispatcher: detect the pack format from the extracted archive and route to the right importer.
async function importModpackFromPath(ctx, modpackPath, onInfo, source = 'local') {
  let tempZip, extractDir;
  try {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    const stamp = Date.now();
    tempZip = path.join(tempDir(), `observerlauncher-import-${stamp}.zip`);
    extractDir = path.join(tempDir(), `observerlauncher-import-${stamp}`);
    fs.copyFileSync(modpackPath, tempZip);
    const r = await platform.extractArchive(tempZip, extractDir);
    if (!r.ok) throw new Error(r.error || 'Could not extract the modpack archive.');
    // Format detection: .mrpack carries modrinth.index.json; a CurseForge pack carries manifest.json.
    const mrIndex = path.join(extractDir, 'modrinth.index.json');
    const cfManifest = path.join(extractDir, 'manifest.json');
    if (fs.existsSync(mrIndex)) return await importMrpackFromPath(ctx, modpackPath, onInfo, source);
    if (fs.existsSync(cfManifest)) {
      let parsed;
      try { parsed = cf.parseCfManifest(JSON.parse(fs.readFileSync(cfManifest, 'utf8'))); }
      catch { return { ok: false, error: 'The manifest.json is not valid JSON.' }; }
      if (!parsed.ok) return { ok: false, error: 'This .zip is not a CurseForge modpack (manifestType is not minecraftModpack).' };
      return await importCfModpack(ctx, extractDir, parsed, onInfo);
    }
    return { ok: false, error: 'Not a valid modpack: it has neither modrinth.index.json (.mrpack) nor manifest.json (CurseForge).' };
  } catch (error) { return marketplaceError(error); }
  finally { try { if (tempZip) fs.rmSync(tempZip, { force: true }); if (extractDir) fs.rmSync(extractDir, { recursive: true, force: true }); } catch {} }
}

function registerModpacks(ipcMain, ctx) {
  const { dialog } = require('electron'); // GUI-only: the file-open dialog below
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
      tempMrpack = path.join(tempDir(), `observerlauncher-market-modpack-${Date.now()}.mrpack`);
      // The .mrpack package itself can be large; cap at 1 GB.
      await download(file.url, tempMrpack, (received, total) => ctx.send('market:progress', { phase: 'pack', name: file.filename, received, total }), null, { maxBytes: 1024 * 1024 * 1024 });
      return await importMrpackFromPath(ctx, tempMrpack, info => ctx.send('market:progress', info), 'market');
    } catch (error) { return marketplaceError(error); }
    finally { try { if (tempMrpack) fs.rmSync(tempMrpack, { force: true }); } catch {} }
  });

  ipcMain.handle('modpack:import', async () => {
    if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    const picked = await dialog.showOpenDialog(ctx.win, { title: 'Import a modpack (.mrpack or CurseForge .zip)', properties: ['openFile'], filters: [{ name: 'Modpack', extensions: ['mrpack', 'zip'] }] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
    return importModpackFromPath(ctx, picked.filePaths[0], undefined, 'local');
  });

  // Verify user-dropped files against a blocked list from a CurseForge import (Prism-style).
  ipcMain.handle('modpack:verify-blocked', async (_, { blocked, destFolder }) => {
    try {
      if (!ctx.currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
      return { ok: true, ...cf.verifyBlockedFiles(ctx.currentServerPath, blocked || [], destFolder || 'mods') };
    } catch (error) { return marketplaceError(error); }
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
      stagingDir = path.join(tempDir(), `observerlauncher-export-${Date.now()}`);
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

module.exports = { importMrpackFromPath, importCfModpack, importModpackFromPath, registerModpacks, mrpackCompat, detectServerCompat, mcFromJar, buildMrpackEntries, dependenciesFor };
