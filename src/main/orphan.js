// v2.0.0 M8: orphan cleanup after a crash. runtime.json (M3) records each instance's spawned
// pid + processStartedAt; platform.getProcessInfo (M1) reports whether that pid is still alive,
// its image name, and its real creation time. Three tiers, favour convenience but NEVER kill the
// wrong process (a recycled pid):
//   t1  pid alive + stored state 'stopped' + image is java  -> auto-kill (leftover from a crash)
//   t2  pid alive + stored state running/starting           -> ask the user (reconnect or stop)
//   t3  pid alive but NOT java (pid reuse)                  -> never kill, just clear the record
const path = require('path');

// Pure decision. `stored` = {pid, processStartedAt, serverPath, status?}; `procInfo` = the
// getProcessInfo result (null when the pid is gone). Returns {tier, action, reason}:
//   action: 'clear' (pid gone), 'kill' (t1), 'ask' (t2), 'forget' (t3)
function classifyOrphan(stored, procInfo, opts) {
  opts = opts || {};
  if (!stored || !stored.pid) return { tier: 0, action: 'clear', reason: 'no stored pid' };
  if (!procInfo || procInfo.alive !== true) return { tier: 0, action: 'clear', reason: 'process is gone' };
  // PID REUSE guard: a recycled pid has a different creation time. If we recorded a real start
  // time and it does not match, this is NOT our server -> never kill (t3).
  const recorded = Number(stored.processStartedAt);
  const actual = Number(procInfo.startTimeMs);
  if (Number.isFinite(recorded) && recorded > 0 && Number.isFinite(actual) && actual > 0
      && Math.abs(recorded - actual) > 2000) {
    return { tier: 3, action: 'forget', reason: `pid ${stored.pid} was reused by another process (start time differs)` };
  }
  const name = String(procInfo.name || '');
  const isJava = /java/i.test(name) || /java/i.test(path.basename(String(stored.serverPath || '')));
  if (!isJava) return { tier: 3, action: 'forget', reason: `pid ${stored.pid} is now "${name || 'unknown'}", not java` };
  const status = String(stored.status || opts.assumedStatus || 'stopped');
  if (status === 'running' || status === 'starting' || status === 'stopping') {
    return { tier: 2, action: 'ask', reason: `a java server (pid ${stored.pid}) is still running` };
  }
  return { tier: 1, action: 'kill', reason: `leftover java server (pid ${stored.pid}) from a crash` };
}

// Scan all recorded processes. `getInfo(pid)` defaults to platform.getProcessInfo. Returns an
// array of {instanceId, stored, tier, action, reason, procInfo}. Never throws.
async function scanOrphans(getInfo, storedMap) {
  if (typeof getInfo !== 'function') getInfo = (pid) => require('./platform').getProcessInfo(pid);
  const out = [];
  const list = storedMap || require('./runtime-state.js').listInstanceProcesses();
  for (const rec of list) {
    let info = null;
    try { info = await getInfo(rec.pid); } catch { info = null; }
    const stored = { pid: rec.pid, processStartedAt: rec.processStartedAt, serverPath: rec.serverPath, status: rec.status };
    out.push({ instanceId: rec.instanceId, stored, procInfo: info, ...classifyOrphan(stored, info) });
  }
  return out;
}

// Act on a scan result. 'clear'/'forget' always just drop the record. 'kill' (t1) terminates the
// process tree. 'ask' (t2) is left to the caller (a GUI dialog); this function does nothing for it.
// Returns the action taken. Never throws.
async function applyOrphanAction(result, deps) {
  deps = deps || {};
  const clear = deps.clearInstanceProcess || require('./runtime-state.js').clearInstanceProcess;
  const killTree = deps.killTree || require('./kill.js').killTree;
  try {
    if (result.action === 'clear' || result.action === 'forget') { clear(result.instanceId); return result.action; }
    if (result.action === 'kill') { killTree(result.stored.pid); clear(result.instanceId); return 'kill'; }
    return 'skip'; // 'ask' -> caller handles
  } catch { return 'error'; }
}

// Ask the user about a tier-2 orphan (a server that still looks running). Falls back to 'reconnect'
// when no GUI bridge is wired (tests / headless). Never throws.
async function askReconnectOrStop(ctx, r, deps) {
  const prompt = (deps && deps.prompt) || ctx.onOrphanPrompt;
  const name = (() => { try { return (require('./settings.js').listInstances().instances.find(i => i.id === r.instanceId) || {}).name || r.instanceId; } catch { return r.instanceId; } })();
  if (typeof prompt !== 'function') return 'reconnect';
  return await new Promise(resolve => {
    let done = false;
    const finish = a => { if (!done) { done = true; resolve(a === 'stop' ? 'stop' : 'reconnect'); } };
    try { prompt({ instanceId: r.instanceId, name, pid: r.stored.pid, serverPath: r.stored.serverPath, reason: r.reason }, finish); }
    catch { finish('reconnect'); }
  });
}

// Boot-time cleanup. t1 (leftover java from a crash) is auto-killed + logged. t3 records are just
// dropped. t2 (a server that still looks running) asks the user via a GUI dialog: Reconnect keeps
// it (record stays, so a later stop can still find it) or Stop gracefully ends it. Never throws.
async function runOrphanCleanup(ctx, deps) {
  deps = deps || {};
  const log = (m, type) => { try { ctx.appendLog(m, type || 'system'); } catch {} };
  let results = [];
  try { results = await scanOrphans(deps.getInfo, deps.storedMap); } catch { return []; }
  for (const r of results) {
    if (r.action === 'clear') { await applyOrphanAction(r, deps); }
    else if (r.action === 'forget') { log(`Orphan cleanup: ${r.reason} — clearing the stale record.`, 'system'); await applyOrphanAction(r, deps); }
    else if (r.action === 'kill') { log(`Orphan cleanup: killing ${r.reason}.`, 'system'); await applyOrphanAction(r, deps); }
    else if (r.action === 'ask') {
      const choice = await askReconnectOrStop(ctx, r, deps);
      if (choice === 'stop') {
        log(`Orphan cleanup: user chose to STOP ${r.reason}.`, 'system');
        await applyOrphanAction({ ...r, action: 'kill' }, deps);
      } else {
        // Full re-attach: adopt the live pid so console (RCON), metrics and stop work again.
        const adopt = deps.adopt || (async (c, stored) => {
          try { return await ctx.runInInstance(r.instanceId, () => require('./server-lifecycle.js').adoptProcess(c, stored, deps)); }
          catch (e) { return { ok: false, error: e?.message || String(e) }; }
        });
        const res = await adopt(ctx, r.stored);
        if (res && res.ok) log(`Orphan cleanup: reconnected to ${r.reason} (pid ${r.stored.pid}).`, 'system');
        else log(`Orphan cleanup: could not reconnect to ${r.reason} — ${res && res.error}. Record kept.`, 'system');
      }
    }
  }
  return results;
}

module.exports = { classifyOrphan, scanOrphans, applyOrphanAction, runOrphanCleanup, askReconnectOrStop };
