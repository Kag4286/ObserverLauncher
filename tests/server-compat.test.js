// 2.3.0: server target detection (loader + MC) for the modpack planner, including the jar-less
// NeoForge/Forge run.bat case that used to resolve to { mc:null, loader:'vanilla' }.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectServerTarget, versionMatchesServer, mcFromName } = require('../src/main/server-compat.js');
const { serverFiles } = require('../src/main/server-files.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

function makeServer({ jar = null, runBat = false, neoforge = [], forge = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-scompat-'));
  const mk = (rel) => fs.mkdirSync(path.join(root, rel), { recursive: true });
  for (const v of neoforge) mk(path.join('libraries', 'net', 'neoforged', 'neoforge', v));
  for (const v of forge) mk(path.join('libraries', 'net', 'minecraftforge', 'forge', v));
  if (jar) fs.writeFileSync(path.join(root, jar), 'x');
  if (runBat) fs.writeFileSync(path.join(root, 'run.bat'), '@echo off\r\n');
  return root;
}

// mcFromName
check('mcFromName paper-1.21.1', mcFromName('paper-1.21.1.jar') === '1.21.1');
check('mcFromName 26.2', mcFromName('server-26.2.jar') === '26.2');
check('mcFromName run.bat -> null', mcFromName('run.bat') === null);

// detectServerTarget: explicit filenames
const paper = makeServer({ jar: 'paper-1.21.1.jar' });
check('paper -> paper/1.21.1', JSON.stringify(detectServerTarget(paper, serverFiles(paper))) === JSON.stringify({ mc: '1.21.1', loader: 'paper' }));
const spig = makeServer({ jar: 'spigot-1.20.4.jar' });
check('spigot -> paper/1.20.4', JSON.stringify(detectServerTarget(spig, serverFiles(spig))) === JSON.stringify({ mc: '1.20.4', loader: 'paper' }));
const cb = makeServer({ jar: 'craftbukkit-1.16.5.jar' });
check('craftbukkit -> paper/1.16.5', JSON.stringify(detectServerTarget(cb, serverFiles(cb))) === JSON.stringify({ mc: '1.16.5', loader: 'paper' }));
const fab = makeServer({ jar: 'fabric-server-mc.1.20.1.jar' });
check('fabric -> fabric/1.20.1', (() => { const d = detectServerTarget(fab, serverFiles(fab)); return d.loader === 'fabric' && d.mc === '1.20.1'; })());
check('mcFromName fabric-server-mc.1.20.1-loader.0.16.10.jar', mcFromName('fabric-server-mc.1.20.1-loader.0.16.10.jar') === '1.20.1');
const fabLaunch = makeServer({ jar: 'fabric-server-launch.jar' });
fs.writeFileSync(path.join(fabLaunch, 'server.jar'), 'vanilla');
fs.mkdirSync(path.join(fabLaunch, 'libraries', 'net', 'fabricmc', 'intermediary', '1.20.1'), { recursive: true });
const flFiles = serverFiles(fabLaunch);
const flTarget = detectServerTarget(fabLaunch, flFiles);
check('serverFiles prefers fabric-server-launch.jar over server.jar', flFiles.jar === 'fabric-server-launch.jar');
check('opaque fabric-server-launch.jar detects fabric + 1.20.1', flTarget.loader === 'fabric' && flTarget.mc === '1.20.1');
const fabRemap = makeServer({ jar: 'server.jar' });
fs.mkdirSync(path.join(fabRemap, '.fabric', 'remappedJars', 'minecraft-1.20.1-0.16.10'), { recursive: true });
const frTarget = detectServerTarget(fabRemap, serverFiles(fabRemap));
check('renamed server.jar + .fabric/remappedJars detects fabric + 1.20.1', frTarget.loader === 'fabric' && frTarget.mc === '1.20.1');
const vel = makeServer({ jar: 'velocity-3.3.0.jar' });
check('velocity -> proxy', detectServerTarget(vel, serverFiles(vel)).loader === 'proxy');

// detectServerTarget: jar-less NeoForge run.bat via libraries/
const neo = makeServer({ runBat: true, neoforge: ['21.1.251'] });
const nt = detectServerTarget(neo, serverFiles(neo));
check('jar-less NeoForge -> neoforge/1.21.1', nt.loader === 'neoforge' && nt.mc === '1.21.1');
// jar-less OLD Forge run.bat
const of = makeServer({ runBat: true, forge: ['1.16.5-36.2.34'] });
const ot = detectServerTarget(of, serverFiles(of));
check('jar-less Forge -> forge/1.16.5', ot.loader === 'forge' && ot.mc === '1.16.5');

// versionMatchesServer
check('neoforge item ok on neoforge', versionMatchesServer({ gameVersions: ['1.21.1'], loaders: ['neoforge'] }, nt).ok === true);
check('forge item REJECTED on neoforge', versionMatchesServer({ gameVersions: ['1.21.1'], loaders: ['forge'] }, nt).reason === 'loader');
check('fabric item REJECTED on neoforge', versionMatchesServer({ gameVersions: ['1.21.1'], loaders: ['fabric'] }, nt).reason === 'loader');
check('wrong MC REJECTED', versionMatchesServer({ gameVersions: ['1.20.4'], loaders: ['neoforge'] }, nt).reason === 'mc');
check('unknown loaders not rejected', versionMatchesServer({ gameVersions: ['1.21.1'] }, nt).ok === true);
check('unknown MC not rejected', versionMatchesServer({ loaders: ['neoforge'] }, nt).ok === true);
check('neoforge also valid on forge server', versionMatchesServer({ gameVersions: ['1.16.5'], loaders: ['forge'] }, ot).ok === true);

// cleanup
for (const r of [paper, spig, cb, fab, fabLaunch, fabRemap, vel, neo, of]) { try { fs.rmSync(r, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
