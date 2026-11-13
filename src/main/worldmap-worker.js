// Worker Thread host/runner for heavy World Map region/NBT/LZ4 operations.
// Running scanExploredChunks and readBiomes in a dedicated worker keeps Main's V8 heap
// small (~60-80 MB) and prevents large region parses from blocking the main event loop.
// The worker spawns lazily on demand and auto-terminates when idle or cleared.
const { Worker, isMainThread, parentPort } = require('worker_threads');

const DEFAULT_IDLE_TTL_MS = 20000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;

if (!isMainThread) {
  const worldmap = require('./worldmap.js');

  parentPort.on('message', async (msg) => {
    const { id, op, args } = msg || {};
    try {
      let result;
      if (op === 'scanExploredChunks') {
        const set = worldmap.scanExploredChunks(...(args || []));
        result = { chunks: [...set], truncated: set.size >= 200000 };
      } else if (op === 'readBiomes') {
        result = await worldmap.readBiomes(...(args || []));
      } else if (op === 'clearBiomeCaches') {
        worldmap.clearBiomeCaches();
        result = { cleared: true };
      } else {
        throw new Error(`Unknown worldmap worker operation: ${op}`);
      }
      parentPort.postMessage({ id, ok: true, result });
    } catch (err) {
      parentPort.postMessage({ id, ok: false, error: err?.message || String(err) });
    }
  });
}

function createWorldmapWorkerClient(options = {}) {
  const idleTtlMs = Number(options.idleTtlMs) > 0 ? Number(options.idleTtlMs) : DEFAULT_IDLE_TTL_MS;
  const requestTimeoutMs = Number(options.requestTimeoutMs) > 0 ? Number(options.requestTimeoutMs) : DEFAULT_REQUEST_TIMEOUT_MS;

  let worker = null;
  let nextId = 1;
  let idleTimer = null;
  const pending = new Map();

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdleTimer() {
    clearIdleTimer();
    if (!worker || pending.size > 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (pending.size === 0) terminate().catch(() => {});
    }, idleTtlMs);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();
  }

  function rejectPendingForWorker(targetWorker, message) {
    for (const [id, entry] of pending.entries()) {
      if (targetWorker && entry.worker !== targetWorker) continue;
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(new Error(message));
    }
  }

  function ensureWorker() {
    if (worker) return worker;
    const w = new Worker(__filename);
    w.on('message', (msg) => {
      if (!msg || typeof msg.id === 'undefined') return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if (pending.size === 0 && worker === w) {
        if (typeof w.unref === 'function') w.unref();
        scheduleIdleTimer();
      }
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error || 'World map worker operation failed.'));
    });
    w.on('error', (err) => {
      if (worker === w) {
        worker = null;
        clearIdleTimer();
      }
      rejectPendingForWorker(w, err?.message || 'World map worker crashed.');
    });
    w.on('exit', (code) => {
      if (worker === w) {
        worker = null;
        clearIdleTimer();
      }
      rejectPendingForWorker(w, `World map worker exited (code ${code}).`);
    });
    worker = w;
    return w;
  }

  function callWorker(op, args) {
    clearIdleTimer();
    const w = ensureWorker();
    // Keep the event loop ref'd while work is actively in-flight, then unref when idle.
    if (typeof w.ref === 'function') w.ref();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`World map worker timed out (${op}).`));
        if (pending.size === 0 && worker === w) {
          if (typeof w.unref === 'function') w.unref();
          scheduleIdleTimer();
        }
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer, worker: w });
      try {
        w.postMessage({ id, op, args });
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  }

  async function terminate() {
    clearIdleTimer();
    const w = worker;
    worker = null;
    rejectPendingForWorker(w, 'World map worker terminated.');
    if (!w) return;
    try { await w.terminate(); } catch {}
  }

  return {
    scanExploredChunks: (serverPath, levelName, dim) => callWorker('scanExploredChunks', [serverPath, levelName, dim]),
    readBiomes: (serverPath, levelName, dim, opts) => callWorker('readBiomes', [serverPath, levelName, dim, opts]),
    clearBiomeCaches: () => terminate(),
    terminate,
    isAlive: () => worker !== null
  };
}

const defaultClient = isMainThread ? createWorldmapWorkerClient() : null;

module.exports = {
  createWorldmapWorkerClient,
  scanExploredChunks: (...args) => defaultClient.scanExploredChunks(...args),
  readBiomes: (...args) => defaultClient.readBiomes(...args),
  clearBiomeCaches: () => defaultClient.clearBiomeCaches(),
  terminate: () => defaultClient.terminate(),
  isAlive: () => defaultClient.isAlive()
};
