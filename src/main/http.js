const fs = require('fs');
const { execFile } = require('child_process');

function withTimeout(ms) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms); return { signal: controller.signal, cancel: () => clearTimeout(timer) }; }
async function jsonAttempt(url, extraHeaders, method, body, timeoutMs) {
  const { signal, cancel } = withTimeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : 25000);
  try {
    const headers = { 'User-Agent': 'ObserverLauncher/0.2 (local Minecraft server launcher)', 'Accept': 'application/json', ...(extraHeaders || {}) };
    const opts = { signal, headers };
    if (method && method !== 'GET') { opts.method = method; if (body != null) { opts.body = body; if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'; } }
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (error) { throw error.name === 'AbortError' ? new Error('Request timed out — check your internet connection.') : error; }
  finally { cancel(); }
}
// 2.5.0: registry APIs (Modrinth especially) intermittently fail with a transient network error
// (observed live: 2/5 calls 'fetch failed'). A GET is safe to retry; a POST (CurseForge file-id
// lookup) is NOT retried blindly. Retries are short + few so a genuinely-down API still fails fast.
async function json(url, extraHeaders, method, body, timeoutMs) {
  const isGet = !method || method === 'GET';
  const attempts = isGet ? 3 : 1;
  const backoff = [400, 1200];
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try { return await jsonAttempt(url, extraHeaders, method, body, timeoutMs); }
    catch (error) {
      lastError = error;
      // A 4xx is a real answer (not found / bad request) - never retry it. Only retry network/
      // timeout/5xx style failures.
      const msg = String(error && error.message || '');
      const retryable = !/^\s*4\d\d\b/.test(msg);
      if (!isGet || !retryable || i === attempts - 1) throw error;
      await new Promise(r => setTimeout(r, backoff[i] || 1200));
    }
  }
  throw lastError;
}
// BUGFIX (downloads died on a brief network hiccup): the old download used ONE fetch with a
// hard 5-minute total timeout. On a slow link a perfectly healthy 80MB jar could be aborted
// mid-download because the wall clock ran out, and a single dropped packet killed the whole
// transfer with no retry. Now: (1) the timeout is STALL-based — the clock only fires after
// `stallMs` with NO bytes received, so a slow-but-alive download is never killed; (2) a failed
// attempt is retried up to `attempts` times with a short backoff before giving up.
// One resumable download attempt. `partPath` is a STABLE path (not per-attempt) so bytes that
// already arrived survive a retry: we send `Range: bytes=<have>-` and append from there. Servers
// that don't support ranges reply 200 (full body) instead of 206 — then we restart that file.
async function downloadAttempt(url, partPath, onProgress, stallMs, externalSignal, maxBytes) {
  let have = 0;
  try { have = fs.statSync(partPath).size; } catch { have = 0; }
  // Disk-fill guard: a resumed part that is already past the cap is refused up front.
  if (maxBytes && have > maxBytes) throw new Error(`Download exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
  const controller = new AbortController();
  // Cancellation: if an external signal aborts (user pressed Cancel), abort our controller too.
  let cancelled = false;
  const onExternalAbort = () => { cancelled = true; controller.abort(); };
  if (externalSignal) {
    if (externalSignal.aborted) { cancelled = true; controller.abort(); }
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  let stallTimer = null;
  const bump = () => { if (stallTimer) clearTimeout(stallTimer); stallTimer = setTimeout(() => controller.abort(), stallMs); };
  try {
    const headers = { 'User-Agent': 'ObserverLauncher/0.2' };
    if (have > 0) headers['Range'] = `bytes=${have}-`;
    bump();
    const r = await fetch(url, { redirect: 'follow', signal: controller.signal, headers });
    if (!r.ok && r.status !== 206) {
      // 416 = our partial is already the whole file (or stale) — caller validates the final size.
      if (r.status === 416) return { done: true };
      throw new Error(`Download failed: ${r.status} ${r.statusText}`);
    }
    // If we asked for a range but the server ignored it (200), the body is the FULL file:
    // truncate our partial and start from zero so we don't append the whole thing twice.
    const resumed = have > 0 && r.status === 206;
    if (have > 0 && !resumed) have = 0;
    const total = (Number(r.headers.get('content-length')) || 0) + have;
    let received = have;
    const fileHandle = fs.openSync(partPath, resumed ? 'a' : 'w');
    try {
      if (r.body && typeof r.body.getReader === 'function') {
        const reader = r.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bump(); // progress → reset the stall watchdog
          received += value.length;
          if (maxBytes && received > maxBytes) throw new Error(`Download exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
          fs.writeSync(fileHandle, value);
          if (onProgress) onProgress(received, total);
        }
      } else {
        const buffer = Buffer.from(await r.arrayBuffer());
        received += buffer.length;
        if (maxBytes && received > maxBytes) throw new Error(`Download exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
        fs.writeSync(fileHandle, buffer);
        if (onProgress) onProgress(received, total || received);
      }
    } finally { fs.closeSync(fileHandle); }
    return { done: true, received, total };
  } catch (error) {
    // NOTE: the .part file is intentionally KEPT so the next attempt can resume.
    if (cancelled) throw new Error('Download cancelled.');
    if (error.name === 'AbortError') throw new Error(`Download stalled — no data received for ${Math.round(stallMs / 1000)}s. Check your internet connection.`);
    throw error;
  } finally { clearTimeout(stallTimer); if (externalSignal) try { externalSignal.removeEventListener('abort', onExternalAbort); } catch {} }
}

// Concurrent-download guard: two downloads targeting the SAME destination would race on the same
// `<dest>.part` file (interleaved writes → corrupt file, and one rename yanks it out from under
// the other). Refuse a second in-flight download to the same destination.
const ACTIVE_DOWNLOADS = new Set();

async function download(url, destination, onProgress, externalSignal, opts) {
  // Default cap 2 GB — generous for any Minecraft server jar/modpack but stops a runaway/hostile
  // download from filling the disk. Callers may override with opts.maxBytes.
  const maxBytes = (opts && Number(opts.maxBytes)) || 2 * 1024 * 1024 * 1024;
  const attempts = 4;
  const stallMs = 30000;
  const backoff = [1000, 3000, 6000];
  const partPath = `${destination}.part`;
  const key = partPath;
  if (ACTIVE_DOWNLOADS.has(key)) throw new Error('A download to this file is already in progress.');
  ACTIVE_DOWNLOADS.add(key);
  let lastError;
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await downloadAttempt(url, partPath, onProgress, stallMs, externalSignal, maxBytes);
        // Success — move the finished part into place.
        try { fs.rmSync(destination, { force: true }); } catch {}
        fs.renameSync(partPath, destination);
        return fs.statSync(destination).size;
      } catch (error) {
        lastError = error;
        // A size-cap violation and a cancel are NOT retryable — do not loop on them.
        if (/exceeds the .* MB limit/.test(error?.message || '')) { try { fs.rmSync(partPath, { force: true }); } catch {} throw error; }
        if (externalSignal && externalSignal.aborted) throw error;
        if (attempt < attempts) {
          // Keep the partial and let the next attempt resume — do NOT reset progress to 0.
          await new Promise(r => setTimeout(r, backoff[attempt - 1] || 6000));
        }
      }
    }
    // All attempts failed — leave the .part file so a future retry can still resume it.
    throw lastError;
  } finally { ACTIVE_DOWNLOADS.delete(key); }
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
