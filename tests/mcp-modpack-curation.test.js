// End-to-end verification for MCP search, modpack planning, dependency walking,
// side classification, curated guide resource, and post-install JAR verification.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

// Build minimal valid stored-entry ZIP (.jar) buffers so isZipFile & scanContentConflicts inspect real archives.
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function makeJar(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nb = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const crc = crc32(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nb.length, 26);
    locals.push(lfh, nb, data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nb.length, 28);
    cdh.writeUInt32LE(offset, 42);
    centrals.push(cdh, nb);
    offset += 30 + nb.length + data.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

const lithiumJar = makeJar({
  'fabric.mod.json': JSON.stringify({
    schemaVersion: 1,
    id: 'lithium',
    version: '0.11.2',
    name: 'Lithium',
    depends: { fabricloader: '>=0.14.0', minecraft: '1.20.1', 'fabric-api': '*' },
  }),
});
const fabricApiJar = makeJar({
  'fabric.mod.json': JSON.stringify({
    schemaVersion: 1,
    id: 'fabric-api',
    version: '0.92.2+1.20.1',
    name: 'Fabric API',
  }),
});
const sha512Of = buf => crypto.createHash('sha512').update(buf).digest('hex');

const capturedUrls = [];
const httpStub = {
  async json(url) {
    capturedUrls.push(url);
    if (url.startsWith('https://api.modrinth.com/v2/search?')) {
      const u = new URL(url);
      const facets = JSON.parse(u.searchParams.get('facets') || '[]');
      const isModpack = facets.some(f => f.includes('project_type:modpack'));
      if (isModpack) {
        return {
          total_hits: 1,
          hits: [{
            project_id: 'mp-fab-1', slug: 'fabulously-optimized', title: 'Fabulously Optimized',
            author: 'robotkoer', description: 'Perf pack', downloads: 999999,
            versions: ['1.20.1'], loaders: ['fabric'], client_side: 'required', server_side: 'optional',
          }],
        };
      }
      return {
        total_hits: 3,
        hits: [
          {
            project_id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', author: 'jellysquid3',
            description: 'Server optimization', downloads: 5000000, versions: ['1.20.1'],
            loaders: ['fabric'], client_side: 'optional', server_side: 'required',
          },
          {
            project_id: 'existingId', slug: 'spark', title: 'spark', author: 'lucko',
            description: 'Profiler', downloads: 4000000, versions: ['1.20.1'],
            loaders: ['fabric'], client_side: 'optional', server_side: 'required',
          },
          {
            project_id: 'clientMod', slug: 'sodium', title: 'Sodium', author: 'jellysquid3',
            description: 'Client renderer', downloads: 9000000, versions: ['1.20.1'],
            loaders: ['fabric'], client_side: 'required', server_side: 'unsupported',
          },
        ],
      };
    }
    if (url.includes('/v2/project/lithium/version') || url.includes('/v2/project/gvQqBUqZ/version')) {
      return [
        {
          id: 'lithium-121', version_number: '0.14.0', game_versions: ['1.21.1'], loaders: ['fabric'],
          version_type: 'release', dependencies: [],
          files: [{ primary: true, filename: 'lithium-fabric-mc1.21.1-0.14.0.jar', url: 'https://cdn.modrinth.com/data/gvQqBUqZ/versions/lithium-121/lithium-0.14.0.jar', size: 5000, hashes: { sha512: 'deadbeef' } }],
        },
        {
          id: 'lithium-1201', version_number: '0.11.2', game_versions: ['1.20.1'], loaders: ['fabric'],
          version_type: 'release',
          // Modrinth required dependency with version_id: null (most common real-world case!)
          dependencies: [{ project_id: 'P7dR8mSH', version_id: null, dependency_type: 'required' }],
          files: [{ primary: true, filename: 'lithium-fabric-mc1.20.1-0.11.2.jar', url: 'https://cdn.modrinth.com/data/gvQqBUqZ/versions/lithium-1201/lithium-0.11.2.jar', size: lithiumJar.length, hashes: { sha512: sha512Of(lithiumJar) } }],
        },
      ];
    }
    if (url.includes('/v2/project/P7dR8mSH/version') || url.includes('/v2/project/fabric-api/version')) {
      return [
        {
          id: 'fapi-1201', version_number: '0.92.2+1.20.1', game_versions: ['1.20.1'], loaders: ['fabric'],
          version_type: 'release', dependencies: [],
          files: [{ primary: true, filename: 'fabric-api-0.92.2+1.20.1.jar', url: 'https://cdn.modrinth.com/data/P7dR8mSH/versions/fapi-1201/fabric-api-0.92.2+1.20.1.jar', size: fabricApiJar.length, hashes: { sha512: sha512Of(fabricApiJar) } }],
        },
      ];
    }
    if (url.includes('/v2/project/clientMod/version') || url.includes('/v2/project/sodium/version')) {
      return [
        {
          id: 'sodium-1201', version_number: '0.5.8', game_versions: ['1.20.1'], loaders: ['fabric'],
          version_type: 'release', dependencies: [],
          files: [{ primary: true, filename: 'sodium-fabric-0.5.8+mc1.20.1.jar', url: 'https://cdn.modrinth.com/data/clientMod/sodium.jar', size: 1000, hashes: { sha512: 'deadbeef' } }],
        },
      ];
    }
    if (url.startsWith('https://api.modrinth.com/v2/projects?ids=')) {
      return [
        { id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', client_side: 'optional', server_side: 'required' },
        { id: 'P7dR8mSH', slug: 'fabric-api', title: 'Fabric API', client_side: 'optional', server_side: 'required' },
        { id: 'clientMod', slug: 'sodium', title: 'Sodium', client_side: 'required', server_side: 'unsupported' },
      ];
    }
    throw new Error('Unexpected mock HTTP url: ' + url);
  },
  async download(url, dest) {
    if (url.includes('lithium-0.11.2')) { fs.writeFileSync(dest, lithiumJar); return; }
    if (url.includes('fabric-api')) { fs.writeFileSync(dest, fabricApiJar); return; }
    throw new Error('Unexpected mock download url: ' + url);
  },
  marketplaceError: e => ({ ok: false, error: e?.message || String(e) }),
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-mcp-curation-'));
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => tmpDir, getVersion: () => '9.0.1' }, ipcMain: { handle() {} }, shell: { openExternal: async () => true } };
  }
  if (request === './http.js' || request === '../main/http.js') {
    return httpStub;
  }
  return origLoad.apply(this, arguments);
};

