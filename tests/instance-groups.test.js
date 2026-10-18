// v6.0.0 E3 + E4: instance groups + cross-instance snapshot builder. Both pure helpers.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// settings.js needs electron app.getPath for its lazy safeStorage path, but the pure helpers we test
// here (sanitizeGroup, setInstanceGroup) do not touch it. Stub just the module.
const userData = path.join(os.tmpdir(), 'ob-e3-' + Date.now());
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } };
  return origLoad.apply(this, arguments);
};

const S = require('../src/main/settings.js');
const N = require('../src/main/instances-snapshot.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- sanitizeGroup ---
ok('sanitizeGroup empty', S.sanitizeGroup('') === '');
ok('sanitizeGroup null', S.sanitizeGroup(null) === '');
ok('sanitizeGroup trims', S.sanitizeGroup('  Survival  ') === 'Survival');
ok('sanitizeGroup collapses internal space', S.sanitizeGroup('My   Group') === 'My Group');
ok('sanitizeGroup caps at 32', S.sanitizeGroup('a'.repeat(40)).length === 32);
ok('sanitizeGroup strips control chars', S.sanitizeGroup('a\u0001b') === 'a b');
ok('sanitizeGroup keeps unicode', S.sanitizeGroup('Thế giới') === 'Thế giới');

// --- buildSnapshots ---
const list = [
  { id: 'a', name: 'Alpha', group: 'Play' },
  { id: 'b', name: 'Beta', group: '' },
  { id: 'c', name: 'Gamma', group: 'Play' },
];
{
  const now = 1000000;
  const states = {
    a: { serverStatus: 'running', startedAt: 400000, metricsHistory: [{ tps: 19.5, mspt: 30, cpu: 40, ram: 55 }], live: { players: ['p1', 'p2'] } },
    b: { serverStatus: 'stopped', startedAt: 0, metricsHistory: [], live: { players: [] } },
    c: { serverStatus: 'starting', startedAt: 0, metricsHistory: [], live: { players: [] } },
  };
  const rows = N.buildSnapshots(list, (id) => states[id], now);
  ok('3 rows for 3 instances', rows.length === 3);
  const a = rows.find(r => r.id === 'a');
  ok('running row shows tps', a.tps === 19.5 && a.running === true);
  ok('running row shows players count', a.players === 2);
  ok('running row shows uptime', a.uptimeMs === 600000);
  ok('running row carries group', a.group === 'Play');
  const b = rows.find(r => r.id === 'b');
  ok('stopped row has null metrics', b.tps === null && b.ram === null && b.cpu === null);
  ok('stopped row players 0', b.players === 0);
  ok('stopped row uptime 0', b.uptimeMs === 0);
  const c = rows.find(r => r.id === 'c');
  ok('starting row has null metrics', c.tps === null && c.running === false);
}
ok('empty list -> no rows', N.buildSnapshots([], () => null).length === 0);
ok('null list -> no rows', N.buildSnapshots(null, () => null).length === 0);
ok('id-less entries dropped', N.buildSnapshots([null, {}, { id: 'x', name: 'X' }], () => null).length === 1);
ok('missing state -> stopped shape', N.buildSnapshots([{ id: 'z', name: 'Z' }], () => undefined)[0].status === 'stopped');
// Verify metrics come from the LAST entry of metricsHistory, not the first.
{
  const rows = N.buildSnapshots([{ id: 'a', name: 'A' }], () => ({
    serverStatus: 'running', startedAt: 0,
    metricsHistory: [{ tps: 10, mspt: 100, cpu: 90, ram: 95 }, { tps: 20, mspt: 10, cpu: 5, ram: 10 }],
    live: { players: [] },
  }), 0);
  ok('latest metric wins', rows[0].tps === 20 && rows[0].ram === 10);
}

// --- promptDialog allowEmpty (v6.0.0 E3 regression guard) ---
// Clearing an instance group submits an EMPTY input. A normal promptDialog treats empty OK as
// cancel (null), which is right for a rename but wrong for a set-or-clear field. Guard the fix
// statically so a future refactor cannot silently re-break clearing a group.
{
  const fs2 = require('fs');
  const path2 = require('path');
  const core = fs2.readFileSync(path2.join(__dirname, '..', 'src', 'renderer', 'js', '00-core.js'), 'utf8');
  ok('promptDialog has allowEmpty', /dataset\.allowEmpty = opts\.allowEmpty/.test(core));
  ok('_pmSubmit honours allowEmpty (returns \"\")', /allowEmpty===\x271\x27\?\x27\x27:null/.test(core));
  ok('pmOk handler uses _pmSubmit', /\$\('#pmOk'\)\?\.addEventListener\('click',_pmSubmit\)/.test(core));
  const shell = fs2.readFileSync(path2.join(__dirname, '..', 'src', 'renderer', 'js', '08-shell.js'), 'utf8');
  ok('setInstanceGroupPrompt passes allowEmpty:true', /promptDialog\(\{[^}]*allowEmpty:true/.test(shell));
}

fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
