// v6.0.0 H1: FileTransaction journal + transactional buildPack. Proves a failed multi-file install
// rolls back (new files removed, overwritten files restored) and a good install commits.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileTransaction } = require('../src/main/fs-utils.js');
const mb = require('../src/main/modpack-build.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- FileTransaction: new file is removed on rollback ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-tx-'));
  const f = path.join(dir, 'new.jar');
  const tx = new FileTransaction();
  tx.touch(f);
  fs.writeFileSync(f, 'new');
  const n = tx.rollback();
  ok('tx: new file removed on rollback', !fs.existsSync(f) && n === 1);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- FileTransaction: overwritten file is restored on rollback ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-tx-'));
  const f = path.join(dir, 'mod.jar');
  fs.writeFileSync(f, 'ORIGINAL');
  const tx = new FileTransaction();
  tx.touch(f);
  fs.writeFileSync(f, 'REPLACED');
  const n = tx.rollback();
  ok('tx: overwritten file restored', fs.readFileSync(f, 'utf8') === 'ORIGINAL' && n === 1);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- FileTransaction: commit keeps new content and removes backups ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-tx-'));
  const f = path.join(dir, 'mod.jar');
  fs.writeFileSync(f, 'ORIGINAL');
  const tx = new FileTransaction();
  tx.touch(f);
  fs.writeFileSync(f, 'REPLACED');
  tx.commit();
  ok('tx: commit keeps new content', fs.readFileSync(f, 'utf8') === 'REPLACED');
  ok('tx: commit removed the backup', !fs.readdirSync(dir).some(x => /txbak/.test(x)));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- transactional buildPack: one bad file rolls back the good ones too ---
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-txbuild-'));
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=world\n');
  // download writes real bytes; verify fails for the SECOND file so the first must be rolled back.
  let n = 0;
  const download = async (url, dest) => { n++; fs.writeFileSync(dest, 'bytes-' + n); return 1; };
  const verify = (dest) => ({ ok: !/b\.jar$/.test(dest), error: 'hash mismatch' });
  const resolved = [
    { id: 'a', source: 'modrinth', kind: 'mod', filename: 'a.jar', url: 'https://cdn.modrinth.com/a.jar' },
    { id: 'b', source: 'modrinth', kind: 'mod', filename: 'b.jar', url: 'https://cdn.modrinth.com/b.jar' },
  ];
  const r = await mb.buildPack(root, resolved, { download, verify, levelName: 'world' });
  ok('txbuild: build failed', r.ok === false);
  ok('txbuild: nothing installed after rollback', r.installed.length === 0);
  ok('txbuild: first file a.jar rolled back', !fs.existsSync(path.join(root, 'mods', 'a.jar')));
  ok('txbuild: no manifest written on failure', !fs.existsSync(path.join(root, 'observerlauncher-manifest.json')));
  ok('txbuild: reported the failing file', r.errors.some(e => /b\.jar|hash mismatch/.test(e.error || '')));

  // A clean build still commits.
  const r2 = await mb.buildPack(root, [
    { id: 'c', source: 'modrinth', kind: 'mod', filename: 'c.jar', url: 'https://cdn.modrinth.com/c.jar' },
  ], { download, verify: () => ({ ok: true }), levelName: 'world' });
  ok('txbuild: clean build commits', r2.ok === true && fs.existsSync(path.join(root, 'mods', 'c.jar')));
  ok('txbuild: manifest written on success', fs.existsSync(path.join(root, 'observerlauncher-manifest.json')));

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
