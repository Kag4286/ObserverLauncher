// Regression: boot snapshot must never break refreshUI or the Start gate.
// settings:get / files:get fall back to emptyServerFiles() when the folder is
// unreadable — it must carry every key the renderer touches (canStart needs
// f.jar/f.launchScript; roster/worlds/backups need arrays; properties {}).
const assert = require('assert');
const { serverFiles, emptyServerFiles } = require('../src/main/server-files.js');

let passed = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  passed++;
}

const e = emptyServerFiles();
for (const k of ['jar', 'launchScript', 'plugins', 'mods', 'datapacks', 'worlds', 'backups', 'properties', 'knownPlayers', 'whitelist', 'banned', 'ops']) {
  ok(`empty has ${k}`, k in e);
}
ok('empty lists are arrays', [e.plugins, e.mods, e.datapacks, e.worlds, e.backups, e.knownPlayers].every(Array.isArray));
ok('empty properties is object', e.properties && typeof e.properties === 'object');

// Start gate mirror (07-overview.js canStart): empty snapshot must NOT enable Start…
const canStart = (s, f, j, status) => !!s.serverPath && !!(f.jar || f.launchScript) && !!j?.ok && status === 'stopped';
ok('empty snapshot blocks Start', canStart({ serverPath: '/srv' }, e, null, 'stopped') === false);
// …while a healthy snapshot enables it (the boot race left java null → dead button).
ok('healthy snapshot enables Start', canStart({ serverPath: '/srv' }, { jar: 'purpur-26.2.jar' }, { ok: true }, 'stopped') === true);

// serverFiles must never throw for missing/empty roots (early-boot IPC safety).
ok("serverFiles('') safe", JSON.stringify(serverFiles('')) === JSON.stringify(e));
ok('serverFiles(missing dir) safe', JSON.stringify(serverFiles('/no/such/dir/xyz')) === JSON.stringify(e));

console.log(`\n${passed} passed, 0 failed`);