const { getTool } = require('../src/mcp/tools.js');
const { resolveResource, resolveStaticDataResource } = require('../src/mcp/resources.js');
const { getPrompt } = require('../src/mcp/prompts.js');

async function main() {
  let pass = 0;
  const check = (name, cond) => {
    assert(cond, 'FAIL: ' + name);
    console.log('PASS', name);
    pass++;
  };

  // Setup mock Fabric 1.20.1 server directory (opaque server.jar + fabric disk marker)
  const serverDir = path.join(tmpDir, 'fabric-1201');
  fs.mkdirSync(path.join(serverDir, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(serverDir, 'libraries', 'net', 'fabricmc', 'intermediary', '1.20.1'), { recursive: true });
  fs.writeFileSync(path.join(serverDir, 'server.jar'), 'stub');
  fs.writeFileSync(path.join(serverDir, 'observerlauncher-manifest.json'), JSON.stringify([
    { projectId: 'existingId', slug: 'spark', fileName: 'spark-fabric.jar' },
  ]));
  const ctx = { currentServerPath: serverDir, serverStatus: 'stopped', javaInfo: { version: '17.0.9' } };

  // 1. search_marketplace inherits server MC, loader, defaultKind='mod', filters excludeClientOnly, marks alreadyInstalled
  const sr = await getTool('search_marketplace').handler(ctx, { query: 'opt', category: 'optimization', excludeClientOnly: true });
  check('search_marketplace succeeds', sr && sr.ok && sr.result);
  check('search_marketplace reports serverContext fabric 1.20.1 mod', sr.result.serverContext.loader === 'fabric' && sr.result.serverContext.mc === '1.20.1' && sr.result.serverContext.defaultKind === 'mod');
  const lastSearchUrl = decodeURIComponent(capturedUrls.find(u => u.includes('/v2/search')));
  check('search_marketplace passes server loader+version+category+server_side facets', lastSearchUrl.includes('loaders:fabric') && lastSearchUrl.includes('versions:1.20.1') && lastSearchUrl.includes('categories:optimization') && lastSearchUrl.includes('server_side:required'));
  check('search_marketplace excludes server_side=unsupported items', !sr.result.items.some(i => i.id === 'clientMod'));
  check('search_marketplace marks alreadyInstalled from manifest', sr.result.items.find(i => i.id === 'existingId')?.alreadyInstalled === true);

  // 2. search_modpacks inherits loader + version
  capturedUrls.length = 0;
  const mpRes = await getTool('search_modpacks').handler(ctx, { query: 'perf' });
  check('search_modpacks succeeds with serverContext', mpRes.ok && mpRes.result.serverContext.loader === 'fabric' && mpRes.result.items.length === 1);
  const mpUrl = decodeURIComponent(capturedUrls[0]);
  check('search_modpacks includes loaders:fabric and versions:1.20.1', mpUrl.includes('loaders:fabric') && mpUrl.includes('versions:1.20.1'));

  // 3. plan_modpack inherits mc/loader/kind when omitted, follows Modrinth required dep with versionId:null, fetches batch env
  const planRes = await getTool('plan_modpack').handler(ctx, {
    items: [{ id: 'lithium' }, { id: 'clientMod' }],
  });
  check('plan_modpack succeeds without explicit kind/version/loader', planRes.ok && planRes.result.server.loader === 'fabric' && planRes.result.server.mc === '1.20.1');
  const lithiumPlan = planRes.result.plan.find(p => p.id === 'lithium');
  const fapiPlan = planRes.result.plan.find(p => p.id === 'P7dR8mSH');
  const clientModPlan = planRes.result.plan.find(p => p.id === 'clientMod');
  check('plan_modpack picks MC 1.20.1 lithium build instead of 1.21.1', lithiumPlan && lithiumPlan.version === '0.11.2' && lithiumPlan.sideRequirement === 'server-only');
  check('plan_modpack follows required dep even when versionId is null', !!fapiPlan && fapiPlan.version === '0.92.2+1.20.1' && Array.isArray(fapiPlan.requiredBy) && fapiPlan.requiredBy.includes('lithium'));
  check('plan_modpack fetches batch env metadata & warns clientOnly', clientModPlan && clientModPlan.sideRequirement === 'client-only' && clientModPlan.warnings.includes('clientOnly'));
  check('plan_modpack builds sideRequirement summary', planRes.result.summary.serverOnly === 2 && planRes.result.summary.clientOnly === 1);

  // 4. assemble_modpack inherits mc/loader/kind and runs postInstallCompat scanContentConflicts
  const asmRes = await getTool('assemble_modpack').handler(ctx, { items: [{ id: 'lithium' }] });
  check('assemble_modpack installs into mods/ for fabric when kind omitted', asmRes.ok && asmRes.result.installed === 1 && asmRes.result.createdFiles[0] === 'mods/lithium-fabric-mc1.20.1-0.11.2.jar');
  check('assemble_modpack postInstallCompat detects missing fabric-api in real JAR', asmRes.result.postInstallCompat && asmRes.result.postInstallCompat.ok === false && asmRes.result.postInstallCompat.missingDependencies.some(d => d.modId === 'fabric-api'));

  // Install fabric-api too -> postInstallCompat becomes clean
  const asmRes2 = await getTool('assemble_modpack').handler(ctx, { items: [{ id: 'fabric-api' }] });
  check('assemble_modpack second pass postInstallCompat ok:true', asmRes2.ok && asmRes2.result.postInstallCompat && asmRes2.result.postInstallCompat.ok === true);

  // 5. Tier 3 guide resource & prompt work
  const staticGuide = resolveStaticDataResource('observer://guides/mod-stacks');
  check('observer://guides/mod-stacks resolves directly', staticGuide && staticGuide.text.includes('serverOptimization'));
  check('resolveResource includes observer://guides/mod-stacks', !!resolveResource('observer://guides/mod-stacks'));
  const rfGuide = await getTool('read_file').handler(ctx, { path: 'observer://guides/mod-stacks' });
  check('read_file supports observer://guides/mod-stacks', rfGuide.ok && rfGuide.result.content.includes('fabric-api'));
  const dp = getPrompt('design_modpack');
  check('design_modpack prompt mentions workflow & guide', dp && dp.build({ goal: 'perf', side: 'server-only' })[0].content.text.includes('observer://guides/mod-stacks'));

  console.log(`\nmcp-modpack-curation: ${pass} passed, 0 failed`);
}

main().then(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}).catch(err => {
  console.error(err);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
