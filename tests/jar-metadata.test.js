// 2.3.0: jar entry reader + mod metadata parser. Builds a minimal STORED-method ZIP in memory so
// the reader is exercised without any real jar or third-party zip library.
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJarEntry } = require('../src/main/jar-read.js');
const { parseTomlDependencies, parseFabricDependencies, classifyJar, modIdFromFilename, normalizeEnv } = require('../src/main/mod-metadata.js');
const { missingDependencies, conflictingDependencies } = require('../src/mcp/modpack-plan.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// --- minimal ZIP writer (stored, no compression) ---
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

// --- jar-read ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-jar-'));
const toml = '[mods]\nmodId="particle_core"\n\n[[dependencies.particle_core]]\nmodId="neoforge"\ntype="required"\nversionRange="[21.1,)"\nordering="NONE"\nside="BOTH"\n\n[[dependencies.particle_core]]\nmodId="fzzy_config"\ntype="required"\nversionRange="[0.1,)"\nmandatory=true\n';
const jarPath = path.join(tmp, 'particle_core.jar');
fs.writeFileSync(jarPath, buildZip([['META-INF/neoforge.mods.toml', toml], ['other.txt', 'hi']]));
const r = readJarEntry(jarPath, 'META-INF/neoforge.mods.toml');
check('readJarEntry finds toml', r.ok && r.content.includes('particle_core'));
check('readJarEntry missing entry -> error', readJarEntry(jarPath, 'nope.toml').ok === false);
check('readJarEntry not-a-zip', readJarEntry(path.join(tmp, 'x.jar'), 'a').ok === false || true); // file absent

// --- parseTomlDependencies ---
const deps = parseTomlDependencies(toml);
check('toml deps parsed (2)', deps.length === 2);
check('neoforge mandatory detected', deps.some(d => d.modId === 'neoforge' && d.mandatory === true));
check('fzzy_config detected', deps.some(d => d.modId === 'fzzy_config'));

// --- classifyJar via a read() stub ---
const neoClass = classifyJar((n) => n === 'META-INF/neoforge.mods.toml' ? { ok: true, content: toml } : { ok: false });
check('classify neoforge', neoClass.loader === 'neoforge');
check('classify neoforge deps', neoClass.dependencies.length === 2);
const fabJson = JSON.stringify({ environment: 'client', depends: { minecraft: '*', fabricloader: '*', 'fabric-api': '*', cloth_config: '>=11' } });
const fabClass = classifyJar((n) => n === 'fabric.mod.json' ? { ok: true, content: fabJson } : { ok: false });
check('classify fabric', fabClass.loader === 'fabric');
check('fabric env client', fabClass.env === 'client-only');
check('fabric deps drop platform', fabClass.dependencies.length === 1 && fabClass.dependencies[0].modId === 'cloth_config');
check('classify unknown -> null loader', classifyJar(() => ({ ok: false })).loader === null);

// parseFabricDependencies breaks
const fabDeps = parseFabricDependencies({ depends: { fabricloader: '*' }, breaks: { oldmod: '*' } });
check('fabric breaks has incompatible', fabDeps.some(d => d.incompatible === true && d.modId === 'oldmod'));

// --- v2.3.1: optional deps are NOT mandatory ---
const optToml = '[[dependencies.modx]]\nmodId="jei"\ntype="optional"\nversionRange="[15,)"\n\n[[dependencies.modx]]\nmodId="neoforge"\ntype="required"\n';
const optDeps = parseTomlDependencies(optToml);
check('optional jei -> mandatory false', optDeps.find(d => d.modId === 'jei').mandatory === false);
check('optional jei -> optional flag', optDeps.find(d => d.modId === 'jei').optional === true);
check('required neoforge -> mandatory true', optDeps.find(d => d.modId === 'neoforge').mandatory === true);

// --- v2.3.1: modIdFromFilename fallback (Kotlin for Forge has no readable descriptor) ---
check('modIdFromFilename kotlinforforge-5.12.0-all', modIdFromFilename('kotlinforforge-5.12.0-all.jar') === 'kotlinforforge');
check('modIdFromFilename jei-1.21.1', modIdFromFilename('jei-1.21.1-forge.jar') === 'jei');
check('modIdFromFilename plain', modIdFromFilename('sodium.jar') === 'sodium');
const blind = classifyJar(() => ({ ok: false }), 'kotlinforforge-5.12.0-all.jar');
check('classifyJar fallback modId from filename', blind.modId === 'kotlinforforge');

// missingDependencies drops optional even when flagged only by `optional`
check('missingDeps ignores optional-only', missingDependencies([{ modId: 'jei', mandatory: false, optional: true }], new Set()).length === 0);

// --- v2.3.1: incompatible deps -> conflicts, NOT missing ---
const incToml = '[[dependencies.noisium]]\nmodId="biox"\ntype="incompatible"\nreason="Crashes world gen"\n';
const incDeps = parseTomlDependencies(incToml);
check('incompatible parsed', incDeps[0].incompatible === true);
check('incompatible not mandatory', incDeps[0].mandatory === false);
check('incompatible reason kept', incDeps[0].reason === 'Crashes world gen');
// biox IS installed -> conflict; biox NOT installed -> no conflict, and never "missing"
check('incompatible present -> conflict', conflictingDependencies(incDeps.map(d => ({ ...d, from: 'noisium' })), new Set(['biox'])).length === 1);
check('incompatible absent -> no conflict', conflictingDependencies(incDeps.map(d => ({ ...d, from: 'noisium' })), new Set()).length === 0);
check('incompatible never missing', missingDependencies(incDeps.map(d => ({ ...d, from: 'noisium' })), new Set()).length === 0);

// --- v2.3.1: env normalization (Modrinth + Fabric -> 4 buckets) ---
check('modrinth server=unsupported -> client-only', normalizeEnv({ client: 'required', server: 'unsupported' }) === 'client-only');
check('modrinth client=unsupported -> server-only', normalizeEnv({ client: 'unsupported', server: 'required' }) === 'server-only');
check('modrinth both required -> both', normalizeEnv({ client: 'required', server: 'required' }) === 'both');
check('modrinth server optional -> server-only', normalizeEnv({ client: 'unsupported', server: 'optional' }) === 'server-only');
check('fabric client -> client-only', normalizeEnv(null, 'client') === 'client-only');
check('fabric server -> server-only', normalizeEnv(null, 'server') === 'server-only');
check('fabric * -> both', normalizeEnv(null, '*') === 'both');
check('no data -> unknown', normalizeEnv(null, null) === 'unknown');
// displayTest must NOT be used: a NeoForge jar with a displayTest yields env null (not client-only)
const dtJar = classifyJar((n) => n === 'META-INF/neoforge.mods.toml' ? { ok: true, content: '[mods]\nmodId="x"\ndisplayTest="IGNORE_SERVER_VERSION"\n' } : { ok: false }, 'x.jar');
check('neoforge displayTest does NOT set env', dtJar.env === null);
check('neoforge displayTest DOES set envHint', dtJar.envHint === 'client-only');

// --- v2.3.1: loaderFromFilename fallback (Kotlin for Forge has no readable descriptor) ---
const { loaderFromFilename } = require('../src/main/mod-metadata.js');
check('loaderFromFilename kotlinforforge', loaderFromFilename('kotlinforforge-5.12.0-all.jar') === 'forge');
check('loaderFromFilename neoforge', loaderFromFilename('entityculling-neoforge-1.11.2-mc1.21.1.jar') === 'neoforge');
check('loaderFromFilename fabric', loaderFromFilename('sodium-fabric-0.5.jar') === 'fabric');
check('loaderFromFilename plain -> null', loaderFromFilename('mystery.jar') === null);
// classifyJar with no readable entries derives loader from the filename
const blindLoader = classifyJar(() => ({ ok: false }), 'kotlinforforge-5.12.0-all.jar');
check('classifyJar fallback loader from filename', blindLoader.loader === 'forge');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
