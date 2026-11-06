const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { listVersions, getPumpkinPlatform, resolve } = require('../src/main/adapters/pumpkin.js');
const {
  getDefaultPumpkinToml,
  parsePumpkinToml,
  syncPumpkinTomlToProperties,
  syncPropertiesToPumpkinToml,
} = require('../src/main/pumpkin-config.js');
const { serverFiles, detectSoftware } = require('../src/main/server-files.js');
const { detectServerTarget } = require('../src/main/server-compat.js');
const { RESOLVERS } = require('../src/main/wizard.js');

let pass = 0;
function ck(name, condition) {
  assert(condition, name);
  pass++;
  console.log(`PASS ${name}`);
}

(async () => {
  // 1. Adapter & Platform Resolution
  const versions = listVersions();
  ck('listVersions returns array of versions', Array.isArray(versions) && versions.length > 0);
  ck('latest version is latest or semver', versions[0] === 'latest' || /^v?\d+/.test(versions[0]));

  const winPlatform = getPumpkinPlatform({ platform: 'win32', arch: 'x64' });
  ck('win32 x64 resolves to pumpkin-X64-Windows.exe', winPlatform.assetName === 'pumpkin-X64-Windows.exe');

  const linuxPlatform = getPumpkinPlatform({ platform: 'linux', arch: 'x64' });
  ck('linux x64 resolves to pumpkin-X64-Linux', linuxPlatform.assetName === 'pumpkin-X64-Linux');

  const macArmPlatform = getPumpkinPlatform({ platform: 'darwin', arch: 'arm64' });
  ck('darwin arm64 resolves to pumpkin-ARM64-macOS', macArmPlatform.assetName === 'pumpkin-ARM64-macOS');

  const resolvedCurrent = await resolve();
  ck('resolve() returns url, name, version', resolvedCurrent.url && resolvedCurrent.name && resolvedCurrent.version);
  ck('resolve() returns urls array with mirror fallback', Array.isArray(resolvedCurrent.urls) && resolvedCurrent.urls.length >= 2);
  ck('resolve() name matches platform binary', process.platform === 'win32' ? resolvedCurrent.name.endsWith('.exe') : !resolvedCurrent.name.endsWith('.exe'));

  const resolved021 = await resolve('0.2.1');
  ck('resolve("0.2.1") maps to tag 0.2.1+26.3-26.51', resolved021.version.includes('0.2.1'));
  ck('resolve("0.2.1") includes mirror url', resolved021.urls.some(u => u.includes('ghfast.top')));

  // RESOLVERS integration check
  ck('RESOLVERS.pumpkin is a function', typeof RESOLVERS.pumpkin === 'function');
  const wizardResolved = await RESOLVERS.pumpkin('0.2.1');
  ck('RESOLVERS.pumpkin returns url and name', Boolean(wizardResolved.url && wizardResolved.name));

  // 2. TOML Generation & Parsing
  const defaultToml = getDefaultPumpkinToml();
  ck('default Pumpkin.toml contains [networking.java]', defaultToml.includes('[networking.java]'));
  ck('default Pumpkin.toml sets port 25565', defaultToml.includes('0.0.0.0:25565'));
  ck('default Pumpkin.toml sets chunk type to anvil', defaultToml.includes('type = "anvil"'));
  ck('default Pumpkin.toml contains default_level_name', defaultToml.includes('default_level_name = "world"'));

  const parsed = parsePumpkinToml(defaultToml);
  ck('parsePumpkinToml reads address', (parsed.address || parsed['networking.java']?.address) === '0.0.0.0:25565');
  ck('parsePumpkinToml reads max_players', (parsed.max_players || parsed['networking.java']?.max_players) === 20);
  ck('parsePumpkinToml reads online_mode', (parsed.online_mode ?? parsed['networking.java']?.online_mode) === true);

  // 3. TOML <-> Properties Synchronization
  const props = syncPumpkinTomlToProperties(defaultToml);
  ck('syncPumpkinTomlToProperties extracts server-port', props['server-port'] === '25565');
  ck('syncPumpkinTomlToProperties extracts max-players', props['max-players'] === '20');
  ck('syncPumpkinTomlToProperties extracts online-mode', props['online-mode'] === 'true');
  ck('syncPumpkinTomlToProperties extracts level-name', props['level-name'] === 'world');

  const updatedToml = syncPropertiesToPumpkinToml(defaultToml, {
    'server-port': '25577',
    'max-players': '50',
    'online-mode': 'false',
    motd: 'A Pumpkin Server in Rust',
    difficulty: 'hard',
    'view-distance': '16',
    'level-name': 'myworld',
  });
  ck('syncPropertiesToPumpkinToml updates port to 25577', updatedToml.includes('0.0.0.0:25577'));
  ck('syncPropertiesToPumpkinToml updates max_players to 50', updatedToml.includes('max_players = 50'));
  ck('syncPropertiesToPumpkinToml updates online_mode to false', updatedToml.includes('online_mode = false'));
  ck('syncPropertiesToPumpkinToml updates motd', updatedToml.includes('A Pumpkin Server in Rust'));
  ck('syncPropertiesToPumpkinToml updates view_distance', updatedToml.includes('view_distance = 16'));
  ck('syncPropertiesToPumpkinToml updates default_level_name', updatedToml.includes('default_level_name = "myworld"'));

  // 4. Server files detection
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pumpkin-test-'));
  try {
    const binName = process.platform === 'win32' ? 'pumpkin.exe' : 'pumpkin';
    fs.writeFileSync(path.join(tmpDir, binName), 'binary-dummy');
    fs.writeFileSync(path.join(tmpDir, 'Pumpkin.toml'), defaultToml);

    const sf = serverFiles(tmpDir);
    ck('serverFiles detects nativeBinary', sf.nativeBinary === binName);
    ck('serverFiles marks engineType as native', sf.engineType === 'native');
    ck('serverFiles marks target.software as pumpkin', sf.target.software === 'pumpkin');
    ck('serverFiles populates properties from Pumpkin.toml', sf.properties['server-port'] === '25565');
    ck('detectSoftware returns pumpkin', detectSoftware(sf) === 'pumpkin');
    const dt = detectServerTarget(tmpDir, sf);
    ck('detectServerTarget detects loader as pumpkin', dt.loader === 'pumpkin');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, 0 failed`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
