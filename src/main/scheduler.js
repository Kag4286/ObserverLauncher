// Server scheduler — auto start/stop on a daily time window (extracted concern, like
// backups.js::startAutoBackupWatcher). Settings are global (one active server), so no
// per-folder state and no ServerSession is needed: the timer reads loadSettings() each
// tick and acts on ctx.
//
// Model: a single daily window — optional startTime and/or stopTime ("HH:MM"), on a set
// of weekdays (empty = every day). Deliberately NOT a cron engine / multi-schedule.
const { loadSettings } = require('./settings.js');
const { startServerInternal } = require('./server-lifecycle.js');

// Parse "HH:MM" -> {h, m} | null. Only 24h clock, strict 2-digit fields.
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

// Tolerance: fire if the scheduled minute was 0..90s ago. This catches the common case
// where the app starts a few seconds after the scheduled minute, while refusing to fire
// retroactively hours late (e.g. app opened at 14:00 with a 08:00 schedule).
const FIRE_WINDOW_MS = 90 * 1000;

// Pure decision function (no Electron, no ctx) so every time/edge case is unit-testable.
//   action      'start' | 'stop'
//   schedule    { enabled, startTime, stopTime, days }
//   now         Date
//   lastFired   { start: 'YYYY-MM-DD'|null, stop: ... }
//   status      ctx.serverStatus ('stopped'|'starting'|'running'|'stopping')
//   opts        { backupInProgress } — stop is skipped mid-backup (never cut a zip short)
function shouldFire(action, schedule, now, lastFired, status, opts = {}) {
  if (!schedule || !schedule.enabled) return false;
  const timeStr = action === 'start' ? schedule.startTime : schedule.stopTime;
  const t = parseTime(timeStr);
  if (!t) return false; // empty/invalid time = this action is off
  // Weekday gate: empty days array = every day. Accept BOTH numbers (0=Sun..6=Sat, what the GUI
  // stores) and short names ('mon'..'sun', what a hand-written/older config or an MCP caller might
  // supply) so a schedule can never silently never-fire because of a type mismatch.
  const NAME_TO_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const rawDays = Array.isArray(schedule.days) ? schedule.days : [];
  const days = rawDays.map(d => typeof d === 'string' ? NAME_TO_NUM[d.toLowerCase().slice(0, 3)] : Number(d)).filter(n => Number.isInteger(n));
  if (days.length && !days.includes(now.getDay())) return false;
  // State gate: only start a stopped server, only stop a running one. Mid-start/mid-stop
  // is deliberately left alone (do not fight a transition already in progress).
  if (action === 'start' && status !== 'stopped') return false;
  if (action === 'stop' && status !== 'running') return false;
  // Never interrupt an in-flight backup.
  if (action === 'stop' && opts.backupInProgress) return false;
  // Window + once-per-day.
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.m, 0, 0);
  const delta = now.getTime() - target.getTime();
  if (delta < 0 || delta >= FIRE_WINDOW_MS) return false;
  if (lastFired && lastFired[action] === dayKey(now)) return false;
  return true;
}

// Stop gracefully exactly like server:stop does (stdin 'stop' + manualStop so the exit
// handler won't auto-restart). Mirrors registerServer's handler without going through IPC.
function stopServerInternal(ctx) {
  if (ctx.serverStatus === 'stopped' || ctx.serverStatus === 'stopping') return { ok: false, error: 'Server is not running.' };
  if (!ctx.serverProcess) return { ok: false, error: 'Server is not running.' };
  ctx.manualStop = true;
  clearTimeout(ctx.restartTimer);
  ctx.setServerStatus('stopping');
  try { ctx.serverProcess.stdin.write('stop\r\n'); } catch {}
  return { ok: true };
}

// Timer tick — separated from the interval so tests can call it with a fixed clock.
async function schedulerTick(ctx, now = new Date()) {
  const s = loadSettings();
  const schedule = { enabled: !!s.scheduleEnabled, startTime: s.scheduleStartTime, stopTime: s.scheduleStopTime, days: s.scheduleDays || [] };
  ctx.schedulerLastFired = ctx.schedulerLastFired || { start: null, stop: null };

  if (shouldFire('start', schedule, now, ctx.schedulerLastFired, ctx.serverStatus, {})) {
    ctx.schedulerLastFired.start = dayKey(now);
    ctx.appendLog('Scheduler: starting the server (scheduled time).', 'system');
    try { await startServerInternal(ctx, s); }
    catch (e) { ctx.appendLog(`Scheduler start failed: ${e?.message || e}`, 'error'); }
  }

  if (shouldFire('stop', schedule, now, ctx.schedulerLastFired, ctx.serverStatus, { backupInProgress: ctx.backupInProgress })) {
    ctx.schedulerLastFired.stop = dayKey(now);
    ctx.appendLog('Scheduler: stopping the server (scheduled time).', 'system');
    stopServerInternal(ctx);
  }
}

function startScheduler(ctx) {
  clearInterval(ctx.schedulerTimer);
  // 60s cadence matches startAutoBackupWatcher; the 90s fire window tolerates a missed tick.
  ctx.schedulerTimer = setInterval(() => { schedulerTick(ctx).catch(() => {}); }, 60 * 1000);
}

module.exports = { parseTime, dayKey, shouldFire, schedulerTick, startScheduler, stopServerInternal, FIRE_WINDOW_MS };
