// v3.3.1: natural version comparison used by the install downgrade gate.
const { compareVersions, isComparableVersion } = require('../src/main/version-compare.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// numeric runs compare numerically (the 1.9 vs 1.10 trap)
ck('1.10 > 1.9', compareVersions('1.10', '1.9') === 1);
ck('1.9 < 1.10', compareVersions('1.9', '1.10') === -1);
ck('equal -> 0', compareVersions('1.2.3', '1.2.3') === 0);
ck('6.0.1 > 5.0.7', compareVersions('6.0.1', '5.0.7') === 1);
ck('5.0.7 < 6.0.1', compareVersions('5.0.7', '6.0.1') === -1);

// equal-length numeric bumps
ck('2.2.6 > 2.2.5', compareVersions('2.2.6', '2.2.5') === 1);
ck('1.0.0 < 1.0.1', compareVersions('1.0.0', '1.0.1') === -1);

// suffix / build metadata
ck('v1.2 > 1.2.0', compareVersions('v1.2', '1.2.0') >= 0); // trailing .0 equals, leading v is text
ck('1.0.0-beta < 1.0.0', compareVersions('1.0.0-beta', '1.0.0') === -1);

// non-numeric / empty are safe
ck('empty vs empty -> 0', compareVersions('', '') === 0);
ck('null safe', compareVersions(null, undefined) === 0);
ck('no throw on garbage', typeof compareVersions('abc', 'def') === 'number');

// comparability guard
ck('1.2.3 comparable', isComparableVersion('1.2.3') === true);
ck('latest NOT comparable', isComparableVersion('latest') === false);
ck('empty NOT comparable', isComparableVersion('') === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
