// MCP tool registry. Each tool: { name, risk, description, inputSchema, handler(ctx, args) }.
// risk: 'read' (free) | 'write' (GUI confirm unless autoAllowWrite) | 'destroy' (always confirm).
// Handlers reuse the SAME backend functions the IPC layer uses, so behaviour is identical.
const fs = require('fs');
const path = require('path');
const { serverFiles, readPlayerData, findPlayerDataFile } = require('../main/server-files.js');
const { safeTarget, readJsonList } = require('../main/fs-utils.js');
const { loadSettings } = require('../main/settings.js');
const { startServerInternal, forceStopServer } = require('../main/server-lifecycle.js');
const { createBackupInternal } = require('../main/backups.js');
const { readLevel, readPlayers, readWaypoints } = require('../main/worldmap.js');
const { localIPv4s } = require('../main/network.js');
const { requiredJavaForJar } = require('../main/java.js');
const editor = require('../main/editor.js');
const { json, withTimeout } = require('../main/http.js');
const { importMrpackFromPath } = require('../main/modpacks.js');

const ok = r => (r && typeof r === 'object' && 'ok' in r) ? r : { ok: true, result: r };
const needPath = ctx => { if (!ctx.currentServerPath) throw new Error('No server folder selected.'); return ctx.currentServerPath; };

