// tests/horizon-adapter.test.js — Horizon & GitHub releases adapter unit tests
const assert = require('assert');
const {
  parseSha256Sums,
  compareSemverDesc,
  resolveChecksumFromRelease,
} = require('../src/main/adapters/github-releases.js');
const {
  isHorizonServerRelease,
  getHorizonPlatform,
  listVersions,
  fetchVersions,
  resolve,
} = require('../src/main/adapters/horizon.js');

let pass = 0;
function ck(name, cond) {
  assert(cond, name);
  pass++;
  console.log(`PASS ${name}`);
}

(async () => {
  // 1. parseSha256Sums handles Pumpkin & Horizon checksum formats
  const sampleSums = [
    '# comment',
    '9a0370da82dd156b88421e74bc87deebdb13601a79b67ef3de0b64e2baae876d  pumpkin-X64-Windows.exe',
    'f47f9f988b7c30b727dfb35aed2b74f01428925b2eccc9bafff2352f4847f7d6  horizon-windows-x64.zip',
  ].join('\n');
  const parsed = parseSha256Sums(sampleSums);
  ck('parses Pumpkin checksum line', parsed.get('pumpkin-x64-windows.exe') === '9a0370da82dd156b88421e74bc87deebdb13601a79b67ef3de0b64e2baae876d');
  ck('parses Horizon checksum line', parsed.get('horizon-windows-x64.zip') === 'f47f9f988b7c30b727dfb35aed2b74f01428925b2eccc9bafff2352f4847f7d6');

  // 2. compareSemverDesc ordering
  const sorted = ['0.2.0+26.3-26.51', '0.2.2+26.3-26.60', '0.2.1+26.3-26.51'].sort(compareSemverDesc);
  ck('sorts 0.2.2 before 0.2.1 and 0.2.0', sorted[0].startsWith('0.2.2') && sorted[2].startsWith('0.2.0'));
  const hSorted = ['v0.2.57', 'v0.2.97', 'v0.2.80'].sort(compareSemverDesc);
  ck('sorts v0.2.97 before v0.2.80 and v0.2.57', hSorted[0] === 'v0.2.97' && hSorted[2] === 'v0.2.57');

  // 3. Horizon server release filter excludes launcher@ releases
  ck('rejects launcher@ desktop release', !isHorizonServerRelease({
    tag_name: 'launcher@0.2.64',
    assets: [{ name: 'horizon-launcher-windows-x64.zip' }],
  }));
  ck('accepts horizon server semver release', isHorizonServerRelease({
    tag_name: 'v0.2.97',
    assets: [{ name: 'horizon-windows-x64.zip' }, { name: 'SHA256SUMS' }],
  }));
  ck('accepts horizon nightly release', isHorizonServerRelease({
    tag_name: 'nightly',
    assets: [{ name: 'horizon-server-linux-x86_64.tar.gz' }],
  }));

  // 4. Platform mapping covers x64 and arm64 cleanly
  ck('win32 x64 maps to horizon-windows-x64.zip', getHorizonPlatform({ platform: 'win32', arch: 'x64' }).assetName === 'horizon-windows-x64.zip');
  ck('darwin arm64 maps to horizon-macos-arm64.zip', getHorizonPlatform({ platform: 'darwin', arch: 'arm64' }).assetName === 'horizon-macos-arm64.zip');
  ck('darwin x64 maps to horizon-macos-x64.zip', getHorizonPlatform({ platform: 'darwin', arch: 'x64' }).assetName === 'horizon-macos-x64.zip');

  // 5. Digest extraction via release asset.digest
  const digest = await resolveChecksumFromRelease({
    assets: [{ name: 'pumpkin-X64-Windows.exe', digest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
  }, 'pumpkin-X64-Windows.exe');
  ck('resolveChecksumFromRelease extracts GitHub API digest field', digest === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

  // 6. listVersions / fetchVersions & resolve
  const syncVers = listVersions();
  ck('sync listVersions includes stable + nightly', Array.isArray(syncVers) && syncVers.includes('nightly') && !syncVers.some(v => v.startsWith('launcher@')));
  const liveVers = await fetchVersions();
  ck('fetchVersions excludes launcher@ tags', Array.isArray(liveVers) && liveVers.length > 0 && !liveVers.some(v => v.startsWith('launcher@')));

  const resolvedNightly = await resolve('nightly');
  ck('resolve("nightly") returns archive and nightly tag', resolvedNightly.url && resolvedNightly.version.startsWith('nightly'));
  const resolvedDefault = await resolve('latest');
  ck('resolve("latest") does not point to launcher@ release', resolvedDefault.url && !resolvedDefault.url.includes('launcher@'));
  ck('resolve("latest") exposes boolean upstreamAvailable status', typeof resolvedDefault.upstreamAvailable === 'boolean');

  console.log(`\n${pass} passed, 0 failed`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
