// v5.0.0 MCP security fixes: (1) safeTarget fail-closed, (2) /resource rate-limit+ALS, (3) missing
// Host refused, (4) empty token fail-closed, (5) lifecycle tools skip confirm when autoAllowWrite.
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-mcp-sec5');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// ---- 1. safeTarget fail-closed ----
const { safeTarget } = require('../src/main/fs-utils.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-st-'));
check('safeTarget normal child ok', safeTarget(root, 'a/b.txt') !== null);
check('safeTarget traversal blocked', safeTarget(root, '../evil.txt') === null);
check('safeTarget absolute-outside blocked', safeTarget(root, path.join(os.tmpdir(), 'x.txt')) === null);
// fail-closed: a root that does NOT exist -> realpathSync throws -> must return null, not the target
const missingRoot = path.join(os.tmpdir(), 'ob-does-not-exist-' + Date.now());
check('safeTarget missing root -> null (fail-closed)', safeTarget(missingRoot, 'x.txt') === null);
// symlink escape still blocked
let symlinkOk = true;
try {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
  check('safeTarget symlink escape blocked', safeTarget(root, 'link/secret.txt') === null);
} catch { /* symlinks may need privilege on Windows */ symlinkOk = false; }
if (!symlinkOk) console.log('SKIP safeTarget symlink test (no symlink privilege)');
fs.rmSync(root, { recursive: true, force: true });

// ---- 5. lifecycle tools skip confirm when autoAllowWrite ----
(async () => {
  const { callTool } = require('../src/mcp/server.js');
  let confirmCalls = 0;
  const ctx = {
    currentServerPath: '', serverStatus: 'stopped', consoleBuffer: [], live: { players: [] },
    activeInstanceId: 'default', runInInstance: (id, fn) => fn(),
    appendLog: () => {}, send: () => {}, setServerStatus() {},
    onMcpConfirm: (req, cb) => { confirmCalls++; cb(false); }, // would DENY if asked
  };
  // autoAllowWrite ON: stop_server (destroy lifecycle) must NOT ask -> proceeds to handler (which
  // may fail for other reasons, but NOT with a 'denied' message).
  const withAllow = await callTool(ctx, 'stop_server', {}, { autoAllowWrite: true, readOnly: false });
  check('autoAllow: stop_server did NOT prompt', confirmCalls === 0);
  check('autoAllow: stop_server not denied', !/denied/i.test(withAllow.error || ''));

  // autoAllowWrite ON but a NON-lifecycle destroy (delete_backup) MUST still prompt.
  confirmCalls = 0;
  const d = await callTool(ctx, 'delete_backup', { name: 'x.zip' }, { autoAllowWrite: true, readOnly: false });
  check('autoAllow: delete_backup STILL prompts', confirmCalls === 1);
  check('autoAllow: delete_backup denied after prompt', /denied/i.test(d.error || ''));

  // autoAllowWrite OFF: stop_server MUST prompt (and be denied by our cb).
  confirmCalls = 0;
  const off = await callTool(ctx, 'stop_server', {}, { autoAllowWrite: false, readOnly: false });
  check('no-autoAllow: stop_server prompts', confirmCalls === 1);
  check('no-autoAllow: stop_server denied', /denied/i.test(off.error || ''));

  // read-only mode blocks write/destroy before any confirm.
  confirmCalls = 0;
  const ro = await callTool(ctx, 'stop_server', {}, { autoAllowWrite: true, readOnly: true });
  check('readOnly blocks stop_server', /read-only/i.test(ro.error || '') && confirmCalls === 0);

  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message, e.stack); process.exit(1); });
