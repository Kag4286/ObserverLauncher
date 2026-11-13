// v8.1.1: Verify World Map Worker Thread isolation + auto-idle termination,
// and true streaming disk writes (with backpressure + maxBytes cap) in http.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

const { createWorldmapWorkerClient } = require('../src/main/worldmap-worker.js');
const { download } = require('../src/main/http.js');

let pass = 0;
let fail = 0;
const ck = (name, cond) => (cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name)));

function makeMinimalRegionWorld(tmpDir) {
  const regionDir = path.join(tmpDir, 'world', 'region');
  fs.mkdirSync(regionDir, { recursive: true });

  const chunkTag = nbt.comp({
    Status: nbt.string('minecraft:full'),
    xPos: nbt.int(0),
    zPos: nbt.int(0),
    sections: nbt.list(nbt.comp([
      {
        Y: nbt.byte(4),
        biomes: nbt.comp({
          palette: nbt.list(nbt.string(['minecraft:plains']))
        })
      }
    ]))
  });
  const rawNbt = nbt.writeUncompressed(chunkTag);
  const compressed = zlib.deflateSync(rawNbt);

  const sectorCount = Math.ceil((5 + compressed.length) / 4096);
  const buf = Buffer.alloc((2 + sectorCount) * 4096);
  // Header slot (0,0) -> sector offset 2, sector count
  buf.writeUInt32BE((2 << 8) | sectorCount, 0);
  // Sector 2 chunk header: 4-byte payload len + 1-byte zlib type (2)
  const dataOff = 2 * 4096;
  buf.writeUInt32BE(compressed.length + 1, dataOff);
  buf[dataOff + 4] = 2;
  compressed.copy(buf, dataOff + 5);

  fs.writeFileSync(path.join(regionDir, 'r.0.0.mca'), buf);
  return tmpDir;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-v811-ws-'));

  try {
    // 1) World Map Worker Thread: scan + biomes + auto-idle terminate + respawn
    {
      const worldRoot = makeMinimalRegionWorld(path.join(tmp, 'srv'));
      const client = createWorldmapWorkerClient({ idleTtlMs: 120 });

      ck('worker not spawned before first call', client.isAlive() === false);

      const explored = await client.scanExploredChunks(worldRoot, 'world', 'overworld');
      ck('worker spawned on scanExploredChunks', client.isAlive() === true);
      ck('worker scanExploredChunks finds chunk 0,0', Array.isArray(explored.chunks) && explored.chunks.includes('0,0'));

      const bio = await client.readBiomes(worldRoot, 'world', 'overworld', { cx0: 0, cz0: 0, cx1: 0, cz1: 0, lod: 'full' });
      ck('worker readBiomes returns minecraft:plains for 0,0', Array.isArray(bio.biomes) && bio.biomes.length === 1 && bio.biomes[0][2] === 'minecraft:plains');

      // Wait for idle auto-termination (120ms TTL)
      await new Promise(r => setTimeout(r, 280));
      ck('worker auto-terminated after idle TTL', client.isAlive() === false);

      // Re-spawns seamlessly on next call and can also be explicitly terminated
      const bio2 = await client.readBiomes(worldRoot, 'world', 'overworld', { cx0: 0, cz0: 0, cx1: 0, cz1: 0, lod: 'fast' });
      ck('worker re-spawned after idle termination', client.isAlive() === true && bio2.biomes.length === 1);

      await client.terminate();
      ck('worker terminated immediately via clear/terminate', client.isAlive() === false);
    }

    // 2) Streaming disk download over HTTP (multi-chunk payload > 64KB highWaterMark)
    {
      const chunks = [
        Buffer.alloc(70 * 1024, 0x41),
        Buffer.alloc(90 * 1024, 0x42),
        Buffer.alloc(40 * 1024, 0x43)
      ];
      const expected = Buffer.concat(chunks);
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-length': expected.length });
        let i = 0;
        const pushNext = () => {
          if (i >= chunks.length) { res.end(); return; }
          res.write(chunks[i++]);
          setTimeout(pushNext, 10);
        };
        pushNext();
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;

      const dest = path.join(tmp, 'streamed.bin');
      const progressCalls = [];
      const size = await download(`http://127.0.0.1:${port}/file`, dest, (got, tot) => {
        progressCalls.push([got, tot]);
      });

      ck('streaming download writes full byte length', size === expected.length);
      ck('streaming download content exact match', fs.readFileSync(dest).equals(expected));
      ck('streaming download reports incremental progress', progressCalls.length >= 2);
      ck('no leftover .part after streamed finish', !fs.existsSync(dest + '.part'));
      server.close();
    }

    // 3) Streaming async-iterable mock fetch + maxBytes abort removes .part and stays bounded
    {
      const origFetch = global.fetch;
      try {
        // 3a: Async iterable body (without getReader) streams chunk-by-chunk
        const a = Buffer.alloc(32 * 1024, 1);
        const b = Buffer.alloc(32 * 1024, 2);
        global.fetch = async () => ({
          ok: true,
          status: 200,
          headers: new Map([['content-length', String(a.length + b.length)]]),
          body: {
            async *[Symbol.asyncIterator]() {
              yield a;
              yield b;
            }
          }
        });
        const destAsync = path.join(tmp, 'async-iter.bin');
        const sz = await download('https://example.invalid/iter', destAsync);
        ck('async-iterator body streams cleanly', sz === a.length + b.length && fs.readFileSync(destAsync).equals(Buffer.concat([a, b])));

        // 3b: Stream aborts immediately when maxBytes is exceeded (no full buffering)
        let yieldedChunks = 0;
        let maxBytesError = null;
        global.fetch = async () => ({
          ok: true,
          status: 200,
          headers: new Map([['content-length', String(512 * 1024)]]),
          body: {
            async *[Symbol.asyncIterator]() {
              for (let i = 0; i < 8; i++) {
                yieldedChunks++;
                yield Buffer.alloc(64 * 1024, i);
              }
            }
          }
        });
        const destCap = path.join(tmp, 'capped.bin');
        try {
          await download('https://example.invalid/huge', destCap, null, null, { maxBytes: 100 * 1024 });
        } catch (err) {
          maxBytesError = err;
        }
        ck('maxBytes rejects oversized stream', !!maxBytesError && /exceeds the/.test(maxBytesError.message));
        ck('maxBytes aborts before consuming entire stream', yieldedChunks <= 2);
        ck('maxBytes removes .part cleanly on abort', !fs.existsSync(destCap + '.part'));
      } finally {
        global.fetch = origFetch;
      }
    }

    // 4) Wiring checks for content-handlers.js, app-lifecycle.js, and http.js
    {
      const contentSrc = fs.readFileSync(path.join(__dirname, '../src/main/content-handlers.js'), 'utf8');
      const lifecycleSrc = fs.readFileSync(path.join(__dirname, '../src/main/app-lifecycle.js'), 'utf8');
      const httpSrc = fs.readFileSync(path.join(__dirname, '../src/main/http.js'), 'utf8');

      ck('content-handlers delegates chunks & biomes to worldmap-worker',
        contentSrc.includes("require('./worldmap-worker.js')") &&
        contentSrc.includes('worldmapWorker.scanExploredChunks') &&
        contentSrc.includes('worldmapWorker.readBiomes') &&
        contentSrc.includes('worldmapWorker.terminate()'));
      ck('app-lifecycle terminates worldmap-worker on minimize and quit',
        lifecycleSrc.includes("require('./worldmap-worker.js').terminate"));
      ck('http.js uses createWriteStream and has no sync full-buffer download fallback',
        httpSrc.includes('fs.createWriteStream') && !httpSrc.includes('Buffer.from(await r.arrayBuffer())'));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
