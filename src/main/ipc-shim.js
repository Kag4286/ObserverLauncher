// ipc-shim.js — a fake `ipcMain` so the feature modules can register WITHOUT Electron.
//
// WHY (v3.0.0 Phase B2): every feature module takes `(ipcMain, ctx)` and calls
// `ipcMain.handle(channel, fn)`. In Electron that is the real IPC surface; headless (src/headless.js)
// has no renderer, but it still needs the SAME handlers so a CLI / MCP-over-headless can call them.
// This shim implements just the two methods the modules actually use (`handle`, `on`) plus an
// `invoke` to run a channel directly, so the backend API is exposed with zero rewrites.
//
// ALS PARITY: main.js wraps ipcMain in a Proxy that runs every handler inside
// ctx.runInInstance(ctx.activeInstanceId, ...) so per-instance ctx accessors resolve to the right
// instance and an instance switch mid-await cannot leak (M4b). The shim reproduces that EXACTLY —
// otherwise multi-instance state would bleed in headless mode.

function createIpcShim(ctx) {
  const handlers = new Map(); // channel -> fn
  const listeners = new Map(); // channel -> fn[] (registered via .on)

  // Minimal event object. Real handlers ignore it; it exists so a handler that touches
  // event.sender / event.reply does not crash headless.
  const fakeEvent = {
    sender: { send() {}, isDestroyed: () => true },
    reply() {},
    preventDefault() {},
  };

  const ipcMain = {
    // Same contract as Electron: registering the same channel twice is a programming error.
    handle(channel, fn) {
      if (typeof channel !== 'string' || !channel) throw new Error('ipc-shim: channel must be a non-empty string');
      if (typeof fn !== 'function') throw new Error('ipc-shim: handler must be a function');
      if (handlers.has(channel)) throw new Error(`ipc-shim: duplicate handler for channel "${channel}"`);
      // ALS parity with main.js's Proxy: pin the active instance at call time.
      handlers.set(channel, (event, ...args) => ctx.runInInstance(ctx.activeInstanceId, () => fn(event, ...args)));
    },
    on(channel, fn) {
      if (typeof channel !== 'string' || !channel) throw new Error('ipc-shim: channel must be a non-empty string');
      if (typeof fn !== 'function') throw new Error('ipc-shim: listener must be a function');
      const list = listeners.get(channel) || [];
      list.push(fn);
      listeners.set(channel, list);
    },
    // Present for API completeness / if a module ever removes a handler.
    removeHandler(channel) { handlers.delete(channel); },
    removeAllListeners(channel) { if (channel) listeners.delete(channel); else listeners.clear(); },
  };

  // Run a registered handler directly (the headless equivalent of ipcRenderer.invoke).
  // Unknown channel -> a clean {ok:false} (callers report it) rather than a throw, so a CLI can
  // print a helpful message instead of a stack trace.
  async function invoke(channel, ...args) {
    const fn = handlers.get(channel);
    if (!fn) return { ok: false, error: `ipc-shim: unknown channel "${channel}"` };
    try {
      return await fn(fakeEvent, ...args);
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // Fire every listener registered via .on (confirm responses, orphan prompts, ...).
  async function emit(channel, ...args) {
    const list = listeners.get(channel) || [];
    for (const fn of list) { try { await fn(fakeEvent, ...args); } catch {} }
  }

  function listChannels() { return [...handlers.keys()].sort(); }

  return { ipcMain, invoke, emit, listChannels };
}

module.exports = { createIpcShim };
