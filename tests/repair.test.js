// v2.5.0 Autonomous Doctor: pure planning logic (src/mcp/repair.js). No Electron needed.
const assert = require('assert');
const repair = require('../src/mcp/repair.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// ---- detectCrashLoop ----
const now = 1_000_000_000_000;
const hour = 60 * 60 * 1000;
ok('no reports -> no loop', repair.detectCrashLoop([], { now }).loop === false);
ok('2 recent crashes -> no loop (min 3)', repair.detectCrashLoop([{ mtime: now - 1000 }, { mtime: now - 2000 }], { now }).loop === false);
ok('3 recent crashes -> loop', repair.detectCrashLoop([{ mtime: now - 1000 }, { mtime: now - 2000 }, { mtime: now - 3000 }], { now }).loop === true);
ok('3 crashes but old -> no loop', repair.detectCrashLoop([{ mtime: now - 2 * hour }, { mtime: now - 3 * hour }, { mtime: now - 4 * hour }], { now }).loop === false);
const mixed = repair.detectCrashLoop([{ mtime: now - 1000 }, { mtime: now - 2000 }, { mtime: now - 3 * hour }], { now });
ok('mixed: only 2 recent -> no loop', mixed.loop === false && mixed.count === 2);
const cl = repair.detectCrashLoop([{ mtime: now - 1000 }, { mtime: now - 5000 }, { mtime: now - 9000 }], { now });
ok('crashLoop.count is recent count', cl.count === 3);
ok('crashLoop.newest is the latest', cl.newest.mtime === now - 1000);
ok('null safe', repair.detectCrashLoop(null, { now }).loop === false);
ok('custom min', repair.detectCrashLoop([{ mtime: now - 1000 }], { now, min: 1 }).loop === true);

// ---- detectRamPressure ----
const flat = Array.from({ length: 10 }, (_, i) => ({ t: i, ram: 1000 }));
ok('flat low -> no pressure', repair.detectRamPressure(flat, 4096).pressure === false);
const climbing = Array.from({ length: 12 }, (_, i) => ({ t: i, ram: 1000 + i * 250 }));
const cres = repair.detectRamPressure(climbing, 4096);
ok('climbing near limit -> pressure', cres.pressure === true);
ok('climbing -> leak flagged', cres.leak === true);
ok('growthPct positive', cres.growthPct > 0);
ok('too few samples -> no pressure', repair.detectRamPressure([{ t: 0, ram: 100 }], 4096).pressure === false);
ok('no limit -> no pressure', repair.detectRamPressure(climbing, 0).pressure === false);
const high = Array.from({ length: 10 }, () => ({ ram: 4000 }));
ok('high flat -> pressure but not leak', repair.detectRamPressure(high, 4096).pressure === true && repair.detectRamPressure(high, 4096).leak === false);
ok('null safe', repair.detectRamPressure(null, 4096).pressure === false);

// ---- proposeRepair: empty ----
const empty = repair.proposeRepair({});
ok('no facts -> empty plan', empty.plan.length === 0);
ok('no facts -> requiresConfirm false', empty.requiresConfirm === false);

// ---- proposeRepair: port conflict ----
const p = repair.proposeRepair({ port: { port: 25565, free: false, suggestedPort: 25566, hint: 'busy' } });
ok('port busy -> change_port', p.plan.some(x => x.action === repair.ACTION.CHANGE_PORT));
const portAction = p.plan.find(x => x.action === repair.ACTION.CHANGE_PORT);
ok('change_port args: server-port 25566', portAction.args.key === 'server-port' && portAction.args.value === '25566');
ok('change_port asks restart', portAction.args.restart === true);
ok('change_port is write risk', portAction.risk === 'write');
const pNoSuggest = repair.proposeRepair({ port: { port: 25565, free: false } });
ok('no suggestion -> port+1', pNoSuggest.plan.find(x => x.action === repair.ACTION.CHANGE_PORT).args.value === '25566');

// ---- proposeRepair: missing dep ----
const d = repair.proposeRepair({ missingDeps: [{ modId: 'kotlinforforge', neededBy: 'particle_core' }] });
ok('missing dep -> install_dependency', d.plan.some(x => x.action === repair.ACTION.INSTALL_DEPENDENCY));
const depAction = d.plan.find(x => x.action === repair.ACTION.INSTALL_DEPENDENCY);
ok('install_dependency args: query = modId', depAction.args.query === 'kotlinforforge' && depAction.args.kind === 'mod');
ok('install_dependency reason names the requirer', /particle_core/.test(depAction.reason));

// ---- proposeRepair: RAM pressure ----
const r = repair.proposeRepair({ ram: { pressure: true, leak: true, avgPct: 92, growthPct: 40 } });
ok('ram pressure -> tune_performance', r.plan.some(x => x.action === repair.ACTION.TUNE_PERFORMANCE));
const tune = r.plan.find(x => x.action === repair.ACTION.TUNE_PERFORMANCE);
ok('tune lowers view-distance', tune.args.lowerViewDistance === true);
ok('leak suggests memory increase', tune.args.suggestMemoryIncrease === true);
const rNoLeak = repair.proposeRepair({ ram: { pressure: true, leak: false, avgPct: 85 } });
ok('no leak -> no memory suggestion', rNoLeak.plan.find(x => x.action === repair.ACTION.TUNE_PERFORMANCE).args.suggestMemoryIncrease === undefined);

// ---- proposeRepair: crash loop ----
const c = repair.proposeRepair({ crashLoop: { loop: true, count: 5 }, newestBackup: 'world-backup-2026.zip' });
ok('crash loop -> restore_backup', c.plan.some(x => x.action === repair.ACTION.RESTORE_BACKUP));
const rb = c.plan.find(x => x.action === repair.ACTION.RESTORE_BACKUP);
ok('restore_backup carries the backup name', rb.args.name === 'world-backup-2026.zip');
ok('restore_backup is destroy risk', rb.risk === 'destroy');

// ---- proposeRepair: combined ----
const all = repair.proposeRepair({
  port: { port: 25565, free: false, suggestedPort: 25570 },
  missingDeps: [{ modId: 'x', neededBy: 'y' }],
  ram: { pressure: true, leak: true, avgPct: 95, growthPct: 50 },
  crashLoop: { loop: true, count: 4 },
  newestBackup: 'b.zip',
});
ok('combined -> 4 actions', all.plan.length === 4);
ok('combined requiresConfirm', all.requiresConfirm === true);
ok('combined summary mentions count', /4/.test(all.summary));

// ---- ACTION_RISK table ----
ok('change_port risk write', repair.ACTION_RISK[repair.ACTION.CHANGE_PORT] === 'write');
ok('restore_backup risk destroy', repair.ACTION_RISK[repair.ACTION.RESTORE_BACKUP] === 'destroy');
ok('install_dependency risk write', repair.ACTION_RISK[repair.ACTION.INSTALL_DEPENDENCY] === 'write');

// ---- candidateQueries (v2.5.0 Doctor fix: query != slug) ----
const cq = repair.candidateQueries('alexsmobs');
ok('candidateQueries keeps raw first', cq[0] === 'alexsmobs');
ok('candidateQueries adds spaced variant', cq.includes('alexs mobs'));
ok('candidateQueries deduped + capped', cq.length <= 4 && new Set(cq).size === cq.length);
ok('candidateQueries on hyphen input', repair.candidateQueries('alexs-mobs').includes('alexs mobs'));
ok('candidateQueries empty safe', repair.candidateQueries('').length === 0 || repair.candidateQueries('')[0] === '' ? repair.candidateQueries('').length === 0 : true);

// ---- pickBestMatch (never blind-pick the wrong mod) ----
const items = [
  { id: 'alexs-mobs', title: 'Alex Mobs' },
  { id: 'seagull-killer', title: 'Seagull Killer' },
];
const exact = repair.pickBestMatch('alexs-mobs', items);
ok('pickBestMatch exact id wins', exact.best && exact.best.id === 'alexs-mobs');
const byTitle = repair.pickBestMatch('Alex Mobs', items);
ok('pickBestMatch normalised title wins', byTitle.best && byTitle.best.id === 'alexs-mobs');
// 'alexsmobs' vs ids 'alexs-mobs' -> normName equal -> score 3 exact.
const runTogether = repair.pickBestMatch('alexsmobs', items);
ok('pickBestMatch run-together matches slug', runTogether.best && runTogether.best.id === 'alexs-mobs');
// nothing close -> no best, candidates offered.
const none = repair.pickBestMatch('totally-unrelated', items);
ok('pickBestMatch no match -> best null', none.best === null);
ok('pickBestMatch no match -> candidates', none.candidates.length === 2);
// two equal substring matches -> ambiguous, do NOT pick.
const amb = repair.pickBestMatch('mobs', [{ id: 'a-mobs', title: 'A Mobs' }, { id: 'b-mobs', title: 'B Mobs' }]);
ok('pickBestMatch ambiguous -> best null', amb.best === null && amb.ambiguous === true);
ok('pickBestMatch empty list safe', repair.pickBestMatch('x', []).best === null);
ok('normName strips non-alnum', repair.normName('Alex Mobs!') === 'alexmobs');

console.log(`\n${passed} passed, 0 failed`);
