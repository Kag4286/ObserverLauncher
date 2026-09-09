// Server process lifecycle (extracted from main.js — behaviour unchanged).
//
// Owns: the 4-state machine (stopped/starting/running/stopping), spawn via
// java -jar or run.bat/run.sh, stdout/stderr parsing, auto-poll (list/tps),
// resource metrics, auto-restart. This is the most stateful module — every
// transition goes through ctx.setServerStatus so the UI choke point is kept.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { loadSettings } = require('./settings.js');
const { validateStart } = require('./java.js');
const { serverFiles, detectSoftware, readEula, writeEula, parseServerLine } = require('./server-files.js');
const platform = require('./platform');
const { killTree } = require('./kill.js');

let waitingForDone = false;

function startAutoPoll(ctx, software) {
  clearInterval(ctx.autoPollTimer);
  ctx.autoPollTimer = setInterval(() => {
    if (!ctx.serverProcess || !ctx.serverProcess.stdin.writable) return;
    ctx.suppressStatusUntil = Date.now() + 4000;
    try {
      ctx.serverProcess.stdin.write('list\r\n');
      if (software === 'paper-like') {
        ctx.serverProcess.stdin.write('tps\r\n');
        ctx.serverProcess.stdin.write('tick query\r\n');
      } else if (software === 'forge') {
        ctx.serverProcess.stdin.write('forge tps\r\n');
      }
    } catch {}
  }, 5000);
}

function startMetrics(ctx) {
  let consecutiveMisses = 0;
  let lastMetrics = { serverMemory: 0, cpu: 0 };
  let javaRetryCount = 0;
  clearInterval(ctx.sampleTimer);
  ctx.sampleTimer = setInterval(async () => {
    try {
      const used = process.memoryUsage().rss / 1024 / 1024;
      if (!ctx.serverProcess?.pid) {
        ctx.monitoredPid = null; consecutiveMisses = 0; javaRetryCount = 0;
        ctx.send('server:metrics', { appMemory: Math.round(used), running: false, timestamp: Date.now(), ...ctx.live });
        return;
      }
      if (!ctx.monitoredPid) {
        const found = await Promise.race([
          platform.findJavaDescendant(ctx.serverProcess.pid),
          new Promise(resolve => setTimeout(() => resolve(null), 3000))
        ]).catch(() => null);
        if (found) {
          ctx.monitoredPid = found;
          javaRetryCount = 0;
        } else {
          javaRetryCount++;
          if (javaRetryCount >= 2 || ctx.currentSoftware === 'paper-like') {
            ctx.monitoredPid = ctx.serverProcess.pid;
          } else {
            ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: lastMetrics.serverMemory, cpu: lastMetrics.cpu, running: true, timestamp: Date.now(), ...ctx.live });
            return;
          }
        }
        if (!ctx.monitoredPid) { ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: 0, cpu: 0, running: true, timestamp: Date.now(), ...ctx.live }); return; }
      }
      const metrics = await Promise.race([
        platform.getProcessMetrics(ctx.monitoredPid),
        new Promise(resolve => setTimeout(() => resolve(null), 5000))
      ]).catch(() => null);
      const r = metrics ? { ok: true, stdout: `${metrics.memoryMB}|${metrics.cpuTime}` } : { ok: false, stdout: '' };
      if (!r.stdout || !r.stdout.trim()) {
        consecutiveMisses++;
        if (consecutiveMisses >= 3) { ctx.monitoredPid = null; javaRetryCount = 0; }
        ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: lastMetrics.serverMemory, cpu: lastMetrics.cpu, running: true, timestamp: Date.now(), ...ctx.live });
        return;
      }
      consecutiveMisses = 0;
      const [memoryRaw, cpuTotalRaw] = String(r.stdout).trim().split('|');
      const memory = Number(memoryRaw), cpuTotal = Number(cpuTotalRaw);
      const now = Date.now();
      let cpu = 0;
      if (Number.isFinite(cpuTotal) && ctx.previousCpu && Number.isFinite(ctx.previousCpu.total)) {
        const deltaSeconds = (now - ctx.previousCpu.at) / 1000;
        if (deltaSeconds > 0) cpu = Math.max(0, Math.min(100, ((cpuTotal - ctx.previousCpu.total) / deltaSeconds / os.cpus().length) * 100));
      }
      if (Number.isFinite(cpuTotal)) ctx.previousCpu = { total: cpuTotal, at: now };
      if (memory > 20) lastMetrics.serverMemory = memory;
      if (Number.isFinite(cpu)) lastMetrics.cpu = Math.round(cpu);
      ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: memory > 20 ? memory : lastMetrics.serverMemory, cpu: Math.round(cpu), running: true, timestamp: now, ...ctx.live });
    } catch (err) {
      const used = process.memoryUsage().rss / 1024 / 1024;
      ctx.send('server:metrics', { appMemory: Math.round(used), serverMemory: lastMetrics.serverMemory, cpu: lastMetrics.cpu, running: true, timestamp: Date.now(), ...ctx.live });
    }
  }, 1000);
}

