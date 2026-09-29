// modpack-build.test.js — assemble a resolved modpack into a server folder (v3.2.0 Phase D2).
// NO network / NO real disk writes of jars: planBuild is pure, and buildPack's download/verify are
// injected. A temp dir is used for the folder layout.
const fs = require('fs');
const os = require('os');
const path = require('path');
const mb = require('../src/main/modpack-build.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

(async () => {
  // destDirForKind
  check('destDirForKind mod -> mods', mb.destDirForKind('mod') === 'mods');
  check('destDirForKind plugin -> plugins', mb.destDirForKind('plugin') === 'plugins');
  check('destDirForKind datapack -> world/datapacks', mb.destDirForKind('datapack', 'world') === path.join('world', 'datapacks'));
  check('destDirForKind modpack -> null (not buildable)', mb.destDirForKind('modpack') === null);

  // planBuild: pure, orders + filters.
  {
    const r = mb.planBuild([
      { id: 'a', kind: 'mod', filename: 'a.jar', url: 'https://cdn.example/a.jar', hashes: { sha512: 'x' } },
      { id: 'b', kind: 'plugin', filename: 'b.jar', url: 'https://cdn.example/b.jar' },
      { id: 'noUrl', kind: 'mod', filename: 'x.jar' },
      { id: 'noFile', kind: 'mod', url: 'https://cdn.example/y.jar' },
      { id: 'pack', kind: 'modpack', filename: 'p.mrpack', url: 'https://cdn.example/p' },
    ], { levelName: 'world' });
    check('planBuild keeps the buildable items', r.steps.length === 2, JSON.stringify(r.steps.map(s => s.id)));
    check('planBuild puts a mod in mods', r.steps[0].dir === 'mods' && r.steps[0].fileName === 'a.jar');
    check('planBuild skips no-url', r.skipped.some(s => s.id === 'noUrl' && s.reason === 'no-url'));
    check('planBuild skips no-filename', r.skipped.some(s => s.id === 'noFile' && s.reason === 'no-filename'));
    check('planBuild skips unsupported kind (modpack)', r.skipped.some(s => s.id === 'pack' && s.reason === 'unsupported-kind'));
    check('planBuild basenames the filename', mb.planBuild([{ id: 'p', kind: 'plugin', filename: '../evil.jar', url: 'https://x/y.jar' }]).steps[0].fileName === 'evil.jar');
  }

  // buildPack: injected download/verify, real temp dir.
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-build-'));
    const downloaded = [];
    const download = async (url, dest) => { downloaded.push(path.basename(dest)); fs.writeFileSync(dest, 'jar-bytes'); return 8; };
    const verify = () => ({ ok: true });
    const resolved = [
      { id: 'a', source: 'modrinth', kind: 'mod', filename: 'a.jar', url: 'https://cdn.modrinth.com/a.jar' },
      { id: 'b', source: 'modrinth', kind: 'plugin', filename: 'b.jar', url: 'https://cdn.example/b.jar' },
    ];
    const r = await mb.buildPack(root, resolved, { download, verify, levelName: 'world' });
    check('buildPack ok', r.ok === true, JSON.stringify(r.errors));
    check('buildPack installed both', r.installed.length === 2);
    check('buildPack downloaded both files', downloaded.length === 2);
    check('buildPack wrote the mod to mods/', fs.existsSync(path.join(root, 'mods', 'a.jar')));
    check('buildPack wrote the plugin to plugins/', fs.existsSync(path.join(root, 'plugins', 'b.jar')));
    check('buildPack recorded a manifest entry', fs.existsSync(path.join(root, 'observerlauncher-manifest.json')));
    fs.rmSync(root, { recursive: true, force: true });
  }

  // buildPack: SSRF-guarded + hash-verify failure deletes the file and reports an error.
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-build-'));
    const download = async (url, dest) => { fs.writeFileSync(dest, 'x'); return 1; };
    const badUrl = await mb.buildPack(root, [{ id: 'x', kind: 'mod', filename: 'x.jar', url: 'http://127.0.0.1/x.jar' }], { download, verify: () => ({ ok: true }), levelName: 'world' });
    check('buildPack refuses a non-public URL', badUrl.ok === false && badUrl.errors.some(e => /Refused/.test(e.error)), JSON.stringify(badUrl.errors));
    const verify = () => ({ ok: false, error: 'hash mismatch' });
    const badHash = await mb.buildPack(root, [{ id: 'y', kind: 'mod', filename: 'y.jar', url: 'https://cdn.modrinth.com/y.jar' }], { download, verify, levelName: 'world' });
    check('buildPack fails on a hash mismatch', badHash.ok === false && badHash.errors.some(e => /hash mismatch/.test(e.error)));
    check('buildPack deleted the bad file', !fs.existsSync(path.join(root, 'mods', 'y.jar')));
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})();
