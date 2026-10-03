// R2 (v3.3.0): end-to-end headless remote. Enable remote in an isolated data dir, boot the headless
// runtime, and hit the REAL loopback server. Proves the settings:save -> startRemoteServer wiring.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-remotedata-'));
process.env.OBSERVER_DATA_DIR = dataDir;

const { createHeadless } = require('../src/headless.js');
const { saveSettings, loadSettings } = require('../src/main/settings.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

(async () => {
  // enable remote + pin a port 0 (random), read-only on so /command is blocked
  const s = loadSettings();
  s.remoteEnabled = true; s.remoteReadOnly = true; s.remoteAllow = '';
  saveSettings(s);

  // createHeadless only (no initHeadless) - no timers/watchers, so the process can exit cleanly.
  const { ctx } = createHeadless();
  await ctx.startRemoteServer();
  ck('remote started', !!ctx.remotePort && ctx.remotePort > 0);
  const token = loadSettings().remoteToken;
  ck('token persisted', typeof token === 'string' && token.length === 48);

  const base = `http://127.0.0.1:${ctx.remotePort}`;
  let resp = await fetch(`${base}/health`);
  ck('/health 200', resp.status === 200);
  resp = await fetch(`${base}/status`);
  ck('/status no token 401', resp.status === 401);
  resp = await fetch(`${base}/status`, { headers: { authorization: 'Bearer ' + token } });
  ck('/status good token 200', resp.status === 200);
  const body = await resp.json();
  ck('/status ok body', body.ok === true);
  // read-only default blocks command
  resp = await fetch(`${base}/command`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'list' }) });
  ck('read-only /command 403', resp.status === 403);

  ctx.stopRemoteServer();
  ck('stop clears port', !ctx.remotePort);

  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  // No process.exit(): let Node drain handles so Windows does not abort on a closing async handle.
  process.exitCode = fail ? 1 : 0;
})();
