// Tests for Hangar marketplace resolution and version picking (v6.0.2).
// Verifies that resolveMarketDownload respects versionId, filters by gameVersion,
// and returns the unified versionId.
const Module = require('module');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' -> ' + detail : '')));

const mockVersions = [
  {
    id: 32305,
    name: '0.16.2',
    createdAt: '2026-10-21T19:41:33Z',
    platformDependencies: { PAPER: ['1.21.2', '1.21.3', '1.21.4'] },
    downloads: {
      PAPER: {
        downloadUrl: 'https://hangar.papermc.io/api/v1/projects/Neky/heroic-map/versions/0.16.2/PAPER/heroic-map-0.16.2.jar',
        fileInfo: { name: 'heroic-map-0.16.2.jar', sizeBytes: 154000, sha256Hash: 'hash0162' },
      },
    },
  },
  {
    id: 32000,
    name: '0.16.1',
    createdAt: '2026-09-15T12:00:00Z',
    platformDependencies: { PAPER: ['1.20.4', '1.20.6', '1.21.1'] },
    downloads: {
      PAPER: {
        downloadUrl: 'https://hangar.papermc.io/api/v1/projects/Neky/heroic-map/versions/0.16.1/PAPER/heroic-map-0.16.1.jar',
        fileInfo: { name: 'heroic-map-0.16.1.jar', sizeBytes: 152000, sha256Hash: 'hash0161' },
      },
    },
  },
  {
    id: 31000,
    name: '0.15.0',
    createdAt: '2026-05-10T10:00:00Z',
    platformDependencies: { PAPER: ['1.19.4', '1.20.1'] },
    downloads: {
      PAPER: {
        downloadUrl: 'https://hangar.papermc.io/api/v1/projects/Neky/heroic-map/versions/0.15.0/PAPER/heroic-map-0.15.0.jar',
        fileInfo: { name: 'heroic-map-0.15.0.jar', sizeBytes: 148000, sha256Hash: 'hash0150' },
      },
    },
  },
];

const realHttp = require('../src/main/http.js');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const from = parent && parent.filename ? parent.filename : '';
  if (request === 'electron') {
    return { app: { getPath: () => path.join(os.tmpdir(), 'ob-mkt-hangar') }, dialog: {}, shell: {}, BrowserWindow: { getAllWindows: () => [] } };
  }
  if (request === './http.js' && from.endsWith('marketplace.js')) {
    return {
      ...realHttp,
      json: async (url) => {
        if (url.includes('/versions?')) return { result: mockVersions };
        return { result: [] };
      },
      download: async () => 0,
    };
  }
  return origLoad.apply(this, arguments);
};

const marketplace = require('../src/main/marketplace.js');

(async () => {
  // 1. Default without versionId or gameVersion picks the newest build (0.16.2)
  const def = await marketplace.resolveMarketDownload({
    source: 'hangar',
    id: 'Neky/heroic-map',
    kind: 'plugin',
  });
  check('default picks latest hangar version name', def.versionId === '0.16.2', def.versionId);
  check('default picks latest hangar versionNumber', def.versionNumber === '0.16.2', def.versionNumber);
  check('default has correct jar url', def.url.includes('0.16.2'), def.url);
  check('default carries sha256 hash', def.hashes?.sha256 === 'hash0162', JSON.stringify(def.hashes));

  // 2. Explicit versionId by name ('0.16.1') picks that exact build
  const byName = await marketplace.resolveMarketDownload({
    source: 'hangar',
    id: 'Neky/heroic-map',
    kind: 'plugin',
    versionId: '0.16.1',
  });
  check('picks explicit versionId by name', byName.versionId === '0.16.1', byName.versionId);
  check('url points at picked build 0.16.1', byName.url.includes('0.16.1'), byName.url);
  check('hash matches picked build 0.16.1', byName.hashes?.sha256 === 'hash0161', JSON.stringify(byName.hashes));

  // 3. Explicit versionId by numeric id (31000) picks that exact build
  const byId = await marketplace.resolveMarketDownload({
    source: 'hangar',
    id: 'Neky/heroic-map',
    kind: 'plugin',
    versionId: '31000',
  });
  check('picks explicit versionId by numeric id', byId.versionId === '0.15.0', byId.versionId);
  check('url points at picked build 0.15.0', byId.url.includes('0.15.0'), byId.url);

  // 4. Filtering by Minecraft gameVersion (when versionId is not specified)
  const byMc = await marketplace.resolveMarketDownload({
    source: 'hangar',
    id: 'Neky/heroic-map',
    kind: 'plugin',
    version: '1.20.4',
  });
  check('matches server gameVersion 1.20.4 to build 0.16.1', byMc.versionId === '0.16.1', byMc.versionId);

  // 5. Velocity software prefers VELOCITY download
  const velVersions = [
    {
      id: 50001,
      name: '1.0.0',
      platformDependencies: { VELOCITY: ['3.3.0'] },
      downloads: {
        PAPER: { downloadUrl: 'https://hangar/paper.jar', fileInfo: { name: 'paper.jar' } },
        VELOCITY: { downloadUrl: 'https://hangar/velocity.jar', fileInfo: { name: 'velocity.jar' } },
      },
    },
  ];
  Module._load = function (request, parent, isMain) {
    const from = parent && parent.filename ? parent.filename : '';
    if (request === 'electron') {
      return { app: { getPath: () => path.join(os.tmpdir(), 'ob-mkt-hangar') }, dialog: {}, shell: {}, BrowserWindow: { getAllWindows: () => [] } };
    }
    if (request === './http.js' && from.endsWith('marketplace.js')) {
      return { ...realHttp, json: async () => ({ result: velVersions }) };
    }
    return origLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve('../src/main/marketplace.js')];
  const marketVel = require('../src/main/marketplace.js');
  const velDl = await marketVel.resolveMarketDownload({
    source: 'hangar',
    id: 'Proxy/Plugin',
    kind: 'plugin',
    software: 'velocity',
  });
  check('velocity software prefers VELOCITY download', velDl.url.includes('velocity.jar'), velDl.url);

  // 6. Throws if no downloads available
  let threw = false;
  try {
    Module._load = function (request, parent, isMain) {
      const from = parent && parent.filename ? parent.filename : '';
      if (request === 'electron') {
        return { app: { getPath: () => path.join(os.tmpdir(), 'ob-mkt-hangar') }, dialog: {}, shell: {}, BrowserWindow: { getAllWindows: () => [] } };
      }
      if (request === './http.js' && from.endsWith('marketplace.js')) {
        return { ...realHttp, json: async () => ({ result: [] }) };
      }
      return origLoad.apply(this, arguments);
    };
    // invalidate require cache
    delete require.cache[require.resolve('../src/main/marketplace.js')];
    const freshMarket = require('../src/main/marketplace.js');
    await freshMarket.resolveMarketDownload({ source: 'hangar', id: 'Neky/heroic-map', kind: 'plugin' });
  } catch (err) {
    threw = true;
    check('throws descriptive error on missing downloads', /No Paper.*download/i.test(err.message), err.message);
  }
  check('missing downloads threw', threw === true);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
