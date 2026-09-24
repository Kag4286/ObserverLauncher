// 2.2.0 (Java gap): unit tests for src/main/server-java.js — deriving the required Java for a
// jar-less (run.bat) NeoForge/Forge server from its libraries/ tree.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectForgeMcVersion, requiredJavaForServer } = require('../src/main/server-java.js');
const { serverFiles } = require('../src/main/server-files.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// Build a throwaway server folder with the given maven version dirs under libraries/.
function makeServer({ neoforge = [], forge = [], jar = null, runBat = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-serverjava-'));
  const mk = (rel) => fs.mkdirSync(path.join(root, rel), { recursive: true });
  for (const v of neoforge) mk(path.join('libraries', 'net', 'neoforged', 'neoforge', v));
  for (const v of forge) mk(path.join('libraries', 'net', 'minecraftforge', 'forge', v));
  if (jar) fs.writeFileSync(path.join(root, jar), 'x');
  if (runBat) fs.writeFileSync(path.join(root, 'run.bat'), '@echo off\r\njava @user_jvm_args.txt\r\n');
  return root;
}

// --- detectForgeMcVersion ---
check('neoforge 21.1.251 -> 1.21.1', detectForgeMcVersion(makeServer({ neoforge: ['21.1.251'] })) === '1.21.1');
check('neoforge 26.3.0.16 -> 26.3', detectForgeMcVersion(makeServer({ neoforge: ['26.3.0.16'] })) === '26.3');
check('forge 1.16.5-36.2.34 -> 1.16.5', detectForgeMcVersion(makeServer({ forge: ['1.16.5-36.2.34'] })) === '1.16.5');
check('forge 1.21.1-52.0.1 -> 1.21.1', detectForgeMcVersion(makeServer({ forge: ['1.21.1-52.0.1'] })) === '1.21.1');
check('empty folder -> null', detectForgeMcVersion(makeServer({})) === null);
check('null root -> null', detectForgeMcVersion(null) === null);
check('newest wins (21.1.9 + 21.1.251 -> 1.21.1)', detectForgeMcVersion(makeServer({ neoforge: ['21.1.9', '21.1.251'] })) === '1.21.1');

// --- requiredJavaForServer ---
// jar present -> jar name wins (authoritative), libraries ignored.
check('jar 1.20.1 wins -> 17', requiredJavaForServer(makeServer({ jar: 'server-1.20.1.jar', neoforge: ['21.1.251'] }), serverFiles) === 17);
// jar-less NeoForge run.bat -> read libraries -> 1.21.1 -> Java 21.
check('neoforge run.bat 21.1.251 -> 21', requiredJavaForServer(makeServer({ neoforge: ['21.1.251'], runBat: true }), serverFiles) === 21);
// jar-less OLD Forge run.bat -> libraries 1.16.5 -> Java 8 (the bug that defaulted to 21).
check('forge run.bat 1.16.5 -> 8', requiredJavaForServer(makeServer({ forge: ['1.16.5-36.2.34'], runBat: true }), serverFiles) === 8);
check('neoforge run.bat 26.3.0.16 -> 25', requiredJavaForServer(makeServer({ neoforge: ['26.3.0.16'], runBat: true }), serverFiles) === 25);
// No run.bat -> not a script server -> do NOT guess from stray libraries.
check('no run.bat -> null (no guess)', requiredJavaForServer(makeServer({ neoforge: ['21.1.251'] }), serverFiles) === null);
check('empty folder -> null', requiredJavaForServer(makeServer({}), serverFiles) === null);
check('null root -> null', requiredJavaForServer(null, serverFiles) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
