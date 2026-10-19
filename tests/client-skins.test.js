// tests/client-skins.test.js — pure helpers of the client-jar skin fallback.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { versionJars, texturesFromJar } = require('../src/main/client-skins.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
}

// Small self-contained zip builder (STORED entries are enough for these tests).
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
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

const WIDE = 'assets/minecraft/textures/entity/player/wide/steve.png';
const SLIM = 'assets/minecraft/textures/entity/player/slim/alex.png';

t('versionJars sorts newest first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-ver-'));
  try {
    for (const v of ['1.19.2', '1.21.4', '1.20.1', 'abc']) {
      fs.mkdirSync(path.join(dir, v));
      fs.writeFileSync(path.join(dir, v, `${v}.jar`), 'x');
    }
    const out = versionJars(dir).map(x => x.version);
    assert.strictEqual(out[0], '1.21.4');
    assert.strictEqual(out[1], '1.20.1');
    assert.strictEqual(out[2], '1.19.2');
    assert.ok(out.includes('abc'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

t('versionJars on missing dir returns []', () => {
  assert.deepStrictEqual(versionJars(path.join(os.tmpdir(), 'nope-' + Date.now())), []);
});

t('texturesFromJar finds wide and slim', () => {
  const tmp = path.join(os.tmpdir(), 'cs-jar-' + Date.now() + '.jar');
  fs.writeFileSync(tmp, makeZip([[WIDE, Buffer.from('W')], [SLIM, Buffer.from('S')]]));
  try {
    const tex = texturesFromJar(tmp);
    assert.ok(tex);
    assert.strictEqual(tex.wide.toString(), 'W');
    assert.strictEqual(tex.slim.toString(), 'S');
  } finally { fs.unlinkSync(tmp); }
});

t('texturesFromJar falls back to legacy path', () => {
  const tmp = path.join(os.tmpdir(), 'cs-jar2-' + Date.now() + '.jar');
  fs.writeFileSync(tmp, makeZip([['assets/minecraft/textures/entity/steve.png', Buffer.from('W')]]));
  try {
    const tex = texturesFromJar(tmp);
    assert.ok(tex);
    assert.strictEqual(tex.wide.toString(), 'W');
    assert.strictEqual(tex.slim, undefined);
  } finally { fs.unlinkSync(tmp); }
});

t('texturesFromJar returns null when no player texture', () => {
  const tmp = path.join(os.tmpdir(), 'cs-jar3-' + Date.now() + '.jar');
  fs.writeFileSync(tmp, makeZip([['assets/minecraft/textures/block/stone.png', Buffer.from('x')]]));
  try { assert.strictEqual(texturesFromJar(tmp), null); }
  finally { fs.unlinkSync(tmp); }
});

t('texturesFromJar on a non-jar returns null', () => {
  const tmp = path.join(os.tmpdir(), 'cs-jar4-' + Date.now() + '.jar');
  fs.writeFileSync(tmp, 'not a zip');
  try { assert.strictEqual(texturesFromJar(tmp), null); }
  finally { fs.unlinkSync(tmp); }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
