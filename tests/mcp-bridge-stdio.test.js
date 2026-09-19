// Bridge stdio integration: spawn src/mcp/bridge.js as a real child process and drive the MCP
// JSON-RPC surface over stdin/stdout, with a tiny fake app HTTP server standing in for Electron.
// This locks the whole bridge contract (initialize / tools/list / tools/call / ping) — the same
// thing a human verified by hand.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BRIDGE = path.join(__dirname, '..', 'src', 'mcp', 'bridge.js');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-bridge-'));

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// ---- Fake app: answers GET /tools and POST /rpc (bearer auth, like server.js) ----
const TOKEN = 'test-token-123';
const fakeApp = http.createServer((req, res) => {
  if ((req.headers.authorization || '') !== 'Bearer ' + TOKEN) { res.writeHead(401); return res.end('no'); }
  if (req.method === 'GET' && req.url === '/tools') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ tools: [
      { name: 'get_status', description: 'status', inputSchema: { type: 'object', properties: {} } },
      { name: 'read_file', description: 'read', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    ] }));
  }
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      const { tool, args } = JSON.parse(body || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      if (tool === 'get_status') return res.end(JSON.stringify({ ok: true, result: { status: 'running', via: 'fake' } }));
      if (tool === 'boom') return res.end(JSON.stringify({ ok: false, error: 'tool blew up' }));
      return res.end(JSON.stringify({ ok: false, error: 'unknown tool' }));
    });
    return;
  }
  res.writeHead(404); res.end();
});

// Helper: send a JSON-RPC line and resolve on the next response line with that id.
function makeClient(child) {
  let buf = '';
  const waiters = [];
  child.stdout.on('data', c => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const w = waiters.findIndex(x => x.id === msg.id);
      if (w >= 0) waiters.splice(w, 1)[0].resolve(msg);
    }
  });
  let nextId = 1;
  return (method, params) => new Promise(resolve => {
    const id = nextId++;
    waiters.push({ id, resolve });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

(async () => {
  await new Promise(r => fakeApp.listen(0, '127.0.0.1', r));
  const port = fakeApp.address().port;
  fs.writeFileSync(path.join(userData, 'mcp-bridge.json'), JSON.stringify({ port, token: TOKEN, appVersion: '9.9.9' }));

  const child = spawn(process.execPath, [BRIDGE], { env: { ...process.env, OBSERVER_MCP_USERDATA: userData }, stdio: ['pipe', 'pipe', 'pipe'] });
  const rpc = makeClient(child);

  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  check('initialize returns result', init && init.result);
  check('initialize serverInfo.name', init.result.serverInfo.name === 'observerlauncher');
  check('initialize version from config', init.result.serverInfo.version === '9.9.9');
  check('initialize capabilities.tools', !!init.result.capabilities.tools);

  const ping = await rpc('ping', {});
  check('ping -> {}', ping && ping.result && Object.keys(ping.result).length === 0);

  const list = await rpc('tools/list', {});
  check('tools/list returns tools', Array.isArray(list.result.tools) && list.result.tools.length === 2);
  const rf = list.result.tools.find(t => t.name === 'read_file');
  check('tools/list schema came from the app (required path)', !!(rf && (rf.inputSchema.required || []).includes('path')));

  const callOk = await rpc('tools/call', { name: 'get_status', arguments: {} });
  check('tools/call ok -> isError false', callOk.result && callOk.result.isError === false);
  check('tools/call ok -> text has result', /running/.test((callOk.result.content[0] || {}).text || ''));

  const callErr = await rpc('tools/call', { name: 'boom', arguments: {} });
  check('tools/call error -> isError true', callErr.result && callErr.result.isError === true);
  check('tools/call error -> text mentions error', /tool blew up/.test((callErr.result.content[0] || {}).text || ''));

  const bad = await rpc('nonexistent/method', {});
  check('unknown method -> error code', bad.error && bad.error.code === -32601);

  child.kill();
  fakeApp.close();
  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message, e.stack); process.exit(1); });
