// Unit tests for MCP mod compatibility and conflict tools (v6.1.6).
// Verifies tCheckModCompat and tListContent with real-world scenarios:
// - Jars named with older versions (e.g. 1.16.4) on a 1.16.5 server.
// - Authoritative internal metadata (mods.toml, fabric.mod.json, mcmod.info).
// - Duplicate modId detection.
// - Accurate diagnostic outputs preventing AI false positives.

const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');

// Mock electron before requiring tools.js
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => path.join(os.tmpdir(), 'ob-mcp-compat-test') } };
  return origLoad.apply(this, arguments);
};

const { getTool } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// Minimal zip builder helper
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
}
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(cdStart, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-mcp-compat-'));
  const modsDir = path.join(tmp, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  // Create a 1.16.5 Forge server environment
  fs.writeFileSync(path.join(tmp, 'forge-1.16.5-36.2.39-server.jar'), 'stub');
  fs.writeFileSync(path.join(tmp, 'server.properties'), 'server-port=25565\n');

  // Mod 1: filename says 1.16.4, but mods.toml declares [1.16.4, 1.16.5]
  const appleskinToml = `
[mods]
modId = "appleskin"
version = "0.8.1"
displayName = "AppleSkin"

[[dependencies.appleskin]]
modId = "minecraft"
mandatory = true
versionRange = "[1.16.4, 1.16.5]"
`;
  fs.writeFileSync(path.join(modsDir, 'appleskin-mc1.16.4-forge-tip-0.8.1.jar'), buildZip([
    ['META-INF/mods.toml', appleskinToml]
  ]));

  // Mod 2: filename says 1.16.4 (author forgot to rename), mods.toml declares 1.16.4
  // Cross-patch compatible with 1.16.5 server
  const jeiToml = `
[mods]
modId = "jei"
version = "7.6.1"
displayName = "Just Enough Items"

[[dependencies.jei]]
modId = "minecraft"
mandatory = true
versionRange = "1.16.4"
`;
  fs.writeFileSync(path.join(modsDir, 'jei-1.16.4-7.6.1.jar'), buildZip([
    ['META-INF/mods.toml', jeiToml]
  ]));

  const ctx = {
    currentServerPath: tmp,
    serverStatus: 'stopped',
    javaInfo: { version: '11.0.22', ok: true }
  };

  const tCheckModCompat = getTool('check_mod_compat').handler;
  const tListContent = getTool('list_content').handler;

  // --- Test tCheckModCompat ---
  const compatRes = await tCheckModCompat(ctx);
  check('check_mod_compat succeeds', compatRes.ok === true);
  const cr = compatRes.result;
  check('server detected as mc=1.16.5 loader=forge', cr.server.mc === '1.16.5' && cr.server.loader === 'forge');
  check('scanned 2 mods', cr.modsScanned === 2);
  check('overall health is ok (no false positive)', cr.ok === true);
  check('zero issues flagged', cr.issues.length === 0);
  check('zero missing deps', cr.missingDeps.length === 0);
  check('zero conflicts', cr.conflicts.length === 0);
  check('zero duplicates', cr.duplicates.length === 0);

  // Check mcSummary
  check('mcSummary scanned=2', cr.mcSummary.scanned === 2);
  check('mcSummary compatible=2', cr.mcSummary.compatible === 2);
  check('mcSummary incompatible=0', cr.mcSummary.incompatible === 0);
  check('mcSummary crossPatch=1', cr.mcSummary.crossPatch === 1);

  // Check detailed mod info
  const mAppleskin = cr.mods.find(m => m.modId === 'appleskin');
  check('appleskin mcRange is [1.16.4, 1.16.5]', mAppleskin.mcRange === '[1.16.4, 1.16.5]');
  check('appleskin mcStatus is range', mAppleskin.mcStatus === 'range');
  check('appleskin mcCompatible is true', mAppleskin.mcCompatible === true);

  const mJei = cr.mods.find(m => m.modId === 'jei');
  check('jei mcStatus is cross-patch', mJei.mcStatus === 'cross-patch');
  check('jei mcCompatible is true', mJei.mcCompatible === true);
  check('jei note clarifies compatibility for AI', mJei.note.includes('binary/network compatible'));

  // --- Test tListContent ---
  const listRes = await tListContent(ctx);
  check('list_content succeeds', listRes.ok === true);
  const lr = listRes.result;
  const lAppleskin = lr.mods.find(m => m.modId === 'appleskin');
  check('list_content carries mcVersionRange', lAppleskin.mcVersionRange === '[1.16.4, 1.16.5]');
  check('list_content carries mcCompatible=true', lAppleskin.mcCompatible === true);
  check('list_content carries mcStatus=range', lAppleskin.mcStatus === 'range');

  const lJei = lr.mods.find(m => m.modId === 'jei');
  check('list_content jei has mcCompatible=true', lJei.mcCompatible === true);
  check('list_content jei has mcStatus=cross-patch', lJei.mcStatus === 'cross-patch');

  // --- Test Duplicate Detection in tCheckModCompat ---
  // Add another jar with the same modId "appleskin"
  fs.writeFileSync(path.join(modsDir, 'appleskin-extra.jar'), buildZip([
    ['META-INF/mods.toml', appleskinToml]
  ]));
  const dupRes = await tCheckModCompat(ctx);
  check('duplicate mod makes ok=false', dupRes.result.ok === false);
  check('duplicate reported in duplicates list', dupRes.result.duplicates.some(d => d.modId === 'appleskin'));
  check('duplicate reported in issues list', dupRes.result.issues.some(i => i.problem === 'duplicate'));

  // Remove duplicate
  fs.unlinkSync(path.join(modsDir, 'appleskin-extra.jar'));

  // --- Test Genuinely Incompatible Minecraft Version ---
  const incompToml = `
[mods]
modId = "futuremod"
version = "1.0"
[[dependencies.futuremod]]
modId = "minecraft"
mandatory = true
versionRange = "[1.20, 1.21)"
`;
  fs.writeFileSync(path.join(modsDir, 'futuremod-1.20.jar'), buildZip([
    ['META-INF/mods.toml', incompToml]
  ]));
  const incompRes = await tCheckModCompat(ctx);
  check('incompatible mod makes ok=false', incompRes.result.ok === false);
  const incompIssue = incompRes.result.issues.find(i => i.problem === 'mc-incompatible');
  check('mc-incompatible issue raised for 1.20 mod on 1.16.5', !!incompIssue && incompIssue.modId === 'futuremod');

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
