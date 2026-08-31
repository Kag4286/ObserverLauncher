const { app, BrowserWindow, dialog, ipcMain, shell, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const os = require('os');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

const { settingsPath, defaultMemoryGB, loadSettings, saveSettings } = require('./main/settings.js');
const crypto = require('crypto');
const { writeFileAtomic, readJsonList, writeJsonList, fileHashes, findFileRecursive, safeTarget, recordManifestEntry } = require('./main/fs-utils.js');
const { withTimeout, json, download, marketplaceError, psQuote, runPowerShell } = require('./main/http.js');
const { parseJavaVersion, detectJava, requiredJavaForJar, javaMajor, validateStart } = require('./main/java.js');
const { serverFiles, detectSoftware, readEula, writeEula, buildPropertiesContent, findPlayerDataFile, readPlayerData, parseServerLine } = require('./main/server-files.js');
const { localIPv4s } = require('./main/network.js');
const { downloadFillProject, listFillVersions } = require('./main/adapters/papermc.js');
const mojang = require('./main/adapters/mojang.js');
const editor = require('./main/editor.js');
const worldmap = require('./main/worldmap.js');
const platform = require('./main/platform');
const textures = require('./main/textures');
// Custom tex:// icon scheme (see src/main/textures.js) — MUST be registered as privileged before
// the app is ready, or Chromium treats it as non-standard and <img> loads fail.
protocol.registerSchemesAsPrivileged([{ scheme: 'tex', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win;
let serverProcess = null;
let currentServerPath = '';
let javaInfo = null;
let consoleBuffer = [];
let sampleTimer = null;
let previousCpu = null;
let monitoredPid = null; // PID of the actual java.exe process running the server (differs from serverProcess.pid when using run.bat)
let live = { tps: null, mspt: null, players: [] };
let currentSoftware = null; // tracks detectSoftware() of the currently running server (for metrics fallback timing)
// FEATURE: periodic auto-poll of "list"/"tps", manual-stop flag (to distinguish from a crash), auto-restart/backup timers.
let autoPollTimer = null;
let suppressStatusUntil = 0;
let lastManualCommandAt = 0; // stamps real user commands so their responses are never auto-hidden
let manualStop = false;
let restartTimer = null;
let restartAttempts = 0;
let autoBackupTimer = null;
let backupInProgress = false; // FEATURE: prevents a manual "Create Backup" click and the auto-backup timer from zipping the same world folder at the same moment (see createBackupInternal)
let lastAutoBackupAt = 0;
let buildProcess = null; // FEATURE: tracks a long-running build process (BuildTools for Spigot/CraftBukkit)

// FEATURE: explicit 4-state server status (stopped/starting/running/stopping) instead of a bare
// running:boolean. A boolean can't tell the UI "the process exists but hasn't finished loading yet"
// from "fully up and answering commands" — that gap is exactly what used to let the Start button be
// double-clicked mid-launch, and made the Properties/Worlds tabs' one-shot refresh unreliable (no
// single moment meant "now it's safe to read files"). Every transition goes through setServerStatus()
// below, which is also the ONLY place that pushes 'server:state' to the renderer — one choke point
// instead of a send('server:state', ...) call hand-added at each place the process happens to change,
// which is how the "server.properties stays empty" bug got introduced in the first place.
let serverStatus = 'stopped'; // 'stopped' | 'starting' | 'running' | 'stopping'
function setServerStatus(status) { serverStatus = status; send('server:state', { status, running: status !== 'stopped' }); }
// FEATURE: same idea for file listing — one named function instead of repeating
// send('server:files', serverFiles(currentServerPath)) at every call site (easy to forget one).
function pushFiles() { send('server:files', serverFiles(currentServerPath)); }
// FEATURE: live content updates — watch the server folder so plugins/mods/datapacks added or
// deleted on disk (Explorer, another tool, a marketplace install) show up in the Content tab
// instantly, instead of the stale list that only refreshed on folder-select/settings-save.
// Recursive watch + debounce. While the server is RUNNING the push is skipped: servers write
// logs/caches constantly and rescanning on each burst would hammer the disk for no benefit
// (running installs are picked up by the next start/stop push, which already exists).
let contentWatcher = null, contentWatchDebounce = null;
function watchServerFolder() {
  try { if (contentWatcher) contentWatcher.close(); } catch {}
  contentWatcher = null;
  if (!currentServerPath) return;
  try {
    contentWatcher = fs.watch(currentServerPath, { recursive: true }, () => {
      clearTimeout(contentWatchDebounce);
      contentWatchDebounce = setTimeout(() => { if (serverStatus !== 'running') { try { pushFiles(); } catch {} } }, 800);
    });
  } catch {}
}

// BUGFIX: the default RAM used to be hardcoded to 2/6GB regardless of the machine's real RAM —
// weak machines could freeze, strong machines were underused. Now the default is computed from
// system RAM the first time (before a settings file exists).
function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function appendLog(text, type = 'server') {
  const line = { time: new Date().toLocaleTimeString(), text: String(text).replace(/\r?\n$/, ''), type };
  consoleBuffer.push(line); if (consoleBuffer.length > 2000) consoleBuffer.shift(); send('server:log', line);
}
// FEATURE: tracks which file came from which Marketplace install, so "export modpack" can later
// rebuild a real .mrpack pointing back at the original download URLs.
// FEATURE: local-network IP addresses (for "friends on your WiFi can join at this address"). Filters
// out internal/loopback interfaces and anything that isn't IPv4 — VPN/virtual adapters can still show
// up here, but that's a reasonable trade-off vs. silently hiding a legitimate LAN address.
// FEATURE: used by the Java auto-installer to locate java.exe inside the extracted portable JRE
// (Adoptium ships it nested one folder deep, e.g. "jdk-21.0.x+y-jre/bin/java.exe" — the exact folder
// name changes with every release, so this can't be hardcoded).
// FEATURE: used to decide whether auto-polling "tps" is safe — vanilla/Forge/Fabric have no built-in
// /tps command, so polling it periodically would just spam "Unknown command" into the console.
// BUGFIX: when the server is launched via run.bat (Forge/NeoForge), serverProcess.pid is the PID of
// cmd.exe (which just invokes run.bat) — NOT the PID of the actual java.exe running Minecraft.
// The launcher used to measure CPU/RAM directly on serverProcess.pid, so for run.bat-based servers
// the numbers were always near 0% since cmd.exe barely uses any resources. The function below walks
// the process tree (BFS over Win32_Process) to find the real java.exe/javaw.exe PID.

// BUGFIX (regression from a previous patch): auto-poll used to start sending "list"/"tps" IMMEDIATELY
// when the Java process spawned — but if the server is still loading (heavy plugins like Geyser/
// Skript can take more than 5s), sending console commands too early throws a NullPointerException
// because CommandSourceStack.getLevel() is still null (a known Paper/Purpur bug, see
// PaperMC/Paper#13580 "Unable to execute commands in console before worlds are loaded"). This does
// NOT crash the server, but it floods the console with red errors that look like a crash. Auto-poll
// now only starts after seeing the "Done (...)!" line — the standard signal every server type
// (Vanilla/Paper/Purpur/Forge) prints once it has finished loading.
let waitingForDone = false;
function startAutoPoll(software) {
  clearInterval(autoPollTimer);
  autoPollTimer = setInterval(() => {
    if (!serverProcess || !serverProcess.stdin.writable) return;
    suppressStatusUntil = Date.now() + 4000;
    try {
      serverProcess.stdin.write('list\r\n');
      // BUGFIX: TPS/MSPT only worked for paper-like servers because that's the only branch that
      // sent a TPS command. Forge/NeoForge have their own /forge tps; Vanilla/Fabric/proxy have
      // no safe built-in command, so they only get 'list' (no false "Unknown command" spam).
      if (software === 'paper-like') {
        serverProcess.stdin.write('tps\r\n');
        // Paper 1.20.2+ answers /tick query with native MSPT — no plugin required. On older
        // Paper builds it's just one harmless "Unknown command" line every 5s.
        serverProcess.stdin.write('tick query\r\n');
      } else if (software === 'forge') {
        // Forge/NeoForge expose /forge tps (prints TPS + MSPT); send it for live telemetry.
        serverProcess.stdin.write('forge tps\r\n');
      }
    } catch {}
  }, 5000);
}
function startMetrics() {
  let consecutiveMisses = 0;
  let lastMetrics = { serverMemory: 0, cpu: 0 }; // BUGFIX: lưu giá trị cuối cùng để gửi lại khi lỗi tạm thời, tránh UI nhảy về "—"
  let javaRetryCount = 0; // BUGFIX: thử tìm java thật vài lần trước khi fallback về PID gốc (cmd.exe)
  clearInterval(sampleTimer); sampleTimer = setInterval(async () => {
    try {
      const used = process.memoryUsage().rss / 1024 / 1024;
      const running = !!(serverProcess?.pid) && (serverStatus === 'running' || serverStatus === 'starting' || serverStatus === 'stopping');
      if (!serverProcess?.pid) { monitoredPid = null; consecutiveMisses = 0; javaRetryCount = 0; send('server:metrics', { appMemory: Math.round(used), running: false, timestamp: Date.now(), ...live }); return; }
      if (!monitoredPid) {
        // BUGFIX: findJavaDescendant can fail on some Windows/PowerShell setups
        // (CIM throttling, command wrapper quirks). Thử tìm java thật vài lần trước khi fallback
        // về PID gốc (có thể là cmd.exe) để tránh đọc nhầm process wrapper → CPU/RAM gần 0.
        const found = await Promise.race([
          platform.findJavaDescendant(serverProcess.pid),
          new Promise(resolve => setTimeout(() => resolve(null), 3000))
        ]).catch(() => null);
        if (found) {
          monitoredPid = found;
          javaRetryCount = 0;
        } else {
          javaRetryCount++;
          // BUGFIX: fallback ngay về PID gốc sau 1 giây thay vì chờ 3 lần 5 giây (tổng 15 giây treo).
          // Với Purpur/Paper (không chạy qua run.bat), PID gốc chính là java.exe — không cần chờ.
          if (javaRetryCount >= 2 || currentSoftware === 'paper-like') {
            monitoredPid = serverProcess.pid;
          } else {
            send('server:metrics', { appMemory: Math.round(used), serverMemory: lastMetrics.serverMemory, cpu: lastMetrics.cpu, running: true, timestamp: Date.now(), ...live });
            return;
          }
        }
        if (!monitoredPid) { send('server:metrics', { appMemory: Math.round(used), serverMemory: 0, cpu: 0, running: true, timestamp: Date.now(), ...live }); return; }
      }
      const metrics = await Promise.race([
        platform.getProcessMetrics(monitoredPid),
        new Promise(resolve => setTimeout(() => resolve(null), 5000))
      ]).catch(() => null);
      const r = metrics ? { ok: true, stdout: `${metrics.memoryMB}|${metrics.cpuTime}` } : { ok: false, stdout: '' };
      if (!r.stdout || !r.stdout.trim()) {
        consecutiveMisses++;
        if (consecutiveMisses >= 3) { monitoredPid = null; javaRetryCount = 0; } // looks like the process actually went away — re-detect next tick
        // BUGFIX: gửi giá trị metrics cuối cùng đã biết thay vì 0, để UI không nhảy về "—".
        send('server:metrics', { appMemory: Math.round(used), serverMemory: lastMetrics.serverMemory, cpu: lastMetrics.cpu, running: true, timestamp: Date.now(), ...live });
        return;
      }
      consecutiveMisses = 0;
      const [memoryRaw, cpuTotalRaw] = String(r.stdout).trim().split('|');
      const memory = Number(memoryRaw), cpuTotal = Number(cpuTotalRaw);
      const now = Date.now();
      // BUGFIX: the real cause of "CPU always shows 0%" — previousCpu used to be overwritten every
      // tick even when cpuTotal came back as NaN (e.g. $p.CPU returns empty once, right after the
      // process was just found). A single NaN permanently poisoned previousCpu.total until the next
      // restart — every subsequent (cpuTotal - NaN) subtraction produced NaN, and `${v.cpu||0}%` in the
      // UI silently turned NaN into "0%", making it look like CPU never moved. Now previousCpu is only
      // updated when a valid number was actually read.
      let cpu = 0;
      if (Number.isFinite(cpuTotal) && previousCpu && Number.isFinite(previousCpu.total)) {
        const deltaSeconds = (now - previousCpu.at) / 1000;
        if (deltaSeconds > 0) cpu = Math.max(0, Math.min(100, ((cpuTotal - previousCpu.total) / deltaSeconds / os.cpus().length) * 100));
      }
      if (Number.isFinite(cpuTotal)) previousCpu = { total: cpuTotal, at: now };
      // Lưu giá trị metrics cuối cùng để dùng khi có lỗi tạm thời — chỉ cập nhật khi memory hợp lệ (>20 MB).
      if (memory > 20) lastMetrics.serverMemory = memory;
      if (Number.isFinite(cpu)) lastMetrics.cpu = Math.round(cpu);
      send('server:metrics', { appMemory: Math.round(used), serverMemory: memory > 20 ? memory : lastMetrics.serverMemory, cpu: Math.round(cpu), running: true, timestamp: now, ...live });
    } catch (err) {
      // BUGFIX: nếu platform API lỗi (PowerShell treo, /proc không đọc được...), vẫn gửi metrics
      // mỗi tick để UI không bao giờ bị "đơ" ở dấu "-". Gửi giá trị cuối cùng đã biết thay vì 0.
      const used = process.memoryUsage().rss / 1024 / 1024;
      send('server:metrics', { appMemory: Math.round(used), serverMemory: lastMetrics.serverMemory, cpu: lastMetrics.cpu, running: true, timestamp: Date.now(), ...live });
    }
  }, 1000);
}
// FEATURE: periodic auto-backup driven by settings.autoBackupMinutes (0 = off). Checked every
// minute, shares the same ZIP-compression logic as the manual backup:create (createBackupInternal).
function startAutoBackupWatcher() {
  clearInterval(autoBackupTimer);
  autoBackupTimer = setInterval(async () => {
    const settings = loadSettings();
    const minutes = Number(settings.autoBackupMinutes) || 0;
    if (minutes <= 0 || !currentServerPath) return;
    if (Date.now() - lastAutoBackupAt < minutes * 60 * 1000) return;
    const result = await createBackupInternal();
    if (result.ok) { lastAutoBackupAt = Date.now(); appendLog(`Auto-backup: ${result.name}`, 'system'); }
  }, 60 * 1000);
}
app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('dev.observerlauncher.minecraftservercontrol');
  // BUGFIX: titleBarStyle:'hidden' + titleBarOverlay used to apply on every platform, but the
  // overlay (minimize/maximize/close caption buttons) is Windows-only — on the Linux builds this
  // project ships, that meant a chrome-less window with NO way to move or close it (there is no
  // -webkit-app-region drag strip either). Keep the hidden+overlay chrome on Windows only; every
  // other platform gets the native title bar back.
  const winOpts = { width: 1480, height: 930, minWidth: 1080, minHeight: 720, backgroundColor: '#08090a', icon: path.join(__dirname, 'renderer', 'assets', 'icons', 'observer.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } };
  if (process.platform === 'win32') Object.assign(winOpts, { titleBarStyle: 'hidden', titleBarOverlay: { color: '#08090a', symbolColor: '#e9edf0', height: 42 } });
  win = new BrowserWindow(winOpts);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // tex:// icon serving — resolution order: on-demand cache (userData/textures/<mc-version>) →
  // bundled 26.2 set → lazy per-icon fetch from the PrismarineJS mirror. "auto" resolves to the
  // detected server's Minecraft version, so a future version's new items appear without a
  // launcher update (see textures.js).
  textures.init({ serverNames: () => { try { const i = serverFiles(currentServerPath); return [i.jar, i.launchScript].filter(Boolean); } catch { return []; } } });
  protocol.handle('tex', textures.handle);
  currentServerPath = loadSettings().serverPath;
  watchServerFolder();
  javaInfo = await detectJava(loadSettings().javaPath || 'java'); startMetrics(); startAutoBackupWatcher();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// BUGFIX: quitting used to bare-call serverProcess.kill(), which on Windows only terminates the
// cmd.exe wrapper when the server was launched via run.bat (Forge/NeoForge) — java.exe kept running
// orphaned, and no "stop" command was ever sent, so the world could lose up to a minute of autosave.
// Quit now: send "stop" for a graceful save+shutdown, give it up to 10s to exit on its own, then
// hard-kill the ENTIRE process tree (taskkill /T /F). A running BuildTools compile has nothing to
// save, so it is hard-killed right away.
function killTree(pid) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(pid, 'SIGTERM');
  } catch {}
}
let quitHandled = false;
app.on('before-quit', event => {
  clearTimeout(restartTimer); clearInterval(sampleTimer); clearInterval(autoPollTimer); clearInterval(autoBackupTimer);
  if (quitHandled || (!serverProcess && !buildProcess)) return;
  event.preventDefault();
  quitHandled = true;
  manualStop = true; // suppress auto-restart triggered by our own shutdown
  try { if (serverProcess?.stdin?.writable) serverProcess.stdin.write('stop\r\n'); } catch {}
  if (buildProcess) killTree(buildProcess.pid);
  const deadline = Date.now() + 10000;
  const waitStop = setInterval(() => {
    if (serverProcess && Date.now() < deadline) return;
    clearInterval(waitStop);
    if (serverProcess) killTree(serverProcess.pid);
    setTimeout(() => app.quit(), 200); // let the exit handler log and clean up first
  }, 250);
});

ipcMain.handle('settings:get', async () => ({ settings: loadSettings(), java: javaInfo, files: serverFiles(currentServerPath), eulaAccepted: readEula(currentServerPath), status: serverStatus, running: serverStatus === 'running', logs: consoleBuffer, live, systemMemoryGB: Math.round(os.totalmem() / (1024 ** 3)), javaRequired: requiredJavaForJar(serverFiles(currentServerPath).jar) || null }));
// FEATURE: on-demand re-read of the server folder (usercache.json, playerdata/*.dat, worlds, plugins,
// ...) without touching settings/java/logs/live state. Needed because the Players tab's "Refresh list"
// button used to be wired to the generic [data-command] handler, which just sends the console command
// "list" — that only affects the ONLINE player list shown by a running server, it never re-reads
// usercache.json or playerdata files from disk. So a player who joined, then left/the server stopped,
// would never show up with a working UUID/"has data" no matter how many times "Refresh list" (or a
// server restart) was tried — the renderer's copy of that data only ever changed at a few specific
// moments (folder select, settings save, server start/stop) and "Refresh list" wasn't one of them.
ipcMain.handle('files:get', async () => ({ ok: true, files: serverFiles(currentServerPath), javaRequired: requiredJavaForJar(serverFiles(currentServerPath).jar) || null }));
// FEATURE: in-launcher text file editor (Content tab) — open/save/list with safety rails
// (extension allowlist, binary sniff, size caps, path traversal protection, mtime conflict
// detection, atomic writes — see src/main/editor.js).
ipcMain.handle('editor:open', async (_, rel) => { const r = editor.openFile(currentServerPath, rel); if (r.ok) edWatchFile(safeTarget(currentServerPath, rel), r.mtime); return r; });
ipcMain.handle('editor:save', async (_, { rel, content, baseMtime, force }) => { const r = editor.saveFile(currentServerPath, rel, content, baseMtime, force); if (r.ok) edWatchMtime = r.mtime; return r; });
ipcMain.handle('editor:list', async () => editor.listFiles(currentServerPath));
// FEATURE: World Map — reads real data from the world save (seed, spawn, player positions)
// plus a per-server waypoint file. See src/main/worldmap.js.
ipcMain.handle('worldmap:load', async () => { const lvlName = serverFiles(currentServerPath).properties['level-name'] || 'world'; return { level: await worldmap.readLevel(currentServerPath, lvlName), players: await worldmap.readPlayers(currentServerPath, lvlName), waypoints: worldmap.readWaypoints(currentServerPath), levelName: lvlName }; });
ipcMain.handle('worldmap:chunks', async (_, dim) => {
  const lvlName = serverFiles(currentServerPath).properties['level-name'] || 'world';
  const set = worldmap.scanExploredChunks(currentServerPath, lvlName, dim || 'overworld');
  return { ok: true, dim: dim || 'overworld', chunks: [...set], truncated: set.size >= 200000 };
});
ipcMain.handle('worldmap:waypoints:set', async (_, list) => worldmap.writeWaypoints(currentServerPath, Array.isArray(list) ? list : []));
// Watch the currently open editor file so the renderer learns about external changes
// (auto-reload when clean, conflict banner when dirty). Our own saves update edWatchMtime
// so self-writes never trigger the event.
let edWatcher = null, edWatchMtime = 0, edWatchDebounce = null;
function edWatchFile(target, initialMtime) {
  try { if (edWatcher) edWatcher.close(); } catch {}
  edWatcher = null; edWatchMtime = initialMtime || 0;
  if (!target) return;
  try {
    edWatcher = fs.watch(target, () => {
      clearTimeout(edWatchDebounce);
      edWatchDebounce = setTimeout(() => {
        let m = 0; try { m = fs.statSync(target).mtimeMs; } catch {}
        if (m && m !== edWatchMtime) { edWatchMtime = m; send('editor:external', { mtime: m }); }
      }, 300);
    });
  } catch {}
}
// FEATURE: suggests a "Documents/ObserverLauncher Servers" folder for the onboarding flow (create a
// new server), creating it if missing so newcomers don't have to type a path themselves.
ipcMain.handle('dialog:server-folder', async (_, opts) => {
  const suggested = path.join(app.getPath('documents'), 'ObserverLauncher Servers');
  if (opts?.suggestNew) { try { fs.mkdirSync(suggested, { recursive: true }); } catch {} }
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', ...(opts?.suggestNew ? ['createDirectory'] : [])], title: opts?.title || 'Select Minecraft server folder', defaultPath: opts?.suggestNew ? suggested : undefined });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('settings:save', async (_, settings) => { const merged = { ...loadSettings(), ...settings }; currentServerPath = merged.serverPath; watchServerFolder(); saveSettings(merged); javaInfo = await detectJava(merged.javaPath || 'java'); return { java: javaInfo, files: serverFiles(currentServerPath), eulaAccepted: readEula(currentServerPath), javaRequired: requiredJavaForJar(serverFiles(currentServerPath).jar) || null }; });
ipcMain.handle('onboarding:complete', async () => { const s = loadSettings(); s.onboarded = true; saveSettings(s); return { ok: true }; });
// FEATURE: "How friends can join" — beginners hosting for the first time usually don't know their own
// LAN IP or server port. localIPv4s() answers "same WiFi" instantly with no network call; the port
// comes straight from server.properties (falls back to the Minecraft default, 25565, before the
// server has ever been configured).
ipcMain.handle('network:info', async () => {
  const info = serverFiles(currentServerPath);
  const isProxy = detectSoftware(info) === 'proxy';
  const port = Number(info.properties['server-port']) || (isProxy ? 25577 : 25565);
  return { ok: true, localIps: localIPv4s(), port };
});
// FEATURE: public IP is only looked up on demand (button click), never automatically — this is the
// one call in the app that goes to a third party purely to answer "what's my IP", so it should never
// fire without the user explicitly asking for it.
ipcMain.handle('network:public-ip', async () => {
  try { const { signal, cancel } = withTimeout(10000); const r = await fetch('https://api.ipify.org?format=json', { signal }).finally(cancel); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); const d = await r.json(); return { ok: true, ip: d.ip }; }
  catch { return { ok: false, error: 'Could not reach the internet to look up your public IP. Check your connection.' }; }
});
// FEATURE: opens the chosen port in Windows Firewall so LAN/internet players can actually reach the
// server (a very common "why can't my friends join" cause for first-time hosts). Creating a firewall
// rule needs admin rights, which this (non-elevated) launcher process doesn't have — so it starts an
// elevated PowerShell just for this one command, which triggers a UAC prompt. This does NOT open the
// port on the user's router; that still has to be done separately (out of scope for a desktop app).
ipcMain.handle('network:allow-firewall', async (_, port) => {
  const p = Number(port);
  if (!Number.isFinite(p) || p < 1 || p > 65535) return { ok: false, error: 'Invalid port.' };
  const r = await platform.allowFirewall(p);
  return r;
});
let javaInstalling = false;
// FEATURE: one-click portable Java install for beginners who don't have Java at all — the #1 blocker
// before ever reaching the server wizard. Downloads an Eclipse Temurin JRE straight from Adoptium's
// official API (no separate installer, no admin rights needed) into the launcher's own userData
// folder, then points Settings > Java executable at it automatically.
// SYNC: the major version is picked from what the CURRENT server folder needs — Minecraft 26.1+
// requires Java 25 (verified against Mojang's manifest javaVersion field), older releases run fine
// on a newer LTS. Default is 25 (newest LTS) when no server is selected yet; very old servers
// (needing 8–17) get 21, which safely runs them.
ipcMain.handle('java:auto-install', async () => {
  if (javaInstalling) return { ok: false, error: 'A Java install is already in progress — check the Console tab.' };
  if (javaInfo?.ok) return { ok: false, error: 'Java is already detected — no need to install it again.' };
  javaInstalling = true;
  let zipPath;
  try {
    let jar = null; try { jar = serverFiles(currentServerPath).jar; } catch {}
    const required = requiredJavaForJar(jar);
    const major = required && required < 21 ? 21 : 25;
    appendLog(`Downloading a portable Java ${major} runtime from Adoptium (Eclipse Temurin)…`, 'system');
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/${arch}/jre/hotspot/normal/eclipse`;
    zipPath = path.join(app.getPath('temp'), `observerlauncher-jre-${Date.now()}.zip`);
    await download(url, zipPath, (received, total) => send('java:progress', { received, total }));
    const targetDir = path.join(app.getPath('userData'), `jre${major}`);
    fs.rmSync(targetDir, { recursive: true, force: true }); fs.mkdirSync(targetDir, { recursive: true });
    appendLog('Extracting Java runtime…', 'system');
    const r = await runPowerShell(`Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(targetDir)} -Force`, 300000); // large worlds can take a while to extract
    if (!r.ok) throw new Error(r.error || 'Could not extract the Java runtime.');
    const javaExe = findFileRecursive(targetDir, 'java.exe');
    if (!javaExe) throw new Error('Java runtime was downloaded but java.exe was not found after extracting.');
    const settings = loadSettings(); settings.javaPath = javaExe; saveSettings(settings);
    javaInfo = await detectJava(javaExe);
    if (!javaInfo.ok) throw new Error('Java was installed but could not be verified — try setting the path manually.');
    appendLog(`Java ready: ${javaInfo.version} (${javaExe})`, 'system');
    return { ok: true, java: javaInfo, settings };
  } catch (error) { appendLog(`Java auto-install failed: ${error?.message || error}`, 'error'); return marketplaceError(error); }
  finally { javaInstalling = false; try { if (zipPath) fs.rmSync(zipPath, { force: true }); } catch {} }
});
async function startServerInternal(settings) {
  // BUGFIX: previously guarded on `if (serverProcess)`, which only blocks a second Start once the
  // process object exists — a double-click right as the first click is still being handled (or a
  // Start sent while a previous server is still 'stopping') could race past this. Guarding on the
  // status string closes that gap: only a genuinely idle launcher ('stopped') may start one.
  if (serverStatus !== 'stopped') return { ok: false, error: serverStatus === 'starting' ? 'Server is already starting.' : serverStatus === 'stopping' ? 'Server is still stopping — wait for it to finish.' : 'Server is already running.' };
  if (buildProcess) return { ok: false, error: 'A build (BuildTools) is still running in this folder — wait for it to finish, check the Console tab.' };
  const error = validateStart(settings, javaInfo, serverFiles); if (error) return { ok: false, error };
  const info = serverFiles(settings.serverPath);
  if (!readEula(settings.serverPath)) { if (!settings.autoEula) return { ok: false, error: 'Accept the Minecraft EULA in Settings before starting.' }; writeEula(settings.serverPath); }
  const software = detectSoftware(info);
  currentSoftware = software;
  const isProxy = software === 'proxy';
  const customArgs = String(settings.jvmArgs || '').trim() ? String(settings.jvmArgs).trim().match(/(?:[^\s"]+|"[^"]*")+/g).map(x => x.replace(/^"|"$/g, '')) : [`-Xms${settings.memoryMin || 2}G`, `-Xmx${settings.memoryMax || 6}G`];
  // BUGFIX/FEATURE: Velocity (proxy) doesn't understand the "nogui" argument like a regular game server
  // does (Bukkit/Forge both ignore unknown arguments, but Velocity parses arguments strictly with
  // picocli and can refuse to start on one it doesn't recognize). Only add "nogui" for a real game server.
  const args = isProxy ? [...customArgs, '-jar', info.jar] : [...customArgs, '-jar', info.jar, 'nogui'];
  appendLog(`Starting ${info.launchScript || info.jar} with ${javaInfo.path}…`, 'system');
  manualStop = false;
  // BUGFIX: previously, when launching via run.bat (modern Forge/NeoForge), the RAM/Xms/Xmx and JVM
  // args set in Settings were completely ignored because run.bat was run as-is through cmd.exe. The
  // launcher now sets the JAVA_TOOL_OPTIONS environment variable so the child Java process (started
  // by run.bat) picks up the right RAM/JVM args, while everything else (mod list, libraries...) stays
  // managed by run.bat.
  if (info.launchScript) {
    const env = { ...process.env };
    if (customArgs.length) env.JAVA_TOOL_OPTIONS = customArgs.join(' ');
    if (info.launchScript.toLowerCase().endsWith('.sh')) {
      serverProcess = spawn('bash', [info.launchScript, 'nogui'], { cwd: settings.serverPath, env });
    } else {
      if (process.platform === 'win32') {
        serverProcess = spawn('cmd.exe', ['/d', '/c', info.launchScript, 'nogui'], { cwd: settings.serverPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false, env });
      } else {
        serverProcess = spawn('bash', [info.launchScript, 'nogui'], { cwd: settings.serverPath, stdio: ['pipe', 'pipe', 'pipe'], env });
      }
    }
  } else {
    // BUGFIX: spawn with explicit stdio pipe + windowsHide:false so Minecraft's console
    // stdin actually works on Windows (with windowsHide:true, stdin is not connected properly
    // and server silently ignores all console commands → TPS/MSPT/RAM/CPU stay "—").
    serverProcess = spawn(javaInfo.path, args, { cwd: settings.serverPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });
  }
  // First-run hint: a fresh folder has no server.properties, so the server logs a scary
  // "Failed to load properties ... NoSuchFileException" ERROR and then CREATES the file itself.
  // Say so up front so the expected first-start error doesn't read like a crash.
  try { if (!fs.existsSync(path.join(settings.serverPath, 'server.properties'))) appendLog('First start: server.properties does not exist yet — the "Failed to load properties" ERROR below is expected; the server creates the file on its own and continues.', 'system'); } catch {}
  // BUGFIX: previously, when launching a .jar directly (not via run.bat), the launcher assumed
  // serverProcess.pid was already the real java.exe and measured RAM/CPU on it directly. But if
  // "java" on PATH is a small shim/launcher (common when Java is installed via Scoop, Chocolatey, or
  // some portable builds) instead of the actual JVM, serverProcess.pid is just a tiny forwarding
  // process (~7MB RAM, almost no CPU) — not the real server. Now it ALWAYS resolves through
  // findJavaDescendant() regardless of run.bat: that function already handles both cases correctly
  // (root is already java(w).exe → returns almost immediately; root is a shim/cmd.exe → walks down to
  // the real child process).
  monitoredPid = null; previousCpu = null;
  live = { tps: null, mspt: null, players: [] }; send('server:live', live);
  waitingForDone = !isProxy;
  const startedProcess = serverProcess;
  // BUGFIX: a failed spawn (ENOENT because the detected Java was uninstalled/moved between the last
  // check and now, or bash missing for a run.sh script on Windows) emits 'error' — NOT 'exit'. With
  // no 'error' listener that was an uncaught exception crashing the whole main process; even where
  // that didn't fire, the launcher stayed stuck on 'starting' forever. Reset to a clean 'stopped'
  // state here instead; the exit handler below becomes a no-op thanks to its null guard.
  serverProcess.on('error', error => {
    appendLog(`Could not launch the server process: ${error.message}`, 'error');
    if (serverProcess !== startedProcess) return;
    serverProcess = null; monitoredPid = null; previousCpu = null; waitingForDone = false;
    currentSoftware = null;
    clearInterval(autoPollTimer); clearTimeout(doneWatchdog);
    live = { tps: null, mspt: null, players: [] };
    setServerStatus('stopped'); send('server:live', live); pushFiles();
  });
  // BUGFIX: 90s was far too long. If the server never prints a matching
  // "Done (...)!" line (Vanilla/Forge/Fabric often don't), TPS/MSPT stayed
  // blank forever because auto-poll never started. 15s is enough for the
  // server to be ready, and harmless if it isn't — commands just queue.
  const doneWatchdog = setTimeout(() => { if (waitingForDone && serverProcess === startedProcess) { waitingForDone = false; startAutoPoll(software); setServerStatus('running'); } }, 15000);
  setTimeout(() => { if (serverProcess === startedProcess) restartAttempts = 0; }, 30000);
  serverProcess.stdout.on('data', d => { d.toString().split(/\r?\n/).filter(Boolean).forEach(x => {
    // BUGFIX: only start auto-poll AFTER the server reports it has finished loading
    // ("Done (12.3s)! For help..."). Sending console commands before that point throws a
    // NullPointerException (see the comment on startAutoPoll).
    // BUGFIX: the old regex only matched an exact "Done (12.3s)!" — some server builds/plugins print
    // extra text inside the parentheses or a slightly different format, which never matched, silently
    // leaving TPS/MSPT stuck on "—" forever even though the server loaded fine. Widened to accept any
    // content inside the parentheses.
    if (waitingForDone && /\bDone \([^)]*\)!/i.test(x)) { waitingForDone = false; clearTimeout(doneWatchdog); startAutoPoll(software); restartAttempts = 0;
      // BUGFIX: server.properties (and world folders) are written by the Minecraft process itself
      // during startup — they don't exist yet at the moment we spawn it. The renderer's file listing
      // (used by the Properties/Worlds/Content tabs) was only ever refreshed on folder-select or
      // settings-save, so a freshly created/started server kept showing an empty Properties tab even
      // though server.properties now genuinely exists on disk. Push a fresh listing once the server
      // reports it has finished loading — this is also the moment status moves 'starting' -> 'running',
      // since "loaded and answering commands" is a more honest definition of "running" than "the OS
      // process exists".
      setServerStatus('running'); pushFiles();
    }
    // FEATURE: the responses for "list"/"tps"/"tick query" sent by auto-poll (not typed by the
    // user) are hidden from the Console panel to avoid spam every 5 seconds, but are still read
    // normally by parseServerLine().
    // BUGFIX: /tick query answers with FOUR lines (running normally / target tick rate / average
    // time per tick / percentiles) — the old suppression regex only knew the "list" and "/tps"
    // response shapes, so Paper 1.20.2+ servers flooded the Console with 4 lines every 5 seconds.
    // All auto-poll response shapes are suppressed now. Manual commands (Console input or the
    // Performance buttons) stamp lastManualCommandAt, so a hand-run "tick query" fired within a
    // poll's suppression window is still shown instead of being swallowed.
    const isAutoPollStatus = Date.now() < suppressStatusUntil
      && Date.now() - lastManualCommandAt > 1200
      && /(players online|TPS from last|The game is running|Target tick rate:|Average time per tick:|Percentiles:|Mean tick time|Mean TPS|Dim \d+\s*:|Overall:)/i.test(x);
    if (!isAutoPollStatus) appendLog(x);
    parseServerLine(x, live, send);
  }); });
  serverProcess.stderr.on('data', d => { d.toString().split(/\r?\n/).filter(Boolean).forEach(x => { appendLog(x, 'error'); parseServerLine(x, live, send); }); });
  serverProcess.on('exit', (code, signal) => {
    if (!serverProcess) return; // already cleaned up by the 'error' path (spawn failure)
    appendLog(`Server stopped (code ${code ?? 'none'}, ${signal || 'normal'}).`, 'system');
    const wasManual = manualStop; manualStop = false;
    serverProcess = null; monitoredPid = null; previousCpu = null; waitingForDone = false; currentSoftware = null; clearInterval(autoPollTimer); clearTimeout(doneWatchdog);
    live = { tps: null, mspt: null, players: [] };
    setServerStatus('stopped'); send('server:live', live); pushFiles();
    // BUGFIX: auto-restart used to have no limit — if the server never loaded successfully (e.g. bad
    // JVM args/RAM/Java) and exited with a non-zero code, the launcher would restart every 5s forever
    // (spamming "Auto-restart is on…" endlessly, looking like the server "crashes on open"). Now capped
    // at 3 consecutive attempts before the launcher gives up for this run and reports it clearly so the
    // user checks their config; the counter resets to 0 as soon as the server loads successfully (see
    // "Done" above).
    const current = loadSettings();
    if (!wasManual && current.autoRestart && code !== 0) {
      const maxAttempts = Math.max(1, Number(current.autoRestartMaxAttempts) || 3);
      const delaySeconds = Math.max(1, Number(current.autoRestartDelaySeconds) || 5);
      if (restartAttempts >= maxAttempts) { appendLog(`Auto-restart stopped after ${maxAttempts} failed attempts in a row — check Console above for the real error before starting again.`, 'error'); restartAttempts = 0; }
      else {
        restartAttempts++;
        appendLog(`Auto-restart is on — restarting server in ${delaySeconds}s… (attempt ${restartAttempts}/${maxAttempts})`, 'system');
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => { startServerInternal(current).catch(() => {}); }, delaySeconds * 1000);
      }
    } else if (!wasManual && current.autoRestart && code === 0) { restartAttempts = 0; }
  });
  setServerStatus(isProxy ? 'running' : 'starting'); pushFiles(); return { ok: true };
}
ipcMain.handle('server:start', async (_, settings) => { restartAttempts = 0; return startServerInternal(settings); });
ipcMain.handle('server:command', async (_, command) => { if (!serverProcess) return { ok: false, error: 'Server is not running.' }; serverProcess.stdin.write(command.trim() + '\r\n'); lastManualCommandAt = Date.now(); appendLog(`> ${command}`, 'command'); return { ok: true }; });
// BUGFIX: previously guarded on `if (!serverProcess)` only — clicking Stop twice in a row (or once
// while a previous Stop is still being processed) would write "stop\n" to stdin a second time. Mostly
// harmless for vanilla/Paper (an already-stopping server just ignores a repeat "stop"), but the status
// guard is the correct fix rather than relying on that being true for every server type.
ipcMain.handle('server:stop', async () => {
  if (serverStatus === 'stopped' || serverStatus === 'stopping') return { ok: false, error: serverStatus === 'stopping' ? 'Server is already stopping.' : 'Server is not running.' };
  if (!serverProcess) return { ok: false, error: 'Server is not running.' };
  manualStop = true; clearTimeout(restartTimer); setServerStatus('stopping'); serverProcess.stdin.write('stop\r\n'); return { ok: true };
});
ipcMain.handle('files:open', async (_, relative) => { const target = safeTarget(currentServerPath, relative); if (target && fs.existsSync(target)) await shell.openPath(target); return true; });
ipcMain.handle('properties:save', async (_, props) => { if (!currentServerPath) return { ok: false }; writeFileAtomic(path.join(currentServerPath, 'server.properties'), buildPropertiesContent(currentServerPath, props)); return { ok: true }; });
// FEATURE: velocity.toml (Velocity proxy config) is real TOML with nested sections ([servers], a
// list of backend servers...) — it can't be flattened into a key=value grid like server.properties
// without corrupting the structure. Read/write it as raw text instead of trying to parse TOML.
ipcMain.handle('properties:raw-get', async () => {
  if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  try { return { ok: true, content: fs.readFileSync(path.join(currentServerPath, 'velocity.toml'), 'utf8') }; }
  catch { return { ok: true, content: '' }; } // no file yet — Velocity generates it on first run
});
ipcMain.handle('properties:raw-save', async (_, content) => {
  if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  writeFileAtomic(path.join(currentServerPath, 'velocity.toml'), content);
  return { ok: true };
});
ipcMain.handle('content:delete', async (_, { kind, fileName }) => {
  if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const levelName = serverFiles(currentServerPath).properties['level-name'] || 'world';
  const folders = { plugin: 'plugins', mod: 'mods', datapack: path.join(levelName, 'datapacks') };
  const folder = folders[kind]; if (!folder) return { ok: false, error: 'Unknown content type.' };
  const target = safeTarget(currentServerPath, path.join(folder, fileName));
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'File not found.' };
  fs.unlinkSync(target);
  return { ok: true, files: serverFiles(currentServerPath) };
});
ipcMain.handle('content:import', async (_, kind) => {
  const levelName = serverFiles(currentServerPath).properties['level-name'] || 'world';
  const folders = { plugin: 'plugins', mod: 'mods', datapack: path.join(levelName, 'datapacks') }; const folder = folders[kind]; if (!folder || !currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const r = await dialog.showOpenDialog(win, { title: `Import ${kind}`, properties: ['openFile', 'multiSelections'], filters: [{ name: kind === 'datapack' ? 'Datapacks' : 'Java archives', extensions: kind === 'datapack' ? ['zip', 'jar'] : ['jar'] }] }); if (r.canceled) return { ok: false, cancelled: true };
  const target = safeTarget(currentServerPath, folder); fs.mkdirSync(target, { recursive: true });
  const MAX_IMPORT_BYTES = 500 * 1024 * 1024; // 500 MB per file guard for beginners
  // BUGFIX: validation used to happen inside the copy loop, so a bad file part-way through a
  // multi-select aborted the import with the earlier files ALREADY copied in — a half-applied
  // install. Validate every file first; only then copy anything.
  for (const file of r.filePaths) {
    let stat; try { stat = fs.statSync(file); } catch { return { ok: false, error: `${path.basename(file)} could not be read.` }; }
    if (stat.size > MAX_IMPORT_BYTES) return { ok: false, error: `${path.basename(file)} is too large (${(stat.size/1024/1024).toFixed(1)} MB). Max 500 MB per file.` };
    if (stat.size === 0) return { ok: false, error: `${path.basename(file)} is empty.` };
    const ext = path.extname(file).toLowerCase();
    if (kind === 'datapack' && !['.zip', '.jar'].includes(ext)) return { ok: false, error: `${path.basename(file)} is not a .zip/.jar datapack.` };
    if (kind !== 'datapack' && ext !== '.jar') return { ok: false, error: `${path.basename(file)} is not a .jar file.` };
  }
  for (const file of r.filePaths) fs.copyFileSync(file, path.join(target, path.basename(file)));
  return { ok: true, files: serverFiles(currentServerPath) };
});
// FEATURE: import a standard Modrinth .mrpack modpack file — extracts it, reads modrinth.index.json,
// downloads every file marked as required on the server, and copies the overrides/ folder (configs
// etc.) into the server directory. Uses the same Expand-Archive approach as world backups since
// .mrpack is just a zip file with a different extension.
// FEATURE: shared by both the manual "Import a modpack" file picker AND installing a modpack found
// directly in Marketplace — same extraction/install logic either way, only how the .mrpack file gets
// onto disk differs (user-picked file vs. downloaded from Modrinth first).
async function importMrpackFromPath(mrpackPath, onInfo) {
  let tempZip, extractDir;
  try {
    if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    onInfo?.({ phase: 'extract', name: 'Extracting modpack archive…', received: 0, total: 0 });
    const stamp = Date.now();
    tempZip = path.join(app.getPath('temp'), `observerlauncher-import-${stamp}.zip`);
    extractDir = path.join(app.getPath('temp'), `observerlauncher-import-${stamp}`);
    fs.copyFileSync(mrpackPath, tempZip);
    const r = await runPowerShell(`Expand-Archive -LiteralPath ${psQuote(tempZip)} -DestinationPath ${psQuote(extractDir)} -Force`, 300000); // a modpack archive can be large
    if (!r.ok) throw new Error(r.error || 'Could not extract the modpack archive.');
    const indexPath = path.join(extractDir, 'modrinth.index.json');
    if (!fs.existsSync(indexPath)) throw new Error('Not a valid .mrpack file (missing modrinth.index.json).');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    let installed = 0, skipped = 0;
    // Pre-compute the install list so the dialog can show real "file i of N" progress.
    const installable = [];
    for (const file of index.files || []) {
      if (file.env?.server === 'unsupported') { skipped++; continue; } // client-only file (e.g. resource pack), skip on a server
      const url = file.downloads?.[0]; if (!url) { skipped++; continue; }
      // BUGFIX (path traversal): file.path comes straight from modrinth.index.json INSIDE the archive
      // — a value ObserverLauncher doesn't control, whether the .mrpack was hand-picked by the user or
      // downloaded from Marketplace/Modrinth. A crafted or corrupted index ("../../../../somewhere")
      // used to resolve with plain path.join() and could write outside the server folder entirely.
      // Every other file-writing IPC handler in this codebase already resolves through safeTarget();
      // this one just never did. Reject the whole import on the first bad entry rather than silently
      // skipping it — a modpack with an escaping path is not something to partially trust.
      const dest = safeTarget(currentServerPath, file.path);
      if (!dest) throw new Error(`This modpack's file list contains an unsafe path ("${file.path}") — import stopped for safety.`);
      installable.push({ url, dest, name: path.basename(dest), size: file.fileSize || 0 });
    }
    for (let i = 0; i < installable.length; i++) {
      const f = installable[i];
      // BUGFIX: progress events used to overload `total` with BOTH the file count and the current
      // file's byte size — the dialog divided one by the other, so the bar and the "i / N" label
      // jumped wildly between units. `total` is now always the file count; byte size travels in
      // its own `fileTotal` field.
      onInfo?.({ phase: 'modpack', index: i + 1, total: installable.length, name: f.name, received: 0, fileTotal: f.size });
      fs.mkdirSync(path.dirname(f.dest), { recursive: true });
      await download(f.url, f.dest, (received, total) => onInfo?.({ phase: 'modpack', index: i + 1, total: installable.length, name: f.name, received, fileTotal: total || f.size }));
      installed++;
    }
    const overridesDir = path.join(extractDir, 'overrides');
    if (fs.existsSync(overridesDir)) {
      const sensitive = ['server.properties', 'eula.txt'].filter(f => fs.existsSync(path.join(overridesDir, f)) && fs.existsSync(path.join(currentServerPath, f)));
      let proceed = true;
      if (sensitive.length) {
        const choice = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancel', 'Overwrite'], defaultId: 0, cancelId: 0, title: 'Modpack wants to overwrite existing config', message: `This modpack includes its own ${sensitive.join(' and ')}, which would replace what you already have configured. Overwrite?` });
        proceed = choice.response === 1;
      }
      if (proceed) fs.cpSync(overridesDir, currentServerPath, { recursive: true });
    }
    return { ok: true, installed, skipped, name: index.name || 'Modpack', files: serverFiles(currentServerPath) };
  } catch (error) { return marketplaceError(error); }
  finally { try { if (tempZip) fs.rmSync(tempZip, { force: true }); if (extractDir) fs.rmSync(extractDir, { recursive: true, force: true }); } catch {} }
}
ipcMain.handle('modpack:install-from-market', async (_, { id, version, versionId }) => {
  if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  let tempMrpack;
  try {
    const versions = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version`);
    const byVersion = versions.filter(v => !version || (v.game_versions || []).includes(version));
    const hasMrpack = v => (v.files || []).some(f => /\.mrpack$/i.test(f.filename));
    // FEATURE: exact version pin from the confirm dialog's picker, else newest matching.
    let target = versionId ? versions.find(v => v.id === versionId && hasMrpack(v)) : null;
    if (!target) target = (byVersion.length ? byVersion : versions).find(hasMrpack);
    const file = target?.files?.find(f => /\.mrpack$/i.test(f.filename));
    if (!file) throw new Error('No .mrpack file was found for this modpack.');
    tempMrpack = path.join(app.getPath('temp'), `observerlauncher-market-modpack-${Date.now()}.mrpack`);
    await download(file.url, tempMrpack, (received, total) => send('market:progress', { phase: 'pack', name: file.filename, received, total }));
    return await importMrpackFromPath(tempMrpack, info => send('market:progress', info));
  } catch (error) { return marketplaceError(error); }
  finally { try { if (tempMrpack) fs.rmSync(tempMrpack, { force: true }); } catch {} }
});
ipcMain.handle('modpack:import', async () => {
  if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  const picked = await dialog.showOpenDialog(win, { title: 'Import a modpack (.mrpack)', properties: ['openFile'], filters: [{ name: 'Modrinth modpack', extensions: ['mrpack', 'zip'] }] });
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
  return importMrpackFromPath(picked.filePaths[0]);
});
// FEATURE: rebuilds a real, standard .mrpack from everything installed through the Marketplace
// (tracked via recordManifestEntry). Hashes are computed fresh from the files on disk so the
// exported pack is verifiable and works with the launcher's own importer or any other .mrpack-aware
// tool — this is not a made-up format.
ipcMain.handle('modpack:export', async () => {
  let stagingDir;
  try {
    if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
    const manifest = readJsonList(currentServerPath, 'observerlauncher-manifest.json');
    if (!manifest.length) return { ok: false, error: 'Nothing to export yet — only plugins/mods installed through the Marketplace are tracked. Manually copied files can\'t be traced back to a download URL.' };
    const levelName = serverFiles(currentServerPath).properties['level-name'] || 'world';
    const destFolders = { plugin: 'plugins', forge: 'mods', fabric: 'mods', datapack: path.join(levelName, 'datapacks'), mod: 'mods' };
    const files = [];
    for (const entry of manifest) {
      const folder = destFolders[entry.kind] || 'plugins';
      const filePath = path.join(currentServerPath, folder, entry.fileName);
      if (!fs.existsSync(filePath)) continue; // removed manually since install, skip
      const stat = fs.statSync(filePath);
      files.push({ path: `${folder.replace(/\\/g, '/')}/${entry.fileName}`, hashes: fileHashes(filePath), downloads: [entry.sourceUrl], fileSize: stat.size, env: { client: 'optional', server: 'required' } });
    }
    if (!files.length) return { ok: false, error: 'None of the previously installed plugins/mods still exist on disk.' };
    const folderName = path.basename(currentServerPath) || 'ObserverLauncher server';
    const index = { formatVersion: 1, game: 'minecraft', versionId: `${folderName}-${Date.now()}`, name: folderName, summary: `Exported from ObserverLauncher — ${files.length} item(s).`, files, dependencies: {} };
    const saveDialog = await dialog.showSaveDialog(win, { title: 'Export modpack', defaultPath: `${folderName}.mrpack`, filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] });
    if (saveDialog.canceled || !saveDialog.filePath) return { ok: false, cancelled: true };
    stagingDir = path.join(app.getPath('temp'), `observerlauncher-export-${Date.now()}`);
    fs.mkdirSync(path.join(stagingDir, 'overrides'), { recursive: true });
    fs.writeFileSync(path.join(stagingDir, 'modrinth.index.json'), JSON.stringify(index, null, 2));
    try { fs.copyFileSync(path.join(currentServerPath, 'server.properties'), path.join(stagingDir, 'overrides', 'server.properties')); } catch {}
    const r = await runPowerShell(`Compress-Archive -Path ${psQuote(path.join(stagingDir, '*'))} -DestinationPath ${psQuote(saveDialog.filePath)} -Force`, 300000);
    if (!r.ok) throw new Error(r.error || 'Could not create the .mrpack archive.');
    return { ok: true, count: files.length, path: saveDialog.filePath };
  } catch (error) { return marketplaceError(error); }
  finally { try { if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {} }
});
async function createBackupInternal() {
  if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' }; const info = serverFiles(currentServerPath); if (!info.worlds.length) return { ok: false, error: 'No world folders found.' };
  // BUGFIX: no guard against two backups running at once (a manual "Create Backup" click landing at
  // the same moment as the auto-backup timer) — both would spin up their own Compress-Archive process
  // against the same world folder for no benefit (the result is a wasted duplicate, not a merge).
  if (backupInProgress) return { ok: false, error: 'A backup is already in progress — wait for it to finish.' };
  backupInProgress = true;
  try {
    // FEATURE: save-off pauses the server's own autosave for the duration of the zip — without it, a
    // large world (several minutes to compress) could still be autosaving mid-backup, risking a zip
    // that captures a world half-written to disk. save-all still forces one clean save right before
    // the zip starts; save-on (in `finally`, so it always runs even if the zip fails) resumes normal
    // autosave afterwards.
    if (serverProcess) { try { serverProcess.stdin.write('save-off\r\n'); serverProcess.stdin.write('save-all\r\n'); } catch {} }
    const dir = safeTarget(currentServerPath, 'observerlauncher-backups'); fs.mkdirSync(dir, { recursive: true }); const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const out = path.join(dir, `world-backup-${stamp}.zip`);
    const r = await platform.createBackup({ serverPath: currentServerPath, worlds: info.worlds, destZip: out });
    return r.ok ? { ok: true, files: serverFiles(currentServerPath), name: path.basename(out) } : { ok: false, error: r.error };
  } finally { try { if (serverProcess && serverProcess.stdin.writable) serverProcess.stdin.write('save-on\r\n'); } catch {} backupInProgress = false; }
}
ipcMain.handle('backup:create', async () => { const r = await createBackupInternal(); if (r.ok) lastAutoBackupAt = Date.now(); return r; });
ipcMain.handle('backup:restore', async (_, name) => { if (serverProcess) return { ok: false, error: 'Stop the server before restoring a backup.' }; if (backupInProgress) return { ok: false, error: 'A backup is currently being created — wait for it to finish before restoring.' }; const backup = safeTarget(currentServerPath, path.join('observerlauncher-backups', name)); if (!backup || !fs.existsSync(backup) || !/\.zip$/i.test(name)) return { ok: false, error: 'Backup not found.' }; const r = await platform.restoreBackup({ destPath: currentServerPath, zipPath: backup }); return r.ok ? { ok: true, files: serverFiles(currentServerPath) } : { ok: false, error: r.error }; });
ipcMain.handle('backup:delete', async (_, name) => { const backup = safeTarget(currentServerPath, path.join('observerlauncher-backups', name)); if (!backup || !fs.existsSync(backup) || !/\.zip$/i.test(name)) return { ok: false, error: 'Backup not found.' }; try { fs.unlinkSync(backup); return { ok: true, files: serverFiles(currentServerPath) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('player:read', async (_, uuid) => { try { return { ok: true, ...(await readPlayerData(currentServerPath, uuid)) }; } catch (error) { return { ok: false, error: error?.message || `Unknown error reading player data for UUID ${uuid}.` }; } });
// FEATURE: previously Whitelist/Kick only worked through console commands (`command()`), making them
// completely useless while the server was STOPPED — exactly when users most need to manage
// whitelist/bans (before starting the server). Now both handlers: if the server is running, still
// send the console command as before (applies immediately); if the server is stopped, edit
// whitelist.json / banned-players.json on disk directly.
ipcMain.handle('player:whitelist-toggle', async (_, { uuid, name, add }) => {
  if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  if (serverProcess) { serverProcess.stdin.write(`whitelist ${add ? 'add' : 'remove'} ${name}\r\n`); appendLog(`> whitelist ${add ? 'add' : 'remove'} ${name}`, 'command'); }
  else { let list = readJsonList(currentServerPath, 'whitelist.json').filter(x => x.uuid !== uuid); if (add) list.push({ uuid, name }); writeJsonList(currentServerPath, 'whitelist.json', list); }
  return { ok: true, files: serverFiles(currentServerPath) };
});
ipcMain.handle('player:ban-toggle', async (_, { uuid, name, ban, reason }) => {
  if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  if (serverProcess) { const cmd = ban ? `ban ${name} ${reason || ''}`.trim() : `pardon ${name}`; serverProcess.stdin.write(cmd + '\r\n'); appendLog(`> ${cmd}`, 'command'); }
  else {
    let list = readJsonList(currentServerPath, 'banned-players.json').filter(x => x.uuid !== uuid);
    if (ban) list.push({ uuid, name, created: new Date().toISOString(), source: 'ObserverLauncher', expires: 'forever', reason: reason || 'Banned by an operator.' });
    writeJsonList(currentServerPath, 'banned-players.json', list);
  }
  return { ok: true, files: serverFiles(currentServerPath) };
});
ipcMain.handle('player:op-toggle', async (_, { uuid, name, op }) => {
  if (!currentServerPath) return { ok: false, error: 'Choose a server folder first.' };
  if (serverProcess) { const cmd = op ? `op ${name}` : `deop ${name}`; serverProcess.stdin.write(cmd + '\r\n'); appendLog(`> ${cmd}`, 'command'); }
  else {
    let list = readJsonList(currentServerPath, 'ops.json').filter(x => x.uuid !== uuid);
    if (op) list.push({ uuid, name, level: 4, bypassesPlayerLimit: false });
    writeJsonList(currentServerPath, 'ops.json', list);
  }
  return { ok: true, files: serverFiles(currentServerPath) };
});
ipcMain.handle('player:save', async (_, { uuid, changes, clearInventory }) => {
  try {
    if (serverProcess) return { ok: false, error: 'Stop the server before editing player data.' };
    // BUGFIX: previously Number(changes.health) etc. had no NaN guard and no range check — a typo or
    // stray text in the form (Number('abc') === NaN) still got written into the player's .dat file as
    // a literal NaN NBT float, and out-of-range values (negative health, gameType 7, a billion XP
    // levels) went through untouched. Validate every field up front and reject the WHOLE save on the
    // first problem — a clear error beats a half-applied edit or a save file with garbage stats in it.
    const clampedFields = [['health', 0, 20], ['food', 0, 20], ['saturation', 0, 20], ['xpLevel', 0, 2000000000], ['xpTotal', 0, 2000000000]];
    const v = {};
    for (const [key, min, max] of clampedFields) {
      const raw = changes[key]; if (raw === undefined || raw === null || raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `"${raw}" is not a valid number for ${key}.` };
      if (n < min || n > max) return { ok: false, error: `${key} must be between ${min} and ${max} (got ${n}).` };
      v[key] = n;
    }
    if (changes.gameType !== undefined && changes.gameType !== null && changes.gameType !== '') {
      const gt = Number(changes.gameType);
      if (!Number.isInteger(gt) || gt < 0 || gt > 3) return { ok: false, error: 'Game mode must be 0 (Survival), 1 (Creative), 2 (Adventure), or 3 (Spectator).' };
      v.gameType = gt;
    }
    const player = await readPlayerData(currentServerPath, uuid); const root = player.parsed.parsed.value;
    const set = (key, type, value) => { if (value !== undefined) root[key] = { type, value }; };
    set('Health', 'float', v.health); set('foodLevel', 'int', v.food); set('foodSaturationLevel', 'float', v.saturation);
    set('XpLevel', 'int', v.xpLevel); set('XpTotal', 'int', v.xpTotal); set('playerGameType', 'int', v.gameType);
    if (clearInventory) root.Inventory = { type: 'list', value: { type: 'compound', value: [] } };
    const backupDir = safeTarget(currentServerPath, 'observerlauncher-backups'); fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `playerdata-${uuid}-${new Date().toISOString().replace(/[:.]/g, '-')}.dat`);
    fs.copyFileSync(player.file, backup); fs.writeFileSync(player.file, zlib.gzipSync(nbt.writeUncompressed(player.parsed.parsed, player.type)));
    return { ok: true, backup: path.basename(backup), data: (await readPlayerData(currentServerPath, uuid)).data };
  } catch (error) { return marketplaceError(error); }
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
      // BUGFIX: Modrinth has NO project_type "plugin" (only mod/modpack/resourcepack/shader/datapack).
      // Plugins (Paper/Spigot/Purpur/Folia...) on Modrinth are still stored with project_type "mod",
      // distinguished only by "loaders". The old facet `project_type:plugin` was a value that doesn't
      // exist, so Modrinth always returned 0 results whenever searching for Plugin. Now it always
      // filters on project_type:mod and adds a loaders facet to get the right plugin/mod type.
      // FEATURE: "Forge mod" used to lump Forge/Fabric/NeoForge/Quilt into one search, which could
      // surface a Fabric-only mod for a Forge server or vice versa. Split into precise groups, and
      // added Datapack as its own content type.
      const loaderGroups = {
        plugin: ['loaders:paper', 'loaders:spigot', 'loaders:purpur', 'loaders:folia', 'loaders:bukkit'],
        forge: ['loaders:forge', 'loaders:neoforge'],
        fabric: ['loaders:fabric', 'loaders:quilt'],
      };
      const index = sort === 'latest' ? 'newest' : sort === 'downloads' ? 'downloads' : 'relevance';
      let lastTotal = null;
      const runSearch = async filters => {
        const facets = encodeURIComponent(JSON.stringify(filters));
        // FEATURE: pagination — offset only applies once a filter combination is known to return
        // results, since "relaxed" fallbacks (below) restart the search with a broader filter and
        // must go back to the first page of THAT broader set, not skip into results the user never saw.
        const data = await json(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query || '')}&limit=20&offset=${skip}&index=${index}&facets=${facets}`);
        lastTotal = data.total_hits ?? null;
        return data.hits || [];
      };
      let hits, relaxed = null;
      if (kind === 'modpack') {
        // Unlike datapacks, Modrinth's docs explicitly list "modpack" as a real project_type value, so
        // no progressive-fallback guessing is needed here.
        hits = await runSearch([['project_type:modpack']]);
      } else if (kind === 'datapack') {
        // FEATURE: Modrinth's exact facet shape for datapacks isn't consistently documented (it has
        // shifted between a dedicated project_type and a "loaders:datapack" tag on a "mod" project
        // over time) — try the most likely shape first, then fall back progressively instead of
        // guessing wrong and silently showing 0 results.
        hits = await runSearch([['project_type:datapack']]);
        if (!hits.length && skip === 0) { hits = await runSearch([['project_type:mod'], ['loaders:datapack']]); if (hits.length) relaxed = 'loader'; }
        if (!hits.length && skip === 0) { hits = await runSearch([['project_type:mod'], ['categories:datapack']]); if (hits.length) relaxed = 'loader'; }
      } else {
        const loaderGroup = loaderGroups[kind] || loaderGroups.plugin;
        // BUGFIX: previously, picking a specific game version (especially a brand-new one) with no
        // plugin built specifically for it made the launcher report "No results" outright, even though
        // compatible plugins existed for nearby versions. Now it progressively relaxes: drop the version
        // filter first, then drop the loaders filter too, instead of reporting 0 results on the first try.
        let filters = [['project_type:mod'], loaderGroup];
        if (version) filters.push([`versions:${version}`]);
        hits = await runSearch(filters);
        if (!hits.length && skip === 0 && version) { hits = await runSearch([['project_type:mod'], loaderGroup]); if (hits.length) relaxed = 'version'; }
        if (!hits.length && skip === 0) { hits = await runSearch([['project_type:mod']]); if (hits.length) relaxed = 'loader'; }
      }
      return { ok: true, relaxed, total: lastTotal, items: hits.map(x => ({ source, id: x.project_id, title: x.title, author: x.author, description: x.description, icon: x.icon_url, downloads: x.downloads, version, env: x.env || null, loaders: x.loaders || [], date: x.date_created || null })) };
    }
    if (source === 'hangar') {
      const order = sort === 'downloads' ? '-downloads' : sort === 'latest' ? '-updatedAt' : '-stars'; const data = await json(`https://hangar.papermc.io/api/v1/projects?query=${encodeURIComponent(query || '')}&limit=20&offset=${skip}&sort=${encodeURIComponent(order)}`); const rows = data.result || data.projects || [];
      return { ok: true, total: data.pagination?.count ?? null, items: rows.map(x => ({ source, id: `${x.namespace?.owner || x.namespace}/${x.name || x.slug}`, title: x.name || x.slug, author: x.namespace?.owner || x.owner || 'Hangar', description: x.description || '', downloads: x.stats?.downloads || 0, version })) };
    }
    const page = Math.floor(skip / 20) + 1;
    const data = await json(`https://api.spiget.org/v2/search/resources/${encodeURIComponent(query || 'plugin')}?size=20&page=${page}&sort=${sort === 'latest' ? '-releaseDate' : '-downloads'}`);
    // Spiget's search endpoint returns a flat array with no total-count field, unlike Modrinth/Hangar —
    // total is left null and the renderer falls back to "a full page came back, so there's probably a
    // next page" instead of showing an exact page count for this source.
    return { ok: true, total: null, items: data.map(x => ({ source: 'spigot', id: String(x.id), title: x.name, author: x.author?.username || 'Spigot author', description: x.tag || x.description || '', downloads: x.downloads || 0, version })) };
  } catch (error) { return marketplaceError(error); }
});
// FEATURE: install-time detail for the confirmation dialog — project body plus the REAL version
// list (id, date, game_versions, loaders, size) so the user picks an exact build and sees
// compatibility before anything touches disk. Non-Modrinth sources have no rich version API;
// they degrade to the search-item metadata (versions:null → picker hidden).
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
    if (!currentServerPath) return { ok: false, error: 'Choose and apply a server folder first.' };
    const kind = ['forge', 'fabric', 'datapack'].includes(item.kind) ? item.kind : 'plugin';
    const levelName = serverFiles(currentServerPath).properties['level-name'] || 'world';
    const destFolders = { plugin: 'plugins', forge: 'mods', fabric: 'mods', datapack: path.join(levelName, 'datapacks') };
    const destDir = safeTarget(currentServerPath, destFolders[kind]); fs.mkdirSync(destDir, { recursive: true }); let url, filename;
    if (item.source === 'modrinth') {
      const versions = await json(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}/version`);
      const wantedLoaders = { plugin: ['paper', 'spigot', 'purpur', 'folia', 'bukkit'], forge: ['forge', 'neoforge'], fabric: ['fabric', 'quilt'], datapack: ['datapack', 'minecraft'] }[kind];
      const byVersion = versions.filter(v => !item.version || (v.game_versions || []).includes(item.version));
      // FEATURE: the confirm dialog can pin an EXACT version id (user's explicit choice from the
      // version list) — it bypasses the loader/game-version auto-pick entirely.
      let target = null;
      if (item.versionId) target = versions.find(v => v.id === item.versionId) || null;
      if (!target) {
        // BUGFIX: previously only filtered by game version, which could download a Fabric build for a
        // Paper server (or vice versa) if the project supports multiple loaders. Now it prefers a build
        // matching the right loader first.
        target = byVersion.find(v => (v.loaders || []).some(l => wantedLoaders.includes(l))) || byVersion[0] || versions[0];
      }
      if (!target?.files?.[0]) throw new Error('No downloadable version was found.'); url = target.files.find(f => f.primary)?.url || target.files[0].url; filename = target.files.find(f => f.primary)?.filename || target.files[0].filename;
    }
    else if (item.source === 'hangar') { const [owner, slug] = String(item.id).split('/'); const versions = await json(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/versions?limit=20`); const target = (versions.result || []).find(v => v.downloads?.PAPER?.downloadUrl); const file = target?.downloads?.PAPER; if (!file) throw new Error('No Paper download was found for this Hangar project.'); url = file.downloadUrl; filename = file.fileInfo?.name || `${slug}.jar`; }
    else if (item.source === 'spigot') { url = `https://api.spiget.org/v2/resources/${encodeURIComponent(item.id)}/download`; filename = `${item.title.replace(/[^\w.-]+/g, '_')}.jar`; }
    else throw new Error('Unsupported marketplace source.');
    const dest = path.join(destDir, path.basename(filename));
    // FEATURE: real byte progress for the install dialog (market:progress events).
    await download(url, dest, (received, total) => send('market:progress', { phase: 'file', name: filename, received, total }));
    // FEATURE: record where this file came from so a later "export modpack" can rebuild a real,
    // re-downloadable .mrpack — without this, the launcher would forget the source the moment the
    // download finished and exporting would be impossible.
    recordManifestEntry(currentServerPath, { kind, fileName: path.basename(filename), sourceUrl: url, source: item.source, title: item.title, installedAt: new Date().toISOString() });
    return { ok: true, files: serverFiles(currentServerPath), name: filename };
  } catch (error) { return marketplaceError(error); }
});
// FEATURE: each software source (Vanilla/PaperMC-family/Fabric/Purpur/Forge-family/Spigot) is now
// resolved through its own adapter module under ./main/adapters/ instead of one long if/else chain
// inline here — adding a new software source means adding one small adapter file, not editing this
// handler. The "plain download" adapters (vanilla/papermc/fabric/purpur) all return the same
// {url, name, version} shape, downloaded the same way below; Forge/NeoForge and Spigot have real
// side effects (running an installer / compiling from source) so they own more of their own flow.
const RESOLVERS = {
  vanilla: (v) => require('./main/adapters/vanilla.js').resolve(v),
  paper: (v) => downloadFillProject('paper', v),
  folia: (v) => downloadFillProject('folia', v),
  velocity: (v) => downloadFillProject('velocity', v),
  fabric: (v) => require('./main/adapters/fabric.js').resolve(v),
  purpur: (v) => require('./main/adapters/purpur.js').resolve(v),
  leaf: (v) => require('./main/adapters/leaf.js').resolve(v),
};
// FEATURE: real-time version list for the create-server wizard — chips and "Latest" label come
// straight from each software's official API instead of hardcoded HTML (which drifted and offered
// versions that don't exist yet, e.g. a future 26.3). raw:true means entries are build identifiers
// passed as-is to the installer (Forge/NeoForge maven ids like "1.20.1-47.2.0"), not MC versions.
ipcMain.handle('wizard:versions', async (_, software) => {
  try {
    const s = String(software || 'vanilla');
    if (s === 'vanilla') {
      const m = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
      const v = m.versions.filter(x => x.version_type === 'release').map(x => x.id);
      return { ok: true, versions: v, latest: v[0] || null, raw: false };
    }
    if (s === 'paper' || s === 'folia' || s === 'velocity') {
      const v = await listFillVersions(s);
      return { ok: true, versions: v, latest: v[0] || null, raw: false };
    }
    if (s === 'purpur') {
      const p = await json('https://api.purpurmc.org/v2/purpur');
      const v = [...(p.versions || [])].reverse(); // upstream is oldest-first
      return { ok: true, versions: v, latest: v[0] || null, raw: false };
    }
    if (s === 'leaf') {
      const p = await json('https://api.leafmc.one/v2/projects/leaf');
      const v = [...(p.versions || [])].reverse(); // upstream is oldest-first (see adapters/leaf.js)
      return { ok: true, versions: v, latest: v[0] || null, raw: false };
    }
    if (s === 'fabric') {
      const g = await json('https://meta.fabricmc.net/v2/versions/game');
      const v = g.filter(x => x.stable).map(x => x.version);
      return { ok: true, versions: v, latest: v[0] || null, raw: false };
    }
    if (s === 'forge' || s === 'neoforge') {
      const maven = s === 'neoforge' ? 'https://maven.neoforged.net/releases/net/neoforged/neoforge' : 'https://maven.minecraftforge.net/net/minecraftforge/forge';
      const { signal, cancel } = withTimeout(15000);
      const xml = await (await fetch(`${maven}/maven-metadata.xml`, { signal }).finally(cancel)).text();
      const latest = xml.match(/<latest>([^<]+)<\/latest>/)?.[1] || null;
      const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]).reverse();
      return { ok: true, versions: all, latest, raw: true };
    }
    if (s === 'spigot') {
      // SYNC: BuildTools has no version API of its own — suggest the live Mojang release list
      // (BuildTools accepts any release; ancient ones may fail to compile) instead of a static
      // list that drifted out of date.
      const m = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
      const v = m.versions.filter(x => x.version_type === 'release').map(x => x.id);
      return { ok: true, versions: v, latest: 'latest', raw: false, note: 'BuildTools accepts any release Mojang publishes — very old ones may fail to compile.' };
    }
    return { ok: false, error: `Unknown software "${s}".` };
  } catch (error) { return { ok: false, error: error?.message || 'Could not load the version list.' }; }
});
// FEATURE: hard-sync the Java requirement for a chosen version — asks Mojang's manifest for the
// authoritative javaVersion.majorVersion instead of trusting the static mapping. Forge/NeoForge
// report raw maven build ids, so the Minecraft id is extracted best-effort ("1.20.1-47.2.0" →
// "1.20.1"; "21.1.57" → family "1.21"); when no exact manifest entry exists the caller falls back
// to the static mapping (source:'mapping', exact:false).
ipcMain.handle('wizard:java-check', async (_, { software, version }) => {
  try {
    const v = String(version || '').trim();
    if (!v || v === 'latest') return { ok: true, source: 'none', java: null, exact: false };
    let mcId = v;
    if (software === 'forge' || software === 'neoforge') {
      const forgeStyle = v.match(/^(1\.\d{1,2}(?:\.\d{1,2})?)-/);
      if (forgeStyle) mcId = forgeStyle[1];
      else {
        const major = v.match(/^(\d{2})\./);
        mcId = major ? `1.${major[1]}` : null;
      }
    }
    if (mcId) {
      const java = await mojang.javaVersionFor(mcId);
      if (java) return { ok: true, source: 'mojang', java, exact: mcId === v, mcId };
    }
    return { ok: true, source: 'mapping', java: requiredJavaForJar(mcId || v), exact: false };
  } catch (error) { return { ok: false, error: error?.message || 'Could not verify the Java requirement.' }; }
});
ipcMain.handle('wizard:create', async (_, { software, version }) => {
  try {
    if (serverProcess) return { ok: false, error: 'Stop the current server before using the wizard.' };
    if (buildProcess) return { ok: false, error: 'A build is already running for this folder — check the Console tab for progress.' };
    if (!currentServerPath) return { ok: false, error: 'Choose and apply an empty server folder first.' }; fs.mkdirSync(currentServerPath, { recursive: true }); const contents = fs.readdirSync(currentServerPath); if (contents.some(x => /\.jar$/i.test(x))) return { ok: false, error: 'This folder already contains a server jar. Choose an empty folder to avoid overwriting it.' };
    const targetVersion = version?.trim();
    // FEATURE: real byte-level download progress for the wizard's "Create server" step (previously
    // just a static "Downloading…" button with no feedback for however long the download took).
    const onProgress = (received, total) => send('wizard:progress', { received, total });

    if (software === 'forge' || software === 'neoforge') {
      const r = await require('./main/adapters/forge.js').install({ software, version: targetVersion, javaInfo, serverPath: currentServerPath, onProgress });
      return { ok: true, files: serverFiles(currentServerPath), name: r.name, version: r.version };
    }

    if (software === 'spigot') {
      // FEATURE: this one still returns "building:true" right away and streams progress to the
      // Console — see the note on spigot.js for why the spawn/process wiring stays here.
      if (!javaInfo?.ok) throw new Error('Java is required to run BuildTools. Set a valid Java path first.');
      // P0.1: early Git check so beginners get a clear error instead of a cryptic BuildTools log 5 min later
      const gitOk = await new Promise(res => require('child_process').execFile('git', ['--version'], { windowsHide: true }, (e) => res(!e)));
      if (!gitOk) throw new Error('Git is not installed or not on PATH — BuildTools needs Git to compile Spigot. Install Git for Windows (https://git-scm.com) and try again.');
      const resolvedVersion = targetVersion || 'latest';
      await require('./main/adapters/spigot.js').fetchBuildTools(currentServerPath, onProgress);
      appendLog(`BuildTools started for Spigot ${resolvedVersion} — this compiles from source and can take several minutes. Requires Git to be installed.`, 'system');
      buildProcess = spawn(javaInfo.path, require('./main/adapters/spigot.js').spawnArgs(resolvedVersion), { cwd: currentServerPath, windowsHide: true });
      buildProcess.stdout.on('data', d => d.toString().split(/\r?\n/).filter(Boolean).forEach(x => appendLog(x, 'system')));
      buildProcess.stderr.on('data', d => d.toString().split(/\r?\n/).filter(Boolean).forEach(x => appendLog(x, 'system')));
      buildProcess.on('exit', code => {
        buildProcess = null;
        if (code === 0) appendLog('BuildTools finished — the Spigot server jar is ready in this folder.', 'system');
        else appendLog(`BuildTools exited with code ${code} — the Spigot build failed. Scroll up in this log for the real error (missing Git is the most common cause).`, 'error');
        send('wizard:build-done', { ok: code === 0, files: serverFiles(currentServerPath) });
      });
      // Same spawn-failure gap as the server process above: without an 'error' listener a bad
      // java path here crashed the app instead of reporting the build as failed.
      buildProcess.on('error', error => {
        buildProcess = null;
        appendLog(`BuildTools could not be started: ${error.message}`, 'error');
        send('wizard:build-done', { ok: false, files: serverFiles(currentServerPath) });
      });
      return { ok: true, building: true, name: 'BuildTools (Spigot)', version: resolvedVersion };
    }

    const resolver = RESOLVERS[software] || RESOLVERS.purpur; // unknown software id falls back to Purpur, matching the previous behaviour's final `else` branch
    const { url, name, version: resolvedVersion, sha256 } = await resolver(targetVersion);
    const dest = path.join(currentServerPath, name);
    await download(url, dest, onProgress);
    // FEATURE: verify the jar against the SHA-256 the Fill API ships with each build — a truncated
    // or tampered download is deleted instead of becoming a server.jar that fails mysteriously.
    if (sha256) {
      try {
        const got = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
        if (got !== String(sha256).toLowerCase()) { fs.rmSync(dest, { force: true }); throw new Error(`Downloaded ${name} failed its SHA-256 checksum and was deleted — check your connection and retry.`); }
      } catch (e) { if (String(e?.message || '').includes('checksum')) throw e; }
    }
    return { ok: true, files: serverFiles(currentServerPath), name, version: resolvedVersion };
  } catch (error) { buildProcess = null; return marketplaceError(error); }
});