// ---- READ tools ----
async function tGetStatus(ctx) {
  const s = loadSettings();
  let files = {}; try { files = serverFiles(ctx.currentServerPath); } catch {}
  return { ok: true, result: {
    status: ctx.serverStatus, running: ctx.serverStatus === 'running',
    serverPath: ctx.currentServerPath || null, jar: files.jar || null, launchScript: files.launchScript || null,
    software: ctx.currentSoftware || null, java: ctx.javaInfo || null,
    javaRequired: files.jar ? (requiredJavaForJar(files.jar) || null) : null,
  } };
}
async function tReadConsole(ctx, a) {
  const n = Math.min(Math.max(1, Number(a.lines) || 100), 2000);
  const buf = ctx.consoleBuffer.slice(-n);
  return { ok: true, result: { lines: buf.map(l => `[${l.time}] ${l.text}`), count: buf.length } };
}
async function tListPlayers(ctx) {
  const f = serverFiles(needPath(ctx));
  return { ok: true, result: { online: ctx.live?.players || [], whitelist: f.whitelist || [], banned: f.banned || [], ops: f.ops || [], known: f.knownPlayers || [] } };
}
async function tGetPlayerData(ctx, a) {
  const root = needPath(ctx);
  const uuid = a.uuid || null, name = a.name || null;
  let file = null;
  if (uuid) file = findPlayerDataFile(root, uuid);
  else if (name) file = findPlayerDataFile(root, name);
  if (!file) return { ok: false, error: 'Player data file not found.' };
  const r = readPlayerData(file);
  return ok(r);
}
async function tListFiles(ctx, a) {
  const root = needPath(ctx);
  const rel = a.path || '.';
  const target = safeTarget(root, rel);
  if (!target) return { ok: false, error: 'Path outside the server folder.' };
  const entries = fs.readdirSync(target, { withFileTypes: true }).map(e => ({ name: e.name, dir: e.isDirectory() }));
  return { ok: true, result: { path: rel, entries } };
}
async function tReadFile(ctx, a) {
  const root = needPath(ctx);
  const r = editor.openFile(root, a.path);
  return ok(r);
}
async function tSearchFiles(ctx, a) {
  const root = needPath(ctx);
  const q = String(a.query || '');
  if (!q) return { ok: false, error: 'query is required.' };
  const list = editor.listFiles(root);
  if (!list.ok) return list;
  const files = (list.files || []).slice(0, 2000);
  const hits = [];
  for (const rel of files) {
    const t = safeTarget(root, rel); if (!t) continue;
    let txt; try { const st = fs.statSync(t); if (st.size > 2 * 1024 * 1024) continue; txt = fs.readFileSync(t, 'utf8'); } catch { continue; }
    txt.split(/\r?\n/).forEach((line, i) => { if (line.toLowerCase().includes(q.toLowerCase()) && hits.length < 200) hits.push({ path: rel, line: i + 1, text: line.slice(0, 300) }); });
    if (hits.length >= 200) break;
  }
  return { ok: true, result: { query: q, hits } };
}
async function tListContent(ctx) {
  const f = serverFiles(needPath(ctx));
  return { ok: true, result: { plugins: f.plugins || [], mods: f.mods || [], datapacks: f.datapacks || [], datapackFolder: f.datapackFolder || null } };
}
async function tGetProperties(ctx) {
  return { ok: true, result: serverFiles(needPath(ctx)).properties || {} };
}
async function tGetRawProperties(ctx) {
  const root = needPath(ctx);
  try { return { ok: true, result: fs.readFileSync(path.join(root, 'velocity.toml'), 'utf8') }; }
  catch { return { ok: true, result: '' }; }
}
async function tGetWorldInfo(ctx) {
  const root = needPath(ctx);
  const lvl = serverFiles(root).properties['level-name'] || 'world';
  const level = await readLevel(root, lvl);
  const players = await readPlayers(root, lvl);
  const waypoints = readWaypoints(root);
  return { ok: true, result: { level, players, waypoints } };
}
async function tListWorlds(ctx) {
  return { ok: true, result: serverFiles(needPath(ctx)).worlds || [] };
}
async function tListBackups(ctx) {
  return { ok: true, result: serverFiles(needPath(ctx)).backups || [] };
}
async function tGetNetworkInfo(ctx) {
  const f = serverFiles(ctx.currentServerPath || '');
  const isProxy = /velocity|bungee|waterfall/i.test(f.jar || '');
  return { ok: true, result: { localIps: localIPv4s(), port: Number(f.properties?.['server-port']) || (isProxy ? 25577 : 25565), platform: process.platform } };
}
async function tGetJavaInfo(ctx) { return { ok: true, result: ctx.javaInfo || null }; }
async function tSearchMarketplace(ctx, a) {
  const source = a.source || 'modrinth';
  const kind = a.kind || 'plugin';
  const query = String(a.query || '').trim();
  const version = a.version || '';
  const sort = a.sort || 'downloads';
  if (source !== 'modrinth') return { ok: false, error: 'Only source=modrinth is supported by the MCP search tool for now.' };
  // Facets mirror src/main/marketplace.js: Modrinth expects an array of OR-groups (each inner
  // array = alternatives). Building it as string-quoted fragments (the old code) produced a
  // double-encoded, wrong filter. Plugin/mod loaders use the same groups the GUI search uses.
  const loaderGroups = {
    plugin: ['loaders:paper', 'loaders:spigot', 'loaders:purpur', 'loaders:folia', 'loaders:bukkit'],
    forge: ['loaders:forge', 'loaders:neoforge'],
    fabric: ['loaders:fabric', 'loaders:quilt'],
  };
  const filters = [];
  if (kind === 'modpack') filters.push(['project_type:modpack']);
  else if (kind === 'datapack') filters.push(['project_type:datapack']);
  else {
    filters.push(['project_type:mod']);
    filters.push(loaderGroups[kind] || loaderGroups.plugin);
  }
  if (version) filters.push(['versions:' + version]);
  let url = 'https://api.modrinth.com/v2/search?query=' + encodeURIComponent(query) + '&limit=20&index=' + (sort === 'latest' ? 'newest' : 'downloads') + '&facets=' + encodeURIComponent(JSON.stringify(filters));
  const { signal, cancel } = withTimeout(15000);
  try {
    const r = await fetch(url, { signal });
    const d = await r.json();
    const items = (d.hits || []).map(h => ({ id: h.project_id, title: h.title, description: h.description, author: h.author, downloads: h.downloads, icon: h.icon_url, source: 'modrinth' }));
    return { ok: true, result: { total: d.total_hits, items } };
  } catch (e) { return { ok: false, error: e?.message || 'Search failed.' }; }
  finally { cancel(); }
}
async function tListMarketVersions(ctx, a) {
  const id = String(a.id || '');
  if (!id) return { ok: false, error: 'id is required.' };
  const r = await json('https://api.modrinth.com/v2/project/' + encodeURIComponent(id) + '/version');
  const versions = (r || []).map(v => ({ id: v.id, number: v.version_number, gameVersions: v.game_versions, loaders: v.loaders, date: v.date_published }));
  return { ok: true, result: versions };
}

