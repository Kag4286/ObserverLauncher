// v2.0.0 (M10): TunnelManager bookkeeping. The Playit daemon is GLOBAL; the app must never stop a
// daemon an instance still needs, and never stop a daemon the USER started.
const assert = require('assert');
const TM = require('../src/main/tunnel-manager.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// shouldStopDaemon: only when no users AND the app owns it.
ok('stop: no users + owned -> stop', TM.shouldStopDaemon(new Set(), true) === true);
ok('stop: no users + not owned -> keep', TM.shouldStopDaemon(new Set(), false) === false);
ok('stop: still a user -> keep (even owned)', TM.shouldStopDaemon(new Set(['A']), true) === false);
ok('stop: two users -> keep', TM.shouldStopDaemon(new Set(['A', 'B']), true) === false);
ok('stop: null users + owned -> stop', TM.shouldStopDaemon(null, true) === true);

// shouldStartDaemon: at least one user and daemon not already running.
ok('start: users + not running -> start', TM.shouldStartDaemon(new Set(['A']), false) === true);
ok('start: users + running -> no', TM.shouldStartDaemon(new Set(['A']), true) === false);
ok('start: no users -> no', TM.shouldStartDaemon(new Set(), false) === false);

// addUser/removeUser are pure (return new Sets, never mutate the input).
const base = new Set(['A']);
const added = TM.addUser(base, 'B');
ok('add: new set has both', added.has('A') && added.has('B'));
ok('add: original unchanged', base.size === 1 && !base.has('B'));
const removed = TM.removeUser(added, 'A');
ok('remove: gone', !removed.has('A') && removed.has('B'));
ok('remove: original unchanged', added.has('A'));
ok('addUser null base', TM.addUser(null, 'X').has('X'));
ok('addUser null id is a no-op', TM.addUser(new Set(['A']), null).size === 1);

// Scenario: A and B both use the daemon; stopping A must NOT stop it (B remains).
let users = new Set();
users = TM.addUser(users, 'A');
users = TM.addUser(users, 'B');
users = TM.removeUser(users, 'A');
ok('scenario: B keeps daemon alive', TM.shouldStopDaemon(users, true) === false);
users = TM.removeUser(users, 'B');
ok('scenario: last user gone -> stop', TM.shouldStopDaemon(users, true) === true);

console.log(`\n${passed} passed, 0 failed`);
