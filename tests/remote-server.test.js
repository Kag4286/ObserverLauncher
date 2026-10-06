// R2 (v3.3.0): the loopback remote server. Real HTTP against 127.0.0.1 with injected handlers, so
// no Electron / no real tool. Verifies auth, allowlist, read-only gating and the /health bypass.
const { createRemoteServer } = require('../src/main/remote.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));
const get = (url, headers) => fetch(url, { headers: headers || {} }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

(async () => {
  let lastInst = 'unset';
  const srv = createRemoteServer({
    token: 'tok-123', allow: [], readOnly: false, version: '9.9.9',
    handlers: {
      instances: async () => ({ instances: [{ id: 'default' }, { id: 'b' }] }),
      status: async (inst) => { lastInst = inst; return { running: true }; },
      console: async (n) => ({ lines: n }),
      players: async () => ({ online: ['a', 'b'] }),
      command: async (c, inst) => ({ ran: c, inst }),
    },
  });
  const port = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer tok-123' };

  let r = await get(`${base}/health`);
  ck('/health no auth -> 200 ok', r.status === 200 && r.body.ok === true);
  ck('/health has version', r.body.version === '9.9.9');

  r = await get(`${base}/status`);
  ck('/status no token -> 401', r.status === 401);

  r = await get(`${base}/status`, { authorization: 'Bearer wrong' });
  ck('/status bad token -> 401', r.status === 401);

  r = await get(`${base}/status`, auth);
  ck('/status good token -> 200', r.status === 200 && r.body.ok === true);
  ck('/status data', r.body.data.running === true);

  r = await get(`${base}/console?lines=50`, auth);
  ck('/console lines param', r.body.data.lines === 50);
  r = await get(`${base}/console`, auth);
  ck('/console default 200', r.body.data.lines === 200);

  r = await get(`${base}/players`, auth);
  ck('/players data', r.body.data.online.length === 2);

  r = await get(`${base}/instances`, auth);
  ck('/instances data', r.status === 200 && r.body.data.instances.length === 2);
  r = await get(`${base}/status?instance=b`, auth);
  ck('?instance passed to handler', r.status === 200 && lastInst === 'b');
  r = await get(`${base}/status`, auth);
  ck('no instance -> empty string', lastInst === '');

  r = await get(`${base}/nope`, auth);
  ck('unknown -> 404', r.status === 404);

  // command (readOnly false)
  let cr = await fetch(`${base}/command`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'list' }) });
  ck('command POST -> 200', cr.status === 200);
  ck('command ran', (await cr.json()).data.ran === 'list');

  // SECURITY: a newline in the command is rejected (else it would inject a second console command)
  cr = await fetch(`${base}/command`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'say hi\r\nstop' }) });
  ck('multi-line command -> 400', cr.status === 400);

  // SECURITY: a browser-shaped request (Origin header) is refused up front
  const or = await get(`${base}/status`, { ...auth, origin: 'https://evil.example' });
  ck('Origin header -> 403', or.status === 403);

  srv.close();

  // read-only server blocks command
  const ro = createRemoteServer({ token: 't', allow: [], readOnly: true, handlers: { command: async () => ({ ran: 'x' }) } });
  const rp = await ro.listen();
  const rbase = `http://127.0.0.1:${rp}`;
  const rcr = await fetch(`${rbase}/command`, { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ command: 'stop' }) });
  ck('read-only command -> 403', rcr.status === 403);
  ro.close();

  // allowlist blocks a non-listed IP (127.0.0.1 is NOT in the allow list)
  const al = createRemoteServer({ token: 't', allow: ['10.9.9.9'], readOnly: true, handlers: { status: async () => ({}) } });
  const ap = await al.listen();
  const ar = await get(`http://127.0.0.1:${ap}/status`, { authorization: 'Bearer t' });
  ck('IP outside allowlist -> 403', ar.status === 403);
  al.close();

  // BUGFIX regression: a 0.0.0.0 (wildcard) bind must accept a request whose Host is the REAL IP
  // (a client never sends Host: 0.0.0.0). A hostname Host must still be rejected (DNS-rebinding).
  // NOTE: fetch() silently DROPS a Host header (forbidden header) so we use a raw http request.
  const http = require('http');
  const rawGet = (port, hostHeader, authHeader) => new Promise(res => {
    const req = http.request({ host: '127.0.0.1', port, path: '/status', method: 'GET', headers: { host: hostHeader, authorization: authHeader } }, r => { r.resume(); r.on('end', () => res(r.statusCode)); });
    req.on('error', () => res(0)); req.end();
  });
  const wb = createRemoteServer({ token: 't', allow: [], readOnly: true, bind: '0.0.0.0', handlers: { status: async () => ({ ok: 1 }) } });
  const wp = await wb.listen();
  ck('wildcard bind: real-IP Host -> 200', (await rawGet(wp, `192.168.1.5:${wp}`, 'Bearer t')) === 200);
  ck('wildcard bind: hostname Host -> 403', (await rawGet(wp, 'evil.example.com', 'Bearer t')) === 403);
  wb.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
