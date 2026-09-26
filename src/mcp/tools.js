// MCP tool registry. Each tool: { name, risk, description, inputSchema, handler(ctx, args) }.
// risk: 'read' (free) | 'write' (GUI confirm unless autoAllowWrite) | 'destroy' (always confirm).
// Handlers reuse the SAME backend functions the IPC layer uses, so behaviour is identical.
const fs = require('fs');
const path = require('path');
const { serverFiles, readPlayerData, findPlayerDataFile, readEula } = require('../main/server-files.js');
const { safeTarget, readJsonList } = require('../main/fs-utils.js');
const { loadSettings, loadSettingsFor, saveSettingsFor } = require('../main/settings.js');
const { startServerInternal, forceStopServer, sendConsoleCommand } = require('../main/server-lifecycle.js');
const { createBackupInternal } = require('../main/backups.js');
const { readLevel, readPlayers, readWaypoints } = require('../main/worldmap.js');
const { localIPv4s } = require('../main/network.js');
const { javaMajor } = require('../main/java.js');
const { requiredJavaForServer } = require('../main/server-java.js');
const doctor = require('./doctor.js');
const editor = require('../main/editor.js');
const { json } = require('../main/http.js');
const { importMrpackFromPath, detectServerCompat } = require('../main/modpacks.js');
const { searchMarket, resolveMarketDownload, listMarketVersions, findMarketProject } = require('../main/marketplace.js');
const { folderForKind, itemCompat, dedupeById, capPlan, planConflicts, planWarnings, filterPlan, missingDependencies, conflictingDependencies, LOADER_FAMILY } = require('./modpack-plan.js');
const { detectServerTarget, versionMatchesServer } = require('../main/server-compat.js');
const { openJar } = require('../main/jar-read.js');
const { classifyJar } = require('../main/mod-metadata.js');
const repair = require('./repair.js');

const ok = r => (r && typeof r === 'object' && 'ok' in r) ? r : { ok: true, result: r };
const needPath = ctx => { if (!ctx.currentServerPath) throw new Error('No server folder selected.'); return ctx.currentServerPath; };

// ---- READ tools ----
async function tGetStatus(ctx) {
  let files = {}; try { files = serverFiles(ctx.currentServerPath); } catch {}
  return { ok: true, result: {
    status: ctx.serverStatus, running: ctx.serverStatus === 'running',
    serverPath: ctx.currentServerPath || null, jar: files.jar || null, launchScript: files.launchScript || null,
    software: ctx.currentSoftware || null, java: ctx.javaInfo || null,
    javaRequired: requiredJavaForServer(ctx.currentServerPath, serverFiles) || null,
  } };
}
async function tReadConsole(ctx, a) {
  const n = Math.min(Math.max(1, Number(a.lines) || 100), 2000);
  const buf = ctx.consoleBuffer.slice(-n);
  // Phase C (item 17): scrub IPv4/email before console text leaves to an AI client.
  const { scrubPII } = require('./doctor.js');
  return { ok: true, result: { lines: buf.map(l => `[${l.time}] ${scrubPII(l.text)}`), count: buf.length } };
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
  const root = needPath(ctx);
  const f = serverFiles(root);
  // 2.3.0: flag jars whose declared loader does not match the server (e.g. a stray Forge jar in a
  // NeoForge mods/ folder) so the AI/user sees the mismatch here instead of in a crash report.
  const server = detectServerTarget(root, f);
  // env source #2 (v2.3.0): a NeoForge/Forge jar has NO static side field, so fall back to the
  // env recorded in observerlauncher-manifest.json when the mod was installed via the Marketplace
  // (Modrinth knows client/server side). Keyed by lowercase fileName.
  const manifestEnv = {};
  try { for (const e of readJsonList(root, 'observerlauncher-manifest.json')) { if (e && e.fileName && e.env) manifestEnv[String(e.fileName).toLowerCase()] = e.env; } } catch {}
  const flagJars = (names, folder) => (names || []).map(name => {
    const row = { name };
    try {
      const jar = openJar(path.join(root, folder, name));
      const cls = classifyJar(jar.read, name);
      if (cls.loader) row.loader = cls.loader;
      // Priority: authoritative env (Fabric metadata) > Modrinth env from the install manifest >
      // weak jar hint (displayTest). A hint-only value is marked so callers know it may be wrong.
      let env = cls.env || manifestEnv[String(name).toLowerCase()] || null;
      let envSource = cls.env ? 'metadata' : (manifestEnv[String(name).toLowerCase()] ? 'modrinth' : null);
      if (!env && cls.envHint) { env = cls.envHint; envSource = 'hint'; }
      if (env) { row.env = env; row.serverUsable = env !== 'client-only'; if (envSource) row.envSource = envSource; }
      // Only flag a mismatch when the loader came from real metadata (not a filename guess).
      if (cls.loader && !cls.loaderGuessed && server.loader && LOADER_FAMILY[server.loader] && !LOADER_FAMILY[server.loader].includes(cls.loader)) row.loaderMismatch = true;
    } catch { /* unreadable jar -> leave unannotated */ }
    return row;
  });
  return { ok: true, result: { server: { mc: server.mc, loader: server.loader }, plugins: f.plugins || [], mods: flagJars(f.mods, 'mods'), datapacks: f.datapacks || [], datapackFolder: f.datapackFolder || null } };
}
// 2.3.0: pre-start compatibility scan of mods/ + plugins/. Reports loader mismatches, missing
// required dependencies (from each jar's own metadata), and client-only mods. Read-only.
async function tCheckModCompat(ctx) {
  const root = needPath(ctx);
  const f = serverFiles(root);
  const server = detectServerTarget(root, f);
  const families = LOADER_FAMILY[server.loader] || [];
  const jarIssues = [];
  const present = new Set();
  // env fallback from the install manifest (NeoForge jars carry no static side field).
  const manifestEnv = {};
  try { for (const e of readJsonList(root, 'observerlauncher-manifest.json')) { if (e && e.fileName && e.env) manifestEnv[String(e.fileName).toLowerCase()] = e.env; } } catch {}
  // First pass: collect every mod id present (so deps can resolve against each other).
  const metas = [];
  for (const name of f.mods || []) {
    const cls = classifyJar(openJar(path.join(root, 'mods', name)).read, name);
    if (!cls.env) cls.env = manifestEnv[String(name).toLowerCase()] || cls.envHint || null;
    metas.push({ name, cls });
    if (cls.modId) present.add(String(cls.modId).toLowerCase());
  }
  const declared = [];
  for (const m of metas) {
    const row = { name: m.name, loader: m.cls.loader || null, modId: m.cls.modId || null };
    if (m.cls.loader && !m.cls.loaderGuessed && families.length && !families.includes(m.cls.loader)) { row.problem = 'loader-mismatch'; row.detail = `declares ${m.cls.loader}, server is ${server.loader}`; }
    if (m.cls.env === 'client-only') { row.problem = row.problem || 'client-only'; row.detail = row.detail || 'client-only mod (no server effect)'; }
    // Collect ALL declared deps (required AND incompatible) so both checks can use them.
    for (const d of m.cls.dependencies || []) { declared.push({ from: m.cls.modId || m.name, modId: d.modId, mandatory: !!d.mandatory, optional: !!d.optional, incompatible: !!d.incompatible, reason: d.reason || null, versionRange: d.versionRange }); }
    jarIssues.push(row);
  }
  const missing = missingDependencies(declared, present);
  // v2.3.1: a declared `type="incompatible"` dep that IS present is a CONFLICT, not a missing dep.
  const conflicts = conflictingDependencies(declared, present);
  return { ok: true, result: { server: { mc: server.mc, loader: server.loader }, modsScanned: metas.length, issues: jarIssues.filter(r => r.problem), missingDeps: missing, conflicts, ok: jarIssues.every(r => !r.problem) && missing.length === 0 && conflicts.length === 0 } };
}
// 2.3.0: dedicated crash-report reader (path confined to crash-reports/) so the AI does not have to
// route through the general file reader, which is rooted at the project, not the server folder.
async function tReadCrashReport(ctx, a) {
  const root = needPath(ctx);
  const name = String(a.name || '');
  let pick = name ? doctor.resolveCrashReport(root, name) : null;
  if (name && !pick) return { ok: false, error: 'Crash report not found: ' + name };
  if (!pick) { const latest = doctor.latestCrashReport(root); if (!latest) return { ok: true, result: { found: false } }; pick = latest.file; }
  let text = '';
  try { text = fs.readFileSync(pick, 'utf8'); } catch (e) { return { ok: false, error: 'Could not read: ' + (e.code || e.message) }; }
  const summary = doctor.summarizeCrashText(text);
  let classification = doctor.classifyCrash(text);
  // BUGFIX (v2.3.1): an FML crash-report often says "<No associated exception found>" while the
  // real cause (missing dependency / wrong-loader jar) is only in logs/latest.log. Always scan the
  // log tail and merge it in; raise confidence when we find concrete entries.
  let fromLog = { missingDeps: [], skippedJars: [] };
  try { const tail = doctor.tailLogFile(root, { lines: 500 }); if (tail.ok) fromLog = doctor.scanLogForMissingDeps((tail.lines || []).join('\n')); } catch {}
  if (fromLog.missingDeps.length || fromLog.skippedJars.length) {
    classification = { category: fromLog.missingDeps.length ? 'mod-dependency' : 'loader-mismatch', confidence: 'high', hints: fromLog.missingDeps.length ? ['Install the missing dependency mod(s) listed in missingDeps, then restart.'] : ['Remove the listed jars that are for a different loader.'] };
  }
  const missing = fromLog.missingDeps.map(d => d.modId);
  return { ok: true, result: { found: true, file: path.basename(pick), classification, missing, fromLog, ...summary } };
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
  const loader = String(a.loader || '');
  try {
    return { ok: true, result: await searchMarket({ source, kind, query, version, sort, offset, loader }) };
  } catch (e) { return { ok: false, error: e?.message || 'Search failed.' }; }
}
async function tListMarketVersions(ctx, a) {
  const id = String(a.id || '');
  if (!id) return { ok: false, error: 'id is required.' };
  // A2: delegate to the shared resolver so Modrinth + Hangar + CurseForge all work (was Modrinth-only).
  try { return { ok: true, result: await listMarketVersions({ id, source: a.source }) }; }
  catch (e) { return { ok: false, error: e?.message || 'Could not list versions.' }; }
}
// A1 (v2.1.0): search Modrinth for installable MODPACKS. Thin wrapper over the shared search so the
// facet logic never drifts; then install one with install_from_market { kind:'modpack' }.
async function tSearchModpacks(ctx, a) {
  const query = String(a.query || '').trim();
  const offset = Number(a.offset) || 0;
  const version = a.version || '';
  try { return { ok: true, result: await searchMarket({ source: 'modrinth', kind: 'modpack', query, version, sort: a.sort || 'downloads', offset }) }; }
  catch (e) { return { ok: false, error: e?.message || 'Search failed.' }; }
}

