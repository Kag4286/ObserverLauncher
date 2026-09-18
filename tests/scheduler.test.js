// Scheduler pure-logic tests: shouldFire() must fire exactly once per day inside the
// tolerance window, respect weekdays + state guards, and never stop mid-backup.
// scheduler.js pulls in server-lifecycle -> settings.js -> electron, so mock electron.
const Module = require('module');
const os = require('os');
const path = require('path');

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => path.join(os.tmpdir(), 'ob-sched-test') } };
  return origLoad.apply(this, arguments);
};

const { parseTime, dayKey, shouldFire, schedulerTick } = require('../src/main/scheduler.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// --- parseTime ---
check('parseTime 08:05', JSON.stringify(parseTime('08:05')) === JSON.stringify({ h: 8, m: 5 }));
check('parseTime 23:59', JSON.stringify(parseTime('23:59')) === JSON.stringify({ h: 23, m: 59 }));
check('parseTime 8:05 (1-digit hour ok)', JSON.stringify(parseTime('8:05')) === JSON.stringify({ h: 8, m: 5 }));
check('parseTime 24:00 invalid', parseTime('24:00') === null);
check('parseTime 08:60 invalid', parseTime('08:60') === null);
check('parseTime empty null', parseTime('') === null);
check('parseTime garbage null', parseTime('noon') === null);

// --- dayKey ---
check('dayKey zero-padded', dayKey(new Date(2026, 0, 5, 10, 0)) === '2026-01-05');

// Helper: a schedule that runs every day at HH:MM for both start and stop.
const sched = (start, stop, days = []) => ({ enabled: true, startTime: start, stopTime: stop, days });

// --- shouldFire: core window ---
const at = (h, m, s = 0, day = 3) => new Date(2026, 5, day, h, m, s); // day 3 = Wednesday
check('start fires at exact minute', shouldFire('start', sched('08:00', ''), at(8, 0, 5), {}, 'stopped'));
check('start fires within 90s', shouldFire('start', sched('08:00', ''), at(8, 0, 89), {}, 'stopped'));
check('start does NOT fire at 90s boundary', !shouldFire('start', sched('08:00', ''), at(8, 0, 90), {}, 'stopped'));
check('start does NOT fire early', !shouldFire('start', sched('08:00', ''), at(7, 59, 59), {}, 'stopped'));
check('start does NOT fire hours late (app opened 14:00)', !shouldFire('start', sched('08:00', ''), at(14, 0), {}, 'stopped'));
check('empty startTime = off', !shouldFire('start', sched('', ''), at(8, 0, 5), {}, 'stopped'));

// --- shouldFire: once per day ---
const today = dayKey(at(8, 0, 5));
check('start skipped if already fired today', !shouldFire('start', sched('08:00', ''), at(8, 0, 30), { start: today }, 'stopped'));
check('start allowed if lastFired was another day', shouldFire('start', sched('08:00', ''), at(8, 0, 5), { start: '2026-06-02' }, 'stopped'));

// --- shouldFire: weekday gate ---
// 2026-06-03 is a Wednesday (getDay()=3).
check('days incl Wednesday fires', shouldFire('start', sched('08:00', '', [3]), at(8, 0, 5), {}, 'stopped'));
check('days excl Wednesday skipped', !shouldFire('start', sched('08:00', '', [1, 2]), at(8, 0, 5), {}, 'stopped'));
check('empty days = every day', shouldFire('start', sched('08:00', '', []), at(8, 0, 5), {}, 'stopped'));

// --- shouldFire: state guards ---
check('start skipped when running', !shouldFire('start', sched('08:00', ''), at(8, 0, 5), {}, 'running'));
check('start skipped when starting', !shouldFire('start', sched('08:00', ''), at(8, 0, 5), {}, 'starting'));
check('stop fires when running', shouldFire('stop', sched('', '23:00'), at(23, 0, 5), {}, 'running'));
check('stop skipped when stopped', !shouldFire('stop', sched('', '23:00'), at(23, 0, 5), {}, 'stopped'));
check('stop skipped when starting', !shouldFire('stop', sched('', '23:00'), at(23, 0, 5), {}, 'starting'));

// --- shouldFire: never stop mid-backup ---
check('stop skipped during backup', !shouldFire('stop', sched('', '23:00'), at(23, 0, 5), {}, 'running', { backupInProgress: true }));

// --- shouldFire: disabled master switch ---
check('disabled schedule never fires', !shouldFire('start', { enabled: false, startTime: '08:00', stopTime: '', days: [] }, at(8, 0, 5), {}, 'stopped'));

// --- schedulerTick integration (mock ctx, fixed clock) ---
(async () => {
  let started = false;
  const ctx = {
    serverStatus: 'stopped', serverProcess: null, backupInProgress: false, restartTimer: null,
    schedulerLastFired: { start: null, stop: null },
    appendLog: () => {}, setServerStatus: (s) => { ctx.serverStatus = s; },
  };
  // Force loadSettings to return an enabled schedule 08:00 today by writing a settings file.
  const fs = require('fs');
  const dir = path.join(os.tmpdir(), 'ob-sched-test');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    version: 99, serverPath: '', javaPath: '', scheduleEnabled: true, scheduleStartTime: '08:00', scheduleStopTime: '', scheduleDays: []
  }));
  // Monkeypatch startServerInternal is hard (closure), so just assert it does not throw and
  // records the fired day. We pass a now far outside the window to prove the gate works.
  await schedulerTick(ctx, new Date(2026, 5, 3, 12, 0));
  check('tick outside window: not fired today', ctx.schedulerLastFired.start === null);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
