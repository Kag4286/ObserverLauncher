// v4.3.0: settings:save must APPLY remote config changes immediately (no app restart), mint a new
// token on rotate, and expose the token over the remote:token IPC. Real headless runtime + shim.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-remotecfg-'));
process.env.OBSERVER_DATA_DIR = dataDir;

const { createHeadless } = require('../src/headless.js');
const { loadSettings } = require('../src/main/settings.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

(async () => {
  const { ctx, shim } = createHeadless();
  ctx.currentRemoteEnabled = false;

  // 1. Enabling remote via settings:save must START the server this turn (the v4.3.0 bugfix: the
  // old order started remote BEFORE saveSettings, so startRemote read remoteEnabled:false -> null).
  let r = await shim.invoke('settings:save', { remoteEnabled: true, remoteReadOnly: false, remoteAllow: '', remotePort: 0 });
  ck('save ok', r && r.ok === true);
  ck('remote started on enable', !!ctx.remotePort && ctx.remotePort > 0);
  ck('save result carries remote status', r.remote && r.remote.running === true && r.remote.port === ctx.remotePort);
  const base = `http://127.0.0.1:${ctx.remotePort}`;
  const token1 = loadSettings().remoteToken;
  ck('token persisted (48 hex)', typeof token1 === 'string' && token1.length === 48);

  // /command works (readOnly off)
  let cr = await fetch(`${base}/command`, { method: 'POST', headers: { authorization: 'Bearer ' + token1, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'list' }) });
  ck('/command allowed when readOnly off', cr.status === 200 || cr.status === 501);

  // 2. Toggling readOnly ON while running must take effect WITHOUT a restart of the app: the server
  // is restarted by settings:save and /command is now refused.
  r = await shim.invoke('settings:save', { remoteReadOnly: true });
  ck('save ok (readOnly on)', r && r.ok === true);
  ck('port still live after config restart', !!ctx.remotePort && ctx.remotePort > 0);
  cr = await fetch(`http://127.0.0.1:${ctx.remotePort}/command`, { method: 'POST', headers: { authorization: 'Bearer ' + token1, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'list' }) });
  ck('readOnly now enforced -> 403', cr.status === 403);

  // 3. Changing the IP allowlist while running must apply: an allowlist that excludes 127.0.0.1
  // blocks the loopback client immediately.
  r = await shim.invoke('settings:save', { remoteAllow: '10.9.9.9' });
  ck('save ok (allowlist)', r && r.ok === true);
  let sr = await fetch(`http://127.0.0.1:${ctx.remotePort}/status`, { headers: { authorization: 'Bearer ' + token1 } });
  ck('new allowlist enforced -> 403', sr.status === 403);

  // 4. Rotating the token mints a NEW one and drops the old one immediately.
  r = await shim.invoke('settings:save', { rotateRemoteToken: true, remoteAllow: '' });
  ck('save ok (rotate)', r && r.ok === true);
  const token2 = loadSettings().remoteToken;
  ck('token changed after rotate', token2 && token2 !== token1 && token2.length === 48);
  ck('rotate flag not persisted', !('rotateRemoteToken' in loadSettings()));
  let old = await fetch(`http://127.0.0.1:${ctx.remotePort}/status`, { headers: { authorization: 'Bearer ' + token1 } });
  ck('old token now rejected -> 401', old.status === 401);
  let fresh = await fetch(`http://127.0.0.1:${ctx.remotePort}/status`, { headers: { authorization: 'Bearer ' + token2 } });
  ck('new token accepted -> 200', fresh.status === 200);

  // 5. remote:token returns the live token for the trusted renderer.
  const t = await shim.invoke('remote:token');
  ck('remote:token ok', t && t.ok === true && t.token === token2);

  // 6. Disabling stops the server.
  await shim.invoke('settings:save', { remoteEnabled: false });
  ck('disable stops remote', !ctx.remotePort);

  try { ctx.stopRemoteServer(); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
