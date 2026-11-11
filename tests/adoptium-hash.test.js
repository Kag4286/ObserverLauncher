// v8.0.1: Verify Adoptium JRE metadata resolution and SHA-256 checksum enforcement.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveAdoptiumAsset } = require('../src/main/settings-handlers.js');
const { verifyFileHash } = require('../src/main/fs-utils.js');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) pass++;
  else { fail++; console.error('FAIL:', label); }
}

(async () => {
  const validSha = crypto.createHash('sha256').update('fake-jre-archive-bytes').digest('hex');
  const mockUrl = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21/OpenJDK21U-jre.zip';

  // 1. Valid Adoptium API payload resolves url and lowercase sha256
  let capturedUrl = '';
  const asset = await resolveAdoptiumAsset(21, 'windows', 'x64', async u => {
    capturedUrl = u;
    return [{ binary: { package: { link: mockUrl, checksum: validSha.toUpperCase(), size: 49106397 } } }];
  });
  check('resolveAdoptiumAsset hits /v3/assets/latest/21/hotspot', capturedUrl.includes('/v3/assets/latest/21/hotspot'));
  check('resolveAdoptiumAsset extracts package link', asset.url === mockUrl);
  check('resolveAdoptiumAsset normalizes sha256 to lowercase', asset.sha256 === validSha);
  check('resolveAdoptiumAsset extracts size', asset.size === 49106397);

  // 2. Missing or malformed checksum throws
  let threwMissing = false;
  try {
    await resolveAdoptiumAsset(21, 'windows', 'x64', async () => [{ binary: { package: { link: mockUrl, checksum: 'not-a-sha256' } } }]);
  } catch { threwMissing = true; }
  check('resolveAdoptiumAsset rejects malformed checksum', threwMissing);

  let threwEmpty = false;
  try {
    await resolveAdoptiumAsset(21, 'windows', 'x64', async () => []);
  } catch { threwEmpty = true; }
  check('resolveAdoptiumAsset rejects empty response', threwEmpty);

  // 3. verifyFileHash enforces the resolved sha256 on disk
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-adoptium-'));
  try {
    const zipFile = path.join(tmpDir, 'jre.zip');
    fs.writeFileSync(zipFile, 'fake-jre-archive-bytes');
    const okRes = verifyFileHash(zipFile, { sha256: asset.sha256 });
    check('verifyFileHash passes when archive matches Adoptium sha256', okRes.ok === true);

    fs.writeFileSync(zipFile, 'tampered-archive-bytes');
    const badRes = verifyFileHash(zipFile, { sha256: asset.sha256 });
    check('verifyFileHash fails when archive bytes are tampered', badRes.ok === false && badRes.algo === 'sha256');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  console.log(`adoptium-hash: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

