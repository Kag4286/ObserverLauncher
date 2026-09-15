// Regression: PowerShell on a comma-decimal locale (vi-VN, de-DE, pt-BR) emits
// "45,6712" — Number() made that NaN, permanently zeroing CPU (and RAM). The
// parse helper must accept both '.' and ',' and never return NaN.
const assert = require('assert');
const { parseMetricValue } = require('../src/main/server-lifecycle.js');

let passed = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  passed++;
}

ok('integer', parseMetricValue('512') === 512);
ok('dot decimal', parseMetricValue('45.6712') === 45.6712);
ok('comma decimal (vi-VN)', parseMetricValue('45,6712') === 45.6712);
ok('string with spaces', parseMetricValue('  512 ') === 512);
ok('null -> NaN', Number.isNaN(parseMetricValue(null)));
ok('undefined -> NaN', Number.isNaN(parseMetricValue(undefined)));
ok('garbage -> NaN', Number.isNaN(parseMetricValue('abc')));
ok('empty -> NaN', Number.isNaN(parseMetricValue('')));

console.log(`\n${passed} passed, 0 failed`);