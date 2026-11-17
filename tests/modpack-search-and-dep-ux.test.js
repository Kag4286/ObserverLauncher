// Regression tests for:
// 1. Modrinth modpack loader facet fix (categories:<loader> OR loaders:<loader>)
// 2. Forge/NeoForge mods.toml side="CLIENT" optional handling on dedicated servers
// 3. Shared missing-dep affectedFiles propagation & metadata provides/embeddedIds export
// 4. tCheckModCompat .disabled exclusion & fabric-api detection
// 5. Renderer imDepInstalled aliases/.disabled exclusion & depSearchQuery normalization
const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const vm = require('vm');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function buildZip(entries) {
  const chunks = [];
  const central = [];
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
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

const capturedSearchUrls = [];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-mp-dep-ux-'));
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => tmpDir, getVersion: () => '9.0.1' }, ipcMain: { handle() {} }, shell: { openExternal: async () => true } };
  }
  if (request === './http.js' || request === '../main/http.js') {
    return {
      async json(url) {
        capturedSearchUrls.push(url);
        return {
          total_hits: 3125,
          hits: [{
            project_id: '1KVo5zza', slug: 'fabulously-optimized', title: 'Fabulously Optimized',
            author: 'robotkoer', description: 'Perf', downloads: 9000000,
            versions: ['1.21.1'], categories: ['fabric', 'optimization'], client_side: 'required', server_side: 'optional',
          }],
        };
      },
      async download() {},
      marketplaceError: e => ({ ok: false, error: e?.message || String(e) }),
    };
  }
  return origLoad.apply(this, arguments);
};

const { searchMarket } = require('../src/main/marketplace.js');
const { parseTomlDependencies } = require('../src/main/mod-metadata.js');
const { scanContentConflicts } = require('../src/main/content-conflicts.js');
const { getTool } = require('../src/mcp/tools.js');

