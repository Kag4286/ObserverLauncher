// Server scheduler — auto start/stop/restart, pre-restart countdown announcements, and custom
// daily automation rules (backup / console command / lifecycle) per instance.
// Persistent last-fired bookkeeping in dataDir()/scheduler-state.json prevents double-firing
// across launcher restarts inside the 90-second fire window.
const fs = require('fs');
const path = require('path');
const { loadSettings, loadSettingsFor } = require('./settings.js');
const { startServerInternal, requestStop, sendConsoleCommand } = require('./server-lifecycle.js');
const { dataDir } = require('./data-dir.js');
const { writeFileAtomic } = require('./fs-utils.js');
const { isSafeConsoleCommand } = require('./validate.js');

const VALID_RULE_ACTIONS = new Set(['start', 'stop', 'restart', 'backup', 'command']);
const MAX_SCHEDULE_RULES = 20;
const NAME_TO_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Parse "HH:MM" -> {h, m} | null. Only 24h clock, strict 2-digit minute field.
function parseTime(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { h, m: mm };
}

// Local YYYY-MM-DD key for 'fired today' bookkeeping.
function dayKey(now) {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function normalizeDays(rawDays) {
  const arr = Array.isArray(rawDays) ? rawDays : [];
  return [...new Set(
    arr
      .map(d => typeof d === 'string' ? NAME_TO_NUM[d.toLowerCase().slice(0, 3)] : Number(d))
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
  )];
}

// Sanitize & validate user-configured automation rules (max 20 per instance). Pure.
function sanitizeScheduleRules(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seenIds = new Set();
  for (let i = 0; i < raw.length && out.length < MAX_SCHEDULE_RULES; i++) {
    const r = raw[i];
    if (!r || typeof r !== 'object') continue;
    const action = String(r.action || '').trim().toLowerCase();
    if (!VALID_RULE_ACTIONS.has(action)) continue;
    const time = String(r.time || '').trim();
    if (!parseTime(time)) continue;
    let command = '';
    if (action === 'command') {
      command = String(r.command || '').trim();
      if (!command || command.length > 500 || !isSafeConsoleCommand(command)) continue;
    }
    let id = String(r.id || `rule-${out.length + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `rule-${out.length + 1}`;
    while (seenIds.has(id)) id = `${id.slice(0, 34)}-${out.length + 1}`;
    seenIds.add(id);
    out.push({
      id,
      enabled: r.enabled !== false,
      time,
      days: normalizeDays(r.days),
      action,
      command,
    });
  }
  return out;
}

// Tolerance: fire if the scheduled minute was 0..90s ago. This catches the common case
// where the app starts a few seconds after the scheduled minute, while refusing to fire
// retroactively hours late (e.g. app opened at 14:00 with a 08:00 schedule).
const FIRE_WINDOW_MS = 90 * 1000;

// Pure decision function (no Electron, no ctx) so every time/edge case is unit-testable.
//   action      'start' | 'stop' | 'restart'
//   schedule    { enabled, startTime, stopTime, restartTime, days }
//   now         Date
//   lastFired   { start: 'YYYY-MM-DD'|null, stop: ..., restart: ... }
//   status      ctx.serverStatus ('stopped'|'starting'|'running'|'stopping')
//   opts        { backupInProgress } — stop/restart is skipped mid-backup (never cut a zip short)
function shouldFire(action, schedule, now, lastFired, status, opts = {}) {
  if (!schedule || !schedule.enabled) return false;
  const timeStr = action === 'start' ? schedule.startTime : (action === 'restart' ? schedule.restartTime : schedule.stopTime);
  const t = parseTime(timeStr);
  if (!t) return false; // empty/invalid time = this action is off
  const days = normalizeDays(schedule.days);
  if (days.length && !days.includes(now.getDay())) return false;
  // State gate: only start a stopped server, only stop/restart a running one.
  if (action === 'start' && status !== 'stopped') return false;
  if ((action === 'stop' || action === 'restart') && status !== 'running') return false;
  // Never interrupt an in-flight backup.
  if ((action === 'stop' || action === 'restart') && opts.backupInProgress) return false;
  // Window + once-per-day.
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.m, 0, 0);
  const delta = now.getTime() - target.getTime();
  if (delta < 0 || delta >= FIRE_WINDOW_MS) return false;
  if (lastFired && lastFired[action] === dayKey(now)) return false;
  return true;
}

// Pure decision function for a custom automation rule ({ id, enabled, time, days, action, command }).
function shouldFireRule(rule, now, lastFiredRules, status, opts = {}) {
  if (!rule || rule.enabled === false) return false;
  if (!VALID_RULE_ACTIONS.has(rule.action)) return false;
  const t = parseTime(rule.time);
  if (!t) return false;
  const days = normalizeDays(rule.days);
  if (days.length && !days.includes(now.getDay())) return false;

  if (rule.action === 'start' && status !== 'stopped') return false;
  if ((rule.action === 'stop' || rule.action === 'restart' || rule.action === 'command') && status !== 'running') return false;
  if ((rule.action === 'stop' || rule.action === 'restart' || rule.action === 'backup') && opts.backupInProgress) return false;
  if (rule.action === 'command' && (!rule.command || !isSafeConsoleCommand(rule.command))) return false;

  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.m, 0, 0);
  const delta = now.getTime() - target.getTime();
  if (delta < 0 || delta >= FIRE_WINDOW_MS) return false;
  if (lastFiredRules && lastFiredRules[rule.id] === dayKey(now)) return false;
  return true;
}

// Descending broadcast checkpoints for pre-stop / pre-restart warnings (e.g. 60 -> [60, 30, 10, 5]).
function countdownMilestones(totalSec) {
  const total = Math.min(600, Math.max(0, Math.trunc(Number(totalSec) || 0)));
  if (total <= 0) return [];
  const defaults = [300, 120, 60, 30, 10, 5];
  const points = defaults.filter(x => x <= total);
  if (!points.includes(total)) points.unshift(total);
  return [...new Set(points)].sort((a, b) => b - a);
}

function formatCountdownLabel(sec) {
  const n = Math.max(1, Math.trunc(Number(sec) || 0));
  if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
  return `${n}s`;
}

// Persistent per-instance last-fired store so restarting the app inside the 90s fire window
// does not double-fire a daily schedule or automation rule.
function defaultStateFile() {
  try { return path.join(dataDir(), 'scheduler-state.json'); } catch { return null; }
}

function loadSchedulerState(instId, filePath = defaultStateFile()) {
  const empty = { start: null, stop: null, restart: null, rules: {} };
  if (!filePath || !instId) return empty;
  try {
    if (!fs.existsSync(filePath)) return empty;
    const all = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const cur = all && typeof all === 'object' ? all[instId] : null;
    if (!cur || typeof cur !== 'object') return empty;
    return {
      start: typeof cur.start === 'string' ? cur.start : null,
      stop: typeof cur.stop === 'string' ? cur.stop : null,
      restart: typeof cur.restart === 'string' ? cur.restart : null,
      rules: cur.rules && typeof cur.rules === 'object' ? { ...cur.rules } : {},
    };
  } catch {
    return empty;
  }
}

function saveSchedulerState(instId, entry, filePath = defaultStateFile(), now = new Date()) {
  if (!filePath || !instId || !entry) return false;
  try {
    let all = {};
    if (fs.existsSync(filePath)) {
      try { all = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {}; } catch { all = {}; }
    }
    const rules = {};
    if (entry.rules && typeof entry.rules === 'object') {
      const refMs = now instanceof Date ? now.getTime() : Date.now();
      const cutoff = dayKey(new Date(refMs - 7 * 24 * 3600 * 1000));
      for (const [k, v] of Object.entries(entry.rules)) {
        if (typeof v === 'string' && v >= cutoff) rules[k] = v;
      }
    }
    all[instId] = {
      start: entry.start || null,
      stop: entry.stop || null,
      restart: entry.restart || null,
      rules,
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileAtomic(filePath, JSON.stringify(all, null, 2));
    return true;
  } catch {
    return false;
  }
}

// Stop gracefully via the shared server-lifecycle requestStop() path so adopted/RCON servers
// receive the stop command AND scheduleGracefulEscalation() terminates hung shutdowns.
async function stopServerInternal(ctx, restartSettings) {
  return await requestStop(ctx, restartSettings);
}

// Broadcast in-game countdown warnings via sendConsoleCommand before stopping/restarting.
// Skips the wait immediately if skipIfEmpty is true and 0 players are online.
async function runCountdownThen(ctx, opts = {}) {
  const action = opts.action === 'restart' ? 'restart' : 'stop';
  const countdownSec = Math.min(600, Math.max(0, Math.trunc(Number(opts.countdownSec) || 0)));
  const skipIfEmpty = opts.skipIfEmpty !== false;
  const onlinePlayers = Array.isArray(ctx.live?.players) ? ctx.live.players.length : 0;
  const sendCmd = opts.sendCmd || sendConsoleCommand;
  const stopFn = opts.stopFn || stopServerInternal;
  const wait = opts.wait || (ms => new Promise(r => setTimeout(r, ms)));
  const restartSettings = action === 'restart' ? (opts.settings || loadSettings()) : null;

  if (ctx._scheduledCountdownActive) return { ok: false, skipped: 'countdown-active' };

  const milestones = (countdownSec > 0 && !(skipIfEmpty && onlinePlayers === 0))
    ? countdownMilestones(countdownSec)
    : [];

  if (!milestones.length) {
    return await stopFn(ctx, restartSettings);
  }

  ctx._scheduledCountdownActive = true;
  const verb = action === 'restart' ? 'restarting' : 'stopping';
  try {
    for (let i = 0; i < milestones.length; i++) {
      if (ctx.serverStatus !== 'running') {
        return { ok: false, cancelled: true };
      }
      const cur = milestones[i];
      const next = i + 1 < milestones.length ? milestones[i + 1] : 0;
      const msg = `say [ObserverLauncher] Server ${verb} in ${formatCountdownLabel(cur)}!`;
      try { await sendCmd(ctx, msg); } catch {}
      try { ctx.appendLog && ctx.appendLog(`Scheduler: announced ${verb} in ${formatCountdownLabel(cur)}.`, 'system'); } catch {}
      const delayMs = Math.max(0, (cur - next) * 1000);
      if (delayMs > 0) await wait(delayMs);
    }
    if (ctx.serverStatus !== 'running' || ctx.backupInProgress) {
      return { ok: false, cancelled: true };
    }
    return await stopFn(ctx, restartSettings);
  } finally {
    ctx._scheduledCountdownActive = false;
  }
}

// Timer tick — separated from the interval so tests can call it with a fixed clock. `settings` is
// optional: when omitted it reads the ACTIVE instance (backward-compatible); when given it targets
// that instance's schedule (the per-instance loop passes it in).
async function schedulerTick(ctx, now = new Date(), settings, opts = {}) {
  const s = settings || loadSettings();
  const schedule = {
    enabled: !!s.scheduleEnabled,
    startTime: s.scheduleStartTime,
    stopTime: s.scheduleStopTime,
    restartTime: s.scheduleRestartTime,
    days: s.scheduleDays || [],
  };

  const instId = typeof ctx.inst === 'function' ? ctx.inst() : null;
  if (!ctx.schedulerLastFired) {
    ctx.schedulerLastFired = (opts.persist !== false && instId)
      ? loadSchedulerState(instId, opts.stateFile)
      : { start: null, stop: null, restart: null, rules: {} };
  } else {
    if (!ctx.schedulerLastFired.rules) ctx.schedulerLastFired.rules = {};
    if (opts.persist !== false && instId && !ctx._schedulerHydrated) {
      const saved = loadSchedulerState(instId, opts.stateFile);
      ctx.schedulerLastFired.start = ctx.schedulerLastFired.start || saved.start;
      ctx.schedulerLastFired.stop = ctx.schedulerLastFired.stop || saved.stop;
      ctx.schedulerLastFired.restart = ctx.schedulerLastFired.restart || saved.restart;
      ctx.schedulerLastFired.rules = { ...saved.rules, ...ctx.schedulerLastFired.rules };
      ctx._schedulerHydrated = true;
    }
  }

  let dirty = false;
  const today = dayKey(now);
  const countdownSec = Number.isFinite(Number(s.scheduleCountdownSec)) ? Number(s.scheduleCountdownSec) : 60;
  const skipIfEmpty = s.scheduleSkipCountdownIfEmpty !== false;

  if (shouldFire('start', schedule, now, ctx.schedulerLastFired, ctx.serverStatus, {})) {
    ctx.schedulerLastFired.start = today;
    dirty = true;
    ctx.appendLog('Scheduler: starting the server (scheduled time).', 'system');
    try { await startServerInternal(ctx, s); }
    catch (e) { ctx.appendLog(`Scheduler start failed: ${e?.message || e}`, 'error'); }
  }

  if (shouldFire('stop', schedule, now, ctx.schedulerLastFired, ctx.serverStatus, { backupInProgress: ctx.backupInProgress })) {
    ctx.schedulerLastFired.stop = today;
    dirty = true;
    ctx.appendLog('Scheduler: stopping the server (scheduled time).', 'system');
    runCountdownThen(ctx, { action: 'stop', countdownSec, skipIfEmpty, settings: s, wait: opts.wait, sendCmd: opts.sendCmd, stopFn: opts.stopFn })
      .catch(e => { try { ctx.appendLog(`Scheduler stop failed: ${e?.message || e}`, 'error'); } catch {} });
  }

  if (shouldFire('restart', schedule, now, ctx.schedulerLastFired, ctx.serverStatus, { backupInProgress: ctx.backupInProgress })) {
    ctx.schedulerLastFired.restart = today;
    dirty = true;
    ctx.appendLog('Scheduler: restarting the server (scheduled time).', 'system');
    runCountdownThen(ctx, { action: 'restart', countdownSec, skipIfEmpty, settings: s, wait: opts.wait, sendCmd: opts.sendCmd, stopFn: opts.stopFn })
      .catch(e => { try { ctx.appendLog(`Scheduler restart failed: ${e?.message || e}`, 'error'); } catch {} });
  }

  // v9.1.0 D1: evaluate custom automation rules when scheduler master toggle is enabled.
  if (schedule.enabled && Array.isArray(s.scheduleRules) && s.scheduleRules.length) {
    const rules = sanitizeScheduleRules(s.scheduleRules);
    for (const rule of rules) {
      if (!shouldFireRule(rule, now, ctx.schedulerLastFired.rules, ctx.serverStatus, { backupInProgress: ctx.backupInProgress })) continue;
      ctx.schedulerLastFired.rules[rule.id] = today;
      dirty = true;
      if (rule.action === 'backup') {
        ctx.appendLog(`Scheduler rule (${rule.time}): creating scheduled backup.`, 'system');
        try {
          const { createBackupInternal, pruneBackups } = require('./backups.js');
          const r = await createBackupInternal(ctx, { auto: true });
          if (r && r.ok) {
            ctx.lastAutoBackupAt = Date.now();
            pruneBackups(ctx, s.backupRetention);
            ctx.appendLog(`Scheduler backup created: ${r.name}`, 'system');
          }
        } catch (e) { ctx.appendLog(`Scheduler backup failed: ${e?.message || e}`, 'error'); }
      } else if (rule.action === 'command') {
        ctx.appendLog(`Scheduler rule (${rule.time}): running "${rule.command}".`, 'system');
        try { await (opts.sendCmd || sendConsoleCommand)(ctx, rule.command); }
        catch (e) { ctx.appendLog(`Scheduler command failed: ${e?.message || e}`, 'error'); }
      } else if (rule.action === 'start') {
        ctx.appendLog(`Scheduler rule (${rule.time}): starting server.`, 'system');
        try { await startServerInternal(ctx, s); }
        catch (e) { ctx.appendLog(`Scheduler start failed: ${e?.message || e}`, 'error'); }
      } else if (rule.action === 'stop' || rule.action === 'restart') {
        ctx.appendLog(`Scheduler rule (${rule.time}): ${rule.action} server.`, 'system');
        runCountdownThen(ctx, { action: rule.action, countdownSec, skipIfEmpty, settings: s, wait: opts.wait, sendCmd: opts.sendCmd, stopFn: opts.stopFn })
          .catch(e => { try { ctx.appendLog(`Scheduler ${rule.action} failed: ${e?.message || e}`, 'error'); } catch {} });
      }
    }
  }

  if (dirty && opts.persist !== false && instId) {
    saveSchedulerState(instId, ctx.schedulerLastFired, opts.stateFile, now);
  }
}

// v2.0.0: run the schedule for EVERY instance, not just the active one — a background server must
// still auto start/stop/run rules on its own schedule. Each tick runs inside ctx.runInInstance(id).
function startScheduler(ctx) {
  clearInterval(ctx.schedulerTimer);
  // 60s cadence matches startAutoBackupWatcher; the 90s fire window tolerates a missed tick.
  ctx.schedulerTimer = setInterval(() => {
    const now = new Date();
    const ids = ctx.instances ? [...ctx.instances.keys()] : [];
    if (!ids.length) ids.push(ctx.inst());
    for (const id of ids) {
      ctx.runInInstance(id, () => {
        let s;
        try { s = loadSettingsFor(id); } catch { return; }
        if (!s || !s.serverPath) return; // never schedule an instance with no server folder
        return schedulerTick(ctx, now, s).catch(() => {});
      });
    }
  }, 60 * 1000);
}

module.exports = {
  parseTime,
  dayKey,
  normalizeDays,
  VALID_RULE_ACTIONS,
  sanitizeScheduleRules,
  shouldFire,
  shouldFireRule,
  countdownMilestones,
  formatCountdownLabel,
  loadSchedulerState,
  saveSchedulerState,
  runCountdownThen,
  schedulerTick,
  startScheduler,
  stopServerInternal,
  FIRE_WINDOW_MS,
};
