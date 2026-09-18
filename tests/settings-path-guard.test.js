// Regression (audit #4): settings:save must refuse to switch the server folder while a
// server is starting/running/stopping, so ctx.currentServerPath can never diverge from the
// live process's folder (metrics/player/worldmap/backup all key off it). Other settings
// still save. A folder change while stopped is still allowed.
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-settings-guard-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true }); // settings:save writes settings.json here
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => userData } };
  }
  return origLoad.apply(this, arguments);
};

const { registerSettings } = require('../src/main/settings-handlers.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// Two real folders so the "is a directory" check passes; a bogus java path keeps detectJava fast.
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-srvA-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-srvB-'));

const handlers = {};
const fakeIpc = { handle: (ch, fn) => { handlers[ch] = fn; } };
const ctx = {
  win: null,
  currentServerPath: dirA,
  serverStatus: 'stopped',
  javaInfo: null,
  send: () => {}, appendLog: () => {},
  watchServerFolder: () => {},
};
registerSettings(fakeIpc, ctx);
const save = handlers['settings:save'];

(async () => {
  const base = { serverPath: dirA, javaPath: path.join(os.tmpdir(), 'no-such-java'), memoryMin: 2, memoryMax: 4, jvmArgs: '' };

  // running + switching folder -> BLOCKED, path unchanged
  ctx.serverStatus = 'running';
  const r1 = await save(null, { ...base, serverPath: dirB });
  check('running: folder switch blocked', r1 && r1.ok === false && /stop the server/i.test(r1.error));
  check('running: currentServerPath unchanged', ctx.currentServerPath === dirA);

  // starting / stopping -> also BLOCKED
  for (const st of ['starting', 'stopping']) {
    ctx.serverStatus = st;
    const r = await save(null, { ...base, serverPath: dirB });
    check(`${st}: folder switch blocked`, r && r.ok === false);
  }

  // running + SAME folder (e.g. changing RAM) -> allowed (no guard error)
  ctx.serverStatus = 'running';
  const r2 = await save(null, { ...base, serverPath: dirA, memoryMax: 8 });
  check('running: same folder still saves', !(r2 && r2.ok === false && /stop the server/i.test(r2.error || '')));
  check('running: same folder keeps path', ctx.currentServerPath === dirA);

  // stopped + switching folder -> allowed
  ctx.serverStatus = 'stopped';
  const r3 = await save(null, { ...base, serverPath: dirB });
  check('stopped: folder switch allowed', !(r3 && r3.ok === false && /stop the server/i.test(r3.error || '')));
  check('stopped: currentServerPath updated', ctx.currentServerPath === dirB);

  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
