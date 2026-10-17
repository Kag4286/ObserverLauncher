// v6.0.0 H2: download() hardening - fail fast on a permanent HTTP failure (4xx), retry a transient
// one (5xx), and reject a clean-but-short body when content-length was declared.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { download } = require('../src/main/http.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

function serve(handler) {
  let count = 0;
  const server = http.createServer((req, res) => { count++; handler(req, res, count); });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, count: () => count })));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-dlh-'));

  // 1) 404 is permanent: exactly ONE request, error thrown, no .part left.
  {
    const { server, port, count } = await serve((req, res) => { res.writeHead(404); res.end('nope'); });
    const dest = path.join(tmp, 'a.bin');
    let threw = false;
    try { await download(`http://127.0.0.1:${port}/a`, dest, () => {}); } catch { threw = true; }
    ck('404 -> throws', threw);
    ck('404 -> only 1 request (no retry)', count() === 1);
    ck('404 -> no .part leftover', !fs.existsSync(dest + '.part'));
    server.close();
  }

  // 2) 503 is transient: retried, and a later success wins.
  {
    const PAY = Buffer.alloc(4096, 3);
    const { server, port, count } = await serve((req, res, n) => {
      if (n === 1) { res.writeHead(503); res.end('busy'); return; }
      res.writeHead(200, { 'content-length': PAY.length }); res.end(PAY);
    });
    const dest = path.join(tmp, 'b.bin');
    const size = await download(`http://127.0.0.1:${port}/b`, dest, () => {});
    ck('503 -> retried then ok', size === PAY.length && fs.readFileSync(dest).equals(PAY));
    ck('503 -> used >1 request', count() >= 2);
    server.close();
  }

  // 3) short body with declared content-length is rejected (incomplete), then a good retry succeeds.
  {
    const PAY = Buffer.alloc(5000, 9);
    const { server, port, count } = await serve((req, res, n) => {
      if (n === 1) { res.writeHead(200, { 'content-length': PAY.length }); res.write(PAY.slice(0, 100)); res.end(); return; }
      res.writeHead(200, { 'content-length': PAY.length }); res.end(PAY);
    });
    const dest = path.join(tmp, 'c.bin');
    const size = await download(`http://127.0.0.1:${port}/c`, dest, () => {});
    ck('short body -> retried to full size', size === PAY.length && fs.readFileSync(dest).equals(PAY));
    ck('short body -> used >1 request', count() >= 2);
    server.close();
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
