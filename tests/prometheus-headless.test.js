// v6.0.0 F4: prove the Prometheus server actually starts via the same lifecycle path the GUI uses
// (settings:save -> startPrometheus), serves /metrics, and returns a body. This is the end-to-end
// check the GUI path cannot easily exercise in unit tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-prom-'));
process.env.OBSERVER_DATA_DIR = dataDir;

const { createHeadless } = require('../src/headless.js');
const { loadSettings, saveSettings } = require('../src/main/settings.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ code: res.statusCode, body: b, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

(async () => {
  // 1. Create the headless ctx.
  const { ctx } = createHeadless();

  // 2. Turn Prometheus on exactly the way the GUI does (settings:save).
  const s = loadSettings();
  s.prometheusEnabled = true;
  s.prometheusPort = 0;
  saveSettings(s);

  // 3. Call the SAME lifecycle function settings:save calls.
  await ctx.startPrometheus();
  ok('ctx.prometheusPort set', ctx.prometheusPort > 0);
  ok('ctx.prometheusServer set', !!ctx.prometheusServer);

  // 4. GET the exact path the user curls.
  const r1 = await get(ctx.prometheusPort, '/metrics');
  ok('GET /metrics 200', r1.code === 200);
  ok('GET /metrics body non-empty', r1.body.length > 0);
  ok('GET /metrics has info family', r1.body.includes('observerlauncher_info'));
  ok('GET /metrics has status family', r1.body.includes('observerlauncher_server_status'));
  ok('GET /metrics content-type', /text\/plain/.test(r1.headers['content-type'] || ''));

  // 5. Trailing slash (Invoke-WebRequest).
  const r2 = await get(ctx.prometheusPort, '/metrics/');
  ok('GET /metrics/ 200', r2.code === 200);

  // 6. Wrong path -> 404.
  const r3 = await get(ctx.prometheusPort, '/nope');
  ok('GET /nope 404', r3.code === 404);

  // 7. Stop clears the port + server.
  ctx.stopPrometheus();
  ok('stopPrometheus clears port', ctx.prometheusPort === 0);
  ok('stopPrometheus clears server', ctx.prometheusServer === null);

  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  console.log(`\n${passed} passed, 0 failed`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