// ---- WRITE tools ----
async function tStartServer(ctx) { return ok(await startServerInternal(ctx, loadSettings())); }
async function tSendCommand(ctx, a) {
  const cmd = String(a.command || '').trim();
  if (!cmd) return { ok: false, error: 'command is required.' };
  if (/[\r\n]/.test(cmd)) return { ok: false, error: 'Command must be single-line.' };
  if (!ctx.serverProcess) return { ok: false, error: 'Server is not running.' };
  ctx.serverProcess.stdin.write(cmd + '\r\n');
  ctx.lastManualCommandAt = Date.now();
  ctx.appendLog('> ' + cmd, 'command');
  return { ok: true };
}
async function tSetProperty(ctx, a) {
  const root = needPath(ctx);
  const key = String(a.key || ''); const val = String(a.value == null ? '' : a.value);
  if (!key) return { ok: false, error: 'key is required.' };
  const f = serverFiles(root).properties || {};
  f[key] = val;
  const { buildPropertiesContent } = require('../main/server-files.js');
  const { writeFileAtomic } = require('../main/fs-utils.js');
  writeFileAtomic(path.join(root, 'server.properties'), buildPropertiesContent(root, f));
  return { ok: true };
}
async function tSetRawProperties(ctx, a) {
  const root = needPath(ctx);
  const content = String(a.content || '');
  if (content.length > 1024 * 1024) return { ok: false, error: 'Content too large (max 1 MB).' };
  const { writeFileAtomic } = require('../main/fs-utils.js');
  writeFileAtomic(path.join(root, 'velocity.toml'), content);
  return { ok: true };
}
// SECURITY: write/edit only touch the SAME allowlisted text extensions the built-in editor
// accepts (editor.ALLOWED). Without this an AI could overwrite a .jar/.dat with text — silently
// corrupting a plugin or player file — via a plain 'write' tier tool.
function assertEditable(aPath) {
  const ext = path.extname(String(aPath || '')).toLowerCase();
  if (!editor.ALLOWED.includes(ext)) throw new Error('Refused: "' + ext + '" is not an editable text type. Allowed: ' + editor.ALLOWED.join(', '));
}
async function tWriteFile(ctx, a) {
  const root = needPath(ctx);
  const target = safeTarget(root, a.path);
  if (!target) return { ok: false, error: 'Path outside the server folder.' };
  assertEditable(a.path);
  if (String(a.content || '').length > 2 * 1024 * 1024) return { ok: false, error: 'Content too large (max 2 MB).' };
  const { writeFileAtomic } = require('../main/fs-utils.js');
  writeFileAtomic(target, String(a.content || ''));
  return { ok: true };
}
async function tEditFile(ctx, a) {
  const root = needPath(ctx);
  const target = safeTarget(root, a.path);
  if (!target) return { ok: false, error: 'Path outside the server folder.' };
  assertEditable(a.path);
  let txt; try { txt = fs.readFileSync(target, 'utf8'); } catch { return { ok: false, error: 'File not found.' }; }
  const oldS = String(a.oldString || ''), newS = String(a.newString || '');
  if (!oldS) return { ok: false, error: 'oldString is required.' };
  if (!txt.includes(oldS)) return { ok: false, error: 'oldString not found in file.' };
  const { writeFileAtomic } = require('../main/fs-utils.js');
  writeFileAtomic(target, txt.replace(oldS, newS));
  return { ok: true };
}
async function tCreateBackup(ctx) { return ok(await createBackupInternal(ctx)); }
async function tInstallFromMarket(ctx, a) {
  const id = String(a.id || '');
  if (!id) return { ok: false, error: 'id is required.' };
  const kind = ['forge', 'fabric', 'datapack', 'mod'].includes(a.kind) ? a.kind : 'plugin';
  const version = a.version || '';
  const versions = await json('https://api.modrinth.com/v2/project/' + encodeURIComponent(id) + '/version');
  if (!Array.isArray(versions) || !versions.length) return { ok: false, error: 'No versions found for this project.' };
  // Mirror market:install: pick by explicit versionId, else by MC version + the right loader group,
  // never blindly versions[0] (which can be the wrong game version or a client-only build).
  const wantedLoaders = { plugin: ['paper', 'spigot', 'purpur', 'folia', 'bukkit'], forge: ['forge', 'neoforge'], mod: ['forge', 'neoforge'], fabric: ['fabric', 'quilt'], datapack: ['datapack', 'minecraft'] }[kind];
  const byVersion = versions.filter(v => !version || (v.game_versions || []).includes(version));
  let target = a.versionId ? versions.find(v => v.id === a.versionId) : null;
  if (!target) target = byVersion.find(v => (v.loaders || []).some(l => wantedLoaders.includes(l))) || byVersion[0] || versions[0];
  if (!target) return { ok: false, error: 'No matching version.' };
  const file = (target.files || []).find(f => f.primary) || (target.files || []).find(f => /\.jar$|\.zip$/i.test(f.filename)) || (target.files || [])[0];
  if (!file) return { ok: false, error: 'No downloadable file.' };
  const { isSafeDownloadUrl } = require('../main/validate.js');
  if (!isSafeDownloadUrl(file.url)) return { ok: false, error: 'Refused: download URL is not an allowlisted public host.' };
  const root = needPath(ctx);
  const folder = kind === 'datapack' ? path.join(serverFiles(root).properties['level-name'] || 'world', 'datapacks') : (kind === 'mod' || kind === 'forge' || kind === 'fabric') ? 'mods' : 'plugins';
  const dest = safeTarget(root, path.join(folder, file.filename));
  if (!dest) return { ok: false, error: 'Unsafe destination path.' };
  const { download } = require('../main/http.js');
  const { recordManifestEntry } = require('../main/fs-utils.js');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await download(file.url, dest);
  try { recordManifestEntry(root, { kind, fileName: file.filename, sourceUrl: file.url, source: 'modrinth', installedAt: new Date().toISOString() }); } catch {}
  return { ok: true, result: { name: file.filename, files: serverFiles(root) } };
}
async function tInstallLocalJar(ctx, a) {
  const root = needPath(ctx);
  const src = String(a.path || '');
  if (!src || !fs.existsSync(src)) return { ok: false, error: 'Source file not found.' };
  // SECURITY: this is the ONE tool that reads a file outside the server root (the user picks a
  // .jar from Downloads). Guard it: .jar only, must be a regular file, capped size. This blocks
  // a prompt-injected AI from copying e.g. /etc/passwd or an arbitrary .exe into the server.
  const st = fs.statSync(src);
  if (!st.isFile()) return { ok: false, error: 'Source is not a file.' };
  if (!/\.jar$/i.test(src)) return { ok: false, error: 'Only .jar files can be installed.' };
  if (st.size > 100 * 1024 * 1024) return { ok: false, error: 'File too large (max 100 MB).' };
  const kind = a.kind || 'plugin';
  const folder = kind === 'datapack' ? path.join(serverFiles(root).properties['level-name'] || 'world', 'datapacks') : kind === 'mod' ? 'mods' : 'plugins';
  const dest = safeTarget(root, path.join(folder, path.basename(src)));
  if (!dest) return { ok: false, error: 'Unsafe destination path.' };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return { ok: true, result: { name: path.basename(src), files: serverFiles(root) } };
}
async function tImportModpackPath(ctx, a) {
  const src = String(a.path || '');
  if (!src || !fs.existsSync(src)) return { ok: false, error: 'Modpack file not found.' };
  return ok(await importMrpackFromPath(ctx, src, undefined, 'mcp'));
}
async function tExportModpack(ctx, a) {
  const dest = String(a.path || '');
  if (!dest) return { ok: false, error: 'path is required.' };
  const root = needPath(ctx);
  const manifest = readJsonList(root, 'observerlauncher-manifest.json');
  if (!manifest.length) return { ok: false, error: 'Nothing to export (no Marketplace-installed content).' };
  const { fileHashes } = require('../main/fs-utils.js');
  const platform = require('../main/platform');
  const levelName = serverFiles(root).properties['level-name'] || 'world';
  const destFolders = { plugin: 'plugins', forge: 'mods', fabric: 'mods', datapack: path.join(levelName, 'datapacks'), mod: 'mods' };
  const files = [];
  for (const entry of manifest) {
    const folder = destFolders[entry.kind] || 'plugins';
    const fp = path.join(root, folder, entry.fileName);
    if (!fs.existsSync(fp)) continue;
    const st = fs.statSync(fp);
    files.push({ path: folder.replace(/\\/g, '/') + '/' + entry.fileName, hashes: fileHashes(fp), downloads: [entry.sourceUrl], fileSize: st.size, env: { client: 'optional', server: 'required' } });
  }
  if (!files.length) return { ok: false, error: 'None of the tracked files still exist on disk.' };
  const { detectServerCompat } = require('../main/modpacks.js');
  const sc = detectServerCompat(serverFiles(root));
  const dependencies = {}; if (sc.mc) dependencies.minecraft = sc.mc;
  const loaderKey = { neoforge: 'neoforge', forge: 'forge', fabric: 'fabric-loader', quilt: 'quilt-loader' }[sc.loader];
  if (loaderKey) dependencies[loaderKey] = 'latest';
  const stagingDir = path.join(require('electron').app.getPath('temp'), 'ob-mcp-export-' + Date.now());
  fs.mkdirSync(path.join(stagingDir, 'overrides'), { recursive: true });
  const index = { formatVersion: 1, game: 'minecraft', versionId: 'mcp-' + Date.now(), name: path.basename(root), summary: 'Exported via MCP - ' + files.length + ' item(s).', files, dependencies };
  fs.writeFileSync(path.join(stagingDir, 'modrinth.index.json'), JSON.stringify(index, null, 2));
  try { fs.copyFileSync(path.join(root, 'server.properties'), path.join(stagingDir, 'overrides', 'server.properties')); } catch {}
  const r = await platform.createArchive(stagingDir, dest);
  try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
  if (!r.ok) return { ok: false, error: r.error || 'Archive failed.' };
  return { ok: true, result: { count: files.length, path: dest } };
}
async function tSavePlayerData(ctx) {
  return { ok: false, error: 'Editing player stats over MCP is not supported yet - use the GUI player editor.' };
}
const { readPlayer, whitelistToggle, banToggle, opToggle } = require('../main/players.js');
async function tReadPlayer(ctx, a) { return ok(await readPlayer(ctx, a.uuid)); }
async function tOpPlayer(ctx, a) { needPath(ctx); return ok(await opToggle(ctx, { uuid: a.uuid || null, name: a.name, op: a.on !== false })); }
async function tWhitelistPlayer(ctx, a) { needPath(ctx); return ok(await whitelistToggle(ctx, { uuid: a.uuid || null, name: a.name, add: a.add !== false })); }
async function tBanPlayer(ctx, a) { needPath(ctx); return ok(await banToggle(ctx, { uuid: a.uuid || null, name: a.name, ban: a.ban !== false, reason: a.reason })); }

