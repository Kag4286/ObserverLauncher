// Regression: downloads must survive a dropped connection. download() retries and, when the
// server supports HTTP Range, resumes from the bytes already on disk instead of restarting.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { download } = require('../src/main/http.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const PAYLOAD = Buffer.alloc(64 * 1024, 7); // 64 KB of 0x07

function startServer({ supportRange, failFirst }) {
  let reqCount = 0;
  const server = http.createServer((req, res) => {
    reqCount++;
    const range = req.headers.range;
    if (supportRange && range) {
      const m = /bytes=(\d+)-/.exec(range);
      const start = m ? Number(m[1]) : 0;
      res.writeHead(206, { 'content-range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`, 'content-length': PAYLOAD.length - start });
      // On the first request, send half then destroy to simulate a mid-stream drop.
      if (failFirst && reqCount === 1) { res.write(PAYLOAD.slice(start, start + 1024)); setTimeout(() => res.destroy(), 20); return; }
      res.end(PAYLOAD.slice(start));
    } else {
      res.writeHead(200, { 'content-length': PAYLOAD.length });
      if (failFirst && reqCount === 1) { res.write(PAYLOAD.slice(0, 1024)); setTimeout(() => res.destroy(), 20); return; }
      res.end(PAYLOAD);
    }
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, count: () => reqCount })));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-dl-'));

  // 1) clean download with Range-capable server
  {
    const { server, port } = await startServer({ supportRange: true, failFirst: false });
    const dest = path.join(tmp, 'a.bin');
    await download(`http://127.0.0.1:${port}/a`, dest, () => {});
    ck('clean download size', fs.statSync(dest).size === PAYLOAD.length);
    ck('clean download bytes', fs.readFileSync(dest).equals(PAYLOAD));
    server.close();
  }

  // 2) drop mid-stream on a Range-capable server → retry resumes (2 requests, correct bytes)
  {
    const { server, port, count } = await startServer({ supportRange: true, failFirst: true });
    const dest = path.join(tmp, 'b.bin');
    await download(`http://127.0.0.1:${port}/b`, dest, () => {});
    ck('resumed download size', fs.statSync(dest).size === PAYLOAD.length);
    ck('resumed download bytes', fs.readFileSync(dest).equals(PAYLOAD));
    ck('resume used >1 request', count() >= 2);
    ck('no leftover .part', !fs.existsSync(dest + '.part'));
    server.close();
  }

  // 3) drop mid-stream on a NON-Range server → retry restarts and still succeeds
  {
    const { server, port } = await startServer({ supportRange: false, failFirst: true });
    const dest = path.join(tmp, 'c.bin');
    await download(`http://127.0.0.1:${port}/c`, dest, () => {});
    ck('non-range retry size', fs.statSync(dest).size === PAYLOAD.length);
    ck('non-range retry bytes', fs.readFileSync(dest).equals(PAYLOAD));
    server.close();
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
