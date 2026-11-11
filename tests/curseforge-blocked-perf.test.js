// v8.0.1: Verify CurseForge blocked-file fast-path hashing, PNG magic-byte check in skins.js,
// and mtime+size cache key in content-conflicts.js.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyBlockedFiles } = require('../src/main/curseforge.js');
const { isValidPngBuffer } = require('../src/main/skins.js');
const { safeClassify } = require('../src/main/content-conflicts.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) pass++;
  else { fail++; console.error('FAIL:', label); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-cf-perf-'));
try {
  const modsDir = path.join(tmpDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  // Create 50 unrelated jars + 1 target blocked jar
  for (let i = 0; i < 50; i++) {
    fs.writeFileSync(path.join(modsDir, `aaa-unrelated-${i}.jar`), `unrelated-content-${i}`);
  }
  const targetBytes = Buffer.from('target-blocked-mod-content');
  const targetSha1 = crypto.createHash('sha1').update(targetBytes).digest('hex');
  fs.writeFileSync(path.join(modsDir, 'zzz-target.jar'), targetBytes);

  // Instrument fs.readFileSync to count how many files verifyBlockedFiles reads on the fast path
  const origReadFileSync = fs.readFileSync;
  let readCount = 0;
  fs.readFileSync = function (p, ...args) {
    if (String(p).startsWith(modsDir)) readCount++;
    return origReadFileSync.call(fs, p, ...args);
  };
  let res;
  try {
    res = verifyBlockedFiles(tmpDir, [{ fileName: 'zzz-target.jar', hashes: { sha1: targetSha1 } }], 'mods');
  } finally {
    fs.readFileSync = origReadFileSync;
  }

  check('verifyBlockedFiles matches target jar', res.verified.length === 1 && res.verified[0].matchedFile === 'zzz-target.jar');
  check('verifyBlockedFiles fast path reads ONLY the matching filename (1 read instead of 51)', readCount === 1);

  // Fallback path: renamed file still matches by SHA-1
  const renamedBytes = Buffer.from('renamed-blocked-mod-content');
  const renamedSha1 = crypto.createHash('sha1').update(renamedBytes).digest('hex');
  fs.writeFileSync(path.join(modsDir, 'custom-renamed.jar'), renamedBytes);
  const res2 = verifyBlockedFiles(tmpDir, [{ fileName: 'original-name.jar', hashes: { sha1: renamedSha1 } }], 'mods');
  check('verifyBlockedFiles fallback matches renamed jar by sha1', res2.verified.length === 1 && res2.verified[0].matchedFile === 'custom-renamed.jar');

  // Test skins.js isValidPngBuffer (Item 15)
  const validPng = Buffer.alloc(128, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(validPng, 0);
  check('isValidPngBuffer accepts valid PNG header >= 100 bytes', isValidPngBuffer(validPng) === true);
  check('isValidPngBuffer rejects HTML/text buffer >= 100 bytes', isValidPngBuffer(Buffer.from('<html>404 Not Found</html>'.repeat(10))) === false);
  check('isValidPngBuffer rejects truncated PNG < 100 bytes', isValidPngBuffer(validPng.subarray(0, 50)) === false);

  // Test content-conflicts.js safeClassify cache invalidation on size change with identical mtime (Item 16)
  // Build two minimal valid ZIP archives with different fabric.mod.json modIds and different byte lengths,
  // but force identical mtimeMs via fs.utimesSync.
  function makeStoredZip(entryName, contentStr) {
    const nameBuf = Buffer.from(entryName, 'utf8');
    const dataBuf = Buffer.from(contentStr, 'utf8');
    const local = Buffer.alloc(30 + nameBuf.length + dataBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    dataBuf.copy(local, 30 + nameBuf.length);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 42);
    nameBuf.copy(cd, 46);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(local.length, 16);
    return Buffer.concat([local, cd, eocd]);
  }

  const jarPath = path.join(modsDir, 'cache-test.jar');
  const fixedDate = new Date(1700000000000);
  fs.writeFileSync(jarPath, makeStoredZip('fabric.mod.json', JSON.stringify({ id: 'mod_alpha', version: '1.0.0' })));
  fs.utimesSync(jarPath, fixedDate, fixedDate);
  const cls1 = safeClassify(modsDir, 'cache-test.jar');

  // Replace with a larger jar but preserve the exact same mtime
  fs.writeFileSync(jarPath, makeStoredZip('fabric.mod.json', JSON.stringify({ id: 'mod_beta_longer_payload', version: '2.0.0', description: 'extra bytes' })));
  fs.utimesSync(jarPath, fixedDate, fixedDate);
  const cls2 = safeClassify(modsDir, 'cache-test.jar');

  check('safeClassify invalidates cache when file size changes despite identical mtime',
    cls1 && cls1.modId === 'mod_alpha' && cls2 && cls2.modId === 'mod_beta_longer_payload'
  );
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log(`curseforge-blocked-perf: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

