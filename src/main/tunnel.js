// src/main/tunnel.js — Public server tunnel so friends can join over the internet WITHOUT port
// forwarding, via Playit.gg.
//
// REALITY CHECK (learned live against Playit agent v1.0.10): the modern Playit agent is a DAEMON —
// it runs as a background service (`playit start`), and the public tunnel is configured in the
// playit.gg dashboard, NOT on the command line. Spawning `playit` directly just exits, and
// `playit attach -s` only streams NEW logs (it does not replay an existing tunnel address). So the
// app CANNOT reliably discover the public address itself. Therefore:
//   - the app's job is to (a) make sure the service is running and (b) get the user to the dashboard;
//   - the public address is entered MANUALLY by the user (the paste box in the UI), which always works.
// SECURITY: the provider is a fixed enum — no renderer string reaches the command line. The
// dashboard/claim URLs are opened externally ONLY if https on a playit.gg host.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { killTree } = require('./kill.js');
const { download } = require('./http.js');
const TM = require('./tunnel-manager.js');

// Playit agent releases live on GitHub. We DON'T hardcode asset filenames (they change) — we ask the
// GitHub API for the latest release and pick the matching asset. Pure so the selection is testable.
const PLAYIT_REPO = 'playit-cloud/playit-agent';
// ITEM 12: installer/archive suffixes. We must download a RUNNABLE binary, not an installer package.
const PLAYIT_INSTALLER_EXT = /\.(msi|apk|deb|rpm|pkg|dmg|tar\.gz|tgz|zip)$/i;
function pickPlayitAsset(assets, platform, arch) {
  if (!Array.isArray(assets)) return null;
  const a = (arch === 'arm64' || arch === 'aarch64') ? 'aarch64' : 'amd64';
  const want = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
  const norm = s => String(s || '').toLowerCase();
  // AMD64 releases may be labelled amd64 / x86_64 / x64; arm64 is only aarch64/arm64.
  const archMatches = name => a === 'aarch64'
    ? (name.includes('aarch64') || name.includes('arm64'))
    : (name.includes('amd64') || name.includes('x86_64') || name.includes('x64'));
  const matches = assets.filter(x => norm(x.name).includes(want));
  // BUG FIX: GitHub lists `playit-windows-x86_64-signed.msi` BEFORE `playit-windows-x86_64.exe`, so
  // the old plain .find() downloaded the MSI and saved it as playit.exe -> the agent would not run.
  // Prefer a non-installer binary (exact arch, then any arch), and only fall back to a package.
  return matches.find(x => !PLAYIT_INSTALLER_EXT.test(norm(x.name)) && archMatches(norm(x.name)))
    || matches.find(x => !PLAYIT_INSTALLER_EXT.test(norm(x.name)))
    || matches.find(x => archMatches(norm(x.name)))
    || matches[0]
    || null;
}

