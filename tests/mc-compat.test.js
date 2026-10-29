// Unit tests for mc-compat.js, cross-patch compatibility, and mod metadata Minecraft version detection (v6.1.6).
const {
  areMcMinorCompatible,
  getMcCompatPeers,
  testMcVersionAgainstRange,
  areMcVersionsCompatible,
  checkMcCompat,
  MC_COMPAT_GROUPS
} = require('../src/main/mc-compat.js');
const { classifyJar, parseMcModInfo, parseTomlModInfo } = require('../src/main/mod-metadata.js');
const { versionMatchesServer } = require('../src/main/server-compat.js');
const { itemCompat } = require('../src/mcp/modpack-plan.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// --- 1. Cross-patch compatible groups ---
check('1.16.4 and 1.16.5 are minor compatible', areMcMinorCompatible('1.16.4', '1.16.5'));
check('1.16.5 and 1.16.4 are minor compatible', areMcMinorCompatible('1.16.5', '1.16.4'));
check('1.20 and 1.20.1 are minor compatible', areMcMinorCompatible('1.20', '1.20.1'));
check('1.19.1 and 1.19.2 are minor compatible', areMcMinorCompatible('1.19.1', '1.19.2'));
check('1.18 and 1.18.1 are minor compatible', areMcMinorCompatible('1.18', '1.18.1'));
check('1.21 and 1.21.1 are minor compatible', areMcMinorCompatible('1.21', '1.21.1'));
check('1.21.2 and 1.21.3 are minor compatible', areMcMinorCompatible('1.21.2', '1.21.3'));
check('26.1 and 26.1.1 are minor compatible', areMcMinorCompatible('26.1', '26.1.1'));
check('1.21 and 1.21.0 are minor compatible via zero-normalization', areMcMinorCompatible('1.21', '1.21.0'));
check('26.1 and 26.1.0 are minor compatible via zero-normalization', areMcMinorCompatible('26.1', '26.1.0'));
check('1.16.5 and 1.17 are NOT compatible', !areMcMinorCompatible('1.16.5', '1.17'));
check('1.12.2 and 1.16.5 are NOT compatible', !areMcMinorCompatible('1.12.2', '1.16.5'));

// --- 2. Range parsing & evaluation ---
// Maven closed interval [1.16.4, 1.16.5]
check('[1.16.4, 1.16.5] satisfies 1.16.4', testMcVersionAgainstRange('1.16.4', '[1.16.4, 1.16.5]'));
check('[1.16.4, 1.16.5] satisfies 1.16.5', testMcVersionAgainstRange('1.16.5', '[1.16.4, 1.16.5]'));
check('[1.16.4, 1.16.5] rejects 1.17', !testMcVersionAgainstRange('1.17', '[1.16.4, 1.16.5]'));
check('[1.16.4, 1.16.5] rejects 1.16.3', !testMcVersionAgainstRange('1.16.3', '[1.16.4, 1.16.5]'));

// Maven half-open [1.16.4, 1.17)
check('[1.16.4, 1.17) satisfies 1.16.5', testMcVersionAgainstRange('1.16.5', '[1.16.4, 1.17)'));
check('[1.16.4, 1.17) rejects 1.17', !testMcVersionAgainstRange('1.17', '[1.16.4, 1.17)'));

// Maven unbounded [1.16.4,)
check('[1.16.4,) satisfies 1.16.5', testMcVersionAgainstRange('1.16.5', '[1.16.4,)'));
check('[1.16.4,) satisfies 1.20.1', testMcVersionAgainstRange('1.20.1', '[1.16.4,)'));
check('[1.16.4,) rejects 1.15.2', !testMcVersionAgainstRange('1.15.2', '[1.16.4,)'));

// Exact bracket [1.16.4]
check('[1.16.4] exact matches 1.16.4', testMcVersionAgainstRange('1.16.4', '[1.16.4]'));
check('[1.16.4] direct test rejects 1.16.5', !testMcVersionAgainstRange('1.16.5', '[1.16.4]'));

// Fabric semver: >=1.16.4 <=1.16.5
check('>=1.16.4 <=1.16.5 satisfies 1.16.5', testMcVersionAgainstRange('1.16.5', '>=1.16.4 <=1.16.5'));
check('>=1.16.4 <=1.16.5 satisfies 1.16.4', testMcVersionAgainstRange('1.16.4', '>=1.16.4 <=1.16.5'));
check('>=1.16.4 <=1.16.5 rejects 1.17', !testMcVersionAgainstRange('1.17', '>=1.16.4 <=1.16.5'));

// Tilde: ~1.16.4
check('~1.16.4 satisfies 1.16.5', testMcVersionAgainstRange('1.16.5', '~1.16.4'));
check('~1.16.4 rejects 1.17', !testMcVersionAgainstRange('1.17', '~1.16.4'));

// Caret: ^1.16.4, ^26.1
check('^1.16.4 satisfies 1.16.5', testMcVersionAgainstRange('1.16.5', '^1.16.4'));
check('^1.16.4 rejects 1.17', !testMcVersionAgainstRange('1.17', '^1.16.4'));
check('^26.1 satisfies 26.1', testMcVersionAgainstRange('26.1', '^26.1'));
check('^26.1 satisfies 26.1.1', testMcVersionAgainstRange('26.1.1', '^26.1'));
check('^26.1 rejects 26.2', !testMcVersionAgainstRange('26.2', '^26.1'));

// Wildcard
check('* satisfies 1.20.1', testMcVersionAgainstRange('1.20.1', '*'));

// --- 3. areMcVersionsCompatible (Range + Cross-patch bridge) ---
// The exact user case: mod declaring 1.16.4 on a 1.16.5 server
check('1.16.5 server compatible with [1.16.4, 1.16.5] range', areMcVersionsCompatible('1.16.5', '[1.16.4, 1.16.5]'));
check('1.16.5 server compatible with bare "1.16.4" via cross-patch', areMcVersionsCompatible('1.16.5', '1.16.4'));
check('1.16.5 server compatible with [1.16.4] via cross-patch', areMcVersionsCompatible('1.16.5', '[1.16.4]'));
check('1.16.5 server compatible with ["1.16.4"] list via cross-patch', areMcVersionsCompatible('1.16.5', ['1.16.4']));
check('1.20.1 server compatible with 1.20 mod via cross-patch', areMcVersionsCompatible('1.20.1', '1.20'));
check('1.16.5 server rejects 1.12.2', !areMcVersionsCompatible('1.16.5', '1.12.2'));
check('1.16.5 server rejects [1.18, 1.19)', !areMcVersionsCompatible('1.16.5', '[1.18, 1.19)'));

// --- 4. checkMcCompat diagnostics & notes ---
const rangeReport = checkMcCompat('1.16.5', '[1.16.4, 1.16.5]');
check('rangeReport compatible', rangeReport.compatible === true);
check('rangeReport status is range', rangeReport.status === 'range');
check('rangeReport has note', typeof rangeReport.note === 'string' && rangeReport.note.includes('1.16.5'));

const crossReport = checkMcCompat('1.16.5', '1.16.4');
check('crossReport compatible', crossReport.compatible === true);
check('crossReport status is cross-patch', crossReport.status === 'cross-patch');
check('crossReport note explains compatibility', crossReport.note.includes('binary/network compatible'));

const incompReport = checkMcCompat('1.16.5', '[1.18, 1.19)');
check('incompReport not compatible', incompReport.compatible === false);
check('incompReport status is incompatible', incompReport.status === 'incompatible');

// --- 5. server-compat versionMatchesServer integration ---
check('versionMatchesServer accepts 1.16.4 build on 1.16.5 server', versionMatchesServer({ gameVersions: ['1.16.4'], loaders: ['forge'] }, { mc: '1.16.5', loader: 'forge' }).ok === true);
check('versionMatchesServer rejects 1.12.2 build on 1.16.5 server', versionMatchesServer({ gameVersions: ['1.12.2'], loaders: ['forge'] }, { mc: '1.16.5', loader: 'forge' }).ok === false);

// --- 6. modpack-plan itemCompat integration ---
check('itemCompat accepts 1.16.4 item on 1.16.5 server without warning', itemCompat({ gameVersions: ['1.16.4'], loaders: ['forge'] }, { mc: '1.16.5', loader: 'forge' }).warnings.length === 0);
check('itemCompat warns mc on 1.12.2 item for 1.16.5 server', itemCompat({ gameVersions: ['1.12.2'], loaders: ['forge'] }, { mc: '1.16.5', loader: 'forge' }).warnings.includes('mc'));

// --- 7. classifyJar with real-world Forge mods.toml containing [[dependencies.minecraft]] ---
const forgeTomlWithMc = `
[mods]
modId = "appleskin"
version = "0.8.1"
displayName = "AppleSkin"

[[dependencies.appleskin]]
modId = "minecraft"
mandatory = true
versionRange = "[1.16.4, 1.16.5]"

[[dependencies.appleskin]]
modId = "forge"
mandatory = true
versionRange = "[35.1.0,)"
`;

const stubRead = (filename) => {
  if (filename === 'META-INF/mods.toml') return { ok: true, content: forgeTomlWithMc };
  return { ok: false };
};

// Mod filename says 1.16.4, but internal mods.toml declares [1.16.4, 1.16.5]
const classified = classifyJar(stubRead, 'appleskin-mc1.16.4-forge-tip-0.8.1.jar');
check('modId is appleskin', classified.modId === 'appleskin');
check('loader is forge', classified.loader === 'forge');
check('mcVersionRange parsed from dependencies', classified.mcVersionRange === '[1.16.4, 1.16.5]');
check('mcHint parsed from filename', classified.mcHint === '1.16.4');
check('mcSource is metadata (not filename)', classified.mcSource === 'metadata');

const checkResult = checkMcCompat('1.16.5', classified.mcVersionRange);
check('classified jar is fully compatible with 1.16.5 server', checkResult.compatible === true);

// --- 8. Gradle unexpanded variable "${file.jarVersion}" fallback ---
const gradleToml = `
[mods]
modId = "coolmod"
version = "\${file.jarVersion}"
displayName = "Cool Mod"
`;
const parsedModInfo = parseTomlModInfo(gradleToml);
check('parseTomlModInfo drops unexpanded ${file.jarVersion}', parsedModInfo.version === null);

// Manifest fallback provides real version
const gradleStub = (name) => {
  if (name === 'META-INF/mods.toml') return { ok: true, content: gradleToml };
  if (name === 'META-INF/MANIFEST.MF') return { ok: true, content: 'Implementation-Version: 1.0.4\nMinecraft-Version: 1.16.5\n' };
  return { ok: false };
};
const gradleClassified = classifyJar(gradleStub, 'coolmod-1.16.5-1.0.4.jar');
check('version falls back to manifest', gradleClassified.version === '1.0.4');
check('mcVersionRange falls back to manifest', gradleClassified.mcVersionRange === '1.16.5');

// --- 9. Legacy Forge mcmod.info parsing ---
const mcmodInfoJson = JSON.stringify([
  {
    modid: 'ironchest',
    name: 'Iron Chest',
    version: '7.0.72.847',
    mcversion: '1.12.2',
    requiredMods: ['forge']
  }
]);
const legacyStub = (name) => {
  if (name === 'mcmod.info') return { ok: true, content: mcmodInfoJson };
  return { ok: false };
};
const legacyClassified = classifyJar(legacyStub, 'ironchest-1.12.2-7.0.72.847.jar');
check('legacy mod loader is forge', legacyClassified.loader === 'forge');
check('legacy modId is ironchest', legacyClassified.modId === 'ironchest');
check('legacy name is Iron Chest', legacyClassified.name === 'Iron Chest');
check('legacy version is 7.0.72.847', legacyClassified.version === '7.0.72.847');
check('legacy mcVersionRange is 1.12.2', legacyClassified.mcVersionRange === '1.12.2');
check('legacy mcSource is metadata', legacyClassified.mcSource === 'metadata');

// --- 10. Compound Maven bracket ranges (smallships case) ---
const compoundRange = '[1.16.5],[1.16.4],[1.16.3],[1.16.2],[1.16.1],[1.16]';
check('compound range satisfies 1.16.5', testMcVersionAgainstRange('1.16.5', compoundRange));
check('compound range satisfies 1.16.4', testMcVersionAgainstRange('1.16.4', compoundRange));
check('compound range satisfies 1.16', testMcVersionAgainstRange('1.16', compoundRange));
check('compound range rejects 1.17', !testMcVersionAgainstRange('1.17', compoundRange));
check('compound range areMcVersionsCompatible with 1.16.5', areMcVersionsCompatible('1.16.5', compoundRange));

const compoundWithSpaces = '[1.16.4, 1.16.5], [1.17]';
check('compound with spaces satisfies 1.16.5', testMcVersionAgainstRange('1.16.5', compoundWithSpaces));
check('compound with spaces satisfies 1.17', testMcVersionAgainstRange('1.17', compoundWithSpaces));
check('compound with spaces rejects 1.18', !testMcVersionAgainstRange('1.18', compoundWithSpaces));

// --- 11. MANIFEST.MF Specification-Version vs Minecraft-Version ---
const { parseManifestMf } = require('../src/main/mod-metadata.js');
check('parseManifestMf ignores Specification-Version 1.0', parseManifestMf('Specification-Title: travelerstitles\nSpecification-Version: 1.0\n').mcVersionRange === null);
check('parseManifestMf ignores Specification-Version 2.1.13', parseManifestMf('Specification-Title: iceandfire\nSpecification-Version: 2.1.13\n').mcVersionRange === null);
check('parseManifestMf ignores Specification-Version 1.11.0', parseManifestMf('Specification-Title: alexsmobs\nSpecification-Version: 1.11.0\n').mcVersionRange === null);
check('parseManifestMf parses Minecraft-Version: 1.16.5', parseManifestMf('Minecraft-Version: 1.16.5\n').mcVersionRange === '1.16.5');

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
