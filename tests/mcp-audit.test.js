// mcp-audit.test.js — C3: MCP audit is JSONL + rotates (history survives the size cap).
//
// WHY: the old audit was TSV text DELETED wholesale at 256 KB, so old write/destroy history vanished.
// Now each line is JSON and the file rotates to .1/.2/.3; read_audit_log reads across the set.
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-audit-'));
process.env.OBSERVER_DATA_DIR = tmpData;

const { auditLog } = require('../src/mcp/server.js');
const { getTool } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));
const auditFile = path.join(tmpData, 'mcp-audit.log');

(async () => {
  // 1) each entry is a single JSON object line with the expected fields.
  auditLog('write_file', 'write', { ok: true });
  auditLog('delete_backup', 'destroy', { ok: false, error: 'denied by headless confirm policy' });
  const raw = fs.readFileSync(auditFile, 'utf8').split('\n').filter(Boolean);
  check('audit has 2 JSONL lines', raw.length === 2, String(raw.length));
  let e0 = {}, e1 = {};
  try { e0 = JSON.parse(raw[0]); e1 = JSON.parse(raw[1]); } catch (err) { check('audit lines parse as JSON', false, String(err)); }
  check('entry has ts/risk/tool/ok', e0.ts && e0.risk === 'write' && e0.tool === 'write_file' && e0.ok === true, JSON.stringify(e0));
  check('denied entry has ok:false + error', e1.ok === false && /policy/.test(e1.error || ''), JSON.stringify(e1));

  // 2) rotation: force the file over the cap -> it moves to .1 (history kept, not deleted).
  //    auditLog only persists `error` on denied entries, so pad with BIG denied errors (~2 KB each).
  const big = 'x'.repeat(2000);
  for (let i = 0; i < 200; i++) auditLog('write_file', 'write', { ok: false, error: big });
  check('audit rotated to .1', fs.existsSync(auditFile + '.1'), 'no .1 file');
  const rotated = fs.existsSync(auditFile + '.1') ? fs.readFileSync(auditFile + '.1', 'utf8') : '';
  check('rotated file still holds old entries', /delete_backup/.test(rotated));

  // 3) read_audit_log reads across the rotation set and returns newest-first window.
  const tool = getTool('read_audit_log');
  const r = await tool.handler({}, { lines: 500 });
  check('read_audit_log ok', r && r.ok === true, JSON.stringify(r));
  check('read_audit_log returns lines', Array.isArray(r.result.lines) && r.result.lines.length > 0, JSON.stringify(r.result && r.result.count));
  check('read_audit_log reads across rotation (finds the denied destroy)', r.result.lines.some(l => /delete_backup/.test(l)), (r.result.lines || []).slice(0, 3).join(' | '));

  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
  console.log(fail ? `\n${fail} check(s) failed.` : `\nAll mcp-audit checks passed (${pass}).`);
  process.exit(fail ? 1 : 0);
})();
