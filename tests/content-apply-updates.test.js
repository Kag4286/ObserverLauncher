// CB5 (v3.3.0): update_content installs the newer build over the old, backing the old file up to
// <name>.bak. download/resolve/verify are injected so this runs offline.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyUpdates } = require('../src/main/content-updates.js');
const { writeJsonList, readJsonList } = require('../src/main/fs-utils.js');
const { getTool } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-au-'));
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=world\n');
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugins', 'Old.jar'), 'OLD-BYTES');
  writeJsonList(root, 'observerlauncher-manifest.json', [
    { fileName: 'Old.jar', kind: 'plugin', source: 'modrinth', projectId: 'luckperms', versionId: 'v1', gameVersion: '1.21' },
    { fileName: 'Same.jar', kind: 'plugin', source: 'modrinth', projectId: 'vault', versionId: 'v9' },
  ]);
  fs.writeFileSync(path.join(root, 'plugins', 'Same.jar'), 'SAME');

  const resolve = async (item) => {
    if (item.id === 'luckperms') return { versionId: 'v2', filename: 'LuckPerms-2.jar', url: 'https://example.com/x.jar', hashes: null };
    if (item.id === 'vault') return { versionId: 'v9', filename: 'Same.jar', url: 'https://example.com/v.jar' };
    return { versionId: 'z', filename: 'z.jar', url: 'https://example.com/z.jar' };
  };
  const download = async (url, dest) => { fs.writeFileSync(dest, 'NEW-BYTES'); };
  const verify = () => ({ ok: true });

  const r = await applyUpdates(root, { resolve, download, verify });
  ck('ok', r.ok === true);
  ck('one updated', r.updated.length === 1);
  ck('renamed from Old.jar -> LuckPerms-2.jar', r.updated[0].from === 'Old.jar' && r.updated[0].to === 'LuckPerms-2.jar');
  ck('new file present', fs.existsSync(path.join(root, 'plugins', 'LuckPerms-2.jar')));
  ck('old file removed (renamed)', !fs.existsSync(path.join(root, 'plugins', 'Old.jar')));
  const bdir = path.join(root, 'plugins', 'observerlauncher-content-backups');
  ck('old backed up to the backups dir', fs.existsSync(bdir) && fs.readdirSync(bdir).some(f => f.includes('Old.jar')));
  ck('no .bak left in plugins/', !fs.existsSync(path.join(root, 'plugins', 'Old.jar.bak')));
  ck('Same.jar skipped as current', r.skipped.some(s => s.fileName === 'Same.jar' && s.reason === 'current'));
  const list = readJsonList(root, 'observerlauncher-manifest.json');
  ck('manifest now has new file', !!list.find(x => x.fileName === 'LuckPerms-2.jar'));
  ck('stale old manifest row dropped', !list.find(x => x.fileName === 'Old.jar'));

  // verify failure -> no new file kept
  fs.writeFileSync(path.join(root, 'plugins', 'Old2.jar'), 'OLD2');
  writeJsonList(root, 'observerlauncher-manifest.json', [{ fileName: 'Old2.jar', kind: 'plugin', source: 'modrinth', projectId: 'p2', versionId: 'a' }]);
  const rf = await applyUpdates(root, { resolve: async () => ({ versionId: 'b', filename: 'Old2.jar', url: 'https://example.com/2.jar' }), download, verify: () => ({ ok: false, error: 'bad hash' }) });
  ck('verify failure recorded', rf.errors.length === 1);
  ck('verify failure did not keep file', !fs.existsSync(path.join(root, 'plugins', 'Old2.jar')) || fs.readFileSync(path.join(root, 'plugins', 'Old2.jar'), 'utf8') === 'OLD2');

  const tool = getTool('update_content');
  ck('update_content tool exists', !!tool);
  ck('update_content is write', tool && tool.risk === 'write');
  // running-server guard
  const blocked = await tool.handler({ currentServerPath: root, serverProcess: { pid: 1 } }, {});
  ck('update_content refuses while server running', blocked && blocked.ok === false);

  // (5) version param: resolve receives the overridden MC version
  let seenVersion = 'unset';
  fs.writeFileSync(path.join(root, 'plugins', 'MC.jar'), 'OLDMC');
  writeJsonList(root, 'observerlauncher-manifest.json', [{ fileName: 'MC.jar', kind: 'plugin', source: 'modrinth', projectId: 'mcmod', versionId: 'v1', gameVersion: '1.21.1' }]);
  const rv = await applyUpdates(root, { names: ['MC.jar'], version: '1.21.4',
    resolve: async (it) => { seenVersion = it.version; return { versionId: 'v2', filename: 'MC.jar', url: 'https://example.com/mc.jar' }; },
    download: async (u, d) => { fs.writeFileSync(d, 'NEWMC'); }, verify: () => ({ ok: true }) });
  ck('version param reaches resolver', seenVersion === '1.21.4');
  ck('version param update applied', rv.updated.length === 1);
  const mcl = readJsonList(root, 'observerlauncher-manifest.json').find(x => x.fileName === 'MC.jar');
  ck('manifest gameVersion updated', mcl && mcl.gameVersion === '1.21.4');

  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