// ITEM 12: pinned SHA-256 for the current release (v1.0.10), used ONLY as a fallback when the
// GitHub API response carries no `asset.digest` (the digest is the primary source and never goes
// stale). Captured from the release page's expanded_assets digests. Keep in sync on major bumps.
const PLAYIT_PINNED_SHA256 = {
  'playit-windows-x86_64.exe': '97ad38fcbd1c4fafcb84a99c0b1b1ba216f76ef5372ae2f6ef142652a1239ad4',
  'playit-windows-x86_64-signed.msi': '18c022281fcfe578fb0d614ac6dc1d36cd6885b4a5439b97655768cd2a82bdc1',
  'playit-cli-linux-amd64': '6fd54d147ae1d3232b22c1c1f4aa3d13cf16d889e840ca2d3f90b4f50a2e7301',
  'playit-cli-linux-aarch64': 'b126b4164c03838598c8f33f209d76f6acf1c257d07900c0af2d461b9647099f',
  'playit-cli-linux-armv7': '2e1140a838b42f00233065432ed36fbfe8af34e9aa22585bcb2e01fcdad282a6',
  'playit-cli-linux-i686': 'e8e4bd663d0781e3d168be2a4e45d3642a38bc7946f507ba6116e8687b8a678f',
  'playit-linux-amd64': '2df7d9f10227ab312b1ad341853db4e8a8243df5cfcdbae58713a4271711c339',
  'playit-linux-armv7': '92ec60988b1246e07ac090c663128bd04bdc0d7ff388db520e1ff7bb4e5003e0',
};
// The expected sha256 hex for a release asset: GitHub's published digest wins; else the pinned hash.
// null = we have nothing to verify against (install proceeds unverified, logged).
function expectedSha256(asset) {
  const d = String((asset && asset.digest) || '');
  if (/^sha256:[0-9a-f]{64}$/i.test(d)) return d.slice(7).toLowerCase();
  const pinned = PLAYIT_PINNED_SHA256[String((asset && asset.name) || '')];
  return pinned ? pinned.toLowerCase() : null;
}
// Streaming sha256 of a file (no whole-file buffer, so a large asset cannot blow memory).
function sha256File(file) {
  const crypto = require('crypto');
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
// ITEM 12 (Authenticode): best-effort, Windows-only. LOGS the signature status, never blocks -
// the Playit agent may legitimately be unsigned, so a hard failure would break the install.
async function checkAuthenticode(file) {
  if (process.platform !== 'win32') return null;
  try {
    const { runPowerShell, psQuote } = require('./http.js');
    const r = await runPowerShell(`(Get-AuthenticodeSignature -LiteralPath ${psQuote(file)}).Status`, 15000);
    if (r && r.ok) return String(r.stdout || '').trim() || null;
  } catch {}
  return null;
}

// Only providers we explicitly support. Add 'pinggy' here when/if it ships.
const PROVIDERS = ['playit'];
function isValidProvider(p) { return PROVIDERS.includes(p); }

// Only ever hand a playit.gg https URL to shell.openExternal.
function isSafePlayitUrl(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)playit\.gg$/.test(u.hostname); }
  catch { return false; }
}

// Locate the Playit agent: an explicit path in settings wins, else look on PATH.
function findPlayitBinary() {
  let stored = '';
  try { stored = require('./settings.js').loadSettings().playitPath || ''; } catch {}
  // Strip surrounding quotes and whitespace — users often paste "C:\path\playit.exe" with quotes.
  stored = String(stored).trim().replace(/^["']+|["']+$/g, '');
  if (stored && fs.existsSync(stored)) return stored;
  // Common system install locations (the system agent owns the running service; the portable copy
  // the app downloads cannot talk to it). Check these BEFORE falling back to PATH.
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'playit', 'playit.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'playit', 'playit.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'playit', 'playit.exe'),
      path.join(process.env['ProgramData'] || 'C:\\ProgramData', 'playit', 'playit.exe'),
    ];
    for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  }
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = spawnSync(cmd, ['playit'], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
      if (first && fs.existsSync(first)) return first;
    }
  } catch {}
  return null;
}

