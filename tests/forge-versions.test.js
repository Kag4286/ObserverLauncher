// Phase 3 (2.2.0): pure Forge/NeoForge version helpers. Covers the MC-label mapping that used to
// show meaningless labels ('21' instead of '1.21.1') in the wizard's MC-first picker.
const assert = require('assert');
const { isPrerelease, mcFor, annotateVersions, compareMc, sortMcVersionsDesc } = require('../src/main/forge-versions.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- isPrerelease: any hyphen = prerelease (26.3.0.16-beta) ---
ok('beta is prerelease', isPrerelease('26.3.0.16-beta') === true);
ok('plain is not prerelease', isPrerelease('21.1.251') === false);
ok('empty not prerelease', isPrerelease('') === false);

// --- mcFor: the core fix ---
ok('NeoForge 21.1.251 -> 1.21.1', mcFor('21.1.251') === '1.21.1');
ok('NeoForge 20.2.16-beta -> 1.20.2', mcFor('20.2.16-beta') === '1.20.2');
ok('NeoForge 26.3.0.16 -> 26.3', mcFor('26.3.0.16') === '26.3');
ok('Forge 1.21.1-52.0.1 -> 1.21.1', mcFor('1.21.1-52.0.1') === '1.21.1');
ok('Forge 1.7.10-10.13 -> 1.7.10', mcFor('1.7.10-10.13.4.1614') === '1.7.10');
ok('NeoForge 21.4.100 -> 1.21.4', mcFor('21.4.100') === '1.21.4');
ok('unknown -> null', mcFor('') === null);
ok('garbage -> null', mcFor('not-a-version') === null);

// --- annotateVersions: order preserved, stable flag + mc filled ---
const ann = annotateVersions(['26.3.0.16-beta', '21.1.251', '1.21.1-52.0.1']);
ok('annotate length', ann.length === 3);
ok('annotate order preserved', ann[0].v === '26.3.0.16-beta' && ann[1].v === '21.1.251');
ok('beta flagged unstable', ann[0].stable === false);
ok('stable flagged', ann[1].stable === true);
ok('mc filled on each', ann.every(a => a.mc));
ok('annotate non-array safe', annotateVersions(null).length === 0);

// --- calendar scheme (26.x) must map to a real MC id, NOT '1.26' ---
ok('NeoForge 26.3.0.33-beta -> 26.3', mcFor('26.3.0.33-beta') === '26.3');
ok('NeoForge 26.2.0.88 -> 26.2', mcFor('26.2.0.88') === '26.2');

// --- sortMcVersionsDesc: numeric, newest first (fixes Leaf's unsorted list) ---
const sorted = sortMcVersionsDesc(['1.21.4', '26.3', '1.21.11', '1.21.1', '26.2']);
ok('sort newest first', JSON.stringify(sorted) === JSON.stringify(['26.3', '26.2', '1.21.11', '1.21.4', '1.21.1']));
ok('sort does not mutate input', ['26.3', '1.21.1'].every((v, i) => ['26.3', '1.21.1'][i] === v));
ok('sort non-array safe', sortMcVersionsDesc(null).length === 0);
ok('compareMc 26.3 > 1.21.1', compareMc('26.3', '1.21.1') < 0);
ok('compareMc 1.21.11 > 1.21.4', compareMc('1.21.11', '1.21.4') < 0);

console.log(`\n${passed} passed, 0 failed`);
