// modpack-plan.test.js — pure decision logic for the MCP modpack planner/assembler.
const path = require('path');
const plan = require('../src/mcp/modpack-plan.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// folderForKind: mirrors the GUI/MCP install mapping.
ck('plugin -> plugins', plan.folderForKind('plugin') === 'plugins');
ck('mod -> mods', plan.folderForKind('mod') === 'mods');
ck('forge -> mods', plan.folderForKind('forge') === 'mods');
ck('neoforge -> mods', plan.folderForKind('neoforge') === 'mods');
ck('datapack -> world/datapacks', plan.folderForKind('datapack', 'world') === path.join('world', 'datapacks'));
ck('datapack honours level-name', plan.folderForKind('datapack', 'myworld') === path.join('myworld', 'datapacks'));

// itemCompat
const server = { mc: '1.20.1', loader: 'forge' };
const good = plan.itemCompat({ kind: 'mod', gameVersions: ['1.20.1'], loaders: ['forge'], env: { server: 'required' } }, server);
ck('compatible item -> ok no warnings', good.ok && good.warnings.length === 0);
ck('mc mismatch warns', plan.itemCompat({ kind: 'mod', gameVersions: ['1.19.2'], loaders: ['forge'] }, server).warnings.includes('mc'));
ck('loader mismatch warns', plan.itemCompat({ kind: 'mod', gameVersions: ['1.20.1'], loaders: ['fabric'] }, server).warnings.includes('loader'));
ck('client-only warns', plan.itemCompat({ kind: 'mod', gameVersions: ['1.20.1'], loaders: ['forge'], env: { server: 'unsupported' } }, server).warnings.includes('clientOnly'));
ck('unknown mc is not a warning', plan.itemCompat({ kind: 'mod', loaders: ['forge'] }, { mc: null, loader: 'forge' }).warnings.length === 0);
ck('quilt item on fabric server is ok', plan.itemCompat({ kind: 'mod', loaders: ['quilt'] }, { mc: null, loader: 'fabric' }).ok);
ck('fabric item on quilt server is ok', plan.itemCompat({ kind: 'mod', loaders: ['fabric'] }, { mc: null, loader: 'quilt' }).ok);

// dedupeById: order-preserving, by source:id
const dedup = plan.dedupeById([
  { id: 'a', source: 'modrinth' },
  { id: 'b', source: 'hangar' },
  { id: 'a', source: 'modrinth' },
  { id: 'a', source: 'hangar' },
  { id: '', source: 'modrinth' },
]);
ck('dedupe removes same source+id', dedup.length === 3);
ck('dedupe keeps order', dedup[0].id === 'a' && dedup[0].source === 'modrinth' && dedup[1].id === 'b');
ck('dedupe keeps different-source same-id', dedup.some(x => x.id === 'a' && x.source === 'hangar'));
ck('dedupe drops empty id', !dedup.some(x => !x.id));

// capPlan
const capped = plan.capPlan([1, 2, 3, 4, 5], 3);
ck('capPlan trims to max', capped.items.length === 3 && capped.trimmed === 2);
ck('capPlan no trim when under', plan.capPlan([1, 2], 5).trimmed === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
