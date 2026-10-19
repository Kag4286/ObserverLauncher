// tests/jar-reader.test.js — pure ZIP reader used to pull textures out of a Minecraft client jar.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { listEntries, readEntry, openJar } = require('../src/main/jar-reader.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
}

// Build a minimal zip in memory: STORED (method 0) + DEFLATE (method 8) entries.
function makeZip(entries) {
  // entries: [{ name, data, method }]
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const method = e.method || 0;
    const payload = method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const crc = 0; // not validated by the reader
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + payload.length;
  }
  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

const zip = makeZip([
  { name: 'a/one.txt', data: Buffer.from('hello'), method: 0 },
  { name: 'a/two.txt', data: Buffer.from('world world world world'), method: 8 },
]);

t('listEntries returns every name', () => {
  const names = listEntries(zip);
  assert.deepStrictEqual(names, ['a/one.txt', 'a/two.txt']);
});

t('readEntry STORED', () => {
  assert.strictEqual(readEntry(zip, 'a/one.txt').toString(), 'hello');
});

t('readEntry DEFLATE', () => {
  assert.strictEqual(readEntry(zip, 'a/two.txt').toString(), 'world world world world');
});

t('readEntry missing throws', () => {
  assert.throws(() => readEntry(zip, 'nope.txt'), /Entry not found/);
});

t('not a zip throws', () => {
  assert.throws(() => listEntries(Buffer.from('hello')), /Not a ZIP/);
});

t('openJar from disk', () => {
  const tmp = path.join(os.tmpdir(), 'jrtest-' + Date.now() + '.zip');
  fs.writeFileSync(tmp, zip);
  try {
    const j = openJar(tmp);
    assert.deepStrictEqual(j.list(), ['a/one.txt', 'a/two.txt']);
    assert.strictEqual(j.read('a/one.txt').toString(), 'hello');
  } finally { try { fs.unlinkSync(tmp); } catch {} }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