// Download + install the Playit agent into userData/playit and remember its path. Mirrors
// autoInstallJava: fetch → verify it is a real file → save playitPath. No admin rights needed.
async function installPlayitAgent(ctx) {
  const { app } = require('electron');
  const { json } = require('./http.js');
  const { isSafeDownloadUrl } = require('./validate.js');
  try {
    ctx.appendLog('Downloading the Playit agent from GitHub…', 'system');
    const rel = await json(`https://api.github.com/repos/${PLAYIT_REPO}/releases/latest`);
    const asset = pickPlayitAsset(rel?.assets, process.platform, process.arch);
    if (!asset?.browser_download_url) throw new Error('No matching Playit agent build was found for this system.');
    if (!isSafeDownloadUrl(asset.browser_download_url)) throw new Error('Refused an unsafe download URL.');
    const dir = path.join(app.getPath('userData'), 'playit');
    fs.mkdirSync(dir, { recursive: true });
    const exeName = process.platform === 'win32' ? 'playit.exe' : 'playit';
    const dest = path.join(dir, exeName);
    // The Playit agent binary is a few MB; cap at 256 MB.
    await download(asset.browser_download_url, dest, (received, total) => ctx.send('tunnel:progress', { received, total }), null, { maxBytes: 256 * 1024 * 1024 });
    if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new Error('The Playit agent download was empty.');
    // ITEM 12: verify before we ever run it. Primary = the digest GitHub publishes with the release
    // (always current, never stale); fallback = pinned hash for known releases. No hash available ->
    // proceed unverified (best-effort) but log it, so the gap is visible instead of silent.
    const expected = expectedSha256(asset);
    if (expected) {
      const actual = sha256File(dest);
      if (actual !== expected) {
        try { fs.rmSync(dest, { force: true }); } catch {}
        throw new Error('The Playit agent failed its SHA-256 check - the download was corrupt or tampered with. Not installing.');
      }
      ctx.appendLog('Playit agent SHA-256 verified.', 'system');
    } else {
      ctx.appendLog('Playit agent downloaded (no published hash to verify against).', 'system');
    }
    if (process.platform !== 'win32') { try { fs.chmodSync(dest, 0o755); } catch {} }
    // ITEM 12 (Authenticode): logged, never enforced (see checkAuthenticode).
    const signature = await checkAuthenticode(dest).catch(() => null);
    if (process.platform === 'win32') ctx.appendLog(`Playit agent signature: ${signature || 'unknown'}.`, 'system');
    const { loadSettings, saveSettings } = require('./settings.js');
    const s = loadSettings();
    // Never clobber a path the user already set (they may point at a system install whose service
    // is the one actually running).
    if (!s.playitPath || !fs.existsSync(s.playitPath)) { s.playitPath = dest; saveSettings(s); }
    ctx.appendLog(`Playit agent ready: ${dest}`, 'system');
    return { ok: true, path: dest, sha256: expected || null, signature: signature || null };
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not download the Playit agent.' };
  }
}

// The port the tunnel should expose: server-port from server.properties, else the MC default.
function resolveTargetPort(ctx) {
  try {
    const { serverFiles } = require('./server-files.js');
    const n = Number(serverFiles(ctx.currentServerPath).properties['server-port']);
    if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  } catch {}
  return 25565;
}

