// v3 -> v4 migration fixtures (v2.0.0). This is the DATA-LOSS TRAP: legacy
// loadSettings() returns FULL DEFAULTS if migrate() throws, so a bug here would
// silently wipe the user's config. These tests pin: per-instance keys move into
// instances[], global keys stay global, settings.v3.bak.json is written BEFORE the
// migration, the version gate does not downgrade a newer store, and the flat view
// round-trips through saveSettings without drift.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-migration-v4-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const { loadSettings, saveSettings, settingsPath, backupPathV3 } = require('../src/main/settings.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const write = (obj) => { fs.rmSync(backupPathV3(), { force: true }); fs.writeFileSync(settingsPath(), JSON.stringify(obj, null, 2)); };
const readRaw = () => JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));

// --- 1. full v3 config with a server folder -> one instance ---
{
  write({
    version: 3, serverPath: '/srv/survival', javaPath: '/usr/bin/java17',
    memoryMin: 2, memoryMax: 6, jvmArgs: '-XX:+UseG1GC', autoEula: true,
    autoRestart: true, autoRestartMaxAttempts: 5, autoRestartDelaySeconds: 10,
    autoBackupMinutes: 30, backupRetention: 7,
    scheduleEnabled: true, scheduleStartTime: '08:00', scheduleStopTime: '23:00', scheduleDays: [1, 2, 3],
    autoTunnel: true, tunnelAddress: 'survival.playit.gg:12345',
    onboarded: true, locale: 'vi', mcpEnabled: true, playitPath: '/opt/playit', motionLevel: 'lite', curseforgeApiKey: 'K',
  });
  const s = loadSettings();
  const raw = readRaw();
  ok('migrated file version = 4', raw.version === 4);
  ok('backup written before migration', fs.existsSync(backupPathV3()));
  ok('backup is the original v3', JSON.parse(fs.readFileSync(backupPathV3(), 'utf8')).version === 3);
  ok('one instance created', Array.isArray(raw.instances) && raw.instances.length === 1);
  ok('instance id default', raw.instances[0].id === 'default');
  ok('instance name from basename', raw.instances[0].name === 'survival');
  ok('activeInstanceId default', raw.activeInstanceId === 'default');
  ok('per-instance key moved (memoryMax)', raw.instances[0].memoryMax === 6);
  ok('tunnel moved into instance', raw.instances[0].tunnelAddress === 'survival.playit.gg:12345');
  ok('schedule moved into instance', raw.instances[0].scheduleStartTime === '08:00');
  ok('top level no longer has serverPath', raw.serverPath === undefined);
  ok('global key stays global (mcpEnabled)', raw.mcpEnabled === true);
  ok('global key stays global (locale)', raw.locale === 'vi');
  ok('global key stays global (playitPath)', raw.playitPath === '/opt/playit');
  // B1 (v2.1.0): a secret is written with a prefix ('plain:' here since the test electron mock has
  // no safeStorage keyring). The plaintext is preserved, just wrapped.
  ok('global key stays global (curseforgeApiKey)', raw.curseforgeApiKey === 'plain:K');
  ok('flat view exposes active serverPath', s.serverPath === '/srv/survival');
  ok('flat view exposes memoryMax', s.memoryMax === 6);
  ok('flat view has no instances array', s.instances === undefined);
}

// --- 2. v3 with empty serverPath -> NO instance (matches plan fixture) ---
{
  write({ version: 3, serverPath: '', javaPath: '', memoryMin: 2, memoryMax: 6, jvmArgs: '', backupRetention: 10 });
  const s = loadSettings();
  const raw = readRaw();
  ok('empty serverPath -> instances []', Array.isArray(raw.instances) && raw.instances.length === 0);
  ok('empty serverPath -> activeInstanceId null', raw.activeInstanceId === null);
  ok('empty -> flat view still has memoryMax default', Number.isFinite(s.memoryMax) && s.memoryMax > 0);
  ok('empty -> flat view serverPath empty string', s.serverPath === '');
}

// --- 3. idempotent: migrating a v4 store again is a no-op ---
{
  write({
    version: 3, serverPath: '/srv/a', memoryMin: 1, memoryMax: 4, backupRetention: 3,
    instances: undefined,
  });
  loadSettings(); // v3 -> v4
  const first = readRaw();
  loadSettings(); // already v4
  const second = readRaw();
  ok('idempotent: same instance count', first.instances.length === second.instances.length);
  ok('idempotent: same active id', first.activeInstanceId === second.activeInstanceId);
  ok('idempotent: memoryMax unchanged', second.instances[0].memoryMax === 4);
}

// --- 4. version gate: a NEWER store is not downgraded ---
{
  write({
    version: 99,
    instances: [{ id: 'x', name: 'Future', serverPath: '/srv/f', memoryMax: 12, backupRetention: 9 }],
    activeInstanceId: 'x',
    locale: 'de', mcpEnabled: true,
  });
  const s = loadSettings();
  const raw = readRaw();
  ok('version gate: file stays at 99', raw.version === 99);
  ok('version gate: flat view reads the future instance', s.serverPath === '/srv/f' && s.memoryMax === 12);
  ok('version gate: global locale preserved', s.locale === 'de');
}

// --- 5. flat round-trip: saveSettings on a flat view re-nests, no drift ---
{
  write({
    version: 3, serverPath: '/srv/rt', javaPath: '/j', memoryMin: 2, memoryMax: 6,
    jvmArgs: '', backupRetention: 10, autoTunnel: false, tunnelAddress: '',
    mcpEnabled: false, locale: 'en', playitPath: '', curseforgeApiKey: '',
  });
  const flat = loadSettings();
  flat.memoryMax = 10; // simulate the RAM slider
  saveSettings(flat);
  const raw = readRaw();
  ok('round-trip: instance memoryMax updated', raw.instances[0].memoryMax === 10);
  ok('round-trip: still one instance', raw.instances.length === 1);
  ok('round-trip: no flat serverPath leaked to top level', raw.serverPath === undefined);
  ok('round-trip: version still 4', raw.version === 4);
  // A second load still sees the change through the flat view.
  ok('round-trip: reload sees memoryMax', loadSettings().memoryMax === 10);
}

// --- 6. corrupt JSON -> defaults, never throws ---
{
  fs.rmSync(backupPathV3(), { force: true });
  fs.writeFileSync(settingsPath(), '{ this is not json');
  let threw = false;
  let s;
  try { s = loadSettings(); } catch { threw = true; }
  ok('corrupt json does not throw', !threw);
  ok('corrupt json -> defaults with memoryMax', Number.isFinite(s.memoryMax));
}

fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, 0 failed`);
process.exit(0);
