// tests/horizon-lifecycle.test.js — Unit tests for Horizon native engine detection and lifecycle
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { serverFiles, detectSoftware } = require('../src/main/server-files.js');
const { detectServerTarget } = require('../src/main/server-compat.js');
const { classifyOrphan } = require('../src/main/orphan.js');
const { validateStart } = require('../src/main/java.js');

let passed = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  passed++;
}

// 1. detectSoftware tests
ok('detectSoftware: horizon binary Windows', detectSoftware({ nativeBinary: 'horizon-server.exe' }) === 'horizon');
ok('detectSoftware: horizon binary POSIX', detectSoftware({ nativeBinary: 'horizon-server' }) === 'horizon');
ok('detectSoftware: server.toml without jar', detectSoftware({ hasHorizonConfig: true, jar: null, launchScript: null }) === 'horizon');
ok('detectSoftware: vanilla jar not overridden', detectSoftware({ jar: 'server.jar' }) === 'vanilla');

// 2. detectServerTarget tests
ok('detectServerTarget: horizon binary', detectServerTarget(null, { nativeBinary: 'horizon-server.exe' }).loader === 'horizon');
ok('detectServerTarget: horizon mc version 26.3', detectServerTarget(null, { nativeBinary: 'horizon-server.exe' }).mc === '26.3');
ok('detectServerTarget: engineType native', detectServerTarget(null, { nativeBinary: 'horizon-server.exe' }).engineType === 'native');

// 3. classifyOrphan tests for Horizon processes
const baseRecord = { pid: 9999, processStartedAt: 1700000000000, serverPath: '/srv/horizon' };
const horizonWin = { alive: true, name: 'horizon-server.exe', startTimeMs: 1700000000000 };
const horizonLinux = { alive: true, name: 'horizon-server', startTimeMs: 1700000000000 };

ok('orphan: stopped horizon-server.exe -> kill (t1)', classifyOrphan({ ...baseRecord, status: 'stopped' }, horizonWin).action === 'kill');
ok('orphan: stopped horizon-server.exe -> tier 1', classifyOrphan({ ...baseRecord, status: 'stopped' }, horizonWin).tier === 1);
ok('orphan: running horizon-server -> ask (t2)', classifyOrphan({ ...baseRecord, status: 'running' }, horizonLinux).action === 'ask');
ok('orphan: running horizon-server -> tier 2', classifyOrphan({ ...baseRecord, status: 'running' }, horizonLinux).tier === 2);

// 3b. classifyOrphan tests for Horizon worker processes (horizon-client) even in non-horizon folder name
const workerRecord = { pid: 9998, processStartedAt: 1700000000000, serverPath: '/srv/custom-game-dir' };
const workerWin = { alive: true, name: 'horizon-client.exe', startTimeMs: 1700000000000 };
const workerLinux = { alive: true, name: 'horizon-client', startTimeMs: 1700000000000 };
ok('orphan: stopped horizon-client.exe -> kill (t1)', classifyOrphan({ ...workerRecord, status: 'stopped' }, workerWin).action === 'kill');
ok('orphan: stopped horizon-client (linux) -> kill (t1)', classifyOrphan({ ...workerRecord, status: 'stopped' }, workerLinux).action === 'kill');
ok('orphan: running horizon-client.exe -> ask (t2)', classifyOrphan({ ...workerRecord, status: 'running' }, workerWin).action === 'ask');

// 4. validateStart bypasses Java check for native engine
const fakeSettings = { serverPath: fs.mkdtempSync(path.join(os.tmpdir(), 'obs-test-horizon-')) };
fs.writeFileSync(path.join(fakeSettings.serverPath, 'horizon-server.exe'), 'dummy binary');
fs.writeFileSync(path.join(fakeSettings.serverPath, 'server.toml'), '[server]\nmotd = "Test"\n');

const mockServerFiles = () => ({
  engineType: 'native',
  nativeBinary: 'horizon-server.exe',
  hasHorizonConfig: true,
  jar: null,
  launchScript: null,
});

// Pass invalid javaInfo ({ ok: false }) — for a Java server this would fail, but for Horizon it must succeed!
const startError = validateStart(fakeSettings, { ok: false }, mockServerFiles);
ok('validateStart: passes without Java for native engine', startError === null);

// 5. server.toml precedence over server.properties
fs.writeFileSync(path.join(fakeSettings.serverPath, 'server.properties'), 'motd=OldJavaValue\nserver-port=25565\n');
fs.writeFileSync(path.join(fakeSettings.serverPath, 'server.toml'), '[server]\nmotd = "AuthoritativeHorizon"\nport = 25577\n');
const filesResult = serverFiles(fakeSettings.serverPath);
ok('precedence: server.toml motd overrides server.properties', filesResult.properties.motd === 'AuthoritativeHorizon');
ok('precedence: server.toml port overrides server.properties', filesResult.properties['server-port'] === '25577');

// Clean up temp dir
try {
  fs.rmSync(fakeSettings.serverPath, { recursive: true, force: true });
} catch {}

console.log(`\nAll ${passed} horizon-lifecycle checks passed.`);

