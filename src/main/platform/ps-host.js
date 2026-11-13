// 2.4.0 (perf): a SINGLE long-lived PowerShell process instead of spawning a new one per second.
//
// WHY: the metrics sampler runs every second and each tick used to spawn `powershell.exe`
// (Windows PowerShell 5.1 startup ~50-120ms CPU + a console-window host). That is what showed up
// as ~17% CPU + extra "Console Window Host"/"Windows PowerShell" processes even when the server was
// idle. One persistent host runs the same cmdlets but pays the startup cost ONCE.
//
// 8.1.1 (ultra-low RAM): PowerShell 5.1 (.NET CLR) holds ~45-55 MB RAM while alive. Auto-shut it
// down after IDLE_TTL_MS (15s) of inactivity or immediately via idleStop() when all servers stop,
// while transparently respawning on the next run() call.
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IDLE_TTL_MS = 15000;

const REPL = '[System.Threading.Thread]::CurrentThread.CurrentCulture=[cultureinfo]::InvariantCulture; $ProgressPreference="SilentlyContinue"; while($true){ $l=[Console]::In.ReadLine(); if($l -eq $null){break}; $m=""; try{ $j=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($l)) | ConvertFrom-Json; $m=$j.m; Invoke-Expression $j.s }catch{ Write-Output ("#ERR#"+$_.Exception.Message) }; if($m){ Write-Output $m } }';

let child = null;
let buf = '';
let pending = null;        // the command currently running
let queue = [];            // commands waiting for the host to be free
let seq = 0;
let disposed = false;
let idleTimer = null;

function clearIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

function touchIdle() {
  clearIdleTimer();
  if (!child || pending || queue.length || disposed) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!pending && !queue.length) idleStop();
  }, IDLE_TTL_MS);
  if (idleTimer.unref) idleTimer.unref();
}

function start() {
  if (child) return child;
  clearIdleTimer();
  child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', REPL], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', onData);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', () => {}); // drain; cmdlet errors also surface on stdout
  const fail = () => {
    clearIdleTimer();
    const p = pending; const q = queue; child = null; pending = null; queue = []; buf = '';
    const err = new Error('ps-host exited');
    if (p) { clearTimeout(p.timer); try { p.reject(err); } catch {} }
    for (const c of q) { clearTimeout(c.queueTimer); clearTimeout(c.timer); try { c.reject(err); } catch {} }
  };
  child.on('exit', fail);
  child.on('error', fail);
  return child;
}

// Send the next queued command to the host (called when pending clears).
function pump() {
  if (pending || !queue.length || disposed) {
    touchIdle();
    return;
  }
  clearIdleTimer();
  const c = start();
  const item = queue.shift();
  pending = item;
  clearTimeout(item.queueTimer);
  item.timer = setTimeout(() => {
    if (pending && pending.marker === item.marker) { pending = null; try { item.reject(new Error('ps-host timeout')); } catch {} pump(); }
  }, item.timeoutMs || 8000);
  const b64 = Buffer.from(JSON.stringify({ s: item.script, m: item.marker }), 'utf8').toString('base64');
  try { c.stdin.write(b64 + '\n'); }
  catch (e) { clearTimeout(item.timer); pending = null; try { item.reject(e); } catch {} pump(); }
}

function onData(chunk) {
  buf += chunk;
  if (!pending) {
    if (buf.length > 8192) buf = buf.slice(-4096); // bound startup noise
    return;
  }
  const idx = buf.indexOf(pending.marker);
  if (idx === -1) return;
  pending.out += buf.slice(0, idx);
  const rest = buf.slice(idx + pending.marker.length);
  buf = '';
  const p = pending;
  pending = null;
  clearTimeout(p.timer);
  try { p.resolve(p.out.replace(/\r?\n$/, '')); } catch {}
  if (rest) onData(rest);
  pump();
}

// Run a PowerShell script and resolve with its stdout (string). Rejects on timeout / host death.
// Callers that get a rejection fall back to the one-shot runPowerShell, so behaviour never regresses.
function run(script, timeoutMs = 8000) {
  if (disposed || !IS_WIN) return Promise.reject(new Error('ps-host unavailable'));
  clearIdleTimer();
  return new Promise((resolve, reject) => {
    const marker = `__OL_PS_${process.pid}_${Date.now()}_${seq++}__`;
    const item = { script, marker, resolve, reject, timer: null, queueTimer: null, timeoutMs, out: '' };
    queue.push(item);
    // If it stays queued longer than timeoutMs, fail it (host busy / dead).
    item.queueTimer = setTimeout(() => {
      if (item.timer) return; // already running
      const i = queue.indexOf(item);
      if (i >= 0) { queue.splice(i, 1); try { reject(new Error('ps-host timeout (queued)')); } catch {} touchIdle(); }
    }, timeoutMs);
    if (!pending) { if (!child) start(); pump(); }
  });
}

// Stop the background PowerShell process when idle (frees ~45-50 MB RAM without disabling future run() calls).
function idleStop() {
  clearIdleTimer();
  if (!child || pending || queue.length) return false;
  const c = child;
  child = null;
  buf = '';
  try { c.removeAllListeners(); } catch {}
  try { if (c.stdin) c.stdin.end(); } catch {}
  try { c.kill(); } catch {}
  return true;
}

function dispose() {
  disposed = true;
  clearIdleTimer();
  const err = new Error('ps-host disposed');
  if (pending) { clearTimeout(pending.timer); try { pending.reject(err); } catch {} }
  for (const c of queue) { clearTimeout(c.queueTimer); clearTimeout(c.timer); try { c.reject(err); } catch {} }
  queue = [];
  pending = null;
  const c = child;
  child = null;
  buf = '';
  try { if (c) { c.removeAllListeners(); c.kill(); } } catch {}
}

module.exports = { run, dispose, idleStop, IS_WIN, IDLE_TTL_MS, _hasChild: () => !!child };
