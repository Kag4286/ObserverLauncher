// v6.0.0 H4: updatePolicyOf resolves the 3-way update policy, with a one-time fallback to the old
// autoCheckUpdates boolean so an existing profile is not lost. Pure (no electron-updater).
const assert = require('assert');
const { updatePolicyOf, UPDATE_POLICIES } = require('../src/main/app-lifecycle.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

ok('policies are auto/ask/off', JSON.stringify(UPDATE_POLICIES) === JSON.stringify(['auto', 'ask', 'off']));
ok('explicit auto', updatePolicyOf({ updatePolicy: 'auto' }) === 'auto');
ok('explicit ask', updatePolicyOf({ updatePolicy: 'ask' }) === 'ask');
ok('explicit off', updatePolicyOf({ updatePolicy: 'off' }) === 'off');
ok('invalid policy -> ask', updatePolicyOf({ updatePolicy: 'bogus' }) === 'ask');
ok('legacy boolean false -> off', updatePolicyOf({ autoCheckUpdates: false }) === 'off');
ok('legacy boolean true -> ask', updatePolicyOf({ autoCheckUpdates: true }) === 'ask');
ok('empty settings -> ask', updatePolicyOf({}) === 'ask');
ok('null settings -> ask', updatePolicyOf(null) === 'ask');
ok('explicit policy wins over legacy boolean', updatePolicyOf({ updatePolicy: 'auto', autoCheckUpdates: false }) === 'auto');

console.log(`\n${passed} passed, 0 failed`);
