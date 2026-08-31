// Sync audit tests: Java requirement mapping across MC versioning schemes.
const { requiredJavaForJar, javaMajor, validateStart } = require('../src/main/java.js');
let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// calendar versioning (26.x) — Java 25 (verified live against Mojang's javaVersion manifest field)
check('paper-26.2.jar -> 25', requiredJavaForJar('paper-26.2.jar') === 25);
check('paper-26.3.jar -> 25 (future)', requiredJavaForJar('paper-26.3.jar') === 25);
check('minecraft_server.26.1.jar -> 25', requiredJavaForJar('minecraft_server.26.1.jar') === 25);
// classic versioning
check('paper-1.21.4.jar -> 21', requiredJavaForJar('paper-1.21.4.jar') === 21);
check('purpur-1.20.6.jar -> 21', requiredJavaForJar('purpur-1.20.6.jar') === 21);
check('paper-1.20.1.jar -> 17', requiredJavaForJar('paper-1.20.1.jar') === 17);
check('fabric-loader-1.18.2.jar -> 17', requiredJavaForJar('fabric-server-mc.1.18.2.jar') === 17);
check('1.17.1 -> 16', requiredJavaForJar('server-1.17.1.jar') === 16);
check('spigot-1.12.2.jar -> 8', requiredJavaForJar('spigot-1.12.2.jar') === 8);
// no false positives / unknowns
check('velocity.jar -> null (no version)', requiredJavaForJar('velocity-3.3.0.jar') === null);
check('run.bat -> null', requiredJavaForJar('') === null);
check('no 1.x false match inside 26.2', requiredJavaForJar('leaf-26.2.jar') === 25);
// javaMajor parses both schemes
check('javaMajor("26.2") -> 26', javaMajor('openjdk version "26.2"') === 26 || javaMajor('26.2') === 26);
check('javaMajor("21.0.4") -> 21', javaMajor('openjdk version "21.0.4"') === 21);
// end-to-end: Java 21 vs Paper 26.2 must now be BLOCKED (26.x needs 25); Java 25 passes
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-java-'));
fs.writeFileSync(path.join(tmp, 'paper-26.2.jar'), 'x');
const fakeFiles = (p) => ({ jar: 'paper-26.2.jar', launchScript: null });
const msg21 = validateStart({ serverPath: tmp, jvmArgs: '', memoryMax: 6 }, { ok: true, version: '21.0.4', arch: '64-bit', path: 'java' }, fakeFiles);
check('Java 21 + 26.2 blocked (needs 25)', typeof msg21 === 'string' && msg21.includes('needs Java 25'));
const msg17 = validateStart({ serverPath: tmp, jvmArgs: '', memoryMax: 6 }, { ok: true, version: '17.0.2', arch: '64-bit', path: 'java' }, fakeFiles);
check('Java 17 + 26.2 blocked (needs 25)', typeof msg17 === 'string' && msg17.includes('needs Java 25'));
const okMsg = validateStart({ serverPath: tmp, jvmArgs: '', memoryMax: 6 }, { ok: true, version: '25.0.1', arch: '64-bit', path: 'java' }, fakeFiles);
check('Java 25 + 26.2 passes jar check', okMsg === null || !okMsg.includes('needs Java'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
