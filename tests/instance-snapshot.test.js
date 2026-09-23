// v2.0.0 (B4/M11): instances:snapshot returns a full state snapshot of ANY instance (status,
// console tail, metrics history, live, files) WITHOUT switching the active instance.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-snapshot-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const { registerSettings } = require('../src/main/settings-handlers.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const handlers = {};
const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; } };
const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-snapB-'));
fs.writeFileSync(path.join(rootB, 'server.properties'), 'server-port=25599\n');
fs.writeFileSync(path.join(rootB, 'server.jar'), 'x');

const ctx = {
  win: null, currentServerPath: '', serverStatus: 'stopped', javaInfo: null,
  send: () => {}, appendLog: () => {}, watchServerFolder: () => {},
  activeInstanceId: 'A',
  instances: new Map([
    ['A', { id: 'A', serverPath: '/srv/A', serverStatus: 'stopped', consoleBuffer: [], metricsHistory: [], live: {}, javaInfo: null }],
    ['B', { id: 'B', serverPath: rootB, serverStatus: 'running', consoleBuffer: [{ time: 't', text: 'hi', type: 'server' }], metricsHistory: [{ t: 1, tps: 20 }], live: { tps: 20, players: ['x'] }, javaInfo: { ok: true, version: '21' } }],
  ]),
};
registerSettings(fakeIpc, ctx);
const snapshot = handlers['instances:snapshot'];

(async () => {
  const r = await snapshot(null, 'B');
  ok('snapshot ok', r && r.ok === true && r.id === 'B');
  ok('snapshot status running', r.status === 'running' && r.running === true);
  ok('snapshot console tail', Array.isArray(r.logs) && r.logs.length === 1 && r.logs[0].text === 'hi');
  ok('snapshot metrics history', Array.isArray(r.metricsHistory) && r.metricsHistory.length === 1);
  ok('snapshot live', r.live && r.live.tps === 20);
  ok('snapshot java', r.java && r.java.version === '21');
  ok('snapshot files read from that instance root', r.files && !!r.files.jar);
  ok('snapshot not active flag', r.active === false);

  // Active instance flag.
  const ra = await snapshot(null, 'A');
  ok('snapshot A active flag', ra.active === true);

  // Unknown id -> error.
  const bad = await snapshot(null, 'NOPE');
  ok('snapshot unknown -> ok:false', bad && bad.ok === false);

  fs.rmSync(rootB, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
