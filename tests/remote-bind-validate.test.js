// 3.3.0: settings:save validates remoteBind (a bad address used to fail silently at listen).
// Drives the real IPC handler via the headless shim, in an isolated data dir.
const fs = require('fs');
const os = require('os');
const path = require('path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-binddata-'));
process.env.OBSERVER_DATA_DIR = dataDir;
const { createHeadless } = require('../src/headless.js');
const { loadSettings } = require('../src/main/settings.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

(async () => {
  const { shim } = createHeadless();
  let r = await shim.invoke('settings:save', { remoteBind: '999.1.1.1' });
  ck('bad IPv4 refused', r && r.ok === false);
  ck('bad IPv4 error mentions bind', r && /bind/i.test(r.error || ''));
  r = await shim.invoke('settings:save', { remoteBind: 'not a host' });
  ck('garbage refused', r && r.ok === false);
  r = await shim.invoke('settings:save', { remoteBind: '127.0.0.1' });
  ck('valid IP accepted', r && r.ok === true);
  ck('valid IP persisted', loadSettings().remoteBind === '127.0.0.1');
  r = await shim.invoke('settings:save', { remoteBind: 'localhost' });
  ck('localhost accepted', r && r.ok === true);
  r = await shim.invoke('settings:save', { remoteBind: '' });
  ck('blank accepted', r && r.ok === true);
  r = await shim.invoke('settings:save', { remotePort: 99999 });
  ck('bad port clamped to 0', r && r.ok === true && loadSettings().remotePort === 0);
  r = await shim.invoke('settings:save', { remotePort: 8777 });
  ck('good port saved', r && r.ok === true && loadSettings().remotePort === 8777);

  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
