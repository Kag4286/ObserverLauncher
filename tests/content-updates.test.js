// CB4 (v3.3.0): check_updates compares the manifest identity (CB2) to the registry and reports
// which items have a newer build. The resolver is injected so this runs offline.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { updatable, checkUpdates } = require('../src/main/content-updates.js');
const { getTool } = require('../src/mcp/tools.js');
const { writeJsonList } = require('../src/main/fs-utils.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// pure gate
ck('no projectId -> null', updatable({ fileName: 'x.jar' }) === null);
ck('no source -> null', updatable({ fileName: 'x.jar', projectId: 'p' }) === null);
ck('full entry -> object', !!updatable({ fileName: 'x.jar', projectId: 'p', source: 'modrinth', kind: 'plugin' }));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-cu-'));
  writeJsonList(root, 'observerlauncher-manifest.json', [
    { fileName: 'Old.jar', kind: 'plugin', source: 'modrinth', projectId: 'luckperms', versionId: 'v1', gameVersion: '1.21' },
    { fileName: 'Same.jar', kind: 'plugin', source: 'modrinth', projectId: 'vault', versionId: 'v9', gameVersion: '1.21' },
    { fileName: 'Legacy.jar', kind: 'mod', source: 'modrinth' },
    { fileName: 'Broken.jar', kind: 'plugin', source: 'modrinth', projectId: 'x', versionId: 'v1' },
    { fileName: 'Spigot.jar', kind: 'plugin', source: 'spigot', projectId: '55', versionId: null },
  ]);
  const fakeResolve = async (item) => {
    if (item.id === 'luckperms') return { versionId: 'v2', filename: 'LuckPerms-2.jar', versionNumber: '5.5' };
    if (item.id === 'vault') return { versionId: 'v9', filename: 'Vault.jar' };
    if (item.id === 'x') throw new Error('registry unavailable');
    return { versionId: 'z' };
  };
  const r = await checkUpdates(root, { resolve: fakeResolve });
  ck('ok', r.ok === true);
  ck('checked all 5', r.checked === 5);
  ck('one update', r.updates === 1);
  const by = Object.fromEntries(r.items.map(i => [i.fileName, i]));
  ck('Old.jar -> update', by['Old.jar'].status === 'update');
  ck('Old.jar latest id', by['Old.jar'].latest === 'v2');
  ck('Old.jar latest file name', by['Old.jar'].latestFileName === 'LuckPerms-2.jar');
  ck('Same.jar -> current', by['Same.jar'].status === 'current');
  ck('Legacy.jar -> unknown', by['Legacy.jar'].status === 'unknown');
  ck('Broken.jar -> error', by['Broken.jar'].status === 'error');
  ck('Spigot.jar -> manual', by['Spigot.jar'].status === 'manual');

  const tool = getTool('check_updates');
  ck('check_updates tool exists', !!tool);
  ck('check_updates is read', tool && tool.risk === 'read');

  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
