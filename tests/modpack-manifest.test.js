// modpack-manifest.test.js — modpack.json schema + static verification (v3.2.0). PURE, no network.
//
// WHY: 3.2.0 adds CI/CD for modpacks. Before any jar is downloaded, a manifest must be schema-valid
// AND every item must pass the HARD loader/MC gate (the v2.3.0 crash chain). This locks the pure
// verify core without touching a registry.
const mm = require('../src/main/modpack-manifest.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name + (detail ? ' — ' + detail : '')));

// ---- validateManifest ----
{
  check('valid minimal manifest', mm.validateManifest({ name: 'x', version: '1.0.0' }).ok);
  check('valid full manifest', mm.validateManifest({ name: 'x', version: '1', minecraft: '1.21.1', loader: 'neoforge', items: [{ id: 'jei', kind: 'mod', source: 'modrinth' }] }).ok);
  check('non-object rejected', !mm.validateManifest(null).ok && !mm.validateManifest([]).ok && !mm.validateManifest('x').ok);
  check('missing name rejected', !mm.validateManifest({ version: '1' }).ok);
  check('blank name rejected', !mm.validateManifest({ name: '   ', version: '1' }).ok);
  check('missing version rejected', !mm.validateManifest({ name: 'x' }).ok);
  check('unknown loader rejected', !mm.validateManifest({ name: 'x', version: '1', loader: 'bogus' }).ok);
  check('items not array rejected', !mm.validateManifest({ name: 'x', version: '1', items: {} }).ok);
  check('item missing id rejected', !mm.validateManifest({ name: 'x', version: '1', items: [{}] }).ok);
  check('item unknown kind rejected', !mm.validateManifest({ name: 'x', version: '1', items: [{ id: 'a', kind: 'nope' }] }).ok);
  const e = mm.validateManifest({ version: '1', items: [{ id: 'a', kind: 'nope' }] });
  check('errors carry stable codes + paths', e.errors.some(x => x.code === 'name-missing') && e.errors.some(x => x.code === 'item-kind-unknown' && x.path === 'items[0].kind'));
}

// ---- verifyManifest: schema-only (no resolved items) ----
{
  const r = mm.verifyManifest({ name: 'x', version: '1', minecraft: '1.21.1', loader: 'neoforge', items: [{ id: 'jei' }, { id: 'jei' }, { id: 'sodium' }] }, [], null, null);
  check('schema-invalid manifest -> not ok + empty summary', !mm.verifyManifest({}, [], null, null).ok);
  check('dedupe by (source,id) removes the repeat', r.summary.items === 2, JSON.stringify(r.summary));
  check('server derived from manifest when no detector', r.server.mc === '1.21.1' && r.server.loader === 'neoforge');
  check('no rejects when nothing is resolved (metadata unknown)', r.summary.rejected === 0);
  check('summary counts accepted', r.summary.accepted === 2);
  check('ok true when no rejects/conflicts/missing', r.ok);
}

// ---- verifyManifest: HARD loader/MC gate via resolved items ----
{
  const manifest = { name: 'x', version: '1', minecraft: '1.21.1', loader: 'neoforge', items: [{ id: 'good' }, { id: 'wrongloader' }, { id: 'wrongmc' }] };
  const resolved = [
    { id: 'good', source: 'modrinth', kind: 'mod', gameVersions: ['1.21.1'], loaders: ['neoforge'] },
    { id: 'wrongloader', source: 'modrinth', kind: 'mod', gameVersions: ['1.21.1'], loaders: ['fabric'] },
    { id: 'wrongmc', source: 'modrinth', kind: 'mod', gameVersions: ['1.20.1'], loaders: ['neoforge'] },
  ];
  const r = mm.verifyManifest(manifest, resolved, { mc: '1.21.1', loader: 'neoforge' }, null);
  check('matching item accepted', r.accepted.some(i => i.id === 'good'));
  check('wrong-loader item rejected', r.rejected.some(i => i.id === 'wrongloader' && i.reason === 'loader'));
  check('wrong-mc item rejected', r.rejected.some(i => i.id === 'wrongmc' && i.reason === 'mc'));
  check('any reject -> ok false', r.ok === false);
  check('summary reflects 1 accepted / 2 rejected', r.summary.accepted === 1 && r.summary.rejected === 2);
}

// ---- verifyManifest: item-vs-item conflict ----
{
  const manifest = { name: 'x', version: '1', minecraft: '1.21.1', loader: 'paper', items: [{ id: 'a' }, { id: 'b' }] };
  const resolved = [
    { id: 'a', source: 'modrinth', kind: 'plugin', gameVersions: ['1.21.1'], loaders: ['paper'], folder: 'plugins', filename: 'same.jar' },
    { id: 'b', source: 'modrinth', kind: 'plugin', gameVersions: ['1.21.1'], loaders: ['paper'], folder: 'plugins', filename: 'same.jar' },
  ];
  const r = mm.verifyManifest(manifest, resolved, { mc: '1.21.1', loader: 'paper' }, null);
  check('same-file collision detected', r.conflicts.some(c => c.code === 'duplicate-file'));
  check('conflict -> ok false', r.ok === false);
}

// ---- verifyManifest: warnings do NOT fail (unless caller is strict) ----
{
  const manifest = { name: 'x', version: '1', minecraft: '1.21.1', loader: 'fabric', items: [{ id: 'someMod', kind: 'mod' }] };
  const resolved = [{ id: 'someMod', source: 'modrinth', kind: 'mod', gameVersions: ['1.21.1'], loaders: ['fabric'] }];
  const r = mm.verifyManifest(manifest, resolved, { mc: '1.21.1', loader: 'fabric' }, null);
  check('fabric-with-mods-no-api warning present', r.warnings.some(w => w.code === 'fabricApiMissing'));
  check('warnings alone keep ok true', r.ok === true);
}

// ---- missing declared dependencies ----
{
  const manifest = { name: 'x', version: '1', minecraft: '1.21.1', loader: 'neoforge', items: [{ id: 'particle' }] };
  const resolved = [{ id: 'particle', source: 'modrinth', kind: 'mod', gameVersions: ['1.21.1'], loaders: ['neoforge'] }];
  const r = mm.verifyManifest(manifest, resolved, { mc: '1.21.1', loader: 'neoforge' }, {
    declaredDeps: [{ from: 'particle', modId: 'kotlinforforge', mandatory: true, versionRange: '*' }],
    present: [],
  });
  check('missing required dep reported', r.missingDependencies.some(d => d.modId === 'kotlinforforge'));
  check('missing dep -> ok false', r.ok === false);
}

// ---- cap / trimmed ----
{
  const items = Array.from({ length: 5 }, (_, i) => ({ id: 'm' + i }));
  const r = mm.verifyManifest({ name: 'x', version: '1', items }, [], null, { maxItems: 3 });
  check('trimmed reflects the cap', r.trimmed === 2 && r.summary.items === 3, JSON.stringify({ t: r.trimmed, s: r.summary.items }));
}

// ---- summarizeReport ----
{
  check('summary line for invalid schema', /SCHEMA INVALID/.test(mm.summarizeReport(mm.verifyManifest({}, [], null, null))));
  const ok = mm.verifyManifest({ name: 'x', version: '1', items: [{ id: 'a' }] }, [], null, null);
  check('summary line for a clean report', /items ok/.test(mm.summarizeReport(ok)));
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
