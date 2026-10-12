// 5.4.0: persistent metrics store. Covers append + buffered flush, load (oldest first, corrupt lines
// skipped), retention trim, delete, and the path-safety fallback for an odd instance id. Uses
// OBSERVER_DATA_DIR so nothing touches the real userData folder.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(os.tmpdir(), 'ob-metrics-store-' + process.pid);
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
process.env.OBSERVER_DATA_DIR = dataDir;

const store = require('../src/main/metrics-store.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

(async () => {
  // 1) recordSample buffers; nothing is written until flushAll() or the interval elapses.
  {
    const id = 'aaaa1111';
    store._resetBuffers();
    store.recordSample(id, { t: 1000, tps: 20, mspt: 5, cpu: 10, ram: 512, players: 2 });
    ok('no file before flush', !fs.existsSync(store.metricsPath(id)));
    store.flushAll();
    ok('file exists after flush', fs.existsSync(store.metricsPath(id)));
    const lines = fs.readFileSync(store.metricsPath(id), 'utf8').trim().split('\n');
    ok('one line written', lines.length === 1);
    ok('line parses back', JSON.parse(lines[0]).tps === 20);
  }

  // 2) loadSamples returns samples oldest first and drops corrupt lines.
  {
    const id = 'bbbb2222';
    store._resetBuffers();
    const file = store.metricsPath(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const now = Date.now();
    const good1 = JSON.stringify({ t: now - 5000, tps: 19, mspt: 6, cpu: 11, ram: 500, players: 1 });
    const good2 = JSON.stringify({ t: now - 1000, tps: 20, mspt: 5, cpu: 12, ram: 520, players: 2 });
    fs.writeFileSync(file, good2 + '\nnot json\n' + good1 + '\n\n');
    const loaded = store.loadSamples(id, store.RETENTION_MS);
    ok('load: corrupt line skipped', loaded.length === 2);
    ok('load: oldest first', loaded[0].t === now - 5000 && loaded[1].t === now - 1000);
    ok('load: shape preserved', loaded[1].tps === 20 && loaded[1].players === 2);
  }

  // 3) loadSamples filters by age.
  {
    const id = 'cccc3333';
    store._resetBuffers();
    const file = store.metricsPath(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const now = Date.now();
    fs.writeFileSync(file, JSON.stringify({ t: now - 9999999, tps: 1 }) + '\n' + JSON.stringify({ t: now, tps: 2 }) + '\n');
    const loaded = store.loadSamples(id, 60000);
    ok('load: old sample filtered out', loaded.length === 1 && loaded[0].tps === 2);
  }

  // 4) trimStore rewrites the file keeping only samples within the window (only when large enough).
  {
    const id = 'dddd4444';
    store._resetBuffers();
    const file = store.metricsPath(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const now = Date.now();
    const lines = [];
    for (let i = 0; i < store.TRIM_LINE_THRESHOLD + 100; i++) {
      lines.push(JSON.stringify({ t: now - (i * 10000), tps: 20 }));
    }
    fs.writeFileSync(file, lines.join('\n') + '\n');
    store.trimStore(id, 60 * 60 * 1000);
    const after = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length;
    ok('trim: file shrank', after < store.TRIM_LINE_THRESHOLD);
    ok('trim: kept recent samples', after > 0);
  }

  // 5) trimStore no-ops on a small file (below the threshold).
  {
    const id = 'eeee5555';
    store._resetBuffers();
    const file = store.metricsPath(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ t: Date.now(), tps: 20 }) + '\n');
    const before = fs.readFileSync(file, 'utf8');
    store.trimStore(id, 60000);
    ok('trim: small file untouched', fs.readFileSync(file, 'utf8') === before);
  }

  // 6) deleteStore removes the file and buffered lines.
  {
    const id = 'ffff6666';
    store._resetBuffers();
    store.recordSample(id, { t: Date.now(), tps: 20 });
    store.flushAll();
    ok('delete: file exists first', fs.existsSync(store.metricsPath(id)));
    store.deleteStore(id);
    ok('delete: file gone', !fs.existsSync(store.metricsPath(id)));
  }

  // 7) An unsafe instance id never escapes the metrics folder.
  {
    const p = store.metricsPath('../../evil');
    const dir = path.resolve(store.metricsDir());
    ok('unsafe id stays inside metrics dir', path.resolve(p).startsWith(dir));
    ok('unsafe id is not the raw name', !p.includes('..'));
  }

  // 8) loadSamples on a missing file returns an empty array, never throws.
  {
    ok('missing file -> []', Array.isArray(store.loadSamples('nonexistent', 60000)) && store.loadSamples('nonexistent', 60000).length === 0);
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
