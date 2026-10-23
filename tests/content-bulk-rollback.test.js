// Unit tests for bulk update and rollback functionality (v6.1.0 C2).
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  applyUpdates,
  rollbackLastUpdate,
  getLastUpdateSession,
  confirmUpdateSession,
  CONTENT_BACKUP_DIR
} = require('../src/main/content-updates.js');
const { writeJsonList, readJsonList } = require('../src/main/fs-utils.js');
const { getTool } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-c2-'));
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=world\n');
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(root, 'mods'), { recursive: true });

  // 1. Initial state: two plugins installed
  fs.writeFileSync(path.join(root, 'plugins', 'LuckPerms-1.0.jar'), 'LP-1-CONTENT');
  fs.writeFileSync(path.join(root, 'plugins', 'Vault-1.0.jar'), 'VAULT-1-CONTENT');

  writeJsonList(root, 'observerlauncher-manifest.json', [
    { fileName: 'LuckPerms-1.0.jar', kind: 'plugin', source: 'modrinth', projectId: 'lp', versionId: 'v1', version: '1.0' },
    { fileName: 'Vault-1.0.jar', kind: 'plugin', source: 'modrinth', projectId: 'vt', versionId: 'v1', version: '1.0' }
  ]);

  const resolve = async (item) => {
    if (item.id === 'lp') return { versionId: 'v2', filename: 'LuckPerms-2.0.jar', url: 'https://example.com/lp2.jar', versionNumber: '2.0' };
    if (item.id === 'vt') return { versionId: 'v2', filename: 'Vault-2.0.jar', url: 'https://example.com/vt2.jar', versionNumber: '2.0' };
    return null;
  };
  const download = async (url, dest) => {
    fs.writeFileSync(dest, url.includes('lp2') ? 'LP-2-CONTENT' : 'VAULT-2-CONTENT');
  };
  const verify = () => ({ ok: true });

  // 2. Perform bulk update
  const res = await applyUpdates(root, { resolve, download, verify });
  ck('applyUpdates bulk returns ok', res.ok === true);
  ck('two items updated', res.updated.length === 2);
  ck('sessionId created', typeof res.sessionId === 'string' && res.sessionId.startsWith('upd-'));
  ck('new LP file exists', fs.existsSync(path.join(root, 'plugins', 'LuckPerms-2.0.jar')));
  ck('old LP file removed', !fs.existsSync(path.join(root, 'plugins', 'LuckPerms-1.0.jar')));
  ck('new Vault file exists', fs.existsSync(path.join(root, 'plugins', 'Vault-2.0.jar')));
  ck('old Vault file removed', !fs.existsSync(path.join(root, 'plugins', 'Vault-1.0.jar')));

  // Check backup directory
  const bdir = path.join(root, 'plugins', CONTENT_BACKUP_DIR);
  ck('backup directory created', fs.existsSync(bdir));
  const backupFiles = fs.readdirSync(bdir);
  ck('two backups preserved', backupFiles.length === 2);

  // Check manifest has new entries
  const manifestAfter = readJsonList(root, 'observerlauncher-manifest.json');
  ck('manifest updated with new LP', !!manifestAfter.find(x => x.fileName === 'LuckPerms-2.0.jar'));
  ck('manifest updated with new Vault', !!manifestAfter.find(x => x.fileName === 'Vault-2.0.jar'));

  // 3. Inspect update session
  const lastSession = getLastUpdateSession(root);
  ck('getLastUpdateSession finds pending session', lastSession && lastSession.status === 'pending');
  ck('session recorded both items', lastSession && lastSession.items && lastSession.items.length === 2);

  // 4. Test rollback
  const rb = rollbackLastUpdate(root, lastSession.id);
  ck('rollback returns ok', rb.ok === true);
  ck('rollback rolledBackCount is 2', rb.rolledBackCount === 2);
  ck('old LP file restored', fs.existsSync(path.join(root, 'plugins', 'LuckPerms-1.0.jar')));
  ck('restored LP has original content', fs.readFileSync(path.join(root, 'plugins', 'LuckPerms-1.0.jar'), 'utf8') === 'LP-1-CONTENT');
  ck('new LP file deleted', !fs.existsSync(path.join(root, 'plugins', 'LuckPerms-2.0.jar')));
  ck('old Vault file restored', fs.existsSync(path.join(root, 'plugins', 'Vault-1.0.jar')));
  ck('restored Vault has original content', fs.readFileSync(path.join(root, 'plugins', 'Vault-1.0.jar'), 'utf8') === 'VAULT-1-CONTENT');
  ck('new Vault file deleted', !fs.existsSync(path.join(root, 'plugins', 'Vault-2.0.jar')));

  // Check manifest restored
  const manifestRestored = readJsonList(root, 'observerlauncher-manifest.json');
  ck('manifest restored LP version', !!manifestRestored.find(x => x.fileName === 'LuckPerms-1.0.jar' && x.versionId === 'v1'));
  ck('manifest restored Vault version', !!manifestRestored.find(x => x.fileName === 'Vault-1.0.jar' && x.versionId === 'v1'));

  // 5. Rollback again when no active sessions left -> error
  const rbAgain = rollbackLastUpdate(root);
  ck('repeat rollback returns not ok', rbAgain.ok === false);

  // 6. Confirm session
  const res2 = await applyUpdates(root, { names: ['LuckPerms-1.0.jar'], resolve, download, verify });
  ck('single update applied', res2.ok === true && res2.updated.length === 1);
  const sess2 = getLastUpdateSession(root);
  ck('session2 is pending', sess2 && sess2.status === 'pending');
  const conf = confirmUpdateSession(root, sess2.id);
  ck('confirmUpdateSession ok', conf.ok === true);
  const sess2After = readJsonList(root, 'observerlauncher-update-sessions.json').find(s => s.id === sess2.id);
  ck('session2 status is confirmed', sess2After && sess2After.status === 'confirmed');

  // 7. MCP Tool checks
  const rbTool = getTool('rollback_content_update');
  ck('rollback_content_update tool exists', !!rbTool);
  ck('rollback_content_update risk is write', rbTool && rbTool.risk === 'write');

  const blocked = await rbTool.handler({ currentServerPath: root, serverProcess: { pid: 999 } }, {});
  ck('rollback_content_update refuses while server running', blocked && blocked.ok === false);

  const allowed = await rbTool.handler({ currentServerPath: root, serverProcess: null }, { sessionId: sess2.id });
  ck('rollback_content_update succeeds via MCP tool', allowed && allowed.ok === true && allowed.rolledBackCount === 1);

  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
