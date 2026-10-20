const fs = require('fs');
const { execFile } = require('child_process');

function withTimeout(ms) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms); return { signal: controller.signal, cancel: () => clearTimeout(timer) }; }
async function jsonAttempt(url, extraHeaders, method, body, timeoutMs) {
  // 6.0.1: the default was 25 s. A registry that stopped answering turned the Marketplace into
  // an endless spinner: the timeout fired, the GET was retried, and the user waited 25 s three
  // times over before seeing an error. 15 s is still generous for a JSON call, and a timeout is
  // no longer retried (see json()), so a hung registry now reports itself in one wait.
  const { signal, cancel } = withTimeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : 15000);
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
      // A TIMEOUT is not retried: the server did not answer at all, so trying again just
      // multiplies the wait the user is already sitting through (25 s x 3 was over a minute of
      // "Searching..." before the error appeared).
      const timedOut = /timed out/i.test(msg);
      const retryable = !timedOut && !/^\s*4\d\d\b/.test(msg);
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
      // H2: tag the HTTP status so download() can tell a permanent failure (403/404) from a
      // transient one (5xx, 408, 429) and only retry the transient kind.
      const err = new Error(`Download failed: ${r.status} ${r.statusText}`);
      err.status = r.status;
      throw err;
    }
    // If we asked for a range but the server ignored it (200), the body is the FULL file:
    // truncate our partial and start from zero so we don't append the whole thing twice.
    const resumed = have > 0 && r.status === 206;
    if (have > 0 && !resumed) have = 0;
    const clHeader = r.headers.get('content-length');
    const contentLengthKnown = clHeader != null && Number.isFinite(Number(clHeader));
    const total = (contentLengthKnown ? Number(clHeader) : 0) + have;
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
    // H2: verify the final size against content-length when the server declared one. A short read
    // that ended cleanly (server said N bytes, sent fewer, closed) would otherwise be kept as a
    // corrupt file. Tagged retryable so download() resumes from the partial.
    if (contentLengthKnown && total > 0 && received !== total) {
      const err = new Error(`Download incomplete: got ${received} of ${total} bytes.`);
      err.retryable = true;
      throw err;
    }
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
        // H2: fail fast on a PERMANENT HTTP failure. A 4xx (except 408 Request Timeout and 429 Too
        // Many Requests) will not change on retry, so retrying only wastes the backoff. Keep the
        // .part file only on a transient failure so the next attempt can resume it.
        const st = Number(error && error.status);
        const permanent = Number.isFinite(st) && st >= 400 && st < 500 && st !== 408 && st !== 429;
        if (permanent) { try { fs.rmSync(partPath, { force: true }); } catch {} throw error; }
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
