// CB3 (v3.3.0): read a jar's DECLARED name + version. Pure parsers (toml / plugin.yml / manifest)
// plus classifyJar wiring. No real jar needed - classifyJar takes a read() stub.
const { classifyJar, parseTomlModInfo, parsePluginYml, parseManifestMf } = require('../src/main/mod-metadata.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// parseTomlModInfo - first [mods] block only, must not read dependency blocks
const toml = '[mods]\nmodId="jei"\nversion="15.2.0"\ndisplayName="Just Enough Items"\n\n[[dependencies.jei]]\nmodId="neoforge"\ntype="required"\n';
const mi = parseTomlModInfo(toml);
ck('toml modId', mi.modId === 'jei');
ck('toml version', mi.version === '15.2.0');
ck('toml name', mi.name === 'Just Enough Items');
// [[mods]] array form
const mi2 = parseTomlModInfo('[[mods]]\nmodId="x"\nversion="1.0"\n');
ck('toml [[mods]] modId', mi2.modId === 'x');
ck('toml [[mods]] version', mi2.version === '1.0');

// parsePluginYml
const py = parsePluginYml('name: LuckPerms\nversion: 5.4.102\nmain: x.Y\n');
ck('plugin.yml name', py.name === 'LuckPerms');
ck('plugin.yml version', py.version === '5.4.102');

// parseManifestMf
const mf = parseManifestMf('Manifest-Version: 1.0\r\nImplementation-Title: WorldEdit\r\nImplementation-Version: 7.3.0\r\n');
ck('manifest name', mf.name === 'WorldEdit');
ck('manifest version', mf.version === '7.3.0');

// classifyJar: fabric json carries name+version
const fab = JSON.stringify({ id: 'sodium', name: 'Sodium', version: '0.6.0', environment: '*', depends: {} });
const fc = classifyJar(n => n === 'fabric.mod.json' ? { ok: true, content: fab } : { ok: false }, 'sodium.jar');
ck('fabric name', fc.name === 'Sodium');
ck('fabric version', fc.version === '0.6.0');

// classifyJar: bukkit plugin -> name/version from plugin.yml
const pc = classifyJar(n => n === 'plugin.yml' ? { ok: true, content: 'name: Vault\nversion: 1.7.3\n' } : { ok: false }, 'Vault.jar');
ck('plugin name from yml', pc.name === 'Vault');
ck('plugin version from yml', pc.version === '1.7.3');

// classifyJar: manifest fallback
const mc = classifyJar(n => n === 'META-INF/MANIFEST.MF' ? { ok: true, content: 'Implementation-Title: Legacy\nImplementation-Version: 2.2\n' } : { ok: false }, 'x.jar');
ck('manifest name fallback', mc.name === 'Legacy');
ck('manifest version fallback', mc.version === '2.2');

// regression: unknown jar still loader null, no version
const unk = classifyJar(() => ({ ok: false }), 'mystery.jar');
ck('unknown loader still null', unk.loader === null);
ck('unknown version still null', unk.version === null);
ck('unknown name still null', unk.name === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
