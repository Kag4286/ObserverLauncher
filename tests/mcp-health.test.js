// mcp-health.test.js — MCP over headless: auto-start on toggle (C1) + unauthenticated /health (C2).
//
// WHY: 3.0.0's whole point is an AI driving a headless server over MCP. C1 = the loopback MCP server
// starts from headless when enabled; C2 = a token-free /health so a Docker healthcheck (3.1.0) can
// probe liveness without the per-launch token. This boots the real server in-process and talks HTTP.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-health-'));
process.env.OBSERVER_DATA_DIR = tmpData;
process.env.OBSERVER_CONFIRM_MODE = 'auto-deny';

const headless = require('../src/headless.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

// Minimal GET that returns { status, body }.
function get(port, urlPath, headers = {}) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', headers }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

(async () => {
  const rt = await headless.start();
  check('headless start() with MCP off opens no port', !rt.ctx.mcpPort, String(rt.ctx.mcpPort));

  // C1: enable MCP the way the Settings UI does (settings:save -> ctx.startMcpServer).
  const saved = await rt.shim.invoke('settings:save', { mcpEnabled: true });
  check('settings:save returns ok', saved && saved.ok === true, JSON.stringify(saved));
  // startMcpServer sets ctx.mcpPort from listen()'s async callback — poll briefly.
  let port = null;
  for (let i = 0; i < 50 && !port; i++) { port = rt.ctx.mcpPort; if (!port) await new Promise(r => setTimeout(r, 50)); }
  check('C1: MCP server auto-started headless (port open)', !!port, String(port));

  if (port) {
    // C2: /health is unauthenticated and returns liveness + version.
    const h = await get(port, '/health');
    check('C2: GET /health -> 200 without auth', h.status === 200, `${h.status} ${h.body}`);
    let parsed = {};
    try { parsed = JSON.parse(h.body); } catch {}
    check('C2: /health payload has ok+uptime+version', parsed.ok === true && typeof parsed.uptime === 'number' && typeof parsed.version === 'string', h.body);

    // SECURITY: /tools still requires the token.
    const t = await get(port, '/tools');
    check('SECURITY: GET /tools without token -> 401', t.status === 401, `${t.status} ${t.body}`);
  }

  // Stop should close the port.
  headless.stop(rt.ctx);
  check('stop() clears mcpPort', !rt.ctx.mcpPort);

  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
  console.log(fail ? `\n${fail} check(s) failed.` : `\nAll mcp-health checks passed (${pass}).`);
  process.exit(fail ? 1 : 0);
})();
