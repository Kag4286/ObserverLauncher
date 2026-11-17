// Regression tests for:
// 1. Multi-loader / universal JARs (neoforge + forge + fabric + quilt in one JAR)
// 2. Lenient JSON parsing in fabric.mod.json & pack.mcmeta (unescaped newlines in strings, comments, trailing commas)
// 3. Inline TOML `mods = [...]` metadata parsing
// 4. Official Minecraft Data Pack pack_format validation & wrapped zip warning
const fs = require('fs');
const os = require('os');
const path = require('path');

const { classifyJar, selectLoaderProfile, parseTomlModInfo } = require('../src/main/mod-metadata.js');
const { scanContentConflicts } = require('../src/main/content-conflicts.js');
const { validateDatapack } = require('../src/main/content-ops.js');
const { getTool } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.error('FAIL', name); }
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
}
function buildZip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nb = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const crc = crc32(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18); lfh.writeUInt32LE(data.length, 22); lfh.writeUInt16LE(nb.length, 26);
    chunks.push(lfh, nb, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nb.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, nb);
    offset += 30 + nb.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

(async () => {
  // 1. Inline TOML `mods = [{ ... }]`
  {
    const inlineToml = `modLoader = 'lowcodefml'\nloaderVersion = '[40,)'\nmods = [\n\t{ modId = 'mr_ending', version = '1.1.2d', displayName = 'True Ending' },\n]`;
    const ti = parseTomlModInfo(inlineToml);
    ck('parseTomlModInfo extracts modId/version/displayName from inline mods = [...]',
      ti.modId === 'mr_ending' && ti.version === '1.1.2d' && ti.name === 'True Ending');
  }

  // 2. Lenient fabric.mod.json (raw literal newline inside description string) + multi-loader selection
  const tmpSrv = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-multi-dp-'));
  try {
    fs.mkdirSync(path.join(tmpSrv, 'mods'), { recursive: true });
    fs.mkdirSync(path.join(tmpSrv, 'world', 'datapacks'), { recursive: true });
    fs.writeFileSync(path.join(tmpSrv, 'fabric-server-mc.1.21.1-loader.0.20.1.jar'), '');

    // Fabric API with bundled fabric-resource-loader-v0 submodule
    const subJar = buildZip([
      ['fabric.mod.json', JSON.stringify({ id: 'fabric-resource-loader-v0', version: '2.0.0' })],
    ]);
    fs.writeFileSync(path.join(tmpSrv, 'mods', 'fabric-api-0.116.18+1.21.1.jar'), buildZip([
      ['fabric.mod.json', JSON.stringify({
        schemaVersion: 1, id: 'fabric-api', version: '0.116.18+1.21.1',
        provides: ['fabric'], jars: [{ file: 'META-INF/jars/fabric-resource-loader-v0.jar' }],
      })],
      ['META-INF/jars/fabric-resource-loader-v0.jar', subJar],
    ]));

    // Library mod whose fabric.mod.json contains an unescaped literal newline inside description (bluelib-style)
    const rawBluelibJson = '{\n  "schemaVersion": 1,\n  "id": "bluelib",\n  "version": "2.4.3",\n  "name": "BlueLib",\n  "description": "Line one\nLine two",\n  "depends": { "fabric-api": ">=0.100.0", "minecraft": "1.21.1" }\n}';
    fs.writeFileSync(path.join(tmpSrv, 'mods', '2.4.3-fabric-1.21.1-bluelib-2.4.3.jar'), buildZip([
      ['fabric.mod.json', rawBluelibJson],
    ]));

    // Consumer mod depending on bluelib
    fs.writeFileSync(path.join(tmpSrv, 'mods', 'dragon-academy-0.5.jar'), buildZip([
      ['fabric.mod.json', JSON.stringify({
        schemaVersion: 1, id: 'bda', version: '0.5.0', name: 'Dragon Academy',
        depends: { bluelib: '>=2.4.3 <2.5.0', minecraft: '1.21.1' },
      })],
    ]));

    // Universal multi-loader JAR with neoforge.mods.toml + mods.toml + fabric.mod.json + quilt.mod.json
    fs.writeFileSync(path.join(tmpSrv, 'mods', 'omni-tweaks-universal-1.3.7.jar'), buildZip([
      ['META-INF/neoforge.mods.toml', '[[mods]]\nmodId="omni_neo"\nversion="1.3.7"\ndisplayName="Omni Tweaks"\n[[dependencies.omni_neo]]\nmodId="missing_neo_only_lib"\ntype="required"\n'],
      ['META-INF/mods.toml', '[[mods]]\nmodId="omni_forge"\nversion="1.3.7"\ndisplayName="Omni Tweaks"\n'],
      ['fabric.mod.json', JSON.stringify({
        schemaVersion: 1, id: 'omni_fab', version: '1.3.7', name: 'Omni Tweaks',
        depends: { 'fabric-resource-loader-v0': '*', minecraft: '1.21.1' },
      })],
      ['quilt.mod.json', JSON.stringify({
        schema_version: 1, quilt_loader: { id: 'omni_quilt', version: '1.3.7', metadata: { name: 'Omni Tweaks' } },
      })],
    ]));

    // Scan on Fabric 1.21.1 -> MUST pass cleanly with 0 issues
    const fabScan = await scanContentConflicts(tmpSrv);
    ck('Fabric scan of lenient JSON lib + consumer + universal multi-loader mod has 0 issues', fabScan.ok === true && fabScan.issues.length === 0);
    ck('Lenient fabric.mod.json parses real modId "bluelib" instead of filename guess', fabScan.metadata['2.4.3-fabric-1.21.1-bluelib-2.4.3.jar']?.modId === 'bluelib');
    ck('Universal jar resolves fabric profile on Fabric server', fabScan.metadata['omni-tweaks-universal-1.3.7.jar']?.loader === 'fabric' && fabScan.metadata['omni-tweaks-universal-1.3.7.jar']?.modId === 'omni_fab');
    ck('Universal jar lists all 4 declared loaders', JSON.stringify(fabScan.metadata['omni-tweaks-universal-1.3.7.jar']?.loaders) === JSON.stringify(['neoforge', 'forge', 'fabric', 'quilt']));

    // Same universal jar inspected on a NeoForge server -> picks neoforge profile cleanly
    const neoOnlyCls = classifyJar(e => e === 'META-INF/neoforge.mods.toml' ? { ok: true, content: '[[mods]]\nmodId="pure_neo"\n' } : { ok: false });
    ck('Pure NeoForge mod on Fabric still preserves loader=neoforge (wrong loader caught)', selectLoaderProfile(neoOnlyCls, 'fabric').loader === 'neoforge');

    // MCP list_content & check_mod_compat agree with GUI scan on universal + lenient JSON jars
    const listRes = await getTool('list_content').handler({ currentServerPath: tmpSrv });
    const mcpOmni = listRes.result.mods.find(m => m.modId === 'omni_fab');
    ck('MCP list_content resolves universal jar to fabric without loaderMismatch', !!mcpOmni && mcpOmni.loader === 'fabric' && !mcpOmni.loaderMismatch);

    const compatRes = await getTool('check_mod_compat').handler({ currentServerPath: tmpSrv });
    ck('MCP check_mod_compat agrees with scanContentConflicts (0 issues)', compatRes.ok && compatRes.result.ok === true);

    // 3. Datapack end-to-end validateDatapack on 1.21.1 (format 48) + wrapped subfolder zip
    fs.writeFileSync(path.join(tmpSrv, 'world', 'datapacks', 'valid-1211.zip'), buildZip([
      ['pack.mcmeta', JSON.stringify({ pack: { pack_format: 48, description: 'Valid 1.21.1 datapack' } })],
    ]));
    const dpOk = validateDatapack(tmpSrv, 'valid-1211.zip');
    ck('validateDatapack accepts format 48 on 1.21.1 server as ok', dpOk.ok && dpOk.result.level === 'ok' && dpOk.result.expected === 48);

    fs.writeFileSync(path.join(tmpSrv, 'world', 'datapacks', 'wrapped.zip'), buildZip([
      ['MyWrappedPack/pack.mcmeta', JSON.stringify({ pack: { pack_format: 48 } })],
    ]));
    const dpWrapped = validateDatapack(tmpSrv, 'wrapped.zip');
    ck('validateDatapack reads nested top-folder pack.mcmeta cleanly on 1.21.1',
      dpWrapped.ok && dpWrapped.result.level === 'ok' && dpWrapped.result.expected === 48);
  } finally {
    try { fs.rmSync(tmpSrv, { recursive: true, force: true }); } catch {}
  }

  console.log(`\nmultiloader-lenient-dp: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
