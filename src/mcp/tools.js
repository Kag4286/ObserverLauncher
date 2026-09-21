// MCP tool registry. Each tool: { name, risk, description, inputSchema, handler(ctx, args) }.
// risk: 'read' (free) | 'write' (GUI confirm unless autoAllowWrite) | 'destroy' (always confirm).
// Handlers reuse the SAME backend functions the IPC layer uses, so behaviour is identical.
const fs = require('fs');
const path = require('path');
const { serverFiles, readPlayerData, findPlayerDataFile, readEula } = require('../main/server-files.js');
const { safeTarget, readJsonList } = require('../main/fs-utils.js');
const { loadSettings } = require('../main/settings.js');
const { startServerInternal, forceStopServer } = require('../main/server-lifecycle.js');
const { createBackupInternal } = require('../main/backups.js');
const { readLevel, readPlayers, readWaypoints } = require('../main/worldmap.js');
const { localIPv4s } = require('../main/network.js');
const { requiredJavaForJar, javaMajor } = require('../main/java.js');
const doctor = require('./doctor.js');
const editor = require('../main/editor.js');
const { json } = require('../main/http.js');
const { importMrpackFromPath } = require('../main/modpacks.js');
const { searchMarket, resolveMarketDownload } = require('../main/marketplace.js');

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
async function tListFiles(ctx, a) {
  const root = needPath(ctx);
  const rel = a.path || '.';
  const target = safeTarget(root, rel);
  if (!target) return { ok: false, error: 'Path outside the server folder.' };
  const all = fs.readdirSync(target, { withFileTypes: true })
    .map(e => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  const CAP = 500;
  const entries = all.slice(0, CAP);
  return { ok: true, result: { path: rel, entries, truncated: all.length > CAP, total: all.length } };
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
  // Runs in the Electron main process — a big scan must not freeze the UI. Cap file count +
  // total bytes, and yield to the event loop every 25 files.
  const files = (list.files || []).slice(0, 800);
  const MAX_SCAN_BYTES = 40 * 1024 * 1024;
  const ql = q.toLowerCase();
  const hits = [];
  let scanned = 0, i = 0;
  for (const rel of files) {
    if (hits.length >= 200 || scanned >= MAX_SCAN_BYTES) break;
    const t = safeTarget(root, rel); if (!t) continue;
    let txt; try { const st = fs.statSync(t); if (st.size > 2 * 1024 * 1024) continue; scanned += st.size; txt = fs.readFileSync(t, 'utf8'); } catch { continue; }
    txt.split(/\r?\n/).forEach((line, li) => { if (hits.length < 200 && line.toLowerCase().includes(ql)) hits.push({ path: rel, line: li + 1, text: line.slice(0, 300) }); });
    if (++i % 25 === 0) await new Promise(r => setImmediate(r));
  }
  return { ok: true, result: { query: q, hits, scannedFiles: i, truncated: scanned >= MAX_SCAN_BYTES } };
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
  // Delegates to the SAME search the GUI marketplace uses (src/main/marketplace.js), so Modrinth,
  // Hangar and Spigot are all supported and the facet/loader logic never drifts between the two.
  const source = a.source || 'modrinth';
  const kind = a.kind || 'plugin';
  const query = String(a.query || '').trim();
  const version = a.version || '';
  const sort = a.sort || 'downloads';
  const offset = Number(a.offset) || 0;
  try {
    return { ok: true, result: await searchMarket({ source, kind, query, version, sort, offset }) };
  } catch (e) { return { ok: false, error: e?.message || 'Search failed.' }; }
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
  if (cmd.length > 2000 || /[\r\n]/.test(cmd)) return { ok: false, error: 'Command must be single-line, max 2000 characters.' };
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
async function tInstallJava(ctx) {
  const { autoInstallJava } = require('../main/settings-handlers.js');
  return ok(await autoInstallJava(ctx));
}
async function tGetSettings(ctx) {
  const s = loadSettings();
  return { ok: true, result: { serverPath: s.serverPath || null, javaPath: s.javaPath || null, memoryMin: s.memoryMin, memoryMax: s.memoryMax, jvmArgs: s.jvmArgs || '', autoEula: !!s.autoEula, autoRestart: !!s.autoRestart, locale: s.locale || 'en', autoBackupMinutes: s.autoBackupMinutes || 0 } };
}
// serverPath is intentionally NOT settable over MCP (root of every file op) — GUI only.
const SETTABLE = {
  memoryMin: v => Number.isFinite(Number(v)) && Number(v) >= 1 && Number(v) <= 64,
  memoryMax: v => Number.isFinite(Number(v)) && Number(v) >= 1 && Number(v) <= 64,
  autoRestart: v => typeof v === 'boolean',
  autoEula: v => typeof v === 'boolean',
  autoBackupMinutes: v => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1440,
  locale: v => typeof v === 'string' && v.length <= 10,
  jvmArgs: v => typeof v === 'string' && v.length <= 2000 && !/["'<>|]/.test(v),
  // SECURITY: playitPath is NOT settable over MCP. tunnel:start spawns whatever binary that path
  // points at, so letting an AI set it (then start the tunnel) would be a one-approval RCE. The
  // user sets it in the GUI only.
  // MCP safety toggles (1.2.0): an AI may flip these only if the user allows the write tier.
  mcpReadOnly: v => typeof v === 'boolean',
  mcpAutoAllowWrite: v => typeof v === 'boolean',
};
async function tSetSetting(ctx, a) {
  const key = String(a.key || '');
  if (!SETTABLE[key]) return { ok: false, error: 'Key not settable over MCP: ' + key + '. Allowed: ' + Object.keys(SETTABLE).join(', ') };
  if (!SETTABLE[key](a.value)) return { ok: false, error: 'Invalid value for ' + key + '.' };
  const { saveSettings } = require('../main/settings.js');
  const s = loadSettings();
  s[key] = a.value;
  if (Number(s.memoryMax) < Number(s.memoryMin)) return { ok: false, error: 'memoryMax must be >= memoryMin.' };
  saveSettings(s);
  return { ok: true, result: { key, value: a.value } };
}
async function tInstallFromMarket(ctx, a) {
  const id = String(a.id || '');
  if (!id) return { ok: false, error: 'id is required.' };
  const kind = ['forge', 'fabric', 'datapack', 'mod'].includes(a.kind) ? a.kind : 'plugin';
  const source = ['modrinth', 'hangar', 'spigot'].includes(a.source) ? a.source : 'modrinth';
  // PARITY: use the SAME resolver the GUI market:install uses, so install now supports Modrinth,
  // Hangar and Spigot — not just Modrinth (search already offered all three).
  let dl;
  try { dl = await resolveMarketDownload({ id, kind, source, version: a.version || '', versionId: a.versionId, title: a.title }); }
  catch (e) { return { ok: false, error: e?.message || 'No download found.' }; }
  const { isSafeDownloadUrl } = require('../main/validate.js');
  if (!isSafeDownloadUrl(dl.url)) return { ok: false, error: 'Refused: download URL is not an allowlisted public host.' };
  const root = needPath(ctx);
  const folder = kind === 'datapack' ? path.join(serverFiles(root).properties['level-name'] || 'world', 'datapacks') : (kind === 'mod' || kind === 'forge' || kind === 'fabric') ? 'mods' : 'plugins';
  const dest = safeTarget(root, path.join(folder, path.basename(dl.filename)));
  if (!dest) return { ok: false, error: 'Unsafe destination path.' };
  const { download } = require('../main/http.js');
  const { recordManifestEntry } = require('../main/fs-utils.js');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await download(dl.url, dest);
  try { recordManifestEntry(root, { kind, fileName: path.basename(dl.filename), sourceUrl: dl.url, source: dl.source, installedAt: new Date().toISOString() }); } catch {}
  return { ok: true, result: { name: dl.filename, files: serverFiles(root) } };
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
  // WARNING FIX: forge/fabric/neoforge are MOD loaders and belong in mods/, not plugins/. The
  // marketplace install path already mapped them correctly; this tool did not, so a mod jar
  // installed via MCP landed in plugins/ and never loaded.
  const folder = kind === 'datapack' ? path.join(serverFiles(root).properties['level-name'] || 'world', 'datapacks')
    : (kind === 'mod' || kind === 'forge' || kind === 'fabric' || kind === 'neoforge') ? 'mods'
    : 'plugins';
  const dest = safeTarget(root, path.join(folder, path.basename(src)));
  if (!dest) return { ok: false, error: 'Unsafe destination path.' };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return { ok: true, result: { name: path.basename(src), files: serverFiles(root) } };
}
async function tImportModpackPath(ctx, a) {
  const src = String(a.path || '');
  if (!src || !fs.existsSync(src)) return { ok: false, error: 'Modpack file not found.' };
  if (!/\.(mrpack|zip)$/i.test(src)) return { ok: false, error: 'Expected a .mrpack (or .zip) file.' };
  return ok(await importMrpackFromPath(ctx, src, undefined, 'mcp'));
}
async function tExportModpack(ctx, a) {
  const dest = String(a.path || '');
  if (!dest) return { ok: false, error: 'path is required.' };
  if (!/\.mrpack$/i.test(dest)) return { ok: false, error: 'Destination must end in .mrpack.' };
  const root = needPath(ctx);
  const manifest = readJsonList(root, 'observerlauncher-manifest.json');
  if (!manifest.length) return { ok: false, error: 'Nothing to export (no Marketplace-installed content).' };
  const platform = require('../main/platform');
  // Shared helpers so this never drifts from the IPC modpack:export path.
  const { buildMrpackEntries, dependenciesFor } = require('../main/modpacks.js');
  const levelName = serverFiles(root).properties['level-name'] || 'world';
  const destFolders = { plugin: 'plugins', forge: 'mods', fabric: 'mods', datapack: path.join(levelName, 'datapacks'), mod: 'mods' };
  const files = buildMrpackEntries(root, manifest, destFolders);
  if (!files.length) return { ok: false, error: 'None of the tracked files still exist on disk.' };
  const dependencies = dependenciesFor(serverFiles(root));
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
async function tSavePlayerData(ctx, a) { return ok(await savePlayer(ctx, { uuid: a.uuid, changes: a.changes || {}, clearInventory: !!a.clearInventory })); }
const { readPlayer, whitelistToggle, banToggle, opToggle, savePlayer } = require('../main/players.js');
async function tReadPlayer(ctx, a) { return ok(await readPlayer(ctx, a.uuid, a.name)); }
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

async function tGetSchedule(ctx) {
  const s = loadSettings();
  return { ok: true, result: { enabled: !!s.scheduleEnabled, startTime: s.scheduleStartTime || '', stopTime: s.scheduleStopTime || '', days: s.scheduleDays || [] } };
}
async function tSetSchedule(ctx, a) {
  const { parseTime } = require('../main/scheduler.js');
  const { saveSettings } = require('../main/settings.js');
  const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const s = loadSettings();
  if (a.enabled !== undefined) {
    if (typeof a.enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean.' };
    s.scheduleEnabled = a.enabled;
  }
  if (a.startTime !== undefined) {
    if (a.startTime !== '' && !parseTime(a.startTime)) return { ok: false, error: 'startTime must be HH:MM (24h) or empty.' };
    s.scheduleStartTime = String(a.startTime);
  }
  if (a.stopTime !== undefined) {
    if (a.stopTime !== '' && !parseTime(a.stopTime)) return { ok: false, error: 'stopTime must be HH:MM (24h) or empty.' };
    s.scheduleStopTime = String(a.stopTime);
  }
  if (a.days !== undefined) {
    if (!Array.isArray(a.days) || a.days.some(d => !VALID_DAYS.includes(String(d).toLowerCase()))) {
      return { ok: false, error: 'days must be an array of ' + VALID_DAYS.join('/') + ' (empty = every day).' };
    }
    // CRITICAL FIX: store NUMBERS (0=Sun..6=Sat), matching what the GUI saves and what
    // scheduler.shouldFire() compares against now.getDay(). Storing names here made every
    // MCP-created schedule silently never fire.
    s.scheduleDays = a.days.map(d => DAY_NUM[String(d).toLowerCase().slice(0, 3)]).filter(n => Number.isInteger(n));
  }
  saveSettings(s);
  return { ok: true, result: { enabled: !!s.scheduleEnabled, startTime: s.scheduleStartTime || '', stopTime: s.scheduleStopTime || '', days: s.scheduleDays || [] } };
}
async function tListWaypoints(ctx) {
  const root = ctx.currentServerPath;
  if (!root) return { ok: false, error: 'Choose and apply a server folder first.' };
  const { readWaypoints } = require('../main/worldmap.js');
  return { ok: true, result: readWaypoints(root) };
}
async function tReadAuditLog(ctx, a) {
  const n = Math.min(Math.max(1, Number(a.lines) || 100), 500);
  try {
    const file = require('path').join(require('electron').app.getPath('userData'), 'mcp-audit.log');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n);
    return { ok: true, result: { lines, count: lines.length } };
  } catch { return { ok: true, result: { lines: [], count: 0, note: 'No audit log yet - write/destroy tool calls are recorded here.' } }; }
}
async function tKickPlayer(ctx, a) {
  const name = String(a.name || '').trim();
  if (!name) return { ok: false, error: 'name is required.' };
  const { isSafePlayerName } = require('../main/validate.js');
  if (!isSafePlayerName(name)) return { ok: false, error: 'Invalid player name - use 3-16 letters, numbers or underscores.' };
  if (!ctx.serverProcess) return { ok: false, error: 'Server is not running.' };
  ctx.serverProcess.stdin.write('kick ' + name + '\r\n');
  return { ok: true, result: { kicked: name } };
}

// ---- SERVER DOCTOR (1.2.0) ---- read-only diagnostics + composite workflows.
async function tDiagnoseServer(ctx) {
  const root = ctx.currentServerPath || '';
  const s = loadSettings();
  let files = {}; try { files = serverFiles(root); } catch {}
  const javaRequired = files.jar ? (requiredJavaForJar(files.jar) || null) : null;
  let eulaAccepted = false; try { eulaAccepted = readEula(root); } catch {}
  const port = Number(files.properties?.['server-port']) || 25565;
  let portFree = null;
  // Only test the port when stopped — a running server holds it by design.
  if (ctx.serverStatus === 'stopped') { try { portFree = (await doctor.checkPortFree(port)).free; } catch {} }
  const lastCrash = doctor.latestCrashReport(root);
  const result = doctor.diagnoseFromData({
    serverPath: root, hasJar: !!files.jar, jar: files.jar, hasLaunchScript: !!files.launchScript, launchScript: files.launchScript,
    java: ctx.javaInfo, javaMajor: javaMajor(ctx.javaInfo?.version), javaRequired, eulaAccepted, port, portFree,
    worlds: files.worlds, backups: files.backups, memoryMax: s.memoryMax, lastCrash: lastCrash ? lastCrash.name : null,
  });
  return { ok: true, result };
}
async function tAnalyzeConsole(ctx, a) {
  const n = Math.min(Math.max(1, Number(a.lines) || 500), 2000);
  const buf = (ctx.consoleBuffer || []).slice(-n);
  const analysis = doctor.analyzeConsoleLines(buf);
  return { ok: true, result: { scanned: buf.length, errors: analysis.errors, warns: analysis.warns, issues: analysis.issues } };
}
async function tExplainCrash(ctx) {
  const root = needPath(ctx);
  const latest = doctor.latestCrashReport(root);
  if (!latest) return { ok: true, result: { found: false, message: 'No crash reports found in crash-reports/.' } };
  let text = '';
  try { text = fs.readFileSync(latest.file, 'utf8'); } catch (e) { return { ok: false, error: 'Could not read the crash report: ' + (e.code || e.message) }; }
  return { ok: true, result: { found: true, file: latest.name, mtime: latest.mtime, ...doctor.summarizeCrashText(text) } };
}
async function tCheckPerformance(ctx) {
  const live = ctx.live || {};
  const tps = live.tps ?? null, mspt = live.mspt ?? null, players = (live.players || []).length;
  const notes = [];
  const push = (level, detail, fix) => notes.push({ level, detail, fix: fix || null });
  if (ctx.serverStatus !== 'running') push('info', 'Server is not running - live metrics are unavailable.');
  if (tps != null) { if (tps < 15) push('error', `TPS ${tps} - the server is struggling.`, 'Reduce view-distance, remove heavy plugins, or allocate more RAM.'); else if (tps < 19) push('warn', `TPS ${tps} - mild lag.`, 'Consider lowering view-distance or plugin load.'); else push('ok', `TPS ${tps} - healthy.`); }
  if (mspt != null) { if (mspt > 50) push('error', `MSPT ${mspt}ms - above the 50ms tick budget.`, 'The main thread cannot keep up; reduce load.'); else if (mspt > 40) push('warn', `MSPT ${mspt}ms - close to the 50ms budget.`); else push('ok', `MSPT ${mspt}ms - healthy.`); }
  return { ok: true, result: { running: ctx.serverStatus === 'running', tps, mspt, players, notes } };
}
async function tValidateConfig(ctx) {
  const root = needPath(ctx);
  const files = serverFiles(root);
  let worldDirs = [];
  try { worldDirs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {}
  return { ok: true, result: { checks: doctor.validateProperties(files.properties || {}, worldDirs) } };
}
async function tCheckPort(ctx, a) {
  let port = Number(a.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    let props = {}; try { props = serverFiles(ctx.currentServerPath || '').properties || {}; } catch {}
    port = Number(props['server-port']) || 25565;
  }
  const r = await doctor.checkPortFree(port);
  return { ok: true, result: { port, ...r } };
}
async function tReadManyFiles(ctx, a) {
  const root = needPath(ctx);
  const paths = Array.isArray(a.paths) ? a.paths.slice(0, 5) : [];
  if (!paths.length) return { ok: false, error: 'paths must be a non-empty array (max 5).' };
  const out = [];
  for (const rel of paths) {
    // Reuse the editor's rails (safeTarget + binary sniff + size cap) so a .jar/.dat can't be
    // returned as utf8 garbage. editor.openFile already runs everything we need.
    const r = editor.openFile(root, rel);
    if (!r.ok) { out.push({ path: rel, ok: false, error: r.error }); continue; }
    out.push({ path: rel, ok: true, content: r.content, readOnly: r.readOnly, size: r.size });
  }
  return { ok: true, result: { files: out } };
}
// --- Composite workflows (Phase 2): chain the doctor's checks into safe multi-step actions. ---
async function tPrepareAndStart(ctx) {
  const diag = await tDiagnoseServer(ctx);
  const errors = (diag.result?.checks || []).filter(c => c.level === 'error');
  if (errors.length) return { ok: false, error: 'Cannot start - fix these first: ' + errors.map(e => e.detail).join(' ') };
  let backup = null;
  try { const b = await createBackupInternal(ctx, { auto: true }); if (b.ok) backup = b.name; } catch {}
  const r = await startServerInternal(ctx, loadSettings());
  return r.ok ? { ok: true, result: { backup, start: r } } : { ok: false, error: r.error, result: { backup } };
}
async function tSafeRestart(ctx) {
  if (ctx.serverStatus === 'stopped') return { ok: false, error: 'Server is not running - use start_server instead.' };
  let backup = null;
  try { const b = await createBackupInternal(ctx, { auto: true }); if (b.ok) backup = b.name; } catch {}
  ctx.manualStop = true;
  clearTimeout(ctx.restartTimer);
  try { if (ctx.serverProcess?.stdin?.writable) ctx.serverProcess.stdin.write('stop\r\n'); } catch {}
  const deadline = Date.now() + 30000;
  while (ctx.serverProcess && Date.now() < deadline) await new Promise(r => setTimeout(r, 500));
  if (ctx.serverProcess) return { ok: false, error: 'Server did not stop within 30s - force_stop_server may be needed.', result: { backup } };
  const r = await startServerInternal(ctx, loadSettings());
  return r.ok ? { ok: true, result: { backup, start: r } } : { ok: false, error: r.error, result: { backup } };
}
async function tDoctorReport(ctx) {
  const diag = await tDiagnoseServer(ctx);
  const cons = await tAnalyzeConsole(ctx, { lines: 500 });
  const perf = await tCheckPerformance(ctx);
  let config = { checks: [] }; try { config = (await tValidateConfig(ctx)).result; } catch {}
  let crash = { found: false }; try { crash = (await tExplainCrash(ctx)).result; } catch {}
  return { ok: true, result: { healthy: diag.result?.healthy ?? null, checks: diag.result?.checks || [], console: cons.result, performance: perf.result, config: config.checks, crash } };
}

const S = (props, required) => ({ type: 'object', properties: props || {}, required: required || [] });
const STR = desc => ({ type: 'string', description: desc });

const TOOLS = [
  { name: 'get_status', risk: 'read', description: 'Server status, folder, jar, software and Java info.', inputSchema: S(), handler: tGetStatus },
  { name: 'read_console', risk: 'read', description: 'Recent console/log lines.', inputSchema: S({ lines: { type: 'number' } }), handler: tReadConsole },
  { name: 'list_players', risk: 'read', description: 'Online, whitelisted, banned, op and known players.', inputSchema: S(), handler: tListPlayers },
  { name: 'get_player_data', risk: 'read', description: 'Read one player .dat (stats/inventory) by UUID or name.', inputSchema: S({ uuid: STR('player UUID (optional)'), name: STR('player name (optional)') }), handler: tReadPlayer },
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
  { name: 'search_marketplace', risk: 'read', description: 'Search Modrinth, Hangar or Spigot for plugins/mods/datapacks/modpacks.', inputSchema: S({ query: STR('search text'), kind: STR('plugin|mod|datapack|modpack'), source: STR('modrinth|hangar|spigot (default modrinth)'), version: STR('MC version'), sort: STR('downloads|latest|relevance'), offset: { type: 'number', description: 'pagination offset (default 0)' } }), handler: tSearchMarketplace },
  { name: 'list_market_versions', risk: 'read', description: 'Versions of a Modrinth project.', inputSchema: S({ id: STR('project id/slug') }, ['id']), handler: tListMarketVersions },
  { name: 'diagnose_server', risk: 'read', description: 'Full server health check: folder, jar, Java version/arch, EULA, port, world, backups, recent crash. Returns per-check level (ok/warn/error) + fixes.', inputSchema: S(), handler: tDiagnoseServer },
  { name: 'analyze_console', risk: 'read', description: 'Scan the console buffer for errors/warnings (OOM, port-busy, exceptions, lag), grouped and ranked.', inputSchema: S({ lines: { type: 'number', description: 'lines to scan (default 500, max 2000)' } }), handler: tAnalyzeConsole },
  { name: 'explain_crash', risk: 'read', description: 'Summarise the newest crash-report (description, version, cause chain).', inputSchema: S(), handler: tExplainCrash },
  { name: 'check_performance', risk: 'read', description: 'TPS/MSPT/players with threshold warnings (does the server keep up?).', inputSchema: S(), handler: tCheckPerformance },
  { name: 'validate_config', risk: 'read', description: 'Validate server.properties: port, level-name exists, view-distance, simulation-distance, max-players.', inputSchema: S(), handler: tValidateConfig },
  { name: 'check_port', risk: 'read', description: 'Check whether the server port is free (bind test).', inputSchema: S({ port: { type: 'number', description: 'port to test (default: server-port)' } }), handler: tCheckPort },
  { name: 'read_many_files', risk: 'read', description: 'Read up to 5 text files in one call (batch, cheaper than 5 read_file calls).', inputSchema: S({ paths: { type: 'array', items: { type: 'string' }, description: 'relative file paths (max 5)' } }, ['paths']), handler: tReadManyFiles },
  { name: 'doctor_report', risk: 'read', description: 'One-shot full report: diagnose + console analysis + performance + config + crash, combined.', inputSchema: S(), handler: tDoctorReport },
  { name: 'read_audit_log', risk: 'read', description: 'Recent MCP write/destroy actions (what an assistant changed), newest last.', inputSchema: S({ lines: { type: 'number', description: 'lines (default 100, max 500)' } }), handler: tReadAuditLog },
  { name: 'start_server', risk: 'write', description: 'Start the server.', inputSchema: S(), handler: tStartServer },
  { name: 'send_console_command', risk: 'write', description: 'Send one command to the running server.', inputSchema: S({ command: STR('single-line command') }, ['command']), handler: tSendCommand },
  { name: 'set_property', risk: 'write', description: 'Set one server.properties key.', inputSchema: S({ key: STR('property key'), value: STR('value') }, ['key']), handler: tSetProperty },
  { name: 'set_raw_properties', risk: 'write', description: 'Replace velocity.toml content.', inputSchema: S({ content: STR('full file') }, ['content']), handler: tSetRawProperties },
  { name: 'write_file', risk: 'write', description: 'Write a text file inside the server folder.', inputSchema: S({ path: STR('relative path'), content: STR('full content') }, ['path', 'content']), handler: tWriteFile },
  { name: 'edit_file', risk: 'write', description: 'Replace oldString with newString in a file.', inputSchema: S({ path: STR('relative path'), oldString: STR('exact text'), newString: STR('replacement') }, ['path', 'oldString', 'newString']), handler: tEditFile },
  { name: 'create_backup', risk: 'write', description: 'Create a world backup (ZIP).', inputSchema: S(), handler: tCreateBackup },
  { name: 'get_settings', risk: 'read', description: 'Read launcher settings (RAM, Java, auto-restart, locale, backup interval).', inputSchema: S(), handler: tGetSettings },
  { name: 'get_schedule', risk: 'read', description: 'Read the server schedule (enabled, start/stop time, weekdays).', inputSchema: S(), handler: tGetSchedule },
  { name: 'list_waypoints', risk: 'read', description: 'List World Map waypoints (id, name, x, z, dimension).', inputSchema: S(), handler: tListWaypoints },
  { name: 'install_java', risk: 'write', description: 'Download and install a portable Java runtime (Adoptium) matching the server needs.', inputSchema: S(), handler: tInstallJava },
  { name: 'set_setting', risk: 'write', description: 'Change one launcher setting (memoryMin/Max, autoRestart, autoEula, autoBackupMinutes, locale, jvmArgs). serverPath is NOT settable.', inputSchema: S({ key: STR('setting name'), value: { description: 'new value' } }, ['key', 'value']), handler: tSetSetting },
  { name: 'set_schedule', risk: 'write', description: 'Set the server schedule. Any of enabled (bool), startTime/stopTime (HH:MM 24h or ""), days (array of mon..sun, empty = every day).', inputSchema: S({ enabled: { type: 'boolean', description: 'true = scheduler on' }, startTime: STR('HH:MM (24h) or empty to disable'), stopTime: STR('HH:MM (24h) or empty to disable'), days: { type: 'array', items: { type: 'string' }, description: 'weekdays mon..sun (empty = every day)' } }), handler: tSetSchedule },
  { name: 'kick_player', risk: 'write', description: 'Kick an online player from the running server.', inputSchema: S({ name: STR('player name') }, ['name']), handler: tKickPlayer },
  { name: 'install_from_market', risk: 'write', description: 'Install a plugin/mod/datapack from Modrinth, Hangar or Spigot (same resolver as the GUI).', inputSchema: S({ id: STR('project id/slug (Hangar: owner/slug)'), kind: STR('plugin|mod|datapack'), source: STR('modrinth|hangar|spigot (default modrinth)'), version: STR('MC version'), versionId: STR('exact Modrinth version id'), title: STR('title (Spigot, optional)') }, ['id']), handler: tInstallFromMarket },
  { name: 'install_local_jar', risk: 'write', description: 'Copy a local .jar into plugins/mods.', inputSchema: S({ path: STR('absolute source path'), kind: STR('plugin|mod|datapack') }, ['path']), handler: tInstallLocalJar },
  { name: 'import_modpack_path', risk: 'write', description: 'Import a .mrpack from a local path.', inputSchema: S({ path: STR('absolute .mrpack path') }, ['path']), handler: tImportModpackPath },
  { name: 'export_modpack', risk: 'write', description: 'Export current setup to a .mrpack at a path.', inputSchema: S({ path: STR('absolute destination .mrpack') }, ['path']), handler: tExportModpack },
  { name: 'prepare_and_start', risk: 'write', description: 'Diagnose first (refuse on hard errors) -> create a safety backup -> start the server.', inputSchema: S(), handler: tPrepareAndStart },
  { name: 'safe_restart', risk: 'destroy', description: 'Back up, gracefully stop (waits up to 30s), then start again. Stops a running server - always requires confirmation (same class as stop_server).', inputSchema: S(), handler: tSafeRestart },
  { name: 'save_player_data', risk: 'write', description: 'Apply edits to a player .dat (health/food/xp/gamemode). Server must be stopped; a backup is written first.', inputSchema: S({ uuid: STR('player UUID'), changes: { type: 'object', description: 'health, food, saturation, xpLevel, xpTotal, gameType' }, clearInventory: { type: 'boolean', description: 'also clear inventory + equipment' } }, ['uuid']), handler: tSavePlayerData },
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
