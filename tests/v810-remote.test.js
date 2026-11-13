// v8.1.0 Remote Access 2.0 tests: Host allowlist, query-safe routing, brute-force 429,
// SSE /events stream (with instance filter & cap), /metrics, /backups, expanded /action, and i18n parity.
const fs = require('fs');
const path = require('path');
const { createRemoteServer, parseAllowedHosts, isHostAllowed } = require('../src/main/remote.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

(async () => {
  // 1. parseAllowedHosts & isHostAllowed unit checks
  const hosts = parseAllowedHosts('*.ts.net, remote.example.com:8443, *');
  ck('parseAllowedHosts drops bare *', hosts.length === 2 && !hosts.includes('*'));
  ck('isHostAllowed exact match', isHostAllowed('remote.example.com', '127.0.0.1', hosts));
  ck('isHostAllowed wildcard *.ts.net', isHostAllowed('mybox.ts.net', '127.0.0.1', hosts));
  ck('isHostAllowed rejects root ts.net', !isHostAllowed('ts.net', '127.0.0.1', hosts));
  ck('isHostAllowed rejects evil.com', !isHostAllowed('evil.com', '127.0.0.1', hosts));
  ck('isHostAllowed allows loopback always', isHostAllowed('127.0.0.1', '127.0.0.1', hosts));
  ck('isHostAllowed rejects hex non-IP hostname on 0.0.0.0', !isHostAllowed('deadbeef', '0.0.0.0', []));
  ck('isHostAllowed allows real IPv6 literal on 0.0.0.0', isHostAllowed('::1', '0.0.0.0', []));

  // 2. Real HTTP server with allowedHosts, SSE, /metrics, /backups, expanded /action
  const actionLog = [];
  const srv = createRemoteServer({
    token: 'tok-v810',
    allow: [],
    allowedHosts: ['*.ts.net'],
    readOnly: false,
    version: '8.1.0',
    handlers: {
      instances: async () => ({ instances: [{ id: 'default' }] }),
      status: async () => ({ running: true }),
      console: async () => ({ lines: [] }),
      players: async () => ({ online: [] }),
      metrics: async () => ({ tps: 20, cpu: 12, ramMb: 1024, maxRamMb: 4096 }),
      backups: async () => ({ backups: [{ name: 'b1.zip', size: 100 }] }),
      command: async (c) => ({ ran: c }),
      action: async (a, payload) => { actionLog.push({ a, payload }); return { ok: true, action: a }; },
    },
  });
  const port = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer tok-v810' };

  // Query-string routing on /health and UI assets
  let r = await fetch(`${base}/health?probe=1`);
  ck('/health?probe=1 -> 200', r.status === 200);
  r = await fetch(`${base}/ui/style.css?v=810`);
  ck('/ui/style.css?v=810 -> 200 text/css', r.status === 200 && (r.headers.get('content-type') || '').includes('text/css'));
  r = await fetch(`${base}/ui/app.js?v=810`);
  ck('/ui/app.js?v=810 -> 200 js', r.status === 200);

  // Host header validation (allowedHosts) via raw http so Node fetch doesn't override Host
  const http = require('http');
  const rawReq = (reqPath, hostHeader, hdrs = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: reqPath, method: 'GET', headers: { Host: hostHeader, ...hdrs } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end();
  });
  const hOk = await rawReq('/status', 'node1.ts.net', auth);
  ck('Host *.ts.net -> 200', hOk.status === 200);
  const hBad = await rawReq('/status', 'evil.example.org', auth);
  ck('Host evil.example.org -> 403', hBad.status === 403);

  // /metrics and /backups
  const mr = await fetch(`${base}/metrics`, { headers: auth });
  const mj = await mr.json();
  ck('/metrics -> 200 tps=20', mr.status === 200 && mj.data.tps === 20);
  const br = await fetch(`${base}/backups`, { headers: auth });
  const bj = await br.json();
  ck('/backups -> 200 list', br.status === 200 && bj.data.backups.length === 1);

  // Expanded /action
  for (const [action, extra] of [
    ['force_stop', {}],
    ['backup', {}],
    ['whitelist_add', { name: 'Steve' }],
    ['whitelist_remove', { name: 'Steve' }],
    ['ban', { name: 'Griefer' }],
    ['unban', { name: 'Griefer' }],
  ]) {
    const ar = await fetch(`${base}/action`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    ck(`POST /action ${action} -> 200`, ar.status === 200);
  }
  ck('actionLog recorded all 6', actionLog.length === 6 && actionLog[2].payload.name === 'Steve');

  // SSE /events stream + instance filtering
  const ac = new AbortController();
  const sseRes = await fetch(`${base}/events?instance=survival`, { headers: auth, signal: ac.signal });
  ck('SSE /events -> 200 text/event-stream', sseRes.status === 200 && (sseRes.headers.get('content-type') || '').includes('text/event-stream'));
  const reader = sseRes.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const readUntil = async (needle) => {
    const deadline = Date.now() + 2000;
    while (!buf.includes(needle) && Date.now() < deadline) {
      const timeout = new Promise(resolve => setTimeout(() => resolve({ value: null, done: true }), Math.max(10, deadline - Date.now())));
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    return buf.includes(needle);
  };
  ck('SSE initial connected comment', await readUntil(': connected'));
  srv.publish('log', { instanceId: 'creative', line: 'SKIP_ME' });
  srv.publish('log', { instanceId: 'survival', line: 'KEEP_ME' });
  srv.publish('metrics', { instanceId: 'survival', tps: 19.8 });
  ck('SSE receives matching instance log', await readUntil('KEEP_ME'));
  ck('SSE filters out other instance', !buf.includes('SKIP_ME'));
  ck('SSE receives metrics event', await readUntil('event: metrics'));
  ac.abort();

  // Read-only gating on new actions
  const roSrv = createRemoteServer({
    token: 'tok-ro', allow: [], readOnly: true,
    handlers: {
      instances: async () => ({ instances: [] }),
      status: async () => ({}),
      console: async () => ({}),
      players: async () => ({}),
      action: async () => ({ ok: true }),
    },
  });
  const roPort = await roSrv.listen();
  const roAct = await fetch(`http://127.0.0.1:${roPort}/action`, {
    method: 'POST',
    headers: { authorization: 'Bearer tok-ro', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'backup' }),
  });
  ck('readOnly blocks POST /action backup -> 403', roAct.status === 403);
  await roSrv.close();

  // Brute-force 429 limiter on separate server
  const bfSrv = createRemoteServer({
    token: 'tok-bf', allow: [], readOnly: true,
    handlers: { instances: async () => ({}), status: async () => ({}), console: async () => ({}), players: async () => ({}) },
  });
  const bfPort = await bfSrv.listen();
  let lastStatus = 0;
  for (let i = 0; i < 16; i++) {
    const res = await fetch(`http://127.0.0.1:${bfPort}/status`, { headers: { authorization: 'Bearer bad' } });
    lastStatus = res.status;
  }
  ck('16th failed auth -> 429 rate limited', lastStatus === 429);
  const blockedValidDuringLock = await fetch(`http://127.0.0.1:${bfPort}/status`, { headers: { authorization: 'Bearer tok-bf' } });
  ck('valid token ALSO blocked during 429 lockout', blockedValidDuringLock.status === 429);
  const healthDuringLock = await fetch(`http://127.0.0.1:${bfPort}/health`);
  ck('/health still 200 during auth lock', healthDuringLock.status === 200);
  await bfSrv.close();

  await srv.close();

  // 3. Locale parity check for new keys in src/renderer/locales/*.js
  const locDir = path.join(__dirname, '..', 'src', 'renderer', 'locales');
  const locFiles = fs.readdirSync(locDir).filter(f => f.endsWith('.js') && f !== 'meta.js');
  for (const f of locFiles) {
    const txt = fs.readFileSync(path.join(locDir, f), 'utf8');
    ck(`locale ${f} has remote.allowedHosts & remote.openDash`, txt.includes("'remote.allowedHosts'") && txt.includes("'remote.allowedHostsSub'") && txt.includes("'remote.openDash'"));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
