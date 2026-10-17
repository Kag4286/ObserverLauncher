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
const { aikarFlags, zgcFlags, g1TunedFlags } = sandbox;
// `const JVM_PRESETS` is a lexical binding: not attached to the sandbox object, so read it by eval.
const JVM_PRESETS = vm.runInContext('JVM_PRESETS', sandbox);

ok('all builders exist', [aikarFlags, zgcFlags, g1TunedFlags].every(f => typeof f === 'function'));
ok('JVM_PRESETS maps all three', JVM_PRESETS.aikar === aikarFlags && JVM_PRESETS.zgc === zgcFlags && JVM_PRESETS.g1 === g1TunedFlags);

// each builder honors the memory passed in
for (const [name, fn] of [['aikar', aikarFlags], ['zgc', zgcFlags], ['g1', g1TunedFlags]]) {
  const s = fn(4, 8);
  ok(`${name}: -Xms4G`, s.includes('-Xms4G'));
  ok(`${name}: -Xmx8G`, s.includes('-Xmx8G'));
  ok(`${name}: utf8 encoding`, s.includes('-Dfile.encoding=UTF-8'));
}

// GC-specific markers
ok('aikar uses G1 + aikars marker', aikarFlags(2, 4).includes('-XX:+UseG1GC') && aikarFlags(2, 4).includes('using.aikars.flags'));
ok('zgc uses ZGC + generational', zgcFlags(8, 16).includes('-XX:+UseZGC') && zgcFlags(8, 16).includes('-XX:+ZGenerational'));
ok('g1 tuned uses G1 + 100ms pause', g1TunedFlags(2, 4).includes('-XX:+UseG1GC') && g1TunedFlags(2, 4).includes('MaxGCPauseMillis=100'));

// no GC flag overlaps wrongly: zgc must NOT also request G1
ok('zgc does not use G1', !zgcFlags(8, 16).includes('UseG1GC'));

console.log(`\n${passed} passed, 0 failed`);