function runPlayit(bin, args, timeoutMs = 15000) {
  try {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
    return { ok: r.status === 0, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (e) { return { ok: false, error: e?.message || 'Could not run the Playit agent.' }; }
}

// BUGFIX (1.1.0): non-blocking variant for the 15s UI poll. spawnSync here would freeze the WHOLE
// Electron main process for up to the 8s timeout — every IPC handler, file watcher and window
// repaint waits on it. Async spawn + a hard kill keeps the UI responsive even if `playit status`
// hangs (e.g. the service pipe is stuck).
function runPlayitAsync(bin, args, timeoutMs = 8000) {
  return new Promise(resolve => {
    let out = '', err = '', settled = false, child;
    const finish = res => { if (!settled) { settled = true; clearTimeout(timer); resolve(res); } };
    const timer = setTimeout(() => { try { child?.kill(); } catch {} finish({ ok: false, error: 'Playit status timed out.' }); }, timeoutMs);
    try { child = spawn(bin, args, { windowsHide: true }); }
    catch (e) { return finish({ ok: false, error: e?.message || 'Could not run the Playit agent.' }); }
    child.stdout?.on('data', d => { out += d; });
    child.stderr?.on('data', d => { err += d; });
    child.on('error', e => finish({ ok: false, error: e?.message || 'Could not run the Playit agent.' }));
    child.on('close', code => finish({ ok: code === 0, status: code, stdout: out, stderr: err }));
  });
}

// Parse `playit status` output for whether the background service is running.
function parseServiceStatus(text) {
  const m = String(text || '').match(/Phase:\s*(\w+)/i);
  return m ? m[1].toLowerCase() : null;
}

function tunnelSnapshot(ctx) {
  return { status: ctx.tunnelStatus || 'stopped', service: ctx.tunnelService || 'unknown', provider: ctx.tunnelProvider || null, port: resolveTargetPort(ctx) };
}

// Ensure the Playit service is running. This is what the "Set up Playit" button does — it does NOT
// try to discover an address (the dashboard owns that). Never auto-runs; explicit user action only.
async function ensurePlayitService(ctx, provider) {
  if (!isValidProvider(provider)) return { ok: false, error: 'Unsupported tunnel provider.' };
  let bin = findPlayitBinary();
  if (!bin) {
    ctx.tunnelProvider = provider;
    ctx.tunnelStatus = 'installing';
    ctx.send('tunnel:status', tunnelSnapshot(ctx));
    const inst = await installPlayitAgent(ctx);
    if (!inst.ok) { ctx.tunnelStatus = 'stopped'; ctx.send('tunnel:status', tunnelSnapshot(ctx)); return { ok: false, error: inst.error }; }
    bin = inst.path;
  }
  ctx.tunnelProvider = provider;
  ctx.tunnelStatus = 'starting';
  ctx.send('tunnel:status', tunnelSnapshot(ctx));
  // Already running? Don't fight it — just report running.
  const st = runPlayit(bin, ['status']);
  if (st.ok && parseServiceStatus(st.stdout) === 'running') {
    ctx.tunnelService = 'running';
    ctx.tunnelStatus = 'running';
    ctx.appendLog('Playit service is already running.', 'system');
    ctx.send('tunnel:status', tunnelSnapshot(ctx));
    return { ok: true, alreadyRunning: true, binary: bin };
  }
  const start = runPlayit(bin, ['start']);
  if (!start.ok) {
    ctx.tunnelStatus = 'error';
    ctx.send('tunnel:status', tunnelSnapshot(ctx));
    return { ok: false, error: (start.stderr || start.error || 'Could not start the Playit service.').trim() };
  }
  // Remember that WE started it, so we only ever stop a service we own (never one the user runs
  // themselves for other things).
  ctx.tunnelStartedByApp = true;
  ctx.tunnelService = 'running';
  ctx.tunnelStatus = 'running';
  ctx.appendLog('Playit service started. Create/see your tunnel on the playit.gg dashboard, then paste the address into the box.', 'system');
  ctx.send('tunnel:status', tunnelSnapshot(ctx));
  return { ok: true, binary: bin };
}

// Ask the real service for its state and sync ctx (so the UI pill reflects reality even when the
// user started the agent themselves, outside the app).
async function refreshTunnel(ctx) {
  // Coalesce overlapping polls: a hung agent can make one call outlive the 15s interval.
  if (ctx.tunnelRefreshing) return tunnelSnapshot(ctx);
  ctx.tunnelRefreshing = true;
  try {
    const bin = findPlayitBinary();
    if (!bin) {
      ctx.tunnelService = 'not-installed'; ctx.tunnelStatus = 'stopped';
      // No log here: this runs every 15s and would spam the console (removed once already).
      return tunnelSnapshot(ctx);
    }
    const st = await runPlayitAsync(bin, ['status'], 8000);
    const phase = st.ok ? parseServiceStatus(st.stdout) : null;
    if (phase === 'running') { ctx.tunnelService = 'running'; ctx.tunnelStatus = 'running'; }
    else { ctx.tunnelService = phase || 'stopped'; ctx.tunnelStatus = 'stopped'; }
    return tunnelSnapshot(ctx);
  } finally {
    ctx.tunnelRefreshing = false;
  }
}

// Stop the background service. SECURITY/SAFETY: only runs `playit stop` if the APP started the
// service — never kills a Playit service the user runs themselves (it may serve other things).
// Called on server stop and on app quit.
function stopTunnel(ctx) {
  // M10: drop the calling instance from the daemon-user set. The daemon is GLOBAL — only stop it
  // when NO instance still wants it AND the app started it (never kill a user-run daemon).
  ctx.tunnelDaemonUsers = TM.removeUser(ctx.tunnelDaemonUsers, ctx.inst());
  if (TM.shouldStopDaemon(ctx.tunnelDaemonUsers, ctx.tunnelStartedByApp)) {
    const bin = findPlayitBinary();
    if (bin) { try { runPlayit(bin, ['stop'], 10000); } catch {} }
    ctx.tunnelStartedByApp = false;
    ctx.tunnelStatus = 'stopped';
    ctx.tunnelService = 'stopped';
  } else if (ctx.tunnelDaemonUsers.size > 0) {
    // Other instances still use the daemon — leave it up, just note it.
    try { ctx.appendLog(`Tunnel daemon kept running (${ctx.tunnelDaemonUsers.size} other instance(s) still use it).`, 'system'); } catch {}
  }
  ctx.send('tunnel:status', tunnelSnapshot(ctx));
  return { ok: true };
}

// AUTO-TUNNEL: when the user enabled it, start the Playit service as soon as the server is running
// (and no tunnel is already up). Called by server-lifecycle after the server reaches 'running'.
// Respects the security model: only acts when the setting is on, and only while the server runs.
async function autoStartTunnel(ctx) {
  let on = false;
  try { on = !!require('./settings.js').loadSettings().autoTunnel; } catch {}
  const decide = reason => { try { ctx.appendLog(`Auto-tunnel: skipped (${reason}).`, 'system'); } catch {} return { ok: false, skipped: reason }; };
  if (!on) return decide('disabled in Settings');
  if (!ctx.serverProcess || ctx.serverStatus !== 'running') return decide(`server not running (status=${ctx.serverStatus})`);
  // M10: register THIS instance as a daemon user BEFORE starting, so the daemon is never torn down
  // while any instance (this one included) still wants it.
  const instId = ctx.inst();
  ctx.tunnelDaemonUsers = TM.addUser(ctx.tunnelDaemonUsers, instId);
  if (ctx.tunnelStatus === 'running' || ctx.tunnelStatus === 'starting' || ctx.tunnelStatus === 'installing') return { ok: true, skipped: 'already' };
  ctx.appendLog('Auto-tunnel: starting the Playit service (enabled in Settings).', 'system');
  return ensurePlayitService(ctx, 'playit');
}

function registerTunnel(ipcMain, ctx) {
  const { shell } = require('electron');
  ipcMain.handle('tunnel:start', async (_, provider) => {
    try { return await ensurePlayitService(ctx, provider); } catch (e) { return { ok: false, error: e?.message || 'Could not start the Playit service.' }; }
  });
  ipcMain.handle('tunnel:install', async () => {
    try { return await installPlayitAgent(ctx); } catch (e) { return { ok: false, error: e?.message || 'Could not install the Playit agent.' }; }
  });
  ipcMain.handle('tunnel:stop', async () => {
    try { return stopTunnel(ctx); } catch (e) { return { ok: false, error: e?.message || 'Could not stop the tunnel.' }; }
  });
  ipcMain.handle('tunnel:get', async () => {
    try { return await refreshTunnel(ctx); } catch { return tunnelSnapshot(ctx); }
  });
  ipcMain.handle('tunnel:refresh', async () => {
    try { return await refreshTunnel(ctx); } catch (e) { return { ok: false, error: e?.message || 'Could not read the Playit status.' }; }
  });
  ipcMain.handle('tunnel:open-url', async (_, url) => {
    if (!isSafePlayitUrl(url)) return { ok: false, error: 'Refused to open an untrusted link.' };
    try { await shell.openExternal(url); return { ok: true }; } catch (e) { return { ok: false, error: e?.message || 'Could not open the link.' }; }
  });
  // Persist the user's public address (pasted once, shown every session). Stored in settings.
  ipcMain.handle('tunnel:set-address', async (_, addr) => {
    try {
      const { loadSettings, saveSettings } = require('./settings.js');
      // SECURITY: this string is echoed back into the UI and copied to friends. Only accept a plain
      // host or host:port (playit addresses look like NAME.tun.ply.gg / NAME.playit.gg), never markup
      // or a javascript:/data: URL. An empty value clears it.
      const raw = String(addr || '').trim();
      const s = loadSettings();
      if (raw === '') { s.tunnelAddress = ''; saveSettings(s); return { ok: true, address: '' }; }
      if (raw.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?$/.test(raw)) {
        return { ok: false, error: 'Enter a plain address like NAME.tun.ply.gg (no links or symbols).' };
      }
      s.tunnelAddress = raw;
      saveSettings(s);
      return { ok: true, address: s.tunnelAddress };
    } catch (e) { return { ok: false, error: e?.message || 'Could not save the address.' }; }
  });
}

module.exports = { registerTunnel, ensurePlayitService, stopTunnel, autoStartTunnel, refreshTunnel, isSafePlayitUrl, isValidProvider, resolveTargetPort, findPlayitBinary, tunnelSnapshot, parseServiceStatus, pickPlayitAsset, installPlayitAgent, PROVIDERS, expectedSha256, sha256File, PLAYIT_PINNED_SHA256 };
