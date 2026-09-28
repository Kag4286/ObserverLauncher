// headless-confirm.test.js — the headless write/destroy confirm policy (v3.0.0 Phase B4).
//
// WHY: headless has no dialog, so confirmOnGui() must DENY write/destroy DELIBERATELY (not by the
// accident of ctx.onMcpConfirm being undefined). This drives callTool() directly with each mode and
// asserts the gate decision + that denials are audited.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the audit log to a throwaway data dir BEFORE server.js reads it.
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-confirm-'));
process.env.OBSERVER_DATA_DIR = tmpData;

const { createContext } = require('../src/main/context.js');
const { callTool } = require('../src/mcp/server.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));
const cfg = { autoAllowWrite: false, readOnly: false };

(async () => {
  // 1) auto-deny: a destroy tool is refused with the POLICY message (not a 60s hang).
  {
    const ctx = createContext();
    ctx.confirmMode = 'auto-deny';
    const t0 = Date.now();
    const r = await callTool(ctx, 'stop_server', {}, cfg);
    check('auto-deny refuses destroy', r && r.ok === false, JSON.stringify(r));
    check('auto-deny message is policy-worded', /headless confirm policy/.test(r.error || ''), r.error);
    check('auto-deny returns immediately (<2s, no 60s timer)', Date.now() - t0 < 2000, String(Date.now() - t0));
  }

  // 2) deny is AUDITED (readable via read_audit_log).
  {
    const audit = path.join(tmpData, 'mcp-audit.log');
    let body = '';
    try { body = fs.readFileSync(audit, 'utf8'); } catch {}
    check('denial written to mcp-audit.log', /stop_server/.test(body), body.slice(0, 120));
  }

  // 3) allowlist: a listed tool passes the gate; an unlisted one is denied.
  {
    const ctx = createContext();
    ctx.confirmMode = 'allowlist';
    ctx.confirmAllow = ['write_file'];
    const denied = await callTool(ctx, 'stop_server', {}, cfg);
    check('allowlist denies an UNLISTED destroy tool', /headless confirm policy/.test(denied.error || ''), denied.error);
    // write_file is listed -> NOT policy-denied (it may still fail for other reasons, e.g. no
    // server folder, but the message must not be the policy denial).
    const passed = await callTool(ctx, 'write_file', { path: 'x.txt', content: 'hi' }, cfg);
    check('allowlist lets a LISTED tool through the gate', !/headless confirm policy/.test((passed && passed.error) || ''), JSON.stringify(passed));
  }

  // 4) gui mode + no onMcpConfirm -> legacy 'Denied by user' (unchanged for the GUI path).
  {
    const ctx = createContext();
    // confirmMode left undefined -> defaults to 'gui'
    const r = await callTool(ctx, 'stop_server', {}, cfg);
    check('gui mode without renderer denies as user', /Denied by user/.test(r.error || ''), r.error);
  }

  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
  console.log(fail ? `\n${fail} check(s) failed.` : `\nAll headless-confirm checks passed (${pass}).`);
  process.exit(fail ? 1 : 0);
})();