(async () => {
  let pass = 0;
  const ck = (name, cond) => { assert(cond, 'FAIL: ' + name); console.log('PASS', name); pass++; };

  // 1. Modrinth modpack search sends categories:fabric OR loaders:fabric
  const mp = await searchMarket({ source: 'modrinth', kind: 'modpack', loader: 'fabric', version: '1.21.1' });
  ck('modpack search succeeds with 3125 hits', mp.ok && mp.total === 3125 && mp.relaxed === null);
  const decUrl = decodeURIComponent(capturedSearchUrls[0]);
  ck('modpack search uses categories:fabric in facets', decUrl.includes('categories:fabric') && decUrl.includes('loaders:fabric') && decUrl.includes('versions:1.21.1'));

  // 2. Forge/NeoForge mods.toml side="CLIENT" deps do not become mandatory server deps
  const toml = `
[[dependencies.coolmod]]
modId="oculus"
mandatory=true
side="CLIENT"
[[dependencies.coolmod]]
modId="geckolib"
mandatory=true
side="BOTH"
`;
  const parsedDeps = parseTomlDependencies(toml);
  const oculusDep = parsedDeps.find(d => d.modId === 'oculus');
  const geckoDep = parsedDeps.find(d => d.modId === 'geckolib');
  ck('side=CLIENT sets mandatory=false optional=true', oculusDep && oculusDep.optional === true && oculusDep.mandatory === false);
  ck('side=BOTH keeps mandatory=true', geckoDep && geckoDep.optional === false && geckoDep.mandatory === true);

  // 3. scanContentConflicts populates affectedFiles for shared missing deps & exposes provides/embeddedIds
  const srv = path.join(tmpDir, 'fab-srv');
  fs.mkdirSync(path.join(srv, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(srv, 'fabric-server-mc.1.20.1-loader.0.16.10.jar'), 'stub');
  fs.writeFileSync(path.join(srv, 'mods', 'modA.jar'), buildZip([
    ['fabric.mod.json', JSON.stringify({ id: 'moda', version: '1.0', depends: { minecraft: '1.20.1', 'fabric-api': '*', sharedlib: '*' } })],
  ]));
  fs.writeFileSync(path.join(srv, 'mods', 'modB.jar'), buildZip([
    ['fabric.mod.json', JSON.stringify({ id: 'modb', version: '1.0', depends: { minecraft: '1.20.1', 'fabric-api': '*', sharedlib: '*' }, provides: ['bonus-api'] })],
  ]));
  fs.writeFileSync(path.join(srv, 'mods', 'sharedlib-old.jar.disabled'), buildZip([
    ['fabric.mod.json', JSON.stringify({ id: 'sharedlib', version: '1.0' })],
  ]));

  const scan = await scanContentConflicts(srv);
  const fapiIssue = scan.issues.find(i => i.type === 'missing-dep' && i.requiredModId === 'fabric-api');
  const sharedIssue = scan.issues.find(i => i.type === 'missing-dep' && i.requiredModId === 'sharedlib');
  ck('fabric-api missing issue lists BOTH modA and modB in affectedFiles', fapiIssue && fapiIssue.affectedFiles.includes('modA.jar') && fapiIssue.affectedFiles.includes('modB.jar'));
  ck('shared missing dep lists BOTH modA and modB in affectedFiles', sharedIssue && sharedIssue.affectedFiles.includes('modA.jar') && sharedIssue.affectedFiles.includes('modB.jar'));
  ck('metadata carries provides array', Array.isArray(scan.metadata['modB.jar']?.provides) && scan.metadata['modB.jar'].provides.includes('bonus-api'));

  // 4. MCP check_mod_compat ignores .disabled jars & flags missing fabric-api
  const compatRes = await getTool('check_mod_compat').handler({ currentServerPath: srv });
  ck('check_mod_compat excludes disabled jar from modsScanned', compatRes.ok && compatRes.result.modsScanned === 2);
  ck('check_mod_compat reports missing sharedlib and fabric-api', compatRes.result.missingDeps.some(d => d.modId === 'sharedlib') && compatRes.result.missingDeps.some(d => d.modId === 'fabric-api'));

  // 5. Renderer imDepInstalled & depSearchQuery/issueAppliesToFile behavior
  const mktCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '05-marketplace.js'), 'utf8');
  const cntCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '01-content.js'), 'utf8');
  const sandbox = {
    state: {
      files: {
        mods: ['yet_another_config_lib_v3-3.5.0.jar', 'disabled-lib-1.0.jar.disabled'],
        plugins: [],
        datapacks: [],
      },
      contentConflicts: {
        metadata: {
          'yet_another_config_lib_v3-3.5.0.jar': { modId: 'yet_another_config_lib_v3', provides: ['yacl-alias'], embeddedIds: ['nested_dep'] },
          'disabled-lib-1.0.jar.disabled': { modId: 'disabled-lib', provides: [], embeddedIds: [] },
        },
      },
    },
    $: () => ({ addEventListener() {}, style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [] }),
    $$: () => [],
    t: k => k,
    window: { observer: { onMarketProgress() {}, onContentRolledBack() {} }, addEventListener() {} },
    document: { addEventListener() {}, activeElement: null, querySelector: () => null },
    debounce: fn => fn,
  };
  vm.createContext(sandbox);
  vm.runInContext(mktCode, sandbox);
  vm.runInContext(cntCode, sandbox);

  ck('imDepInstalled matches Modrinth yacl slug to yet_another_config_lib_v3', sandbox.imDepInstalled({ projectId: '1eAoo2KR', slug: 'yacl', title: 'YetAnotherConfigLib' }) === true);
  ck('imDepInstalled matches embedded JiJ id', sandbox.imDepInstalled({ projectId: 'x1234567', slug: 'nested-dep', title: 'Nested Dep' }) === true);
  ck('imDepInstalled ignores .disabled jars', sandbox.imDepInstalled({ projectId: 'd1234567', slug: 'disabled-lib', title: 'Disabled Lib' }) === false);
  ck('depSearchQuery maps FAPI submodule to fabric-api', sandbox.depSearchQuery('fabric-networking-api-v1') === 'fabric-api');
  ck('depSearchQuery normalizes yet_another_config_lib_v3', sandbox.depSearchQuery('yet_another_config_lib_v3') === 'yet another config lib');
  ck('issueAppliesToFile matches affectedFiles second entry', sandbox.issueAppliesToFile(fapiIssue, 'modB.jar') === true);

  console.log(`\nmodpack-search-and-dep-ux: ${pass} passed, 0 failed`);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
})().catch(err => {
  console.error(err);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
