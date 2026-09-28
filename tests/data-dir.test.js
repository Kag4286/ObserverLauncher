// data-dir.test.js — guards the v3.0.0 headless data-dir resolution (Phase B1).
//
// WHY: every backend module used `app.getPath('userData')` directly, welding them to Electron.
// dataDir() is now the single resolver, and it MUST keep working in three situations:
//   1. OBSERVER_DATA_DIR set (headless/CLI/Docker) -> that path, always.
//   2. Electron app present (GUI)                  -> app.getPath('userData').
//   3. plain Node (require('electron') is a string)-> per-platform default, never a throw.
const Module = require('module');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

// Load data-dir.js fresh with a controllable electron stub (clear the require cache each time).
const DATA_DIR = require.resolve('../src/main/data-dir.js');
const origLoad = Module._load;
function withElectron(stub, fn) {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return stub;
    return origLoad.apply(this, arguments);
  };
  delete require.cache[DATA_DIR];
  try { return fn(require(DATA_DIR)); }
  finally { Module._load = origLoad; delete require.cache[DATA_DIR]; }
}

const ENV_KEY = 'OBSERVER_DATA_DIR';
const savedEnv = process.env[ENV_KEY];
const restoreEnv = () => { if (savedEnv === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = savedEnv; };

// 1) env override wins, regardless of electron.
process.env[ENV_KEY] = path.join(os.tmpdir(), 'ol-dd-env');
withElectron({ app: { getPath: () => '/should/be/ignored' } }, ({ dataDir }) => {
  check('OBSERVER_DATA_DIR override wins', dataDir() === path.join(os.tmpdir(), 'ol-dd-env'), dataDir());
});
// blank override is ignored -> falls through
process.env[ENV_KEY] = '   ';
withElectron({ app: { getPath: () => path.join(os.tmpdir(), 'ol-dd-electron') } }, ({ dataDir }) => {
  check('blank override ignored', dataDir() === path.join(os.tmpdir(), 'ol-dd-electron'), dataDir());
});
restoreEnv();

// 2) real electron app object -> userData.
withElectron({ app: { getPath: () => path.join(os.tmpdir(), 'ol-dd-electron') } }, ({ dataDir }) => {
  check('electron userData used when no env', dataDir() === path.join(os.tmpdir(), 'ol-dd-electron'), dataDir());
});

// 3) plain-Node shapes must NOT throw and must fall back to the platform default.
withElectron('C:/path/to/electron.exe', ({ dataDir, platformDefaultDir }) => {
  let v = null, threw = null;
  try { v = dataDir(); } catch (e) { threw = e; }
  check('electron string export does not throw', !threw, threw && threw.message);
  check('electron string export -> platform default', v === platformDefaultDir(), v);
});
withElectron(undefined, ({ dataDir }) => {
  check('electron undefined -> platform default', dataDir() === require('../src/main/data-dir.js').platformDefaultDir());
});
// app present but getPath missing -> still falls back, never throws.
withElectron({ app: {} }, ({ dataDir, platformDefaultDir }) => {
  check('app without getPath -> platform default', dataDir() === platformDefaultDir());
});

// tempDir() is always the OS temp dir.
withElectron(undefined, ({ tempDir }) => {
  check('tempDir === os.tmpdir()', tempDir() === os.tmpdir(), tempDir());
});

console.log(fail ? `\n${fail} check(s) failed.` : `\nAll data-dir checks passed (${pass}).`);
process.exit(fail ? 1 : 0);
