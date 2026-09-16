// Platform helpers for the Java auto-installer: pick the right Adoptium OS, archive format and
// java binary name per platform (Windows .zip/java.exe vs Linux/mac .tar.gz/java).
const assert = require('assert');
const { javaRuntimeOs, javaRuntimeExt, javaBinName } = require('../src/main/java.js');
let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

ok('win32 -> windows', javaRuntimeOs('win32') === 'windows');
ok('linux -> linux', javaRuntimeOs('linux') === 'linux');
ok('darwin -> mac', javaRuntimeOs('darwin') === 'mac');
ok('freebsd -> linux', javaRuntimeOs('freebsd') === 'linux');

ok('windows ext zip', javaRuntimeExt('windows') === 'zip');
ok('linux ext tar.gz', javaRuntimeExt('linux') === 'tar.gz');
ok('mac ext tar.gz', javaRuntimeExt('mac') === 'tar.gz');

ok('windows bin java.exe', javaBinName('windows') === 'java.exe');
ok('linux bin java', javaBinName('linux') === 'java');
ok('mac bin java', javaBinName('mac') === 'java');

// default arg follows the current process platform (never throws)
ok('default os is a string', typeof javaRuntimeOs() === 'string');
ok('default ext matches os', javaRuntimeExt() === (javaRuntimeOs() === 'windows' ? 'zip' : 'tar.gz'));

console.log(`\n${passed} passed, 0 failed`);
