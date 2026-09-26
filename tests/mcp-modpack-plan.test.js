// A3 (v2.1.0): planConflicts is the item-vs-ITEM check that itemCompat (item-vs-server) does not do.
// Pure module - no electron, no network.
const assert = require('assert');
const { folderForKind, itemCompat, dedupeById, capPlan, planConflicts, planWarnings, filterPlan, missingDependencies, LOADER_FAMILY } = require('../src/mcp/modpack-plan.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- folderForKind ---
ok('datapack -> world/datapacks', folderForKind('datapack', 'world') === require('path').join('world', 'datapacks'));
ok('mod -> mods', folderForKind('mod', 'world') === 'mods');
ok('forge/fabric/neoforge -> mods', folderForKind('forge', 'w') === 'mods' && folderForKind('fabric', 'w') === 'mods' && folderForKind('neoforge', 'w') === 'mods');
ok('plugin -> plugins', folderForKind('plugin', 'world') === 'plugins');

// --- itemCompat (existing behaviour still holds) ---
const srv = { mc: '1.20.1', loader: 'fabric' };
ok('mc mismatch warns', itemCompat({ kind: 'mod', gameVersions: ['1.19.2'], loaders: ['fabric'] }, srv).warnings.includes('mc'));
ok('loader match no warn', itemCompat({ kind: 'mod', gameVersions: ['1.20.1'], loaders: ['fabric'] }, srv).warnings.length === 0);
ok('loader mismatch warns', itemCompat({ kind: 'mod', gameVersions: ['1.20.1'], loaders: ['forge'] }, srv).warnings.includes('loader'));
ok('quilt accepted for fabric server', itemCompat({ kind: 'mod', gameVersions: ['1.20.1'], loaders: ['quilt'] }, srv).warnings.length === 0);
ok('client-only warns', itemCompat({ kind: 'mod', gameVersions: ['1.20.1'], loaders: ['fabric'], env: { server: 'unsupported' } }, srv).warnings.includes('clientOnly'));
ok('unknown server mc -> no mc warn', itemCompat({ kind: 'mod', gameVersions: ['1.19.2'] }, { mc: null, loader: null }).warnings.length === 0);

// --- dedupeById ---
const dup = dedupeById([{ id: 'a', source: 'modrinth' }, { id: 'a', source: 'modrinth' }, { id: 'b', source: 'modrinth' }, { id: 'a', source: 'hangar' }]);
ok('dedupe keeps first per (source,id)', dup.length === 3);
ok('dedupe drops empty id', dedupeById([{ id: '' }]).length === 0);

// --- capPlan ---
ok('capPlan trims to max', capPlan([1, 2, 3, 4, 5], 3).items.length === 3);
ok('capPlan reports trimmed', capPlan([1, 2, 3, 4, 5], 3).trimmed === 2);

// --- planConflicts (A3) ---
ok('no conflicts for clean plan', planConflicts([{ id: 'a', source: 'modrinth', version: '1', folder: 'mods', filename: 'a.jar' }]).conflicts.length === 0);

const sameProj = planConflicts([
  { id: 'a', source: 'modrinth', version: '1.0', folder: 'mods', filename: 'a.jar' },
  { id: 'a', source: 'modrinth', version: '2.0', folder: 'mods', filename: 'a.jar' },
]);
ok('duplicate-version detected', sameProj.conflicts.some(c => c.code === 'duplicate-version'));

const sameFile = planConflicts([
  { id: 'x', source: 'modrinth', version: '1', folder: 'mods', filename: 'shared.jar' },
  { id: 'y', source: 'hangar', version: '1', folder: 'mods', filename: 'SHARED.jar' },
]);
ok('duplicate-file detected case-insensitive', sameFile.conflicts.some(c => c.code === 'duplicate-file'));
ok('same project same file is NOT a file conflict', planConflicts([
  { id: 'a', source: 'modrinth', version: '1', folder: 'mods', filename: 'a.jar' },
]).conflicts.length === 0);

const incompat = planConflicts([{ id: 'a', source: 'modrinth', version: '1', folder: 'mods', filename: 'a.jar', warnings: ['incompatible'] }]);
ok('incompatible relation detected', incompat.conflicts.some(c => c.code === 'incompatible'));

// Two different projects, different files -> no conflict.
ok('distinct files no conflict', planConflicts([
  { id: 'a', source: 'modrinth', version: '1', folder: 'mods', filename: 'a.jar' },
  { id: 'b', source: 'modrinth', version: '1', folder: 'mods', filename: 'b.jar' },
]).conflicts.length === 0);

// --- planWarnings (A5) ---
const fabricSrv = { mc: '1.20.1', loader: 'fabric' };
ok('fabric mods without api -> fabricApiMissing', planWarnings([{ id: 'sodium', kind: 'mod' }], fabricSrv, {}).warnings.some(w => w.code === 'fabricApiMissing'));
ok('fabric api present -> no fabricApiMissing', planWarnings([{ id: 'sodium', kind: 'mod' }, { id: 'fabric-api', kind: 'mod' }], fabricSrv, {}).warnings.every(w => w.code !== 'fabricApiMissing'));
ok('paper server -> no fabricApiMissing', planWarnings([{ id: 'essentialsx', kind: 'plugin' }], { mc: '1.20.1', loader: 'paper' }, {}).warnings.every(w => w.code !== 'fabricApiMissing'));
ok('hasProxy + mod -> proxy warning', planWarnings([{ id: 'a', kind: 'mod' }], { mc: '1.20.1', loader: 'fabric' }, { hasProxy: true }).warnings.some(w => w.code === 'proxy'));
ok('hasProxy + plugin only -> no proxy warning', planWarnings([{ id: 'a', kind: 'plugin' }], { mc: '1.20.1', loader: 'paper' }, { hasProxy: true }).warnings.every(w => w.code !== 'proxy'));
ok('java requirement too high -> java warning', planWarnings([{ id: 'bigmod', kind: 'mod', javaRequired: 21 }], fabricSrv, { serverJava: 17 }).warnings.some(w => w.code === 'java'));
ok('java requirement met -> no warning', planWarnings([{ id: 'bigmod', kind: 'mod', javaRequired: 17 }], fabricSrv, { serverJava: 17 }).warnings.every(w => w.code !== 'java'));
ok('unknown server java -> no java warning', planWarnings([{ id: 'x', kind: 'mod', javaRequired: 21 }], fabricSrv, { serverJava: null }).warnings.every(w => w.code !== 'java'));

// --- filterPlan (A8, v2.3.0): HARD reject loader/MC mismatches ---
const match = (dl, s) => {
  if (s.mc && dl.gameVersions && dl.gameVersions.length && !dl.gameVersions.includes(s.mc)) return { ok: false, reason: 'mc' };
  const fam = LOADER_FAMILY[s.loader];
  if (fam && dl.loaders && dl.loaders.length && !dl.loaders.some(l => fam.includes(l))) return { ok: false, reason: 'loader' };
  return { ok: true, reason: null };
};
const neoServer = { mc: '1.21.1', loader: 'neoforge' };
const fp = filterPlan([
  { id: 'ok', source: 'modrinth', kind: 'mod', gameVersions: ['1.21.1'], loaders: ['neoforge'] },
  { id: 'wrongloader', source: 'modrinth', kind: 'mod', gameVersions: ['1.21.1'], loaders: ['forge'] },
  { id: 'wrongmc', source: 'modrinth', kind: 'mod', gameVersions: ['1.20.4'], loaders: ['neoforge'] },
], neoServer, match);
ok('filterPlan accepts matching', fp.accepted.length === 1 && fp.accepted[0].id === 'ok');
ok('filterPlan rejects 2', fp.rejected.length === 2);
ok('filterPlan rejects loader', fp.rejected.some(r => r.id === 'wrongloader' && r.reason === 'loader'));
ok('filterPlan rejects mc', fp.rejected.some(r => r.id === 'wrongmc' && r.reason === 'mc'));

// --- missingDependencies (A9, v2.3.0) ---
const declared = [
  { from: 'particle_core', modId: 'fzzy_config', mandatory: true, versionRange: '[0.1,)' },
  { from: 'particle_core', modId: 'kotlinforforge', mandatory: true },
  { from: 'particle_core', modId: 'neoforge', mandatory: true },
  { from: 'particle_core', modId: 'sodium', mandatory: false },
];
const miss = missingDependencies(declared, new Set(['fzzy_config']));
ok('missingDependencies drops platform (neoforge)', !miss.some(m => m.modId === 'neoforge'));
ok('missingDependencies drops optional', !miss.some(m => m.modId === 'sodium'));
ok('missingDependencies drops present (fzzy_config)', !miss.some(m => m.modId === 'fzzy_config'));
ok('missingDependencies finds kotlinforforge', miss.some(m => m.modId === 'kotlinforforge'));
ok('missingDependencies dedupes', missingDependencies([{ modId: 'x', mandatory: true }, { modId: 'X', mandatory: true }], []).length === 1);

console.log(`\n${passed} passed, 0 failed`);
