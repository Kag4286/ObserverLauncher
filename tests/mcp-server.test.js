// MCP server integration: boot the loopback HTTP server with a mock ctx and drive it over
// real HTTP — proves auth, routing and a read tool actually work end to end.
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

const userData = path.join(os.tmpdir(), 'ob-mcp-srv-test');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const { startMcpServer, stopMcpServer, bridgeConfigPath } = require('../src/mcp/server.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

function post(port, token, body) {
  return new Promise(resolve => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, 'content-length': Buffer.byteLength(data) } }, res => {
      let out = ''; res.on('data', c => out += c); res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.write(data); req.end();
  });
}

(async () => {
  const ctx = {
    currentServerPath: '', serverStatus: 'stopped', javaInfo: null, consoleBuffer: [], live: { players: [] },
    appendLog: () => {}, send: () => {}, setServerStatus() {}, pushFiles() {},
    // M4b: real ctx pins tool handlers to an instance via AsyncLocalStorage; the mock only
    // needs a pass-through so callTool can run the handler unchanged.
    activeInstanceId: null, runInInstance: (id, fn) => fn(),
  };
  startMcpServer(ctx);
  // listen() is async; give it a tick.
  await new Promise(r => setTimeout(r, 200));

  check('server assigned a port', typeof ctx.mcpPort === 'number' && ctx.mcpPort > 0);
  check('token generated', typeof ctx.mcpToken === 'string' && ctx.mcpToken.length === 64);
  check('bridge config written', fs.existsSync(bridgeConfigPath()));
  const cfg = JSON.parse(fs.readFileSync(bridgeConfigPath(), 'utf8'));
  check('config has port+token+script', cfg.port === ctx.mcpPort && cfg.token === ctx.mcpToken && typeof cfg.script === 'string');
  check('script path ends with bridge.js', cfg.script.endsWith('bridge.js'));

  // wrong token -> 401
  const bad = await post(ctx.mcpPort, 'wrong', { tool: 'get_status', args: {} });
  check('wrong token rejected (401)', bad.status === 401);

  // read tool -> ok
  const good = await post(ctx.mcpPort, ctx.mcpToken, { tool: 'get_status', args: {} });
  check('get_status returns 200', good.status === 200);
  let parsed = {}; try { parsed = JSON.parse(good.body); } catch {}
  check('get_status ok:true', parsed.ok === true);
  check('get_status result has status', parsed.result && parsed.result.status === 'stopped');

  // unknown tool -> ok:false
  const unk = await post(ctx.mcpPort, ctx.mcpToken, { tool: 'nope', args: {} });
  let up = {}; try { up = JSON.parse(unk.body); } catch {}
  check('unknown tool -> ok:false', up.ok === false);

  // GET /tools: auth-gated, returns the real schema list (the bridge uses this).
  const getTools = (token) => new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: ctx.mcpPort, path: '/tools', method: 'GET', headers: token ? { authorization: 'Bearer ' + token } : {} }, res => { let o = ''; res.on('data', c => o += c); res.on('end', () => resolve({ status: res.statusCode, body: o })); });
    req.on('error', e => resolve({ status: 0, body: e.message })); req.end();
  });
  const noAuth = await getTools(null);
  check('/tools without token -> 401', noAuth.status === 401);
  const withAuth = await getTools(ctx.mcpToken);
  check('/tools with token -> 200', withAuth.status === 200);
  let tl = {}; try { tl = JSON.parse(withAuth.body); } catch {}
  check('/tools returns >=30 tools', Array.isArray(tl.tools) && tl.tools.length >= 30);
  const rf = (tl.tools || []).find(x => x.name === 'read_file');
  check('/tools read_file has required path', !!(rf && (rf.inputSchema.required || []).includes('path')));

  // destroy tool without GUI confirm -> denied (ctx.onMcpConfirm unset)
  const del = await post(ctx.mcpPort, ctx.mcpToken, { tool: 'stop_server', args: {} });
  let dp = {}; try { dp = JSON.parse(del.body); } catch {}
  check('destroy without confirm -> denied', dp.ok === false && /denied/i.test(dp.error || ''));

  stopMcpServer(ctx);
  check('stop clears port', ctx.mcpPort === null);
  check('stop removes bridge config', !fs.existsSync(bridgeConfigPath()));

  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message, e.stack); process.exit(1); });
