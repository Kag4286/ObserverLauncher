// v6.0.0 F4: Prometheus /metrics format + server guard. Pure renderer + a loopback server that
// answers /metrics once.
const assert = require('assert');
const http = require('http');
const P = require('../src/main/prometheus.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- escapeLabel ---
ok('escapeLabel backslash', P.escapeLabel('a\\b') === 'a\\\\b');
ok('escapeLabel quote', P.escapeLabel('a"b') === 'a\\"b');
ok('escapeLabel newline', P.escapeLabel('a\nb') === 'a\\nb');
ok('escapeLabel null -> empty', P.escapeLabel(null) === '');

// --- renderInstance ---
const runningRow = { id: 'a', name: 'Alpha', group: 'Play', status: 'running', running: true, tps: 19.5, mspt: 30, cpu: 40, ram: 55, players: 2, uptimeMs: 600000 };
const lines = P.renderInstance(runningRow);
ok('status is 2 for running', lines.some(l => /^observerlauncher_server_status\{.*\} 2$/.test(l)));
ok('tps emitted', lines.some(l => /^observerlauncher_tps\{.*\} 19\.5$/.test(l)));
ok('mspt emitted', lines.some(l => /^observerlauncher_mspt\{.*\} 30$/.test(l)));
ok('cpu emitted', lines.some(l => /^observerlauncher_cpu_percent\{.*\} 40$/.test(l)));
ok('ram emitted', lines.some(l => /^observerlauncher_ram_percent\{.*\} 55$/.test(l)));
ok('players emitted', lines.some(l => /^observerlauncher_players\{.*\} 2$/.test(l)));
ok('uptime seconds emitted', lines.some(l => /^observerlauncher_uptime_seconds\{.*\} 600$/.test(l)));
ok('labels include id/name/group', lines[0].includes('instance="a"') && lines[0].includes('name="Alpha"') && lines[0].includes('group="Play"'));

// Stopped row: status=0 present, all other metrics absent.
const stoppedRow = { id: 'b', name: 'Beta', status: 'stopped', running: false, tps: null, mspt: null, cpu: null, ram: null, players: 0, uptimeMs: 0 };
const sLines = P.renderInstance(stoppedRow);
ok('stopped status=0', sLines.some(l => /^observerlauncher_server_status\{.*\} 0$/.test(l)));
ok('stopped players=0 emitted', sLines.some(l => /^observerlauncher_players\{.*\} 0$/.test(l)));
ok('stopped tps omitted', !sLines.some(l => l.startsWith('observerlauncher_tps{')));
ok('stopped uptime omitted', !sLines.some(l => l.startsWith('observerlauncher_uptime_seconds{')));

// starting/stopping enums.
ok('starting status=1', P.renderInstance({ status: 'starting' }).some(l => /server_status\{.*\} 1$/.test(l)));
ok('stopping status=3', P.renderInstance({ status: 'stopping' }).some(l => /server_status\{.*\} 3$/.test(l)));

// --- renderMetrics ---
const body = P.renderMetrics([runningRow, stoppedRow], '6.0.0');
ok('has info block', body.includes('# HELP observerlauncher_info') && body.includes('observerlauncher_info{version="6.0.0"} 1'));
ok('has status type', body.includes('# TYPE observerlauncher_server_status gauge'));
ok('both instances rendered', body.includes('instance="a"') && body.includes('instance="b"'));
ok('body ends with newline', body.endsWith('\n'));
ok('empty rows -> info only', P.renderMetrics([], '6.0.0').includes('observerlauncher_info') && !P.renderMetrics([], '6.0.0').includes('instance='));

// --- server guards ---
(async () => {
  const srv = P.createPrometheusServer({
    version: 'test',
    snapshot: () => [runningRow],
  });
  const port = await srv.listen();
  ok('server listening on loopback', port > 0);

  const get = (path) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = ''; res.on('data', (c) => body += c); res.on('end', () => resolve({ code: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });

  const r1 = await get('/metrics');
  ok('/metrics 200', r1.code === 200);
  ok('/metrics content-type', /text\/plain; version=0\.0\.4/.test(r1.headers['content-type']));
  ok('/metrics body has tps', r1.body.includes('observerlauncher_tps'));

  const r2 = await get('/other');
  ok('/other 404', r2.code === 404);

  // Wrong Host header -> 403 (DNS-rebinding guard).
  const bad = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/metrics', method: 'GET', headers: { host: 'evil.example.com' } }, (res) => {
      let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ code: res.statusCode }));
    });
    req.on('error', reject); req.end();
  });
  ok('foreign Host 403', bad.code === 403);

  // Cross-origin Origin -> 403.
  const cors = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/metrics', method: 'GET', headers: { origin: 'http://evil.example.com' } }, (res) => {
      let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ code: res.statusCode }));
    });
    req.on('error', reject); req.end();
  });
  ok('cross-origin Origin 403', cors.code === 403);

  srv.close();
  console.log(`\n${passed} passed, 0 failed`);
})();
