// CB2 (v3.3.0): manifest v2 identity. resolveItem must carry projectId/versionId/gameVersion from
// the resolver, and buildPack must persist them into observerlauncher-manifest.json (the data later
// update checks read). Both use injectable resolve/download/verify so this runs offline.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveItem } = require('../src/main/modpack-resolve.js');
const { buildPack } = require('../src/main/modpack-build.js');
const { readJsonList } = require('../src/main/fs-utils.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

(async () => {
  // resolveItem carries identity through
  const fakeResolve = async () => ({ url: 'https://example.com/x.jar', filename: 'x.jar', source: 'modrinth', gameVersions: ['1.21'], loaders: ['paper'], projectId: 'luckperms', versionId: 'ver-1', gameVersion: '1.21', versionNumber: '5.4' });
  const item = await resolveItem({ id: 'luckperms', source: 'modrinth', kind: 'plugin' }, fakeResolve, 'world');
  ck('resolveItem carries projectId', item.projectId === 'luckperms');
  ck('resolveItem carries versionId', item.versionId === 'ver-1');
  ck('resolveItem carries gameVersion', item.gameVersion === '1.21');

  // buildPack persists identity into the manifest
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-mv2-'));
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=world\n');
  const download = async (url, dest) => { fs.writeFileSync(dest, 'jar-bytes'); };
  const verify = () => ({ ok: true });
  const resolved = [{ id: 'luckperms', source: 'modrinth', kind: 'plugin', folder: 'plugins', filename: 'x.jar', url: 'https://example.com/x.jar', hashes: null, projectId: 'luckperms', versionId: 'ver-1', gameVersion: '1.21' }];
  const r = await buildPack(root, resolved, { download, verify, levelName: 'world' });
  ck('buildPack ok', r && r.ok === true);
  const manifest = readJsonList(root, 'observerlauncher-manifest.json');
  const entry = manifest.find(e => e.fileName === 'x.jar');
  ck('manifest entry written', !!entry);
  ck('entry has projectId', entry && entry.projectId === 'luckperms');
  ck('entry has versionId', entry && entry.versionId === 'ver-1');
  ck('entry has gameVersion', entry && entry.gameVersion === '1.21');

  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
