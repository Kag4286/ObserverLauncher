// v6.0.0 G3: JVM preset builders are pure functions in 00-core.js. Runs the file in a VM with a DOM
// stub, then checks each preset sets -Xms/-Xmx from the given GB and carries its defining GC flag.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '00-core.js'), 'utf8');
const noop = () => {};
const sandbox = {
  document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: noop },
  window: { addEventListener: noop, LOCALES: { en: {} } },
  navigator: { clipboard: { writeText: async () => {} } },
  requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  setTimeout, clearTimeout, console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { aikarFlags, zgcFlags, g1TunedFlags, shenandoahFlags, recommendJvmPreset } = sandbox;
// `const JVM_PRESETS` is a lexical binding: not attached to the sandbox object, so read it by eval.
const JVM_PRESETS = vm.runInContext('JVM_PRESETS', sandbox);

ok('all builders exist', [aikarFlags, zgcFlags, g1TunedFlags, shenandoahFlags].every(f => typeof f === 'function'));
ok('JVM_PRESETS maps all four', JVM_PRESETS.aikar === aikarFlags && JVM_PRESETS.zgc === zgcFlags && JVM_PRESETS.g1 === g1TunedFlags && JVM_PRESETS.shenandoah === shenandoahFlags);

// each builder honors the memory passed in
for (const [name, fn] of [['aikar', aikarFlags], ['zgc', zgcFlags], ['g1', g1TunedFlags], ['shenandoah', shenandoahFlags]]) {
  const s = fn(4, 8);
  ok(`${name}: -Xms4G`, s.includes('-Xms4G'));
  ok(`${name}: -Xmx8G`, s.includes('-Xmx8G'));
  ok(`${name}: utf8 encoding`, s.includes('-Dfile.encoding=UTF-8'));
}

// GC-specific markers
ok('aikar uses G1 + aikars marker', aikarFlags(2, 4).includes('-XX:+UseG1GC') && aikarFlags(2, 4).includes('using.aikars.flags'));
ok('zgc uses ZGC + generational (legacy/default)', zgcFlags(8, 16).includes('-XX:+UseZGC') && zgcFlags(8, 16).includes('-XX:+ZGenerational'));
ok('zgc omits -XX:+ZGenerational on Java 25+', zgcFlags(8, 16, 25).includes('-XX:+UseZGC') && !zgcFlags(8, 16, 25).includes('-XX:+ZGenerational'));
ok('shenandoah uses ShenandoahGC', shenandoahFlags(6, 12).includes('-XX:+UseShenandoahGC'));
ok('g1 tuned uses G1 + 100ms pause', g1TunedFlags(2, 4).includes('-XX:+UseG1GC') && g1TunedFlags(2, 4).includes('MaxGCPauseMillis=100'));
ok('g1 tuned includes -XX:+UnlockExperimentalVMOptions for Java 8 compatibility', g1TunedFlags(2, 4).includes('-XX:+UnlockExperimentalVMOptions'));

// recommendJvmPreset checks
ok('recommend zgc for Java 21/25 + high RAM', recommendJvmPreset({ maxGB: 12, javaVersion: 25 }) === 'zgc');
ok('recommend shenandoah for modded + 8GB on Java 21', recommendJvmPreset({ maxGB: 8, javaVersion: 21, isModded: true }) === 'shenandoah');
ok('recommend aikar for modded on Java 8 (shenandoah unsupported)', recommendJvmPreset({ maxGB: 8, javaVersion: 8, isModded: true }) === 'aikar');
ok('recommend g1 for low RAM (<4GB)', recommendJvmPreset({ maxGB: 2, javaVersion: 17 }) === 'g1');
ok('recommend aikar by default', recommendJvmPreset({ maxGB: 6, javaVersion: 17 }) === 'aikar');

// no GC flag overlaps wrongly: zgc must NOT also request G1
ok('zgc does not use G1', !zgcFlags(8, 16).includes('UseG1GC'));
ok('shenandoah does not use G1', !shenandoahFlags(6, 12).includes('UseG1GC'));

console.log(`\n${passed} passed, 0 failed`);