async function startServerInternal(ctx, settings) {
  if (ctx.serverStatus !== 'stopped') return { ok: false, error: ctx.serverStatus === 'starting' ? 'Server is already starting.' : ctx.serverStatus === 'stopping' ? 'Server is still stopping — wait for it to finish.' : 'Server is already running.' };
  if (ctx.buildProcess) return { ok: false, error: 'A build (BuildTools) is still running in this folder — wait for it to finish, check the Console tab.' };
  const error = validateStart(settings, ctx.javaInfo, serverFiles);
  if (error) return { ok: false, error };
  const info = serverFiles(settings.serverPath);
  if (!readEula(settings.serverPath)) {
    if (!settings.autoEula) return { ok: false, error: 'Accept the Minecraft EULA in Settings before starting.' };
    writeEula(settings.serverPath);
  }
  const software = detectSoftware(info);
  ctx.currentSoftware = software;
  const isProxy = software === 'proxy';
  const customArgs = String(settings.jvmArgs || '').trim()
    ? String(settings.jvmArgs).trim().match(/(?:[^\s"]+|"[^"]*")+/g).map(x => x.replace(/^"|"$/g, ''))
    : [`-Xms${settings.memoryMin || 2}G`, `-Xmx${settings.memoryMax || 6}G`];
  const args = isProxy ? [...customArgs, '-jar', info.jar] : [...customArgs, '-jar', info.jar, 'nogui'];
  ctx.appendLog(`Starting ${info.launchScript || info.jar} with ${ctx.javaInfo.path}…`, 'system');
  ctx.manualStop = false;

  if (info.launchScript) {
    const env = { ...process.env };
    if (customArgs.length) env.JAVA_TOOL_OPTIONS = customArgs.join(' ');
    if (info.launchScript.toLowerCase().endsWith('.sh')) {
      ctx.serverProcess = spawn('bash', [info.launchScript, 'nogui'], { cwd: settings.serverPath, env });
    } else {
      if (process.platform === 'win32') {
        ctx.serverProcess = spawn('cmd.exe', ['/d', '/c', info.launchScript, 'nogui'], { cwd: settings.serverPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false, env });
      } else {
        ctx.serverProcess = spawn('bash', [info.launchScript, 'nogui'], { cwd: settings.serverPath, stdio: ['pipe', 'pipe', 'pipe'], env });
      }
    }
  } else {
    ctx.serverProcess = spawn(ctx.javaInfo.path, args, { cwd: settings.serverPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });
  }

  try { if (!fs.existsSync(path.join(settings.serverPath, 'server.properties'))) ctx.appendLog('First start: server.properties does not exist yet — the "Failed to load properties" ERROR below is expected; the server creates the file on its own and continues.', 'system'); } catch {}

  ctx.monitoredPid = null;
  ctx.previousCpu = null;
  ctx.live = { tps: null, mspt: null, players: [] };
  ctx.send('server:live', ctx.live);
  waitingForDone = !isProxy;
  const startedProcess = ctx.serverProcess;

  ctx.serverProcess.on('error', err => {
    ctx.appendLog(`Could not launch the server process: ${err.message}`, 'error');
    if (ctx.serverProcess !== startedProcess) return;
    ctx.serverProcess = null;
    ctx.monitoredPid = null;
    ctx.previousCpu = null;
    waitingForDone = false;
    ctx.currentSoftware = null;
    clearInterval(ctx.autoPollTimer);
    clearTimeout(doneWatchdog);
    ctx.live = { tps: null, mspt: null, players: [] };
    ctx.setServerStatus('stopped');
    ctx.send('server:live', ctx.live);
    ctx.pushFiles();
  });

  const doneWatchdog = setTimeout(() => {
    if (waitingForDone && ctx.serverProcess === startedProcess) {
      waitingForDone = false;
      startAutoPoll(ctx, software);
      ctx.setServerStatus('running');
    }
  }, 15000);
  setTimeout(() => { if (ctx.serverProcess === startedProcess) ctx.restartAttempts = 0; }, 30000);

  ctx.serverProcess.stdout.on('data', d => {
    d.toString().split(/\r?\n/).filter(Boolean).forEach(x => {
      if (waitingForDone && /\bDone \([^)]*\)!/i.test(x)) {
        waitingForDone = false;
        clearTimeout(doneWatchdog);
        startAutoPoll(ctx, software);
        ctx.restartAttempts = 0;
        ctx.setServerStatus('running');
        ctx.pushFiles();
      }
      const isAutoPollStatus = Date.now() < ctx.suppressStatusUntil
        && Date.now() - ctx.lastManualCommandAt > 1200
        && /(players online|TPS from last|The game is running|Target tick rate:|Average time per tick:|Percentiles:|Mean tick time|Mean TPS|Dim \d+\s*:|Overall:)/i.test(x);
      if (!isAutoPollStatus) ctx.appendLog(x);
      parseServerLine(x, ctx.live, ctx.send);
    });
  });
  ctx.serverProcess.stderr.on('data', d => {
    d.toString().split(/\r?\n/).filter(Boolean).forEach(x => { ctx.appendLog(x, 'error'); parseServerLine(x, ctx.live, ctx.send); });
  });
  ctx.serverProcess.on('exit', (code, signal) => {
    if (!ctx.serverProcess) return;
    ctx.appendLog(`Server stopped (code ${code ?? 'none'}, ${signal || 'normal'}).`, 'system');
    const wasManual = ctx.manualStop;
    ctx.manualStop = false;
    ctx.serverProcess = null;
    ctx.monitoredPid = null;
    ctx.previousCpu = null;
    waitingForDone = false;
    ctx.currentSoftware = null;
    clearInterval(ctx.autoPollTimer);
    clearTimeout(doneWatchdog);
    ctx.live = { tps: null, mspt: null, players: [] };
    ctx.setServerStatus('stopped');
    ctx.send('server:live', ctx.live);
    ctx.pushFiles();
    const current = loadSettings();
    if (!wasManual && current.autoRestart && code !== 0) {
      const maxAttempts = Math.max(1, Number(current.autoRestartMaxAttempts) || 3);
      const delaySeconds = Math.max(1, Number(current.autoRestartDelaySeconds) || 5);
      if (ctx.restartAttempts >= maxAttempts) {
        ctx.appendLog(`Auto-restart stopped after ${maxAttempts} failed attempts in a row — check Console above for the real error before starting again.`, 'error');
        ctx.restartAttempts = 0;
      } else {
        ctx.restartAttempts++;
        ctx.appendLog(`Auto-restart is on — restarting server in ${delaySeconds}s… (attempt ${ctx.restartAttempts}/${maxAttempts})`, 'system');
        clearTimeout(ctx.restartTimer);
        ctx.restartTimer = setTimeout(() => { startServerInternal(ctx, current).catch(() => {}); }, delaySeconds * 1000);
      }
    } else if (!wasManual && current.autoRestart && code === 0) { ctx.restartAttempts = 0; }
  });

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
    ctx.serverProcess.stdin.write(command.trim() + '\r\n');
    ctx.lastManualCommandAt = Date.now();
    ctx.appendLog(`> ${command}`, 'command');
    return { ok: true };
  });
  ipcMain.handle('server:stop', async () => {
    if (ctx.serverStatus === 'stopped' || ctx.serverStatus === 'stopping') return { ok: false, error: ctx.serverStatus === 'stopping' ? 'Server is already stopping.' : 'Server is not running.' };
    if (!ctx.serverProcess) return { ok: false, error: 'Server is not running.' };
    ctx.manualStop = true;
    clearTimeout(ctx.restartTimer);
    ctx.setServerStatus('stopping');
    ctx.serverProcess.stdin.write('stop\r\n');
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

module.exports = { startServerInternal, forceStopServer, startAutoPoll, startMetrics, registerServer };
