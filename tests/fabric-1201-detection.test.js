// Integration tests for real Fabric 1.20.1 ZIP scanning, Jar-in-Jar, provides, Fabric API alias, disabled skipping, and corrupt JAR detection.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanContentConflicts } = require('../src/main/content-conflicts.js');
const { detectServerTarget } = require('../src/main/server-compat.js');
const { serverFiles } = require('../src/main/server-files.js');

let pass = 0;
function ok(name, cond, detail) {
  assert(cond, `FAIL: ${name}${detail ? ' -> ' + detail : ''}`);
  console.log(`PASS ${name}`);
  pass++;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function buildZipBuffer(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-fab1201-'));
  try {
    const modsDir = path.join(root, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'fabric-server-mc.1.20.1-loader.0.16.10.jar'), 'stub');

    // Scenario 1: Healthy Fabric 1.20.1 server with Jar-in-Jar, provides, 1.20.x wildcard, and disabled duplicate
    const nestedMidnight = buildZipBuffer([
      ['fabric.mod.json', JSON.stringify({ id: 'midnightlib', version: '1.4.1', environment: '*' })],
    ]);
    const nestedFabricNet = buildZipBuffer([
      ['fabric.mod.json', JSON.stringify({ id: 'fabric-networking-api-v1', version: '1.3.11', environment: '*' })],
    ]);

    fs.writeFileSync(path.join(modsDir, 'fabric-api-0.92.2+1.20.1.jar'), buildZipBuffer([
      ['fabric.mod.json', JSON.stringify({ id: 'fabric-api', name: 'Fabric API', version: '0.92.2+1.20.1', provides: ['fabric'], depends: { minecraft: '1.20.x' } })],
      ['META-INF/jars/fabric-networking-api-v1.jar', nestedFabricNet],
    ]));

    fs.writeFileSync(path.join(modsDir, 'coolmod-fabric-1.20.x.jar'), buildZipBuffer([
      ['fabric.mod.json', JSON.stringify({
        id: 'coolmod',
        name: 'Cool Mod',
        version: '2.0.0',
        environment: '*',
        jars: [{ file: 'META-INF/jars/midnightlib.jar' }],
        depends: {
          minecraft: '1.20.x',
          fabricloader: '*',
          fabric: '*',
          midnightlib: '*',
          'fabric-networking-api-v1': '*',
        },
      })],
      ['META-INF/jars/midnightlib.jar', nestedMidnight],
    ]));

    // Disabled older duplicate should NOT trigger a duplicate warning, while retaining metadata
    fs.writeFileSync(path.join(modsDir, 'coolmod-fabric-1.0.0.jar.disabled'), buildZipBuffer([
      ['fabric.mod.json', JSON.stringify({ id: 'coolmod', name: 'Cool Mod Old', version: '1.0.0' })],
    ]));

    const files1 = serverFiles(root);
    const srv1 = detectServerTarget(root, files1);
    ok('Fabric 1.20.1 server detected cleanly', srv1.loader === 'fabric' && srv1.mc === '1.20.1', JSON.stringify(srv1));

    const scan1 = await scanContentConflicts(root);
    ok('Fabric 1.20.1 real JiJ + 1.20.x + disabled duplicate scan is clean', scan1.ok === true, JSON.stringify(scan1.issues));
    ok('Disabled jar keeps metadata without counting as active issue', scan1.metadata['coolmod-fabric-1.0.0.jar.disabled']?.name === 'Cool Mod Old');

    // Scenario 2: Remove fabric-api -> should flag missing-dep for fabric-api!
    fs.unlinkSync(path.join(modsDir, 'fabric-api-0.92.2+1.20.1.jar'));
    const scan2 = await scanContentConflicts(root);
    ok('Removing fabric-api flags missing-dep', !scan2.ok && scan2.issues.some(i => i.type === 'missing-dep' && i.requiredModId === 'fabric-api'), JSON.stringify(scan2.issues));

    // Scenario 3: Corrupt active JAR -> should flag corrupt-jar
    fs.writeFileSync(path.join(modsDir, 'broken-download.jar'), '<html>not a jar</html>');
    const scan3 = await scanContentConflicts(root);
    ok('Corrupt JAR flagged with corrupt-jar issue', scan3.issues.some(i => i.fileName === 'broken-download.jar' && i.type === 'corrupt-jar'), JSON.stringify(scan3.issues));

    console.log(`\n${pass} passed, 0 failed`);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
})();
