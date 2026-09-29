// modpack-resolve.test.js — modpack.json -> resolved items (v3.2.0 Phase C). NO live network.
//
// WHY: verifyManifest() needs RESOLVED items (real gameVersions/loaders/filename) to run the HARD
// gate. modpack-resolve.js reuses marketplace.resolveMarketDownload, so here we inject a FAKE resolver
// and prove the mapping (kind -> folder, metadata passthrough) + that per-item failures are collected.
const mr = require('../src/main/modpack-resolve.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

(async () => {
  // normalizeKind: keep mod distinct from plugin; unknown -> mod.
  check('normalizeKind keeps mod', mr.normalizeKind('mod') === 'mod');
  check('normalizeKind keeps plugin', mr.normalizeKind('plugin') === 'plugin');
  check('normalizeKind unknown -> mod', mr.normalizeKind('weird') === 'mod');
  check('normalizeKind undefined -> mod', mr.normalizeKind(undefined) === 'mod');

  // resolveItem: maps resolver output into the verifier's shape, folder from kind.
  {
    const fakeResolve = async (item) => ({ url: 'https://cdn.example/' + item.id + '.jar', filename: item.id + '.jar', source: item.source, hashes: { sha512: 'abc' }, size: 10, versionNumber: '1.2.3', gameVersions: ['1.21.1'], loaders: ['neoforge'], dependencies: [{ projectId: 'dep', type: 'required' }] });
    const it = await mr.resolveItem({ id: 'jei', source: 'modrinth', kind: 'mod' }, fakeResolve, 'world');
    check('resolveItem sets folder=mods for a mod', it.folder === 'mods', it.folder);
    check('resolveItem carries gameVersions', JSON.stringify(it.gameVersions) === JSON.stringify(['1.21.1']));
    check('resolveItem carries loaders', JSON.stringify(it.loaders) === JSON.stringify(['neoforge']));
    check('resolveItem carries filename', it.filename === 'jei.jar');
    check('resolveItem defaults source to modrinth', (await mr.resolveItem({ id: 'x', kind: 'mod' }, fakeResolve, 'world')).source === 'modrinth');
    const dp = await mr.resolveItem({ id: 'dp', kind: 'datapack' }, fakeResolve, 'world');
    check('resolveItem sets datapack folder under level-name', dp.folder === require('path').join('world', 'datapacks'), dp.folder);
    const pl = await mr.resolveItem({ id: 'pl', kind: 'plugin' }, fakeResolve, 'world');
    check('resolveItem sets plugin folder', pl.folder === 'plugins');
  }

  // resolveManifest: resolves all, collects errors instead of throwing.
  {
    const fakeResolve = async (item) => {
      if (item.id === 'bad') { const e = new Error('No downloadable version was found.'); throw e; }
      return { filename: item.id + '.jar', url: 'https://cdn.example/' + item.id, source: item.source, gameVersions: ['1.21.1'], loaders: ['neoforge'] };
    };
    const manifest = { name: 'x', version: '1', items: [{ id: 'a' }, { id: 'bad' }, { id: 'c' }] };
    let progressCalls = 0;
    const r = await mr.resolveManifest(manifest, { resolve: fakeResolve, levelName: 'world', onProgress: () => progressCalls++ });
    check('resolveManifest resolves the good items', r.items.length === 2 && r.items.map(i => i.id).join(',') === 'a,c', JSON.stringify(r.items.map(i => i.id)));
    check('resolveManifest collects the failure', r.errors.length === 1 && r.errors[0].id === 'bad', JSON.stringify(r.errors));
    check('resolveManifest error has the message', /No downloadable/.test(r.errors[0].error));
    check('resolveManifest called onProgress per item', progressCalls === 3, String(progressCalls));
  }

  // resolveManifest: empty / missing items is safe.
  {
    const r = await mr.resolveManifest({ name: 'x', version: '1' }, { resolve: async () => ({}) });
    check('resolveManifest with no items -> empty', r.items.length === 0 && r.errors.length === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})();