// ---- DESTROY tools ----
async function tStopServer(ctx) {
  if (ctx.serverStatus === 'stopped' || ctx.serverStatus === 'stopping') return { ok: false, error: 'Server is not running.' };
  if (!ctx.serverProcess) return { ok: false, error: 'Server is not running.' };
  ctx.manualStop = true;
  clearTimeout(ctx.restartTimer);
  ctx.setServerStatus('stopping');
  try { ctx.serverProcess.stdin.write('stop\r\n'); } catch {}
  return { ok: true };
}
async function tForceStopServer(ctx) { return ok(await forceStopServer(ctx)); }
async function tDeleteContent(ctx, a) {
  const root = needPath(ctx);
  const kind = a.kind || 'plugin';
  const name = String(a.name || '');
  if (!name) return { ok: false, error: 'name is required.' };
  const f = serverFiles(root);
  const folder = kind === 'datapack' ? f.datapackFolder : kind === 'mod' ? 'mods' : 'plugins';
  const target = safeTarget(root, path.join(folder, name));
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'File not found.' };
  try { fs.unlinkSync(target); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, result: { files: serverFiles(root) } };
}
async function tDeleteBackup(ctx, a) {
  const { resolveBackupFile } = require('../main/backups.js');
  const backup = resolveBackupFile(ctx, String(a.name || ''));
  if (!backup || !fs.existsSync(backup)) return { ok: false, error: 'Backup not found.' };
  try { fs.unlinkSync(backup); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}
async function tRestoreBackup(ctx, a) {
  if (ctx.serverProcess) return { ok: false, error: 'Stop the server before restoring.' };
  const { resolveBackupFile } = require('../main/backups.js');
  const platform = require('../main/platform');
  const backup = resolveBackupFile(ctx, String(a.name || ''));
  if (!backup || !fs.existsSync(backup)) return { ok: false, error: 'Backup not found.' };
  const r = await platform.restoreBackup({ destPath: ctx.currentServerPath, zipPath: backup });
  return ok(r);
}

const S = (props, required) => ({ type: 'object', properties: props || {}, required: required || [] });
const STR = desc => ({ type: 'string', description: desc });

const TOOLS = [
  { name: 'get_status', risk: 'read', description: 'Server status, folder, jar, software and Java info.', inputSchema: S(), handler: tGetStatus },
  { name: 'read_console', risk: 'read', description: 'Recent console/log lines.', inputSchema: S({ lines: { type: 'number' } }), handler: tReadConsole },
  { name: 'list_players', risk: 'read', description: 'Online, whitelisted, banned, op and known players.', inputSchema: S(), handler: tListPlayers },
  { name: 'get_player_data', risk: 'read', description: 'Read one player .dat (stats/inventory) by UUID.', inputSchema: S({ uuid: STR('player UUID') }, ['uuid']), handler: tReadPlayer },
  { name: 'list_files', risk: 'read', description: 'List a directory inside the server folder.', inputSchema: S({ path: STR('relative dir, default .') }), handler: tListFiles },
  { name: 'read_file', risk: 'read', description: 'Read a text file inside the server folder.', inputSchema: S({ path: STR('relative file path') }, ['path']), handler: tReadFile },
  { name: 'search_files', risk: 'read', description: 'Grep text files inside the server folder.', inputSchema: S({ query: STR('substring') }, ['query']), handler: tSearchFiles },
  { name: 'list_content', risk: 'read', description: 'Plugins, mods and datapacks.', inputSchema: S(), handler: tListContent },
  { name: 'get_properties', risk: 'read', description: 'Parsed server.properties.', inputSchema: S(), handler: tGetProperties },
  { name: 'get_raw_properties', risk: 'read', description: 'Raw velocity.toml content.', inputSchema: S(), handler: tGetRawProperties },
  { name: 'get_world_info', risk: 'read', description: 'Seed, spawn, players and waypoints.', inputSchema: S(), handler: tGetWorldInfo },
  { name: 'list_worlds', risk: 'read', description: 'World folders.', inputSchema: S(), handler: tListWorlds },
  { name: 'list_backups', risk: 'read', description: 'Backup files with size + date.', inputSchema: S(), handler: tListBackups },
  { name: 'get_network_info', risk: 'read', description: 'LAN IPs and server port.', inputSchema: S(), handler: tGetNetworkInfo },
  { name: 'get_java_info', risk: 'read', description: 'Detected Java version/path/arch.', inputSchema: S(), handler: tGetJavaInfo },
  { name: 'search_marketplace', risk: 'read', description: 'Search Modrinth for plugins/mods/datapacks/modpacks.', inputSchema: S({ query: STR('search text'), kind: STR('plugin|mod|datapack|modpack'), version: STR('MC version'), sort: STR('downloads|latest') }), handler: tSearchMarketplace },
  { name: 'list_market_versions', risk: 'read', description: 'Versions of a Modrinth project.', inputSchema: S({ id: STR('project id/slug') }, ['id']), handler: tListMarketVersions },
  { name: 'start_server', risk: 'write', description: 'Start the server.', inputSchema: S(), handler: tStartServer },
  { name: 'send_console_command', risk: 'write', description: 'Send one command to the running server.', inputSchema: S({ command: STR('single-line command') }, ['command']), handler: tSendCommand },
  { name: 'set_property', risk: 'write', description: 'Set one server.properties key.', inputSchema: S({ key: STR('property key'), value: STR('value') }, ['key']), handler: tSetProperty },
  { name: 'set_raw_properties', risk: 'write', description: 'Replace velocity.toml content.', inputSchema: S({ content: STR('full file') }, ['content']), handler: tSetRawProperties },
  { name: 'write_file', risk: 'write', description: 'Write a text file inside the server folder.', inputSchema: S({ path: STR('relative path'), content: STR('full content') }, ['path', 'content']), handler: tWriteFile },
  { name: 'edit_file', risk: 'write', description: 'Replace oldString with newString in a file.', inputSchema: S({ path: STR('relative path'), oldString: STR('exact text'), newString: STR('replacement') }, ['path', 'oldString', 'newString']), handler: tEditFile },
  { name: 'create_backup', risk: 'write', description: 'Create a world backup (ZIP).', inputSchema: S(), handler: tCreateBackup },
  { name: 'install_from_market', risk: 'write', description: 'Install a plugin/mod/datapack from Modrinth.', inputSchema: S({ id: STR('project id/slug'), kind: STR('plugin|mod|datapack'), versionId: STR('exact version id') }, ['id']), handler: tInstallFromMarket },
  { name: 'install_local_jar', risk: 'write', description: 'Copy a local .jar into plugins/mods.', inputSchema: S({ path: STR('absolute source path'), kind: STR('plugin|mod|datapack') }, ['path']), handler: tInstallLocalJar },
  { name: 'import_modpack_path', risk: 'write', description: 'Import a .mrpack from a local path.', inputSchema: S({ path: STR('absolute .mrpack path') }, ['path']), handler: tImportModpackPath },
  { name: 'export_modpack', risk: 'write', description: 'Export current setup to a .mrpack at a path.', inputSchema: S({ path: STR('absolute destination .mrpack') }, ['path']), handler: tExportModpack },
  { name: 'op_player', risk: 'write', description: 'Grant or revoke operator.', inputSchema: S({ name: STR('player name'), uuid: STR('known UUID (optional)'), on: { type: 'boolean', description: 'true = op, false = deop' } }, ['name']), handler: tOpPlayer },
  { name: 'whitelist_player', risk: 'write', description: 'Add or remove from the whitelist.', inputSchema: S({ name: STR('player name'), uuid: STR('known UUID (optional)'), add: { type: 'boolean', description: 'true = add, false = remove' } }, ['name']), handler: tWhitelistPlayer },
  { name: 'ban_player', risk: 'write', description: 'Ban or unban a player.', inputSchema: S({ name: STR('player name'), uuid: STR('known UUID (optional)'), ban: { type: 'boolean', description: 'true = ban, false = unban' }, reason: STR('ban reason (optional)') }, ['name']), handler: tBanPlayer },
  { name: 'stop_server', risk: 'destroy', description: 'Gracefully stop the server.', inputSchema: S(), handler: tStopServer },
  { name: 'force_stop_server', risk: 'destroy', description: 'Kill the server process tree.', inputSchema: S(), handler: tForceStopServer },
  { name: 'delete_content', risk: 'destroy', description: 'Delete a plugin/mod/datapack file.', inputSchema: S({ kind: STR('plugin|mod|datapack'), name: STR('file name') }, ['name']), handler: tDeleteContent },
  { name: 'delete_backup', risk: 'destroy', description: 'Delete a backup ZIP.', inputSchema: S({ name: STR('backup file name') }, ['name']), handler: tDeleteBackup },
  { name: 'restore_backup', risk: 'destroy', description: 'Restore a backup (overwrites worlds).', inputSchema: S({ name: STR('backup file name') }, ['name']), handler: tRestoreBackup },
];

function getTool(name) { return TOOLS.find(t => t.name === name) || null; }

module.exports = { TOOLS, getTool };
