const fs = require('fs');
const { execFile } = require('child_process');

function withTimeout(ms) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms); return { signal: controller.signal, cancel: () => clearTimeout(timer) }; }
async function json(url) {
  const { signal, cancel } = withTimeout(15000);
  try {
    const r = await fetch(url, { signal, headers: { 'User-Agent': 'ObserverLauncher/0.2 (local Minecraft server launcher)', 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (error) { throw error.name === 'AbortError' ? new Error('Request timed out after 15s — check your internet connection.') : error; }
  finally { cancel(); }
}
async function download(url, destination, onProgress) {
  const { signal, cancel } = withTimeout(300000);
  const tmp = `${destination}.download-${process.pid}-${Date.now()}.tmp`;
  try {
    const r = await fetch(url, { redirect: 'follow', signal, headers: { 'User-Agent': 'ObserverLauncher/0.2' } });
    if (!r.ok) throw new Error(`Download failed: ${r.status} ${r.statusText}`);
    const total = Number(r.headers.get('content-length')) || 0;
    // FEATURE: stream to a temp file and report bytes as they arrive, instead of buffering the whole
    // response in memory with r.arrayBuffer() and only finding out it's done when it's already done.
    // Server jars/installers can be 40-80MB+, so on a slow connection the wizard used to just say
    // "Downloading…" with zero feedback for a minute or more — no way to tell a slow download from a
    // hung one. Falls back to the old buffered path if the runtime's fetch doesn't expose a readable
    // stream body (defensive; Electron's fetch always does).
    let received = 0;
    if (r.body && typeof r.body.getReader === 'function') {
      const reader = r.body.getReader();
      const fileHandle = fs.openSync(tmp, 'w');
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fs.writeSync(fileHandle, value);
          received += value.length;
          if (onProgress) onProgress(received, total);
        }
      } finally { fs.closeSync(fileHandle); }
    } else {
      const buffer = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(tmp, buffer);
      received = buffer.length;
      if (onProgress) onProgress(received, total || received);
    }
    fs.renameSync(tmp, destination);
    return received;
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw error.name === 'AbortError' ? new Error('Download timed out after 5 minutes — check your internet connection.') : error;
  } finally { cancel(); }
}
function marketplaceError(error) { return { ok: false, error: error?.message || 'Marketplace request failed. Check your connection.' }; }
function psQuote(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function runPowerShell(command, timeoutMs = 30000) {
  const tryPs = (exe, cb) => execFile(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true, timeout: timeoutMs }, (error, stdout, stderr) => {
    if (!error) return cb({ ok: true, error: null, stdout });
    const msg = stderr || error.message || '';
    // Fallback to pwsh (PowerShell 7) if powershell.exe missing or blocked
    if (exe === 'powershell.exe' && /not recognized|cannot find|ENOENT/i.test(msg)) {
      execFile('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: timeoutMs }, (e2, out2, err2) => {
        if (!e2) return cb({ ok: true, error: null, stdout: out2 });
        return cb({ ok: false, error: e2.killed ? `PowerShell command timed out after ${Math.round(timeoutMs/1000)}s.` : (err2 || e2.message), stdout: out2 });
      });
    } else {
      cb({ ok: !error, error: error ? (error.killed ? `PowerShell command timed out after ${Math.round(timeoutMs/1000)}s.` : (stderr || error.message)) : null, stdout });
    }
  });
  return new Promise(resolve => tryPs('powershell.exe', resolve));
}
module.exports = { withTimeout, json, download, marketplaceError, psQuote, runPowerShell };
