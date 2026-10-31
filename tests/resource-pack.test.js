const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { inspectResourcePack, readPackTexture, clearPackCache } = require('../src/main/resource-pack.js');
const textures = require('../src/main/textures.js');

let pass = 0, fail = 0;
function check(name, cond) {
  cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));
}

// 1. Missing / invalid files
const resMissing = inspectResourcePack(path.join(os.tmpdir(), 'non-existent-pack.zip'));
check('missing pack returns ok: false', !resMissing.ok);

const badZipPath = path.join(os.tmpdir(), 'bad-pack.zip');
fs.writeFileSync(badZipPath, Buffer.from('not a zip file'));
const resBad = inspectResourcePack(badZipPath);
check('invalid zip returns ok: false', !resBad.ok);
fs.unlinkSync(badZipPath);

// Helper to construct a minimal valid ZIP file (stored method = 0)
function createZipBuffer(files) {
  const localHeaders = [];
  const cdHeaders = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const contentBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = 0; // simple mock for jar-reader
    const compSize = contentBuf.length;
    const uncompSize = contentBuf.length;

    // Local file header (30 bytes + name + content)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // LOC_SIG
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(0, 8); // method = 0 (stored)
    lh.writeUInt16LE(0, 10); // time
    lh.writeUInt16LE(0, 12); // date
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compSize, 18);
    lh.writeUInt32LE(uncompSize, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra length

    localHeaders.push(lh, nameBuf, contentBuf);

    // Central directory header (46 bytes + name)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // CD_SIG
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(0, 10); // method = 0 (stored)
    cd.writeUInt16LE(0, 12); // time
    cd.writeUInt16LE(0, 14); // date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compSize, 20);
    cd.writeUInt32LE(uncompSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra len
    cd.writeUInt16LE(0, 32); // comment len
    cd.writeUInt16LE(0, 34); // disk start
    cd.writeUInt16LE(0, 36); // internal attr
    cd.writeUInt32LE(0, 38); // external attr
    cd.writeUInt32LE(offset, 42); // local header offset

    cdHeaders.push(cd, nameBuf);
    offset += 30 + nameBuf.length + contentBuf.length;
  }

  const cdTotalSize = cdHeaders.reduce((acc, b) => acc + b.length, 0);
  const cdOffset = offset;
  const count = Object.keys(files).length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD_SIG
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(count, 8); // entries on disk
  eocd.writeUInt16LE(count, 10); // total entries
  eocd.writeUInt32LE(cdTotalSize, 12); // CD size
  eocd.writeUInt32LE(cdOffset, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
}

// 2. Build mock resource pack zip
const mockPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const mockSwordPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb, 0xcc, 0xdd]);
const packMcmeta = JSON.stringify({
  pack: {
    description: 'Test Pack 7.0.0Z',
    pack_format: 48,
  },
});

const zipBuffer = createZipBuffer({
  'pack.mcmeta': packMcmeta,
  'pack.png': mockPng,
  'assets/minecraft/textures/item/diamond_sword.png': mockSwordPng,
  'assets/minecraft/textures/models/armor/diamond_layer_1.png': mockPng,
});

const packPath = path.join(os.tmpdir(), 'test-resource-pack.zip');
fs.writeFileSync(packPath, zipBuffer);

try {
  // Test inspect
  const info = inspectResourcePack(packPath);
  check('inspect returns ok: true', info.ok);
  check('inspect has description', info.description === 'Test Pack 7.0.0Z');
  check('inspect has packFormat', info.packFormat === 48);
  check('inspect detects pack.png', info.hasIcon === true);

  // Test reading texture directly
  const swordBuf = readPackTexture(packPath, 'item', 'diamond_sword.png');
  check('readPackTexture finds diamond_sword.png', swordBuf && swordBuf.length === mockSwordPng.length);
  check('readPackTexture content matches', swordBuf && swordBuf[8] === 0xaa);

  const armorBuf = readPackTexture(packPath, 'armor', 'diamond.png');
  check('readPackTexture finds armor layer', armorBuf && armorBuf.length === mockPng.length);

  const missingBuf = readPackTexture(packPath, 'block', 'stone.png');
  check('readPackTexture returns null on miss', missingBuf === null);

  // Test tex:// protocol override
  textures.setActiveResourcePackPath(packPath);
  const resp = textures.handle({ url: 'tex://auto/item/diamond_sword.png' });
  check('tex:// override status 200', resp.status === 200);

  // Test clear cache
  clearPackCache();
  textures.setActiveResourcePackPath(null);
  check('setActiveResourcePackPath to null unsets pack', textures.getActiveResourcePackPath() === null);
} finally {
  try { fs.unlinkSync(packPath); } catch {}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

