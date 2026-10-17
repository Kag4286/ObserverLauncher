// v6.0.0 FIX: a manifest entry whose file no longer exists on disk must NOT be counted as an update.
// Reproduces the "1 update(s) available" on a server with zero installed content.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { checkUpdates } = require('../src/main/content-updates.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-cu-'));
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=world\n');
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });

  // A manifest that claims a plugin exists, but the file was deleted from plugins/.
  fs.writeFileSync(path.join(root, 'observerlauncher-manifest.json'), JSON.stringify([
    { fileName: 'Ghost.jar', kind: 'plugin', source: 'modrinth', projectId: 'ghost', versionId: 'v1' },
  ]));
  // The resolver would say a newer version exists - if it were ever called for a missing file.
  const resolve = async () => ({ versionId: 'v2', versionNumber: '2.0' });
  const r1 = await checkUpdates(root, { resolve });
  ok('stale entry: zero updates', r1.updates === 0);
  ok('stale entry: not even checked', r1.checked === 0);
  ok('stale entry: no item produced', r1.items.length === 0);

  // Now the file really exists -> it IS checked and the update is reported.
  fs.writeFileSync(path.join(root, 'plugins', 'Real.jar'), 'x');
  fs.writeFileSync(path.join(root, 'observerlauncher-manifest.json'), JSON.stringify([
    { fileName: 'Real.jar', kind: 'plugin', source: 'modrinth', projectId: 'real', versionId: 'v1' },
  ]));
  const r2 = await checkUpdates(root, { resolve });
  ok('present file: one update', r2.updates === 1 && r2.checked === 1);

  // A datapack entry resolves its folder under the level-name.
  fs.mkdirSync(path.join(root, 'world', 'datapacks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'world', 'datapacks', 'Pack.zip'), 'x');
  fs.writeFileSync(path.join(root, 'observerlauncher-manifest.json'), JSON.stringify([
    { fileName: 'Pack.zip', kind: 'datapack', source: 'modrinth', projectId: 'pack', versionId: 'v1' },
  ]));
  const r3 = await checkUpdates(root, { resolve });
  ok('datapack resolved under world/datapacks', r3.checked === 1 && r3.updates === 1);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
