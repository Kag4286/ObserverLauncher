// mcp-confirm.test.js — the MCP write/destroy confirmation gate (src/mcp/confirm.js).
// This is the security gate that decides whether an AI tool call is allowed; it had no test.
// No electron needed: we mock ipcMain + ctx.
const { registerMcpConfirm } = require('../src/mcp/confirm.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

function setup(opts = {}) {
  const handlers = {};
  const ipcMain = { on: (ch, fn) => { handlers[ch] = fn; } };
  const sent = [];
  const ctx = {
    send: (ch, data) => { if (opts.sendThrows) throw new Error('renderer gone'); sent.push({ ch, data }); },
  };
  registerMcpConfirm(ipcMain, ctx);
  return { handlers, sent, ctx };
}

// 1. request is forwarded to the renderer
{
  const { sent, ctx } = setup();
  const req = { reqId: 'r1', tool: 'write_file', args: { path: 'a.txt' }, risk: 'write' };
  ctx.onMcpConfirm(req, () => {});
  ck('confirm request forwarded to renderer', sent.length === 1 && sent[0].ch === 'mcp:confirm-request' && sent[0].data.reqId === 'r1');
}

// 2. allow:true resolves the callback with true
{
  const { handlers, ctx } = setup();
  let got = null;
  ctx.onMcpConfirm({ reqId: 'r2', tool: 'edit_file', args: {}, risk: 'write' }, v => { got = v; });
  handlers['mcp:confirm-response'](null, { reqId: 'r2', allow: true });
  ck('allow:true -> cb(true)', got === true);
}

// 3. allow:false resolves with false
{
  const { handlers, ctx } = setup();
  let got = null;
  ctx.onMcpConfirm({ reqId: 'r3', tool: 'delete_backup', args: {}, risk: 'destroy' }, v => { got = v; });
  handlers['mcp:confirm-response'](null, { reqId: 'r3', allow: false });
  ck('allow:false -> cb(false)', got === false);
}

// 4. a response for an UNKNOWN reqId is ignored (no throw, no spurious cb)
{
  const { handlers, ctx } = setup();
  let calls = 0;
  ctx.onMcpConfirm({ reqId: 'r4', tool: 'x', args: {}, risk: 'write' }, () => { calls++; });
  let threw = false;
  try { handlers['mcp:confirm-response'](null, { reqId: 'nope', allow: true }); } catch { threw = true; }
  ck('unknown reqId ignored (no throw)', !threw && calls === 0);
}

// 5. the callback fires exactly ONCE even if two responses arrive for the same reqId
{
  const { handlers, ctx } = setup();
  let calls = 0, last = null;
  ctx.onMcpConfirm({ reqId: 'r5', tool: 'x', args: {}, risk: 'destroy' }, v => { calls++; last = v; });
  handlers['mcp:confirm-response'](null, { reqId: 'r5', allow: true });
  handlers['mcp:confirm-response'](null, { reqId: 'r5', allow: false });
  ck('cb fires exactly once', calls === 1 && last === true);
}

// 6. if ctx.send throws (renderer gone) the callback resolves false immediately
{
  const { ctx } = setup({ sendThrows: true });
  let got = null;
  ctx.onMcpConfirm({ reqId: 'r6', tool: 'x', args: {}, risk: 'write' }, v => { got = v; });
  ck('renderer gone -> cb(false)', got === false);
}

// 7. malformed response payloads are ignored safely
{
  const { handlers, ctx } = setup();
  let calls = 0;
  ctx.onMcpConfirm({ reqId: 'r7', tool: 'x', args: {}, risk: 'write' }, () => { calls++; });
  let threw = false;
  try { handlers['mcp:confirm-response'](null, null); handlers['mcp:confirm-response'](null, {}); handlers['mcp:confirm-response'](null, undefined); } catch { threw = true; }
  ck('malformed responses ignored', !threw && calls === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
