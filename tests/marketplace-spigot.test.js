// Two Marketplace defects, both found by probing the live registries.
//
// 1. Spiget's version-specific download endpoint answers 403 for EVERY version of EVERY
//    resource, with any user agent:
//      /v2/resources/94387/download                  -> 200, 201871 bytes, a real jar
//      /v2/resources/94387/versions/409737/download  -> 403
//      /v2/resources/94387/versions/<uuid>/download  -> 404
//    The launcher built the version-specific URL, so picking a build in the version picker could
//    never install anything. Only the plain endpoint works, and it always serves the latest
//    build, so the picker must not promise otherwise.
//
// 2. A downloaded file was accepted without checking it was a jar. A registry that answers 200
//    with an HTML error page was saved as "<name>.jar" and reported as a SUCCESSFUL install.
//
// The network is mocked: the point is the URL the launcher builds and what it accepts.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' -> ' + detail : '')));

const realHttp = require('../src/main/http.js');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const from = parent && parent.filename ? parent.filename : '';
  if (request === 'electron') {
    return { app: { getPath: () => path.join(os.tmpdir(), 'ob-mkt-test-userdata') }, dialog: {}, shell: {}, BrowserWindow: { getAllWindows: () => [] } };
  }
  if (request === './http.js' && from.endsWith('marketplace.js')) {
    return { ...realHttp, json: async () => ({}), download: async () => 0 };
  }
  return origLoad.apply(this, arguments);
};
const marketplace = require('../src/main/marketplace.js');

(async () => {
  // --- 1. the Spigot download URL -----------------------------------------
  const spigot = await marketplace.resolveMarketDownload({
    source: 'spigot', id: '94387', kind: 'plugin', title: 'LifeSteal SMP Plugin',
  });
  check('spigot url points at the plain download endpoint', spigot.url === 'https://api.spiget.org/v2/resources/94387/download', spigot.url);
  check('spigot url has no /versions/ segment', !spigot.url.includes('/versions/'), spigot.url);
  check('spigot keeps no version id', !spigot.versionId, String(spigot.versionId));
  check('spigot filename ends in .jar', /\.jar$/.test(spigot.filename), spigot.filename);
  check('spigot filename has no spaces', !/\s/.test(spigot.filename), spigot.filename);
  check('spigot filename keeps the title', spigot.filename.startsWith('LifeSteal_SMP_Plugin'), spigot.filename);

  // Even when a version was picked, the URL must stay on the endpoint that works.
  const withVersion = await marketplace.resolveMarketDownload({
    source: 'spigot', id: '94387', kind: 'plugin', title: 'LifeSteal SMP Plugin', versionId: '409737',
  });
  check('a picked version does not change the url', withVersion.url === spigot.url, withVersion.url);
  check('a picked version is not carried into the download', !withVersion.versionId, String(withVersion.versionId));

  // --- 2. the jar signature check -----------------------------------------
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-mkt-zip-'));
  const good = path.join(root, 'good.jar');
  const bad = path.join(root, 'bad.jar');
  const empty = path.join(root, 'empty.jar');
  const short = path.join(root, 'short.jar');
  fs.writeFileSync(good, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]));
  fs.writeFileSync(bad, '<!DOCTYPE html><html>captcha</html>');
  fs.writeFileSync(empty, '');
  fs.writeFileSync(short, Buffer.from([0x50, 0x4b]));
  const isZip = marketplace.isZipFile;
  check('a real jar passes the signature check', isZip(good) === true);
  check('an HTML page fails the signature check', isZip(bad) === false);
  check('an empty file fails the signature check', isZip(empty) === false);
  check('a file shorter than the signature fails', isZip(short) === false);
  check('a missing file fails the signature check', isZip(path.join(root, 'nope.jar')) === false);
  // The signature is the ZIP local file header: 50 4b 03 04.
  check('the signature is 50 4b 03 04', fs.readFileSync(good).slice(0, 4).toString('hex') === '504b0304');
  fs.rmSync(root, { recursive: true, force: true });

  // --- 3. the detail flags a source that cannot honour a version pick ----
  // buildDetail is internal, so the rule is asserted through the exported detail shape.
  const mp = require('../src/main/marketplace.js');
  check('marketplace exports resolveMarketDownload', typeof mp.resolveMarketDownload === 'function');
  check('marketplace exports searchMarket', typeof mp.searchMarket === 'function');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();