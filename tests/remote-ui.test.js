// 4.4.0: the Remote web dashboard — static serving, same-origin Origin relaxation, and the
// /ui/config read-only probe. Real HTTP against 127.0.0.1 with injected handlers.
const { createRemoteServer } = require('../src/main/remote.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));
const get = (url, headers) => fetch(url, { headers: headers || {} }).then(async r => ({ status: r.status, type: r.headers.get('content-type') || '', body: await r.text() }));

(async () => {
  const srv = createRemoteServer({
    token: 'tok-ui', allow: [], readOnly: false, version: '9.9.9',
    handlers: {
      instances: async () => ({ instances: [{ id: 'default', name: 'Main' }] }),
      status: async () => ({ running: true }),
      console: async () => ({ lines: ['a', 'b'] }),
      players: async () => ({ online: [] }),
      command: async (c) => ({ ran: c }),
    },
  });
  const port = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: 'Bearer tok-ui' };

  // --- static assets are served WITHOUT auth (they carry no secret) ---
  let r = await get(`${base}/`);
  ck('GET / -> 200 html', r.status === 200 && /text\/html/.test(r.type));
  ck('GET / contains the dashboard shell', /ObserverLauncher/.test(r.body) && /id="app"/.test(r.body));
  r = await get(`${base}/ui`);
  ck('GET /ui -> 200 html', r.status === 200 && /text\/html/.test(r.type));
  r = await get(`${base}/ui/style.css`);
  ck('GET /ui/style.css -> 200 css', r.status === 200 && /text\/css/.test(r.type));
  r = await get(`${base}/ui/app.js`);
  ck('GET /ui/app.js -> 200 js', r.status === 200 && /javascript/.test(r.type));

  // --- /ui/config needs the token and reports readOnly ---
  r = await get(`${base}/ui/config`);
  ck('/ui/config without token -> 401', r.status === 401);
  r = await get(`${base}/ui/config`, auth);
  ck('/ui/config with token -> 200 readOnly:false', r.status === 200 && JSON.parse(r.body).data.readOnly === false);

  // --- Origin guard: same-origin allowed, cross-origin 403, no Origin allowed ---
  const post = (origin) => fetch(`${base}/command`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ command: 'list' }),
  }).then(async x => ({ status: x.status, body: await x.json().catch(() => ({})) }));

  let cr = await post(`${base}`);
  ck('same-origin Origin -> allowed (200)', cr.status === 200 && cr.body.data && cr.body.data.ran === 'list');
  cr = await post('https://evil.example');
  ck('cross-origin Origin -> 403', cr.status === 403);
  cr = await post('');
  ck('no Origin (curl) -> allowed', cr.status === 200);

  // --- traversal: a static path built from request input must NEVER serve source ---
  const raw = require('http');
  const rawGet = (path, headers) => new Promise(res => {
    const req = raw.request({ host: '127.0.0.1', port, path, method: 'GET', headers: headers || {} }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, body: b })); });
    req.on('error', () => res({ status: 0, body: '' })); req.end();
  });
  let tr = await rawGet('/ui/../remote.js', auth);
  ck('traversal /ui/../remote.js does NOT serve source', tr.status === 401 || tr.status === 404);
  ck('traversal response has no source markers', !/createRemoteServer/.test(tr.body));
  tr = await rawGet('/%2e%2e/remote.js', auth);
  ck('encoded traversal -> not served', tr.status === 401 || tr.status === 404);

  // --- read-only server hides the command box and still blocks /command ---
  const ro = createRemoteServer({ token: 't', allow: [], readOnly: true, handlers: { command: async () => ({}) } });
  const rp = await ro.listen();
  const rbase = `http://127.0.0.1:${rp}`;
  r = await get(`${rbase}/ui/config`, { authorization: 'Bearer t' });
  ck('read-only /ui/config -> readOnly:true', r.status === 200 && JSON.parse(r.body).data.readOnly === true);
  const rc = await fetch(`${rbase}/command`, { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ command: 'stop' }) });
  ck('read-only /command -> 403', rc.status === 403);
  ro.close();

  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
