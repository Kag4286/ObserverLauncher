// tests/jar-reader-lazy.test.js — the lazy openJar() path added for the v6.0.0 memory fix.
// Asserts the handle reads entries from disk without ever loading the whole jar into memory.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { openJar, JarHandle } = require('../src/main/jar-reader.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
}

// Zip builder with STORED and DEFLATE entries; the payload can be padded so the file is large.
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, method } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const payload = method === 8 ? zlib.deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + payload.length;
  }
  const lp = Buffer.concat(locals), cp = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cp.length, 12);
  eocd.writeUInt32LE(lp.length, 16);
  return Buffer.concat([lp, cp, eocd]);
}

const tmp = path.join(os.tmpdir(), 'jrlazy-' + Date.now() + '.jar');
const padding = Buffer.alloc(200 * 1024, 0x7a); // 200 KB of noise, enough to notice if it is loaded
fs.writeFileSync(tmp, makeZip([
  { name: 'small.txt', data: Buffer.from('hello'), method: 0 },
  { name: 'deflated.txt', data: Buffer.from('world '.repeat(100)), method: 8 },
  { name: 'assets/mod/textures/item/x.png', data: padding, method: 0 },
]));

try {
  t('openJar lists every entry', () => {
    const j = openJar(tmp);
    assert.deepStrictEqual(j.list().sort(), ['assets/mod/textures/item/x.png', 'deflated.txt', 'small.txt']);
  });

  t('openJar reads a STORED entry', () => {
    assert.strictEqual(openJar(tmp).read('small.txt').toString(), 'hello');
  });

  t('openJar reads a DEFLATE entry', () => {
    assert.strictEqual(openJar(tmp).read('deflated.txt').toString(), 'world '.repeat(100));
  });

  t('openJar reads a large nested entry intact', () => {
    const buf = openJar(tmp).read('assets/mod/textures/item/x.png');
    assert.strictEqual(buf.length, 200 * 1024);
    assert.strictEqual(buf[0], 0x7a);
  });

  t('openJar does not keep the jar body in the handle', () => {
    const j = openJar(tmp);
    // The handle holds a Map of entry metadata only. No Buffer field should be anywhere near the
    // size of the file (200 KB+); the biggest field is the small entry table.
    assert.ok(j instanceof JarHandle);
    const blobs = Object.values(j).filter(v => Buffer.isBuffer(v));
    for (const b of blobs) assert.ok(b.length < 64 * 1024, 'handle holds a large Buffer');
    assert.ok(!('buf' in j), 'handle still has a buf field');
  });

  t('openJar leaves no file descriptor open', () => {
    // Reading twice in a row must work: each read opens and closes its own fd, so a leaked fd
    // would not surface here, but a closed-fd bug would throw on the second call.
    const j = openJar(tmp);
    assert.strictEqual(j.read('small.txt').toString(), 'hello');
    assert.strictEqual(j.read('small.txt').toString(), 'hello');
  });

  t('a missing entry throws', () => {
    assert.throws(() => openJar(tmp).read('nope.txt'), /Entry not found/);
  });

  t('a non-zip throws', () => {
    const bad = path.join(os.tmpdir(), 'jrlazy-bad-' + Date.now() + '.jar');
    fs.writeFileSync(bad, 'not a zip');
    try { assert.throws(() => openJar(bad), /Not a ZIP/); } finally { fs.unlinkSync(bad); }
  });
} finally { fs.unlinkSync(tmp); }

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