// ---- WRITE tools ----
async function tStartServer(ctx) { return ok(await startServerInternal(ctx, loadSettings())); }
async function tSendCommand(ctx, a) {
  const cmd = String(a.command || '').trim();
  if (!cmd) return { ok: false, error: 'command is required.' };
  if (cmd.length > 2000 || /[\r\n]/.test(cmd)) return { ok: false, error: 'Command must be single-line, max 2000 characters.' };
  // M6: prefer RCON, stdin fallback (same helper the IPC path uses).
  return await sendConsoleCommand(ctx, cmd);
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
  // M12: read the TARGET instance (ctx.inst() is set by runInInstance in callTool), not the active one.
  const s = loadSettingsFor(ctx.inst());
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
  // M12: write the TARGET instance (ctx.inst()), not the active one.
  const target = ctx.inst();
  const s = loadSettingsFor(target);
  s[key] = a.value;
  if (Number(s.memoryMax) < Number(s.memoryMin)) return { ok: false, error: 'memoryMax must be >= memoryMin.' };
  saveSettingsFor(target, s);
  return { ok: true, result: { key, value: a.value } };
}
async function tInstallFromMarket(ctx, a) {
  const id = String(a.id || '');
  if (!id) return { ok: false, error: 'id is required.' };
  const kind = ['forge', 'fabric', 'datapack', 'mod', 'modpack'].includes(a.kind) ? a.kind : 'plugin';
  // curseforge works only when the USER set their own API key in the GUI (ToS forbids a bundled key).
  const source = ['modrinth', 'hangar', 'spigot', 'curseforge'].includes(a.source) ? a.source : 'modrinth';
  // PARITY: use the SAME resolver the GUI market:install uses, so install now supports Modrinth,
  // Hangar and Spigot — not just Modrinth (search already offered all three).
  let dl;
  try { dl = await resolveMarketDownload({ id, kind, source, version: a.version || '', versionId: a.versionId, title: a.title }); }
  catch (e) {
    if (e && e.code === 'blocked') return { ok: false, blocked: true, error: 'This CurseForge project does not allow third-party downloads. Install it manually from its page.' };
    return { ok: false, error: e?.message || 'No download found.' };
  }
  const { isSafeDownloadUrl } = require('../main/validate.js');
  if (!isSafeDownloadUrl(dl.url)) return { ok: false, error: 'Refused: download URL is not an allowlisted public host.' };
  const root = needPath(ctx);
  // A1 (v2.1.0): a modpack is a .mrpack bundle, not a single jar - download it to a temp file and
  // run the SAME importMrpackFromPath the GUI/MCP import path uses (installs its files + overrides).
  if (kind === 'modpack') {
    const { download } = require('../main/http.js');
    const os = require('os');
    const tmp = path.join(os.tmpdir(), 'ob-mcp-mrpack-' + Date.now() + '.mrpack');
    try {
      await download(dl.url, tmp, null, null, { maxBytes: 512 * 1024 * 1024 });
      const r = await importMrpackFromPath(ctx, tmp, undefined, 'mcp');
      return ok(r);
    } catch (e) {
      return { ok: false, error: e?.message || 'Modpack import failed.' };
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  }
  const folder = kind === 'datapack' ? path.join(serverFiles(root).properties['level-name'] || 'world', 'datapacks') : (kind === 'mod' || kind === 'forge' || kind === 'fabric') ? 'mods' : 'plugins';
  const dest = safeTarget(root, path.join(folder, path.basename(dl.filename)));
  if (!dest) return { ok: false, error: 'Unsafe destination path.' };
  const { download } = require('../main/http.js');
  const { recordManifestEntry } = require('../main/fs-utils.js');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // A single plugin/mod jar from the market; cap at 512 MB (mirrors the GUI install path).
  await download(dl.url, dest, null, null, { maxBytes: 512 * 1024 * 1024 });
  try { recordManifestEntry(root, { kind, fileName: path.basename(dl.filename), sourceUrl: dl.url, source: dl.source, env: item.env || undefined, installedAt: new Date().toISOString() }); } catch {}
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

// ============ MODPACK PLANNER / ASSEMBLER (1.5.0) ============
// An AI can already install one item at a time, but a whole pack that way costs one GUI confirm per
// file. These two tools split the job: plan_modpack (read) resolves candidates + compatibility +
// dependencies into a plan the AI shows the user; assemble_modpack (write) installs the approved
// plan in ONE confirmed batch. The AI supplies ids/source/version only - URLs and hashes are always
// resolved here from the registry, never taken from the model.
function normalizePlanItem(it) {
  const source = ['modrinth', 'hangar', 'spigot', 'curseforge'].includes(it && it.source) ? it.source : 'modrinth';
  const kind = ['forge', 'fabric', 'datapack', 'mod', 'neoforge', 'plugin'].includes(it && it.kind) ? it.kind : 'plugin';
  return { source, kind, id: String((it && it.id) || ''), version: (it && it.version) || '', versionId: (it && it.versionId) || '', title: (it && it.title) || null, env: (it && it.env) || null };
}
async function tPlanModpack(ctx, a) {
  const root = needPath(ctx);
  const input = Array.isArray(a.items) ? a.items : [];
  if (!input.length) return { ok: false, error: 'items is required: [{ id, source?, kind?, version?, versionId? }]. Find ids with search_marketplace first.' };
  const max = Math.max(1, Math.min(100, Number(a.max) || 50));
  const resolveDeps = a.resolveDeps !== false;
  const props = serverFiles(root).properties || {};
  // A8 (v2.3.0): detect the target from libraries/ too, so a jar-less NeoForge/Forge server is not
  // misread as vanilla (which made the loader filter below a no-op).
  const server = detectServerTarget(root, serverFiles(root));
  const seed = dedupeById(input.map(normalizePlanItem).filter(it => it.id));
  const { items: capped } = capPlan(seed, max);
  const seen = new Set(capped.map(it => it.source + ':' + it.id));
  const queue = [...capped];
  const plan = [];
  const rejected = [];
  const problems = [];
  const dlByKey = new Map(); // source:id -> resolved download (for the A9 jar inspection below)
  let depth = 0;
  while (queue.length && plan.length < max) {
    const batch = queue.splice(0, queue.length);
    depth++;
    for (const it of batch) {
      if (plan.length >= max) break;
      let dl;
      try { dl = await resolveMarketDownload(it); }
      catch (e) { problems.push({ id: it.id, source: it.source, error: e?.message || 'Could not resolve a downloadable version.' }); continue; }
      const compat = itemCompat({ kind: it.kind, gameVersions: dl.gameVersions, loaders: dl.loaders, env: it.env }, server);
      // A8 (v2.3.0): HARD reject a version whose loader/MC does not match the server, instead of
      // only warning - a Forge mod on NeoForge (or a wrong-MC build) must never reach the plan.
      const vmatch = versionMatchesServer({ gameVersions: dl.gameVersions, loaders: dl.loaders }, server);
      if (!vmatch.ok) { rejected.push({ id: it.id, source: it.source, kind: it.kind, reason: vmatch.reason, version: dl.versionNumber || it.version || null }); continue; }
      dlByKey.set(it.source + ':' + it.id, dl);
      // CurseForge dependencies are listed (informational) but NOT auto-queued: CF publishes no
      // official relationType table, so we cannot reliably tell required from optional. Incompatible
      // ones become a warning. Modrinth deps (clear types) are followed below.
      const deps = Array.isArray(dl.dependencies) ? dl.dependencies : [];
      const cfDeps = deps.filter(d => d && (d.uncertain || !d.versionId) && d.projectId && it.source === 'curseforge');
      const incompat = deps.filter(d => d && d.type === 'incompatible' && d.projectId);
      if (incompat.length) compat.warnings.push('incompatible');
      const entry = { id: it.id, source: it.source, kind: it.kind, title: it.title, version: dl.versionNumber || it.version || null, filename: dl.filename, folder: folderForKind(it.kind, props['level-name'] || 'world').replace(/\\/g, '/'), warnings: compat.warnings };
      if (it.source === 'curseforge' && cfDeps.length) entry.dependencies = cfDeps.map(d => ({ projectId: d.projectId, type: d.type, uncertain: !!d.uncertain }));
      plan.push(entry);
      // A6 (v2.1.0): follow required Modrinth deps to depth 3 (was 2); the `seen` set already guards
      // cycles and capPlan caps the total, so a deeper walk cannot run away.
      if (resolveDeps && depth <= 3 && Array.isArray(dl.dependencies)) {
        for (const d of dl.dependencies) {
          if (!d || d.type !== 'required' || !d.projectId) continue;
          // Only Modrinth deps carry a versionId; CF deps are surfaced in `entry.dependencies` above.
          if (!d.versionId) continue;
          const key = 'modrinth:' + d.projectId;
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({ source: 'modrinth', kind: it.kind === 'datapack' ? 'datapack' : it.kind, id: String(d.projectId), version: it.version, versionId: d.versionId || '', title: null, env: null });
        }
      }
    }
  }
  // A4: flag items whose exact target file is already present (case-insensitive) so the AI can skip
  // re-installing - a hint, not an error. Same folder mapping the installer uses.
  for (const p of plan) {
    try {
      const target = safeTarget(root, path.join(p.folder, p.filename));
      if (target) {
        const dir = path.dirname(target);
        const base = path.basename(target).toLowerCase();
        const present = fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.toLowerCase() === base);
        if (present) p.alreadyInstalled = true;
      }
    } catch { /* existence check is best-effort */ }
  }
  const warnCount = plan.filter(p => p.warnings.length).length;
  const installedCount = plan.filter(p => p.alreadyInstalled).length;
  // A3: item-vs-item conflicts (the plan is otherwise only checked item-vs-server).
  const { conflicts } = planConflicts(plan);
  // A5: plan-level warnings (Fabric API missing, proxy, Java requirement).
  let hasProxy = false;
  try { hasProxy = fs.existsSync(path.join(root, 'velocity.toml')); } catch {}
  const serverJava = (() => { try { return javaMajor(ctx.javaInfo?.version); } catch { return null; } })();
  const { warnings: planWarn } = planWarnings(plan, server, { hasProxy, serverJava });
  return { ok: true, result: { server: { mc: server.mc, loader: server.loader }, planned: plan.length, withWarnings: warnCount, alreadyInstalled: installedCount, conflicts, planWarnings: planWarn, rejected, plan, problems, note: 'Show this plan to the user, then call assemble_modpack with the same items to install them in one confirmed batch.' } };
}
async function tAssembleModpack(ctx, a) {
  const root = needPath(ctx);
  const input = Array.isArray(a.items) ? a.items : [];
  if (!input.length) return { ok: false, error: 'items is required.' };
  const items = dedupeById(input.map(normalizePlanItem).filter(it => it.id)).slice(0, 100);
  const levelName = (serverFiles(root).properties || {})['level-name'] || 'world';
  const { isSafeDownloadUrl } = require('../main/validate.js');
  const { download } = require('../main/http.js');
  const { recordManifestEntry } = require('../main/fs-utils.js');
  // Recompute compatibility per item so the REPORT itself carries warnings — assemble must not
  // rely on the caller having run plan_modpack first (the "show plan, then assemble" flow is
  // prompt-driven, not enforced). A failed compat check does not block the install; it is reported.
  // A8 (v2.3.0): detect the target from libraries/ too (jar-less NeoForge/Forge run.bat).
  const server = detectServerTarget(root, serverFiles(root));
  const force = a.force === true;
  // A7 (v2.1.0) preflight: resolve each item first, sum the sizes the registry reports, and warn on
  // a big batch BEFORE any download so the AI can confirm with the user. Resolve failures are kept
  // and reported in the final results too (not silently dropped).
  const resolved = [];
  let totalBytes = 0, unknownSize = 0;
  const blocked = [];
  for (const it of items) {
    try {
      const dl = await resolveMarketDownload(it);
      if (!isSafeDownloadUrl(dl.url)) { resolved.push({ it, dl, error: 'Download URL is not on an allowlisted public host.' }); continue; }
      // A8 (v2.3.0): refuse a version whose loader/MC does not match the server (unless force:true).
      const vmatch = versionMatchesServer({ gameVersions: dl.gameVersions, loaders: dl.loaders }, server);
      if (!vmatch.ok && !force) { blocked.push({ id: it.id, source: it.source, kind: it.kind, reason: vmatch.reason }); continue; }
      if (Number.isFinite(dl.size) && dl.size > 0) totalBytes += dl.size; else unknownSize++;
      resolved.push({ it, dl });
    } catch (e) { resolved.push({ it, error: e?.message || 'Could not resolve a downloadable version.' }); }
  }
  const results = [];
  const createdFiles = [];
  let installed = 0, failed = 0;
  for (const r of resolved) {
    const it = r.it;
    if (r.error) { results.push({ id: it.id, ok: false, error: r.error }); failed++; continue; }
    const dl = r.dl;
    try {
      const dest = safeTarget(root, path.join(folderForKind(it.kind, levelName), path.basename(dl.filename)));
      if (!dest) { results.push({ id: it.id, ok: false, error: 'Unsafe destination path.' }); failed++; continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await download(dl.url, dest, null, null, { maxBytes: 512 * 1024 * 1024 });
      try { recordManifestEntry(root, { kind: it.kind, fileName: path.basename(dl.filename), sourceUrl: dl.url, source: it.source, title: it.title || undefined, env: it.env || undefined, installedAt: new Date().toISOString() }); } catch {}
      createdFiles.push(path.relative(root, dest).replace(/\\/g, '/'));
      const warnings = itemCompat({ kind: it.kind, gameVersions: dl.gameVersions, loaders: dl.loaders, env: it.env }, server).warnings;
      const row = { id: it.id, ok: true, name: dl.filename };
      if (warnings.length) row.warnings = warnings;
      results.push(row);
      installed++;
    } catch (e) { results.push({ id: it.id, ok: false, error: e?.message || 'Install failed.' }); failed++; }
  }
  const warned = results.filter(r => r.warnings && r.warnings.length).length;
  const preflight = { totalBytes, unknownSize, over500MB: totalBytes > 500 * 1024 * 1024 };
  // Plan-level warnings (same helper plan_modpack uses) so the assemble report is self-contained:
  // the AI does not have to have run plan_modpack first to see Fabric-API-missing / proxy / java.
  let hasProxy = false; try { hasProxy = fs.existsSync(path.join(root, 'velocity.toml')); } catch {}
  const serverJava = (() => { try { return javaMajor(ctx.javaInfo?.version); } catch { return null; } })();
  const installPlan = items.map(it => ({ id: it.id, source: it.source, kind: it.kind, filename: (results.find(r => r.id === it.id && r.ok) || {}).name || null, folder: folderForKind(it.kind, levelName).replace(/\\/g, '/'), javaRequired: it.javaRequired }));
  const { warnings: planWarn } = planWarnings(installPlan, server, { hasProxy, serverJava });
  const note = failed && createdFiles.length
    ? 'Some items installed before a failure. To undo, call delete_content for each file in createdFiles (needs user approval).'
    : undefined;
  const blockedNote = blocked.length ? `${blocked.length} item(s) were skipped as incompatible with this ${server.loader} ${server.mc || ''} server (pass force:true to override).` : undefined;
  return { ok: true, result: { requested: items.length, installed, failed, blocked, withWarnings: warned, planWarnings: planWarn, preflight, createdFiles, note: blockedNote || note, results, files: serverFiles(root) } };
}
async function tSavePlayerData(ctx, a) { return ok(await savePlayer(ctx, { uuid: a.uuid, changes: a.changes || {}, clearInventory: !!a.clearInventory })); }
const { readPlayer, whitelistToggle, banToggle, opToggle, savePlayer } = require('../main/players.js');
async function tReadPlayer(ctx, a) { return ok(await readPlayer(ctx, a.uuid, a.name)); }
async function tOpPlayer(ctx, a) { needPath(ctx); return ok(await opToggle(ctx, { uuid: a.uuid || null, name: a.name, op: a.on !== false, level: a.level })); }
async function tWhitelistPlayer(ctx, a) { needPath(ctx); return ok(await whitelistToggle(ctx, { uuid: a.uuid || null, name: a.name, add: a.add !== false })); }
async function tBanPlayer(ctx, a) { needPath(ctx); return ok(await banToggle(ctx, { uuid: a.uuid || null, name: a.name, ban: a.ban !== false, reason: a.reason, ip: a.ip })); }

// ---- DESTROY tools ----
async function tStopServer(ctx) {
  if (ctx.serverStatus === 'stopped' || ctx.serverStatus === 'stopping') return { ok: false, error: 'Server is not running.' };
  if (!ctx.serverProcess) return { ok: false, error: 'Server is not running.' };
  ctx.manualStop = true;
  clearTimeout(ctx.restartTimer);
  ctx.setServerStatus('stopping');
  // M12: RCON-first (works for an adopted / RCON-attached server whose stdin stub is null).
  try { await sendConsoleCommand(ctx, 'stop'); } catch {}
  return { ok: true };
}
async function tForceStopServer(ctx) { return ok(await forceStopServer(ctx)); }
// ---- M11: multi-instance tools ----
async function tListInstances(ctx) {
  const { listInstances } = require('../main/settings.js');
  const { instances, activeInstanceId } = listInstances();
  // Include live status per instance (from ctx.instances) so the AI can pick one to act on.
  const enriched = instances.map(i => {
    const st = ctx.instances && ctx.instances.get(i.id);
    return { id: i.id, name: i.name, serverPath: i.serverPath, status: (st && st.serverStatus) || 'stopped', active: i.id === activeInstanceId };
  });
  return { ok: true, result: { instances: enriched, activeInstanceId } };
}
// M12: read a NON-active instance's full state (status, console, metrics, files, java) WITHOUT
// making it active. Mirrors the IPC instances:snapshot. Lets an AI inspect/compare servers without
// flipping the user's GUI to another instance. Read-only.
async function tGetInstanceSnapshot(ctx, a) {
  const { resolveInstanceId } = require('../main/settings.js');
  const id = resolveInstanceId(String(a.instance || a.id || '').trim() || null);
  if (!id) return { ok: false, error: 'Unknown instance id. Call list_instances for valid ids.' };
  const st = ctx.instances && ctx.instances.get(id);
  if (!st) return { ok: false, error: 'Unknown instance.' };
  const root = st.currentServerPath || st.serverPath || '';
  let files = {}; try { files = serverFiles(root); } catch {}
  const n = Math.min(Math.max(1, Number(a.lines) || 100), 2000);
  const { scrubPII } = require('./doctor.js');
  const logs = (Array.isArray(st.consoleBuffer) ? st.consoleBuffer.slice(-n) : []).map(l => `[${l.time}] ${scrubPII(l.text)}`);
  const hist = Array.isArray(st.metricsHistory) ? st.metricsHistory : [];
  return { ok: true, result: {
    id, name: st.name || null, serverPath: root || null,
    status: st.serverStatus || 'stopped', running: st.serverStatus === 'running',
    active: id === ctx.activeInstanceId,
    logs, live: st.live || { tps: null, mspt: null, players: [] },
    metricsSamples: hist.length, java: st.javaInfo || null, files,
  } };
}
async function tSelectInstance(ctx, a) {
  const { switchInstance } = require('../main/settings.js');
  const id = String(a.instance || a.id || '').trim();
  if (!id) return { ok: false, error: 'instance id is required.' };
  const r = switchInstance(id);
  if (!r.ok) return r;
  try { ctx.seedInstances(); } catch {}
  return { ok: true, result: { activeInstanceId: ctx.activeInstanceId } };
}
async function tStartInstance(ctx, a) {
  const { loadSettingsFor, resolveInstanceId } = require('../main/settings.js');
  const id = resolveInstanceId(String(a.instance || a.id || '').trim() || null);
  if (!id) return { ok: false, error: 'Unknown instance id.' };
  return await ctx.runInInstance(id, async () => {
    const s = loadSettingsFor(id);
    // Prime the target instance's runtime folder so file ops inside startServerInternal resolve.
    ctx.currentServerPath = s.serverPath || ctx.currentServerPath;
    return ok(await startServerInternal(ctx, s));
  });
}
async function tStopInstance(ctx, a) {
  const { resolveInstanceId } = require('../main/settings.js');
  const id = resolveInstanceId(String(a.instance || a.id || '').trim() || null);
  if (!id) return { ok: false, error: 'Unknown instance id.' };
  return await ctx.runInInstance(id, async () => {
    if (ctx.serverStatus === 'stopped' || ctx.serverStatus === 'stopping') return { ok: false, error: 'Instance is not running.' };
    if (!ctx.serverProcess) return { ok: false, error: 'Instance is not running.' };
    ctx.manualStop = true;
    clearTimeout(ctx.restartTimer);
    ctx.setServerStatus('stopping');
    try { await sendConsoleCommand(ctx, 'stop'); } catch {}
    return { ok: true };
  });
}
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
  // M12: the TARGET instance's schedule, not the active one.
  const s = loadSettingsFor(ctx.inst());
  return { ok: true, result: { enabled: !!s.scheduleEnabled, startTime: s.scheduleStartTime || '', stopTime: s.scheduleStopTime || '', days: s.scheduleDays || [] } };
}
async function tSetSchedule(ctx, a) {
  const { parseTime } = require('../main/scheduler.js');
  const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const target = ctx.inst();
  const s = loadSettingsFor(target);
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
  saveSettingsFor(target, s);
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
  // M12: route through sendConsoleCommand (RCON-first) so kick works on an RCON/adopted server too.
  const r = await sendConsoleCommand(ctx, 'kick ' + name);
  if (!r.ok) return r;
  return { ok: true, result: { kicked: name } };
}

// ---- SERVER DOCTOR (1.2.0) ---- read-only diagnostics + composite workflows.
async function tDiagnoseServer(ctx) {
  const root = ctx.currentServerPath || '';
  const s = loadSettings();
  let files = {}; try { files = serverFiles(root); } catch {}
  const javaRequired = requiredJavaForServer(root, serverFiles) || null;
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
  const buf = (ctx.consoleBuffer || []).slice(-n).map(l => ({ text: doctor.scrubPII(l.text), type: l.type }));
  const analysis = doctor.analyzeConsoleLines(buf);
  return { ok: true, result: { scanned: buf.length, errors: analysis.errors, warns: analysis.warns, issues: analysis.issues } };
}
async function tExplainCrash(ctx, a) {
  const root = needPath(ctx);
  // Default = newest. A `name` (from list_crash_reports) lets the AI read an OLDER crash.
  let pick = null;
  if (a && a.name) {
    const p = doctor.resolveCrashReport(root, a.name);
    if (!p) return { ok: false, error: 'Crash report not found: ' + a.name };
    let mtime = 0; try { mtime = fs.statSync(p).mtimeMs; } catch {}
    pick = { file: p, name: a.name, mtime };
  } else {
    pick = doctor.latestCrashReport(root);
  }
  if (!pick) return { ok: true, result: { found: false, message: 'No crash reports found in crash-reports/.' } };
  let text = '';
  try { text = fs.readFileSync(pick.file, 'utf8'); } catch (e) { return { ok: false, error: 'Could not read the crash report: ' + (e.code || e.message) }; }
  // C1 (v2.1.0): add a rule-based category so the AI can act without reading the whole report.
  const classification = doctor.classifyCrash(text);
  // 2.3.0: the crash-report HEADER often says "No associated exception found" while the real cause
  // (a missing mandatory dependency, a jar for the wrong loader) is only in logs/latest.log. Scan
  // the tail of the log too and surface concrete missing-dep / skipped-jar entries, and raise
  // confidence when we find them.
  let fromLog = { missingDeps: [], skippedJars: [] };
  try {
    const tail = doctor.tailLogFile(root, { lines: 400 });
    if (tail.ok) fromLog = doctor.scanLogForMissingDeps((tail.lines || []).join('\n'));
  } catch { /* log scan is best-effort */ }
  let finalClass = classification;
  if (fromLog.missingDeps.length || fromLog.skippedJars.length) {
    finalClass = { category: fromLog.missingDeps.length ? 'mod-dependency' : 'loader-mismatch', confidence: 'high', hints: fromLog.missingDeps.length ? ['Install the missing dependency mod(s) listed in missingDeps, then restart.'] : ['Remove the listed jars that are for a different loader.'] };
  }
  return { ok: true, result: { found: true, file: pick.name, mtime: pick.mtime, classification: finalClass, fromLog, ...doctor.summarizeCrashText(text) } };
}
async function tListCrashReports(ctx) {
  const root = needPath(ctx);
  const reports = doctor.listCrashReports(root);
  return { ok: true, result: { count: reports.length, reports } };
}
async function tReadServerLog(ctx, a) {
  const root = needPath(ctx);
  const r = doctor.tailLogFile(root, { file: a.file, lines: a.lines, maxBytes: a.maxBytes });
  return r.ok ? { ok: true, result: r } : { ok: false, error: r.error };
}
async function tCheckPerformance(ctx) {
  const live = ctx.live || {};
  const tps = live.tps ?? null, mspt = live.mspt ?? null, players = (live.players || []).length;
  const notes = [];
  const push = (level, detail, fix) => notes.push({ level, detail, fix: fix || null });
  if (ctx.serverStatus !== 'running') push('info', 'Server is not running - live metrics are unavailable.');
  // 2.3.0: right after start TPS is null for a few seconds; say so instead of a silent null.
  else if (tps == null) { const secs = Math.round((Date.now() - (ctx.startedAt || Date.now())) / 1000); push('info', `Metrics are still warming up (server has been up ~${Math.max(0, secs)}s) - retry in a few seconds.`); }
  if (tps != null) { if (tps < 15) push('error', `TPS ${tps} - the server is struggling.`, 'Reduce view-distance, remove heavy plugins, or allocate more RAM.'); else if (tps < 19) push('warn', `TPS ${tps} - mild lag.`, 'Consider lowering view-distance or plugin load.'); else push('ok', `TPS ${tps} - healthy.`); }
  if (mspt != null) { if (mspt > 50) push('error', `MSPT ${mspt}ms - above the 50ms tick budget.`, 'The main thread cannot keep up; reduce load.'); else if (mspt > 40) push('warn', `MSPT ${mspt}ms - close to the 50ms budget.`); else push('ok', `MSPT ${mspt}ms - healthy.`); }
  return { ok: true, result: { running: ctx.serverStatus === 'running', tps, mspt, players, notes } };
}
async function tGetMetricsHistory(ctx, a) {
  const { queryHistory } = require('../main/server-metrics.js');
  const minutes = Math.min(Math.max(1, Number(a?.minutes) || 30), 180);
  const maxSamples = Math.min(Math.max(1, Number(a?.max_samples) || 500), 1000);
  const hist = ctx.metricsHistory || [];
  const q = queryHistory(hist, { minutes, maxSamples });
  return { ok: true, result: { minutes, ...q } };
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
  // C2 (v2.1.0): when the port is busy, explain WHO holds it and suggest an alternative. A port
  // configured by another ObserverLauncher instance is the common, fixable case; an unknown holder
  // is reported plainly. Suggestion scans up to 20 ports above.
  let holder = null;
  if (r.free === false) {
    try {
      for (const [id, st] of ctx.instances || []) {
        if (id === ctx.inst()) continue;
        const root = st.currentServerPath || st.serverPath;
        if (!root) continue;
        let p = 0; try { p = Number(serverFiles(root).properties?.['server-port']) || 0; } catch {}
        if (p === port) { holder = { type: 'instance', id, name: st.name || null }; break; }
      }
    } catch {}
    if (!holder) holder = { type: 'unknown' };
    let suggestion = null;
    for (let cand = port + 1; cand <= Math.min(65535, port + 20); cand++) {
      const c = await doctor.checkPortFree(cand);
      if (c.free === true) { suggestion = cand; break; }
    }
    r.holder = holder;
    r.suggestedPort = suggestion;
    r.hint = holder.type === 'instance'
      ? `Another ObserverLauncher instance (${holder.name || holder.id}) uses port ${port}. Stop it or change this instance's server-port.`
      : `Another process holds port ${port}.` + (suggestion ? ` Try server-port ${suggestion}.` : '');
  }
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

// ============ v2.5.0 AUTONOMOUS DOCTOR (propose + apply) ============
// propose_fix GATHERS the facts (diagnose + port + mod compat + crash loop + RAM trend) and asks
// repair.js for a structured plan. It changes NOTHING - the AI shows the plan to the user, then
// calls apply_fix. apply_fix re-uses the existing tool handlers so all guards still apply.
async function tProposeFix(ctx) {
  const root = needPath(ctx);
  // Facts. Each source is best-effort so one failure does not abort the whole diagnosis.
  let diag = {}; try { diag = (await tDiagnoseServer(ctx)).result || {}; } catch {}
  let port = {}; try { port = (await tCheckPort(ctx, {})).result || {}; } catch {}
  let compat = {}; try { compat = (await tCheckModCompat(ctx)).result || {}; } catch {}
  let reports = []; try { reports = doctor.listCrashReports(root) || []; } catch {}
  let newestBackup = null; try { const b = serverFiles(root).backups || []; newestBackup = b[0] ? b[0].name : null; } catch {}
  // RAM pressure: use the active instance's sampled history + the configured memoryMax (MB).
  let ram = {}; try { const s = loadSettingsFor(ctx.inst()); ram = repair.detectRamPressure(ctx.metricsHistory || [], (Number(s.memoryMax) || 6) * 1024, {}); } catch {}
  const crashLoop = repair.detectCrashLoop(reports, {});
  const facts = {
    issues: diag.checks || [],
    port,
    missingDeps: compat.missingDeps || [],
    crashLoop,
    ram,
    newestBackup,
  };
  const r = repair.proposeRepair(facts);
  return { ok: true, result: { server: { mc: compat.server?.mc ?? null, loader: compat.server?.loader ?? null }, healthy: diag.healthy ?? null, diagnosis: { port, missingDeps: facts.missingDeps, crashLoop, ram }, plan: r.plan, summary: r.summary, note: 'Show this plan to the user. Call apply_fix with the same actions (confirmed) to run them. Nothing has changed yet.' } };
}
// apply_fix EXECUTES a plan from propose_fix. Each item { action, args } is routed to an existing
// tool handler, so every guard (safeTarget, isSafeDownloadUrl, confirm tier) still applies.
async function tApplyFix(ctx, a) {
  const items = Array.isArray(a && a.actions) ? a.actions : [];
  if (!items.length) return { ok: false, error: 'actions is required: pass the plan[] entries from propose_fix.' };
  const results = [];
  for (const it of items) {
    const action = it && it.action;
    const args = (it && it.args) || {};
    try {
      if (action === repair.ACTION.CHANGE_PORT) {
        const r = await tSetProperty(ctx, { key: String(args.key || 'server-port'), value: String(args.value) });
        results.push({ action, ok: r.ok !== false, result: r });
      } else if (action === repair.ACTION.INSTALL_DEPENDENCY) {
        // Resolve the dependency by name via the marketplace, then install it (write tier).
        // BUGFIX (2.5.1): pin the search + install to the SERVER's real loader (neoforge/forge/
        // fabric/quilt) so a NeoForge server never gets a Forge-only build. detectServerTarget
        // reads libraries/ for a jar-less run.bat server too. Fall back to the generic 'mod' group
        // when the loader is unknown (vanilla).
        let loader = '';
        try { const t = detectServerTarget(needPath(ctx), serverFiles(needPath(ctx))); loader = ['neoforge', 'forge', 'fabric', 'quilt'].includes(t.loader) ? t.loader : ''; } catch {}
        // v2.5.0 fix: a bare modId rarely matches Modrinth full-text search ('alexsmobs' -> 0 hits
        // while 'Alex Mobs' works). findMarketProject tries query variants + a direct slug lookup,
        // then scores the hits and REFUSES when ambiguous - so we never install the wrong mod
        // (the old blind top-1 could pick an unrelated result).
        const found = await findMarketProject(String(args.query || ''), { loader });
        if (!found.ok || !found.item) {
          results.push({ action, ok: false, error: found.error || `No mod found matching "${args.query}".`, candidates: found.candidates || [] });
          continue;
        }
        const hit = found.item;
        const r = await tInstallFromMarket(ctx, { id: hit.id, kind: 'mod', source: 'modrinth', loader });
        results.push({ action, ok: r.ok !== false, name: hit.title, loader: loader || 'any', result: r });
      } else if (action === repair.ACTION.TUNE_PERFORMANCE) {
        // Lower view-distance one notch (never below 4). Memory increase is only SUGGESTED (the plan
        // reason carries it) - changing RAM needs a restart and a deliberate user choice.
        let cur = 10; try { cur = Number(serverFiles(needPath(ctx)).properties['view-distance']) || 10; } catch {}
        const next = Math.max(4, cur - 2);
        const r = await tSetProperty(ctx, { key: 'view-distance', value: String(next) });
        results.push({ action, ok: r.ok !== false, detail: `view-distance ${cur} -> ${next}`, suggestMemoryIncrease: !!args.suggestMemoryIncrease, result: r });
      } else if (action === repair.ACTION.RESTORE_BACKUP) {
        const name = args.name || (() => { try { const b = serverFiles(needPath(ctx)).backups || []; return b[0] ? b[0].name : null; } catch { return null; } })();
        if (!name) { results.push({ action, ok: false, error: 'No backup available to restore.' }); continue; }
        const r = await tRestoreBackup(ctx, { name });
        results.push({ action, ok: r.ok !== false, name, result: r });
      } else {
        results.push({ action, ok: false, error: 'Unknown action: ' + action });
      }
    } catch (e) { results.push({ action, ok: false, error: e?.message || String(e) }); }
  }
  const okCount = results.filter(r => r.ok).length;
  return { ok: true, result: { applied: okCount, total: items.length, results, note: okCount < items.length ? 'Some fixes failed - see results. A restart may be needed for port/view-distance changes.' : 'All fixes applied. Restart the server if a port or view-distance changed.' } };
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
  { name: 'list_content', risk: 'read', description: 'Plugins, mods and datapacks (mods carry a loader flag + loaderMismatch when they do not match the server).', inputSchema: S(), handler: tListContent },
  { name: 'check_mod_compat', risk: 'read', description: 'Pre-start scan of mods/: reports jars for the wrong loader, client-only mods, MISSING required dependencies (read from each jar metadata, incl. non-registry deps), and CONFLICTS (a declared type="incompatible" mod that is installed). Run before start_server to catch the crash chain early.', inputSchema: S(), handler: tCheckModCompat },
  { name: 'read_crash_report', risk: 'read', description: 'Read a crash-report from crash-reports/ (default newest; pass name). Path is confined to the server folder (unlike read_file, which is rooted at the project).', inputSchema: S({ name: STR('crash report file name (optional, default newest)') }), handler: tReadCrashReport },
  { name: 'get_properties', risk: 'read', description: 'Parsed server.properties.', inputSchema: S(), handler: tGetProperties },
  { name: 'get_raw_properties', risk: 'read', description: 'Raw velocity.toml content.', inputSchema: S(), handler: tGetRawProperties },
  { name: 'get_world_info', risk: 'read', description: 'Seed, spawn, players and waypoints.', inputSchema: S(), handler: tGetWorldInfo },
  { name: 'list_worlds', risk: 'read', description: 'World folders.', inputSchema: S(), handler: tListWorlds },
  { name: 'list_backups', risk: 'read', description: 'Backup files with size + date.', inputSchema: S(), handler: tListBackups },
  { name: 'get_network_info', risk: 'read', description: 'LAN IPs and server port.', inputSchema: S(), handler: tGetNetworkInfo },
  { name: 'get_java_info', risk: 'read', description: 'Detected Java version/path/arch.', inputSchema: S(), handler: tGetJavaInfo },
  { name: 'search_marketplace', risk: 'read', description: 'Search Modrinth, Hangar, Spigot or CurseForge for plugins/mods/datapacks/modpacks. CurseForge requires the user to have set an API key in Settings.', inputSchema: S({ query: STR('search text'), kind: STR('plugin|mod|datapack|modpack'), source: STR('modrinth|hangar|spigot|curseforge (default modrinth)'), version: STR('MC version'), sort: STR('downloads|latest|relevance'), offset: { type: 'number', description: 'pagination offset (default 0)' } }), handler: tSearchMarketplace },
  { name: 'list_market_versions', risk: 'read', description: 'Versions of a project (Modrinth, Hangar or CurseForge). Pick a versionId then install_from_market.', inputSchema: S({ id: STR('project id/slug (Hangar: owner/slug)'), source: STR('modrinth|hangar|curseforge (default modrinth)') }, ['id']), handler: tListMarketVersions },
  { name: 'diagnose_server', risk: 'read', description: 'Full server health check: folder, jar, Java version/arch, EULA, port, world, backups, recent crash. Returns per-check level (ok/warn/error) + fixes.', inputSchema: S(), handler: tDiagnoseServer },
  { name: 'analyze_console', risk: 'read', description: 'Scan the console buffer for errors/warnings (OOM, port-busy, exceptions, lag), grouped and ranked.', inputSchema: S({ lines: { type: 'number', description: 'lines to scan (default 500, max 2000)' } }), handler: tAnalyzeConsole },
  { name: 'explain_crash', risk: 'read', description: 'Summarise a crash-report (default: newest; pass name to read an older one from list_crash_reports).', inputSchema: S({ name: STR('crash report file name (optional, default newest)') }), handler: tExplainCrash },
  { name: 'list_crash_reports', risk: 'read', description: 'List all crash-reports (name, mtime, size), newest first.', inputSchema: S(), handler: tListCrashReports },
  { name: 'read_server_log', risk: 'read', description: 'Tail the server log file (logs/latest.log by default) - last N lines, bounded size, survives restarts. Use this to see what happened on a previous run.', inputSchema: S({ file: STR('log file name inside logs/ (default latest.log)'), lines: { type: 'number', description: 'max lines to return (default 200, max 2000)' }, maxBytes: { type: 'number', description: 'max bytes read from the end (default 512KB, max 4MB)' } }), handler: tReadServerLog },
  { name: 'check_performance', risk: 'read', description: 'TPS/MSPT/players snapshot with threshold warnings (does the server keep up?).', inputSchema: S(), handler: tCheckPerformance },
  { name: 'get_metrics_history', risk: 'read', description: 'Time series of sampled metrics (tps, mspt, cpu, ram, players) so you can tell if memory is climbing or when TPS dropped. Downsampled to a bounded count.', inputSchema: S({ minutes: { type: 'number', description: 'window in minutes (default 30, max 180)' }, max_samples: { type: 'number', description: 'max samples returned (default 500, max 1000)' } }), handler: tGetMetricsHistory },
  { name: 'validate_config', risk: 'read', description: 'Validate server.properties: port, level-name exists, view-distance, simulation-distance, max-players.', inputSchema: S(), handler: tValidateConfig },
  { name: 'check_port', risk: 'read', description: 'Check whether the server port is free (bind test).', inputSchema: S({ port: { type: 'number', description: 'port to test (default: server-port)' } }), handler: tCheckPort },
  { name: 'read_many_files', risk: 'read', description: 'Read up to 5 text files in one call (batch, cheaper than 5 read_file calls).', inputSchema: S({ paths: { type: 'array', items: { type: 'string' }, description: 'relative file paths (max 5)' } }, ['paths']), handler: tReadManyFiles },
  { name: 'doctor_report', risk: 'read', description: 'One-shot full report: diagnose + console analysis + performance + config + crash, combined.', inputSchema: S(), handler: tDoctorReport },
  { name: 'read_audit_log', risk: 'read', description: 'Recent MCP write/destroy actions (what an assistant changed), newest last.', inputSchema: S({ lines: { type: 'number', description: 'lines (default 100, max 500)' } }), handler: tReadAuditLog },
  { name: 'propose_fix', risk: 'read', description: 'Autonomous Doctor: gather port/mod-dep/crash-loop/RAM facts and return a STRUCTURED repair plan (change_port, install_dependency, tune_performance, restore_backup). Changes NOTHING - show the plan to the user, then call apply_fix.', inputSchema: S(), handler: tProposeFix },
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
  { name: 'search_modpacks', risk: 'read', description: 'Search Modrinth for installable modpacks. Install one with install_from_market { kind: "modpack", id }.', inputSchema: S({ query: STR('search text'), version: STR('MC version'), sort: STR('downloads|latest|relevance'), offset: { type: 'number', description: 'pagination offset (default 0)' } }), handler: tSearchModpacks },
  { name: 'install_from_market', risk: 'write', description: 'Install a plugin/mod/datapack/MODPACK from Modrinth, Hangar, Spigot or CurseForge (same resolver as the GUI). kind:"modpack" downloads the .mrpack and imports it (its files + overrides) into this instance. CurseForge needs the user to have set an API key in Settings, and refuses projects whose author blocks third-party downloads.', inputSchema: S({ id: STR('project id/slug (Hangar: owner/slug)'), kind: STR('plugin|mod|datapack|modpack'), source: STR('modrinth|hangar|spigot|curseforge (default modrinth)'), version: STR('MC version'), versionId: STR('exact Modrinth version id'), title: STR('title (Spigot, optional)') }, ['id']), handler: tInstallFromMarket },
  { name: 'install_local_jar', risk: 'write', description: 'Copy a local .jar into plugins/mods.', inputSchema: S({ path: STR('absolute source path'), kind: STR('plugin|mod|datapack') }, ['path']), handler: tInstallLocalJar },
  { name: 'import_modpack_path', risk: 'write', description: 'Import a .mrpack from a local path.', inputSchema: S({ path: STR('absolute .mrpack path') }, ['path']), handler: tImportModpackPath },
  { name: 'export_modpack', risk: 'write', description: 'Export current setup to a .mrpack at a path.', inputSchema: S({ path: STR('absolute destination .mrpack') }, ['path']), handler: tExportModpack },
  { name: 'plan_modpack', risk: 'read', description: 'Resolve candidate projects into an install plan: exact versions, per-item compatibility warnings against this server, and required Modrinth dependencies (depth 1-2, auto-followed). CurseForge items also list their declared dependencies (informational only - CF has no reliable required/optional table, so they are shown, never auto-installed). Read-only. Find ids with search_marketplace first, show the plan to the user, then assemble_modpack.', inputSchema: S({ items: { type: 'array', description: 'candidates: [{ id, source?, kind?, version?, versionId? }]', items: { type: 'object' } }, resolveDeps: { type: 'boolean', description: 'include required Modrinth dependencies (default true)' }, max: { type: 'number', description: 'max items in the plan (default 50)' } }, ['items']), handler: tPlanModpack },
  { name: 'assemble_modpack', risk: 'write', description: 'Install a whole list of projects in one confirmed batch (from plan_modpack). Returns a per-item report (installed/failed). One confirmation for the entire batch.', inputSchema: S({ items: { type: 'array', description: 'items: [{ id, source?, kind?, version?, versionId?, title? }]', items: { type: 'object' } } }, ['items']), handler: tAssembleModpack },
  { name: 'prepare_and_start', risk: 'write', description: 'Diagnose first (refuse on hard errors) -> create a safety backup -> start the server.', inputSchema: S(), handler: tPrepareAndStart },
  { name: 'safe_restart', risk: 'destroy', description: 'Back up, gracefully stop (waits up to 30s), then start again. Stops a running server - always requires confirmation (same class as stop_server).', inputSchema: S(), handler: tSafeRestart },
  { name: 'save_player_data', risk: 'write', description: 'Apply edits to a player .dat (health/food/xp/gamemode). Server must be stopped; a backup is written first.', inputSchema: S({ uuid: STR('player UUID'), changes: { type: 'object', description: 'health, food, saturation, xpLevel, xpTotal, gameType' }, clearInventory: { type: 'boolean', description: 'also clear inventory + equipment' } }, ['uuid']), handler: tSavePlayerData },
  { name: 'op_player', risk: 'write', description: 'Grant or revoke operator. level 1-4 applies when the server is STOPPED (writes ops.json); a running server always grants level 4 (vanilla /op has no level arg).', inputSchema: S({ name: STR('player name'), uuid: STR('known UUID (optional)'), on: { type: 'boolean', description: 'true = op, false = deop' }, level: { type: 'number', description: 'operator level 1-4 (default 4; stopped server only)' } }, ['name']), handler: tOpPlayer },
  { name: 'whitelist_player', risk: 'write', description: 'Add or remove from the whitelist.', inputSchema: S({ name: STR('player name'), uuid: STR('known UUID (optional)'), add: { type: 'boolean', description: 'true = add, false = remove' } }, ['name']), handler: tWhitelistPlayer },
  { name: 'ban_player', risk: 'write', description: 'Ban or unban a player, or ban/unban an IP with ip.', inputSchema: S({ name: STR('player name (or any label when using ip)'), uuid: STR('known UUID (optional)'), ban: { type: 'boolean', description: 'true = ban, false = unban' }, reason: STR('ban reason (optional)'), ip: STR('ban by IP instead of name (optional)') }, ['name']), handler: tBanPlayer },
  { name: 'list_instances', risk: 'read', description: 'List all configured server instances (id, name, serverPath, status, active). Call this FIRST to discover which instance to target, then pass instance: <id> to other tools.', inputSchema: S(), handler: tListInstances },
  { name: 'get_instance_snapshot', risk: 'read', description: 'Read ONE instance\'s full state (status, console tail, live metrics, java, files) WITHOUT making it active - use to inspect/compare a background server without disturbing the user\'s GUI.', inputSchema: S({ instance: STR('instance id (from list_instances)'), lines: { type: 'number', description: 'console lines to return (default 100, max 2000)' } }, ['instance']), handler: tGetInstanceSnapshot },
  { name: 'select_instance', risk: 'write', description: 'Make an instance the ACTIVE one (subsequent tools without an instance param target it). NOTE: this switches the user\'s GUI to that instance too - prefer passing an optional instance: <id> to the specific tool, or get_instance_snapshot, when you only need to read.', inputSchema: S({ instance: STR('instance id (from list_instances)') }, ['instance']), handler: tSelectInstance },
  { name: 'start_instance', risk: 'write', description: 'Start a specific instance by id (defaults to the active one).', inputSchema: S({ instance: STR('instance id (optional, default active)') }), handler: tStartInstance },
  { name: 'stop_instance', risk: 'destroy', description: 'Gracefully stop a specific instance by id (defaults to the active one).', inputSchema: S({ instance: STR('instance id (optional, default active)') }), handler: tStopInstance },
  { name: 'stop_server', risk: 'destroy', description: 'Gracefully stop the server.', inputSchema: S(), handler: tStopServer },
  { name: 'force_stop_server', risk: 'destroy', description: 'Kill the server process tree.', inputSchema: S(), handler: tForceStopServer },
  { name: 'delete_content', risk: 'destroy', description: 'Delete a plugin/mod/datapack file.', inputSchema: S({ kind: STR('plugin|mod|datapack'), name: STR('file name') }, ['name']), handler: tDeleteContent },
  { name: 'delete_backup', risk: 'destroy', description: 'Delete a backup ZIP.', inputSchema: S({ name: STR('backup file name') }, ['name']), handler: tDeleteBackup },
  { name: 'restore_backup', risk: 'destroy', description: 'Restore a backup (overwrites worlds).', inputSchema: S({ name: STR('backup file name') }, ['name']), handler: tRestoreBackup },
  { name: 'apply_fix', risk: 'destroy', description: 'Autonomous Doctor: execute the actions from a propose_fix plan (change_port, install_dependency, tune_performance, restore_backup). Always requires confirmation. Pass the plan entries you showed the user.', inputSchema: S({ actions: { type: 'array', description: 'plan[] entries from propose_fix: [{action, args}]', items: { type: 'object' } } }, ['actions']), handler: tApplyFix },
];

function getTool(name) { return TOOLS.find(t => t.name === name) || null; }

module.exports = { TOOLS, getTool };
