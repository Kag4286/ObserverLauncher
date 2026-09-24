// v2.0.0 (M4b) architecture guard: per-instance ctx fields must be ACCESSORS reading
// through ctx.inst() (AsyncLocalStorage), never plain data properties on the shared ctx
// object. A half-migrated module that reintroduces `currentServerPath:` into the object
// literal would silently break instance isolation. This test is the safety net for M4b.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// context.js pulls in server-files.js which needs electron app.getPath().
const userData = path.join(os.tmpdir(), 'ob-arch-ctx-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const { createContext } = require('../src/main/context.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- static guard: the object literal must not re-declare migrated fields ---
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'context.js'), 'utf8');
const litStart = src.indexOf('const ctx = {');
const litEnd = src.indexOf('\n  };', litStart);
const literal = src.slice(litStart, litEnd);

// Migrated per-instance fields (add here as M4b converts each one).
const MIGRATED = [
  'currentServerPath', 'serverProcess', 'javaInfo', 'consoleBuffer', 'sampleTimer',
  'previousCpu', 'monitoredPid', 'live', 'metricsHistory', 'currentSoftware',
  'autoPollTimer', 'suppressStatusUntil', 'lastManualCommandAt', 'manualStop',
  'restartTimer', 'restartAttempts', 'shutdownTimer', 'adoptWatchTimer', 'autoBackupTimer', 'schedulerTimer',
  'schedulerLastFired', 'serverStatus', 'waitingForDone', 'runtimeInstanceId',
  'backupInProgress', 'lastAutoBackupAt', 'buildProcess', 'rcon', 'tpsUnsupported',
  'wizardAbort', 'contentWatcher', 'contentWatchers', 'contentWatchDebounce',
  'edWatcher', 'edWatchMtime', 'edWatchDebounce',
];
for (const field of MIGRATED) {
  ok(`object literal has no flat '${field}:'`, !new RegExp(`\\b${field}\\s*:`).test(literal));
}

// --- runtime: currentServerPath is an accessor ---
const ctx = createContext();
const desc = Object.getOwnPropertyDescriptor(ctx, 'currentServerPath');
ok('currentServerPath is an accessor', !!(desc && desc.get && desc.set));
ok('currentServerPath default is empty string', ctx.currentServerPath === '');

// --- isolation: two ALS chains keep their own server path ---
ctx.runInInstance('A', () => {
  ctx.currentServerPath = '/srv/a';
  ctx.runInInstance('B', () => { ctx.currentServerPath = '/srv/b'; });
  ok('chain A unchanged after B set', ctx.currentServerPath === '/srv/a');
});
ok('instance A stored separately', ctx.instances.get('A').currentServerPath === '/srv/a');
ok('instance B stored separately', ctx.instances.get('B').currentServerPath === '/srv/b');
ok('outside als -> active/empty', ctx.currentServerPath === '');

fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
