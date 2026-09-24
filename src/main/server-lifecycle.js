// Server process lifecycle (extracted from main.js — behaviour unchanged).
//
// Owns: the 4-state machine (stopped/starting/running/stopping), spawn via
// java -jar or run.bat/run.sh, stdout/stderr parsing, auto-poll (list/tps),
// resource metrics, auto-restart. This is the most stateful module — every
// transition goes through ctx.setServerStatus so the UI choke point is kept.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadSettings, getActiveInstanceId } = require('./settings.js');
const { setInstanceProcess, setInstanceStatus, clearInstanceProcess } = require('./runtime-state.js');
const { validateStart } = require('./java.js');
const { requiredJavaForServer } = require('./server-java.js');
const { serverFiles, detectSoftware, readEula, writeEula, parseServerLine, buildPropertiesContent } = require('./server-files.js');
const { RconClient, desiredRconProps } = require('./rcon.js');
const platform = require('./platform');
const { killTree } = require('./kill.js');
// Metrics sampling and auto-poll were split into their own modules (behaviour unchanged).
// Re-exported below so existing callers (app-lifecycle.js, tests) keep working.
const { parseMetricValue, startMetrics } = require('./server-metrics.js');
const { startAutoPoll } = require('./server-poll.js');

// Build the JVM argument list. Custom jvmArgs win over the memory sliders; both are split on
// whitespace with quote support. `jar` is a parameter so this stays a pure, testable function.
function buildLaunchArgs(settings, isProxy, jar) {
  const customArgs = String(settings.jvmArgs || '').trim()
    ? String(settings.jvmArgs).trim().match(/(?:[^\s"]+|"[^"]*")+/g).map(x => x.replace(/^"|"$/g, ''))
    : [`-Xms${settings.memoryMin || 2}G`, `-Xmx${settings.memoryMax || 6}G`];
  const args = isProxy ? [...customArgs, '-jar', jar] : [...customArgs, '-jar', jar, 'nogui'];
  return { customArgs, args };
}

// Spawn the server process (java -jar … or cmd/bash run.bat/run.sh) and store it on ctx.
function spawnServerProcess(ctx, serverPath, info, customArgs, args) {
  if (info.launchScript) {
    const env = { ...process.env };
    if (customArgs.length) env.JAVA_TOOL_OPTIONS = customArgs.join(' ');
    if (info.launchScript.toLowerCase().endsWith('.sh')) {
      ctx.serverProcess = spawn('bash', [info.launchScript, 'nogui'], { cwd: serverPath, stdio: ['pipe', 'pipe', 'pipe'], env });
    } else if (process.platform === 'win32') {
      ctx.serverProcess = spawn('cmd.exe', ['/d', '/c', info.launchScript, 'nogui'], { cwd: serverPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false, env });
    } else {
      ctx.serverProcess = spawn('bash', [info.launchScript, 'nogui'], { cwd: serverPath, stdio: ['pipe', 'pipe', 'pipe'], env });
    }
  } else {
    ctx.serverProcess = spawn(ctx.javaInfo.path, args, { cwd: serverPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });
  }
  recordSpawnedProcess(ctx, serverPath);
}

// v2.0.0 (M3): persist the spawned process identity so orphan cleanup can find a
// server left behind after an app crash. The child pid's REAL creation time is the
// PID-reuse guard (M1 platform.getProcessInfo). Recorded immediately with an
// approximate start, then refined with the OS-reported creation time once known.
function recordSpawnedProcess(ctx, serverPath) {
  const proc = ctx.serverProcess;
  if (!proc || !proc.pid) return;
  const instanceId = ctx.inst();
  ctx.runtimeInstanceId = instanceId;
  setInstanceProcess(instanceId, { pid: proc.pid, processStartedAt: Date.now(), serverPath });
  Promise.resolve(platform.getProcessInfo(proc.pid)).then(info => {
    if (info && info.startTimeMs && ctx.serverProcess === proc) {
      setInstanceProcess(instanceId, { pid: proc.pid, processStartedAt: info.startTimeMs, serverPath });
    }
  }).catch(() => {});
}

// Auto-restart after an unexpected exit (skipped for manual stops; a clean exit resets the counter).
function handleAutoRestart(ctx, wasManual, code) {
  const current = loadSettings();
  if (wasManual || !current.autoRestart) return;
  if (code === 0) { ctx.restartAttempts = 0; return; }
  const maxAttempts = Math.max(1, Number(current.autoRestartMaxAttempts) || 3);
  const delaySeconds = Math.max(1, Number(current.autoRestartDelaySeconds) || 5);
  if (ctx.restartAttempts >= maxAttempts) {
    ctx.appendLog(`Auto-restart stopped after ${maxAttempts} failed attempts in a row — check Console above for the real error before starting again.`, 'error');
    ctx.restartAttempts = 0;
    return;
  }
  ctx.restartAttempts++;
  ctx.appendLog(`Auto-restart is on — restarting server in ${delaySeconds}s… (attempt ${ctx.restartAttempts}/${maxAttempts})`, 'system');
  clearTimeout(ctx.restartTimer);
  ctx.restartTimer = setTimeout(() => { startServerInternal(ctx, current).catch(() => {}); }, delaySeconds * 1000);
}

// A7 (Phase A): port lease. Each instance owns a server-port (from its server.properties).
// Refuse to start if ANOTHER currently-running instance uses the same port — two servers on one
// port would make the second fail to bind, confusingly. A different port already taken by a
// NON-instance process is surfaced by the OS bind failure + doctor.checkPortFree, not here.
function checkPortLease(ctx, instId, settings) {
  try {
    const { serverFiles } = require('./server-files.js');
    const portsOf = root => {
      const props = (serverFiles(root).properties) || {};
      const game = Number(props['server-port']) || 25565;
      const rcon = Number(props['rcon.port']) || 0;
      return { game, rcon };
    };
    const mine = portsOf(settings && settings.serverPath);
    const clash = [];
    for (const [id, st] of ctx.instances) {
      if (id === instId) continue;
      if (!st || !(st.serverStatus === 'running' || st.serverStatus === 'starting' || st.serverStatus === 'stopping')) continue;
      const root = st.serverPath || (st.currentServerPath) || '';
      if (!root) continue;
      const other = portsOf(root);
      // M6: both the game port AND the RCON port must be unique across running instances.
      if (other.game === mine.game || (mine.rcon > 0 && other.rcon === mine.rcon)) clash.push(id);
    }
    if (clash.length) {
      return { block: true, message: `A port used by this server is already used by another running instance (${clash.join(', ')}). Change server-port or rcon.port in one of them, or stop it first.` };
    }
    return { block: false, message: '' };
  } catch { return { block: false, message: '' }; }
}

// B5: sum requested memoryMax (GB) of running instances + this one vs total system RAM.
function checkRamBudget(ctx, instId, settings) {
  try {
    const totalMB = platform.getTotalMemoryMB ? platform.getTotalMemoryMB() : 0;
    if (!totalMB) return { block: false, warn: false };
    const thisGB = Number(settings.memoryMax) || 0;
    let otherGB = 0;
    for (const [id, st] of ctx.instances) {
      if (id === instId) continue;
      if (st && (st.serverStatus === 'running' || st.serverStatus === 'starting' || st.serverStatus === 'stopping')) {
        otherGB += Number(st.memoryMax) || 0;
      }
    }
    const totalGB = totalMB / 1024;
    const wanted = thisGB + otherGB;
    if (wanted > totalGB) {
      return { block: true, warn: false, message: `Not enough RAM: this instance needs ${thisGB} GB and ${otherGB} GB is already allocated to running instances, but the system only has ~${Math.round(totalGB)} GB. Lower the memory on one of them or stop a server first.` };
    }
    if (wanted > totalGB * 0.8) {
      return { block: false, warn: true, message: `RAM warning: ${wanted} GB requested across running instances, ~${Math.round(totalGB)} GB total — the system may start swapping.` };
    }
    return { block: false, warn: false };
  } catch { return { block: false, warn: false }; }
}

// M6: ensure server.properties enables RCON with a per-instance port + password, and persist the
// chosen values into settings so the same port is reused next start. Preserves any RCON config the
// user already set. Returns {port,password} or null when the folder/properties are unusable.
function ensureRconInProperties(ctx, settings) {
  const root = settings && settings.serverPath;
  if (!root) return null;
  const info = serverFiles(root);
  const props = info.properties || {};
  const desired = desiredRconProps(props, settings.rconPort, settings.rconPassword);
  // Only write when something actually needs to change, to avoid needless file churn.
  const needsWrite = props['enable-rcon'] !== 'true'
    || String(props['rcon.port'] || '') !== String(desired.port)
    || String(props['rcon.password'] || '') !== String(desired.password);
  if (needsWrite) {
    const content = buildPropertiesContent(root, { 'enable-rcon': 'true', 'rcon.port': String(desired.port), 'rcon.password': desired.password });
    require('./fs-utils.js').writeFileAtomic(path.join(root, 'server.properties'), content);
  }
  // Persist the credentials on the instance so the next start reuses the same port/password.
  try {
    const cur = loadSettings();
    if (String(cur.rconPort) !== String(desired.port) || cur.rconPassword !== desired.password) {
      cur.rconPort = desired.port; cur.rconPassword = desired.password;
      require('./settings.js').saveSettings(cur);
    }
  } catch {}
  return { port: desired.port, password: desired.password };
}

// M6: attach an RCON client once the server is up. Runs in the spawn's instance via the caller.
function connectRcon(ctx, cfg, instId) {
  if (!cfg || !cfg.port) return;
  closeRcon(ctx);
  const client = new RconClient({ host: '127.0.0.1', port: cfg.port, password: cfg.password, timeoutMs: 5000 });
  ctx.rcon = client;
  client.connect().then(() => {
    if (ctx.rcon === client) ctx.appendLog(`RCON connected on 127.0.0.1:${cfg.port}.`, 'system');
  }).catch(err => {
    if (ctx.rcon === client) ctx.rcon = null;
    ctx.appendLog(`RCON unavailable (${err?.message || err}); using stdin for console commands.`, 'system');
  });
}

function closeRcon(ctx) {
  try { if (ctx.rcon) ctx.rcon.close(); } catch {}
  ctx.rcon = null;
}

// M6: route a console command. Prefer RCON when connected; fall back to stdin (early boot, or when
// RCON failed). Always echoes the command to the console like the old path did.
async function sendConsoleCommand(ctx, command) {
  ctx.lastManualCommandAt = Date.now();
  ctx.appendLog(`> ${command}`, 'command');
  const client = ctx.rcon;
  if (client && client.connected) {
    try { await client.exec(command); return { ok: true, via: 'rcon' }; }
    catch (e) { try { ctx.appendLog(`RCON command failed (${e?.message || e}); falling back to stdin.`, 'system'); } catch {} }
  }
  if (ctx.serverProcess && ctx.serverProcess.stdin && ctx.serverProcess.stdin.writable) {
    try { ctx.serverProcess.stdin.write(command + '\r\n'); return { ok: true, via: 'stdin' }; }
    catch (e) { return { ok: false, error: e?.message || 'Could not send the command.' }; }
  }
  return { ok: false, error: 'Server is not running.' };
}

// v2.0.0 (M8 full re-attach): adopt a server we did NOT spawn this session (a tier-2 orphan the
// user chose to Reconnect to). We cannot recover stdin/stdout of a foreign process, so:
//   - ctx.serverProcess becomes a lightweight stub { pid, adopted:true, stdin:null, ... }
//   - console commands go through RCON (routes by port, lifecycle-independent)
//   - metrics resume automatically (metricsTick uses ctx.serverProcess.pid)
//   - a liveness poll replaces the missing 'exit' event
// Guards: pid must be alive, java, and match the recorded start time (PID-reuse). Never throws.
async function adoptProcess(ctx, stored, deps) {
  deps = deps || {};
  const getInfo = deps.getInfo || (p => platform.getProcessInfo(p));
  const pid = Number(stored && stored.pid);
  if (!Number.isFinite(pid) || pid <= 0) return { ok: false, error: 'No pid to adopt.' };
  let info = null;
  try { info = await getInfo(pid); } catch { info = null; }
  if (!info || info.alive !== true) return { ok: false, error: 'The server process has already exited.' };
  const recorded = Number(stored.processStartedAt), actual = Number(info.startTimeMs);
  if (Number.isFinite(recorded) && recorded > 0 && Number.isFinite(actual) && actual > 0 && Math.abs(recorded - actual) > 2000) {
    return { ok: false, error: 'That pid was reused by another process — refusing to adopt it.' };
  }
  if (!/java/i.test(String(info.name || ''))) return { ok: false, error: `That pid is "${info.name || 'unknown'}", not a java server.` };

  const instId = ctx.inst();
  ctx.currentServerPath = stored.serverPath || ctx.currentServerPath;
  ctx.runtimeInstanceId = instId;
  ctx.serverProcess = { pid, adopted: true, killed: false, stdin: null, stdout: null, stderr: null };
  ctx.monitoredPid = null;
  ctx.previousCpu = null;
  ctx.manualStop = false;
  ctx.waitingForDone = false;
  ctx.live = { tps: null, mspt: null, players: [] };
  ctx.setServerStatus('running');
  setInstanceStatus(instId, 'running');

  // Attach RCON so console commands work on the adopted process.
  try {
    const props = serverFiles(stored.serverPath).properties || {};
    // Read the ADOPTED instance's own settings (not the active one) for its RCON port/password.
    const s = require('./settings.js').loadSettingsFor(instId);
    const port = Number(s.rconPort) || Number(props['rcon.port']);
    const password = String(s.rconPassword || props['rcon.password'] || '');
    if (port && password) connectRcon(ctx, { port, password }, instId);
    else ctx.appendLog('Adopted server has no RCON configured — console commands may be unavailable.', 'system');
  } catch {}

  ctx.appendLog(`Reconnected to a running server (pid ${pid}). Console uses RCON; the process log is not available for an adopted server.`, 'system');
  ctx.pushFiles();
  startAdoptedWatch(ctx, instId, pid, deps);
  return { ok: true, pid };
}

// Liveness poll for an adopted process (no 'exit' event is available for a foreign pid). When the
// pid disappears, run the same cleanup the spawn exit handler would: stop status, clear the runtime
// record, close RCON. Auto-restart is NOT applied to an adopted server (we did not start it).
function startAdoptedWatch(ctx, instId, pid, deps) {
  deps = deps || {};
  const getInfo = deps.getInfo || (p => platform.getProcessInfo(p));
  clearInterval(ctx.adoptWatchTimer);
  ctx.adoptWatchTimer = setInterval(() => {
    ctx.runInInstance(instId, async () => {
      const proc = ctx.serverProcess;
      if (!proc || !proc.adopted || proc.pid !== pid) { clearInterval(ctx.adoptWatchTimer); ctx.adoptWatchTimer = null; return; }
      let info = null;
      try { info = await getInfo(pid); } catch { info = null; }
      if (info && info.alive === true) return;
      clearInterval(ctx.adoptWatchTimer); ctx.adoptWatchTimer = null;
      clearInstanceProcess(ctx.runtimeInstanceId || instId);
      closeRcon(ctx);
      ctx.appendLog('The adopted server process has exited.', 'system');
      ctx.serverProcess = null;
      ctx.monitoredPid = null;
      ctx.previousCpu = null;
      ctx.live = { tps: null, mspt: null, players: [] };
      ctx.setServerStatus('stopped');
      ctx.send('server:live', ctx.live);
      ctx.pushFiles();
    }).catch(() => {});
  }, 5000);
}

async function startServerInternal(ctx, settings) {
  if (ctx.serverStatus !== 'stopped') return { ok: false, error: ctx.serverStatus === 'starting' ? 'Server is already starting.' : ctx.serverStatus === 'stopping' ? 'Server is still stopping — wait for it to finish.' : 'Server is already running.' };
  if (ctx.buildProcess) return { ok: false, error: 'A build (BuildTools) is still running in this folder — wait for it to finish, check the Console tab.' };
  // B5a: pin THIS spawn to the instance the caller targeted. IPC handlers already run inside
  // runInInstance(activeInstanceId); callbacks below are wrapped in runInInstance(instId) so an
  // instance switch mid-start can never write this server's status/process onto another instance.
  const instId = ctx.inst();
  // B5: RAM budget across running instances. Sum memoryMax (GB) of every OTHER instance that is
  // currently starting/running/stopping, plus this one, and compare to total system RAM. >100%
  // blocks (a swap death spiral corrupts nothing but freezes the machine); >80% only warns. The
  // renderer shows the message; we never silently change the user's requested memory.
  const ramCheck = checkRamBudget(ctx, instId, settings);
  if (ramCheck.block) return { ok: false, error: ramCheck.message };
  if (ramCheck.warn) { try { ctx.appendLog(ramCheck.message, 'system'); } catch {} }
  // A7: refuse a port already leased by another running instance.
  const portCheck = checkPortLease(ctx, instId, settings);
  if (portCheck.block) return { ok: false, error: portCheck.message };
  const error = validateStart(settings, ctx.javaInfo, serverFiles, requiredJavaForServer);
  if (error) return { ok: false, error };
  const info = serverFiles(settings.serverPath);
  if (!readEula(settings.serverPath)) {
    if (!settings.autoEula) return { ok: false, error: 'Accept the Minecraft EULA in Settings before starting.' };
    writeEula(settings.serverPath);
  }
  const software = detectSoftware(info);
  ctx.currentSoftware = software;
  // 2.2.0: fresh start -> re-try the tps poll (a previous run may have flagged it unsupported).
  ctx.tpsUnsupported = false;
  const isProxy = software === 'proxy';
  // M6: make sure RCON is enabled in server.properties with a per-instance port + password BEFORE
  // the server reads the file. Existing user RCON config is preserved (see desiredRconProps).
  let rconCfg = null;
  try { rconCfg = ensureRconInProperties(ctx, settings); } catch (e) { try { ctx.appendLog(`RCON setup skipped: ${e?.message || e}`, 'system'); } catch {} }
  const { customArgs, args } = buildLaunchArgs(settings, isProxy, info.jar);
  ctx.appendLog(`Starting ${info.launchScript || info.jar} with ${ctx.javaInfo.path}…`, 'system');
  ctx.manualStop = false;

  spawnServerProcess(ctx, settings.serverPath, info, customArgs, args);

  try { if (!fs.existsSync(path.join(settings.serverPath, 'server.properties'))) ctx.appendLog('First start: server.properties does not exist yet — the "Failed to load properties" ERROR below is expected; the server creates the file on its own and continues.', 'system'); } catch {}

  ctx.monitoredPid = null;
  ctx.previousCpu = null;
  ctx.live = { tps: null, mspt: null, players: [] };
  ctx.send('server:live', ctx.live);
  ctx.waitingForDone = !isProxy;
  const startedProcess = ctx.serverProcess;
  // B5a: process events fire OUTSIDE the IPC handler's async context. Re-enter the spawn's
  // instance for every callback so a background server's stdout/exit can never read or write the
  // ACTIVE instance's serverStatus/process fields. setTimeout/setInterval created inside a
  // wrapped callback inherit the AsyncLocalStorage context, so nested timers stay pinned too.
  const inInst = (fn) => (...a) => ctx.runInInstance(instId, () => fn(...a));

  ctx.serverProcess.on('error', inInst(err => {
    clearInstanceProcess(ctx.runtimeInstanceId || instId);
    closeRcon(ctx);
    ctx.appendLog(`Could not launch the server process: ${err.message}`, 'error');
    if (ctx.serverProcess !== startedProcess) return;
    ctx.serverProcess = null;
    ctx.monitoredPid = null;
    ctx.previousCpu = null;
    ctx.waitingForDone = false;
    ctx.currentSoftware = null;
    clearInterval(ctx.autoPollTimer);
    clearTimeout(doneWatchdog);
    ctx.live = { tps: null, mspt: null, players: [] };
    ctx.setServerStatus('stopped');
    ctx.send('server:live', ctx.live);
    ctx.pushFiles();
  }));

  const doneWatchdog = setTimeout(inInst(() => {
    if (ctx.waitingForDone && ctx.serverProcess === startedProcess) {
      ctx.waitingForDone = false;
      startAutoPoll(ctx, software);
      ctx.setServerStatus('running');
      try { require('./tunnel.js').autoStartTunnel(ctx).catch(() => {}); } catch {}
    }
  }), 15000);
  setTimeout(inInst(() => { if (ctx.serverProcess === startedProcess) ctx.restartAttempts = 0; }), 30000);

  ctx.serverProcess.stdout.on('data', inInst(d => {
    d.toString().split(/\r?\n/).filter(Boolean).forEach(x => {
      if (ctx.waitingForDone && /\bDone \([^)]*\)!/i.test(x)) {
        ctx.waitingForDone = false;
        clearTimeout(doneWatchdog);
        startAutoPoll(ctx, software);
        ctx.restartAttempts = 0;
        ctx.setServerStatus('running');
        ctx.pushFiles();
        // M6: the server is now accepting RCON connections — attach (stdin stays as fallback).
        try { connectRcon(ctx, rconCfg, instId); } catch {}
        try { require('./tunnel.js').autoStartTunnel(ctx).catch(() => {}); } catch {}
      }
      // Suppress the echo of our OWN auto-poll commands + any "unknown command" reply they cause.
      // A server that does not support a poll command (e.g. `forge tps` on some NeoForge builds)
      // would otherwise print 'Unknown or incomplete command' + the echoed line every 5s forever.
      // When we see that reply DURING a poll window, flag the instance so startAutoPoll stops
      // sending the tps command (it is a server limitation, not a bug we can fix).
      const duringPoll = Date.now() < ctx.suppressStatusUntil && Date.now() - ctx.lastManualCommandAt > 1200;
      if (duringPoll && /Unknown or incomplete command|see below for error|<--\[HERE\]/i.test(x)) {
        ctx.tpsUnsupported = true;
      }
      const isAutoPollStatus = duringPoll
        && /(players online|TPS from last|The game is running|Target tick rate:|Average time per tick:|Percentiles:|Mean tick time|Mean TPS|Dim \d+\s*:|Overall:|Unknown or incomplete command|see below for error|<--\[HERE\]|^forge tps$|^tps$|^tick query$|^list$)/i.test(x);
      if (!isAutoPollStatus) ctx.appendLog(x);
      parseServerLine(x, ctx.live, ctx.send);
    });
  }));
  ctx.serverProcess.stderr.on('data', inInst(d => {
    d.toString().split(/\r?\n/).filter(Boolean).forEach(x => { ctx.appendLog(x, 'error'); parseServerLine(x, ctx.live, ctx.send); });
  }));
  ctx.serverProcess.on('exit', inInst((code, signal) => {
    if (!ctx.serverProcess) return;
    clearInstanceProcess(ctx.runtimeInstanceId || instId);
    closeRcon(ctx);
    ctx.appendLog(`Server stopped (code ${code ?? 'none'}, ${signal || 'normal'}).`, 'system');
    const wasManual = ctx.manualStop;
    ctx.manualStop = false;
    ctx.serverProcess = null;
    ctx.monitoredPid = null;
    ctx.previousCpu = null;
    ctx.waitingForDone = false;
    ctx.currentSoftware = null;
    clearInterval(ctx.autoPollTimer);
    clearTimeout(doneWatchdog);
    ctx.live = { tps: null, mspt: null, players: [] };
    ctx.setServerStatus('stopped');
    ctx.send('server:live', ctx.live);
    ctx.pushFiles();
    // SECURITY: never leave the public tunnel up once the server is down.
    try { require('./tunnel.js').stopTunnel(ctx); } catch {}
    handleAutoRestart(ctx, wasManual, code);
  }));

  ctx.setServerStatus(isProxy ? 'running' : 'starting');
  ctx.pushFiles();
  return { ok: true };
}

function registerServer(ipcMain, ctx) {
  // BUGFIX: an unexpected throw inside startServerInternal (bad folder perms,
  // corrupt files, spawn edge cases) used to reject the invoke — the renderer
  // await then threw with NO toast, so Start looked completely dead. Always
  // resolve with {ok:false} so the user sees the reason.
  ipcMain.handle('server:start', async (_, settings) => {
    ctx.restartAttempts = 0;
    try {
      return await startServerInternal(ctx, settings);
    } catch (error) {
      try { ctx.appendLog(`Start failed: ${error?.message || error}`, 'error'); } catch {}
      return { ok: false, error: error?.message || 'Could not start the server for an unknown reason.' };
    }
  });
  ipcMain.handle('server:command', async (_, command) => {
    if (!ctx.serverProcess) return { ok: false, error: 'Server is not running.' };
    // SECURITY: stdin.write appends \r\n — an embedded newline would execute
    // as a SECOND console command (e.g. `kick Notch\nstop` from a crafted
    // player name). Console input is single-line by design; reject multi-line.
    const { isSafeConsoleCommand } = require('./validate.js');
    if (!isSafeConsoleCommand(command)) return { ok: false, error: 'Invalid command — single line only, max 2000 characters.' };
    // M6: prefer RCON; stdin fallback keeps early-boot commands working.
    return await sendConsoleCommand(ctx, command.trim());
  });
  ipcMain.handle('server:stop', async () => {
    if (ctx.serverStatus === 'stopped' || ctx.serverStatus === 'stopping') return { ok: false, error: ctx.serverStatus === 'stopping' ? 'Server is already stopping.' : 'Server is not running.' };
    if (!ctx.serverProcess) return { ok: false, error: 'Server is not running.' };
    ctx.manualStop = true;
    clearTimeout(ctx.restartTimer);
    ctx.setServerStatus('stopping');
    // An ADOPTED process (re-attached after a crash) has no stdin — send the stop via RCON instead.
    if (ctx.serverProcess.adopted) {
      try { await sendConsoleCommand(ctx, 'stop'); } catch {}
    } else {
      try { ctx.serverProcess.stdin.write('stop\r\n'); } catch {}
    }
    // Phase C (item 16): escalate a graceful stop if the server hangs. Important with N instances:
    // a stuck shutdown must not pin one server forever. Send stop -> wait 15s -> SIGTERM/taskkill
    // -> wait 5s -> force kill, and LOG which instance was force-killed.
    scheduleGracefulEscalation(ctx, ctx.inst(), ctx.serverProcess);
    return { ok: true };
  });
  // FEATURE: force-stop (kill) — graceful "stop" goes through the game's own
  // save+shutdown, which hangs when the server is frozen mid-start or stuck
  // (heavy mod, deadlock, runaway GC). This terminates the process tree
  // immediately instead of erroring like server:stop does while 'stopping'.
  // Allowed from starting/running/stopping — only a fully stopped server is
  // rejected. Unsaved progress may be lost; the renderer confirms first.
  ipcMain.handle('server:force-stop', async () => {
    try {
      return await forceStopServer(ctx);
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not force-stop the server.' };
    }
  });
}

// Phase C (item 16): watch a stopping server and escalate if it does not exit. Each tick runs
// inside runInInstance(instId) so ctx.serverProcess/monitoredPid resolve to THIS instance.
function scheduleGracefulEscalation(ctx, instId, proc) {
  clearInterval(ctx.shutdownTimer);
  const t0 = Date.now();
  const termAt = t0 + 15000; // after the game's own stop had 15s to save + exit
  const killAt = termAt + 5000; // after SIGTERM/taskkill had 5s
  let phase = 'graceful';
  const tick = () => {
    if (ctx.serverProcess !== proc) { clearInterval(ctx.shutdownTimer); ctx.shutdownTimer = null; return; }
    const now = Date.now();
    if (phase === 'graceful' && now >= termAt) {
      phase = 'term';
      ctx.appendLog('Server did not stop within 15s — terminating the process…', 'system');
      try { killTree(proc.pid); } catch {}
    } else if (phase === 'term' && now >= killAt) {
      phase = 'kill';
      clearInterval(ctx.shutdownTimer); ctx.shutdownTimer = null;
      ctx.appendLog(`Instance "${instId}" ignored a graceful stop and did not exit — FORCE killing it. The world may not be fully saved.`, 'error');
      try { process.kill(proc.pid, 'SIGKILL'); } catch {}
      try { if (ctx.monitoredPid) process.kill(ctx.monitoredPid, 'SIGKILL'); } catch {}
    }
  };
  ctx.shutdownTimer = setInterval(() => ctx.runInInstance(instId, tick), 500);
}

async function forceStopServer(ctx) {
  const proc = ctx.serverProcess;
  if (!proc || ctx.serverStatus === 'stopped') return { ok: false, error: 'Server is not running.' };
  ctx.manualStop = true; // the exit handler must not auto-restart our own kill
  clearTimeout(ctx.restartTimer);
  clearInterval(ctx.autoPollTimer);
  try { if (proc.stdin?.writable) proc.stdin.write('stop\r\n'); } catch {}
  ctx.appendLog('Force stop requested — terminating the server process…', 'system');
  ctx.setServerStatus('stopping');
  killTree(proc.pid);
  // POSIX killTree only signals the direct child: when launched via run.sh the
  // real java process is a grandchild, so hunt it down too (best effort).
  // Whatever is still alive after 3s gets SIGKILL — force means force.
  if (process.platform !== 'win32') {
    try {
      const javaPid = await Promise.race([
        platform.findJavaDescendant(proc.pid),
        new Promise(resolve => setTimeout(() => resolve(null), 4000))
      ]).catch(() => null);
      if (javaPid && javaPid !== proc.pid) killTree(javaPid);
    } catch {}
    setTimeout(() => {
      if (ctx.serverProcess === proc) {
        try { process.kill(proc.pid, 'SIGKILL'); } catch {}
        try { if (ctx.monitoredPid) process.kill(ctx.monitoredPid, 'SIGKILL'); } catch {}
      }
    }, 3000);
  }
  return { ok: true };
}

module.exports = { startServerInternal, forceStopServer, startAutoPoll, startMetrics, registerServer, parseMetricValue, checkRamBudget, checkPortLease, scheduleGracefulEscalation, sendConsoleCommand, connectRcon, closeRcon, ensureRconInProperties, adoptProcess, startAdoptedWatch };
