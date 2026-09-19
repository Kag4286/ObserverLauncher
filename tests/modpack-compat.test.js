// Modpack compatibility: mrpackCompat() must flag MC/loader mismatches between a .mrpack's
// declared dependencies and the current server, while never warning when either side is unknown.
// modpacks.js requires electron (dialog/app) so mock it before requiring.
const Module = require('module');
const os = require('os');
const path = require('path');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => path.join(os.tmpdir(), 'ob-mp-test') }, dialog: {} };
  return origLoad.apply(this, arguments);
};

const { mrpackCompat, detectServerCompat, mcFromJar } = require('../src/main/modpacks.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// --- mcFromJar ---
check('mcFromJar paper-1.21.4.jar', mcFromJar('paper-1.21.4.jar') === '1.21.4');
check('mcFromJar server-26.2.jar', mcFromJar('server-26.2.jar') === '26.2');
check('mcFromJar no version', mcFromJar('velocity.jar') === null);

// --- detectServerCompat ---
check('detect neoforge', detectServerCompat({ jar: 'neoforge-21.1.0.jar' }).loader === 'neoforge');
check('detect forge', detectServerCompat({ jar: 'forge-1.20.1-47.2.0.jar' }).loader === 'forge');
check('detect fabric', detectServerCompat({ jar: 'fabric-server-mc.1.20.1.jar' }).loader === 'fabric');
check('detect quilt', detectServerCompat({ jar: 'quilt-server-launch.jar' }).loader === 'quilt');
check('detect paper', detectServerCompat({ jar: 'paper-1.21.4.jar' }).loader === 'paper');
check('detect vanilla', detectServerCompat({ jar: 'minecraft_server.1.20.1.jar' }).loader === 'vanilla');
check('detect proxy', detectServerCompat({ jar: 'velocity-3.3.0.jar' }).loader === 'proxy');
check('detect spigot config -> paper', detectServerCompat({ jar: 'x.jar', hasSpigotConfig: true }).loader === 'paper');
check('detect mc from jar', detectServerCompat({ jar: 'paper-1.21.4.jar' }).mc === '1.21.4');

// --- mrpackCompat: MC version ---
check('mc match -> no warning', mrpackCompat({ minecraft: '1.20.1' }, { mc: '1.20.1', loader: 'forge' }).warnings.length === 0);
check('mc mismatch -> mc warning', mrpackCompat({ minecraft: '1.20.1' }, { mc: '1.21.4', loader: 'forge' }).warnings.includes('mc'));
check('mc unknown on pack -> no warning', mrpackCompat({}, { mc: '1.21.4', loader: 'forge' }).warnings.length === 0);
check('mc unknown on server -> no warning', mrpackCompat({ minecraft: '1.20.1' }, { mc: null, loader: 'forge' }).warnings.length === 0);

// --- mrpackCompat: loader ---
check('forge pack + forge server ok', !mrpackCompat({ forge: '47.2.0' }, { mc: '1.20.1', loader: 'forge' }).warnings.includes('loader'));
check('forge pack + paper server -> loader warn', mrpackCompat({ forge: '47.2.0' }, { mc: '1.20.1', loader: 'paper' }).warnings.includes('loader'));
check('neoforge pack + forge server -> warn', mrpackCompat({ neoforge: '21' }, { mc: '1.21', loader: 'forge' }).warnings.includes('loader'));
check('fabric pack + fabric server ok', !mrpackCompat({ 'fabric-loader': '0.15' }, { mc: '1.20.1', loader: 'fabric' }).warnings.includes('loader'));
check('fabric pack + quilt server ok', !mrpackCompat({ 'fabric-loader': '0.15' }, { mc: '1.20.1', loader: 'quilt' }).warnings.includes('loader'));
check('quilt pack + fabric server ok', !mrpackCompat({ 'quilt-loader': '0.20' }, { mc: '1.20.1', loader: 'fabric' }).warnings.includes('loader'));
check('fabric pack + forge server -> warn', mrpackCompat({ 'fabric-loader': '0.15' }, { mc: '1.20.1', loader: 'forge' }).warnings.includes('loader'));
check('vanilla pack + forge server -> no loader warn', !mrpackCompat({ minecraft: '1.20.1' }, { mc: '1.20.1', loader: 'forge' }).warnings.includes('loader'));

// --- combined ---
const both = mrpackCompat({ minecraft: '1.20.1', forge: '47' }, { mc: '1.21.4', loader: 'fabric' });
check('both mismatched -> 2 warnings', both.warnings.includes('mc') && both.warnings.includes('loader'));
check('mc object has want/have', both.mc.want === '1.20.1' && both.mc.have === '1.21.4');
check('loader object has want/have', both.loader.want === 'forge' && both.loader.have === 'fabric');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
