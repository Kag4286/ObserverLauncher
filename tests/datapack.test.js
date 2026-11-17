// 3.3.0: datapack validation helpers (pure) + editor ALLOWED extensions + the 2 new MCP tools.
const { parsePackMeta, formatRange, formatForMc, classifyFormat } = require('../src/main/datapack.js');
const { ALLOWED } = require('../src/main/editor.js');
const { getTool } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// editor ALLOWED
ck('mcfunction allowed', ALLOWED.includes('.mcfunction'));
ck('snbt allowed', ALLOWED.includes('.snbt'));

// parsePackMeta
let m = parsePackMeta(JSON.stringify({ pack: { pack_format: 15, description: 'x' } }));
ck('pack_format parsed', m.format === 15);
ck('no error', m.error === null);
ck('bad json -> error', !!parsePackMeta('{not json').error);
ck('no pack obj -> error', !!parsePackMeta('{}').error);
ck('supported_formats array', JSON.stringify(parsePackMeta(JSON.stringify({ pack: { pack_format: 15, supported_formats: [15, 26] } })).supported) === '[15,26]');
ck('supported_formats number -> range', JSON.stringify(parsePackMeta(JSON.stringify({ pack: { pack_format: 15, supported_formats: 26 } })).supported) === '[26,26]');
ck('supported_formats object {min_inclusive,max_inclusive}', JSON.stringify(parsePackMeta(JSON.stringify({ pack: { pack_format: 15, supported_formats: { min_inclusive: 15, max_inclusive: 48 } } })).supported) === '[15,48]');
ck('lenient pack.mcmeta (comments + trailing comma)', parsePackMeta('{\n// comment\n"pack": { "pack_format": 48, }\n}').format === 48);
// v6.0.0 C5: 1.21.9+ (26.x) uses min_format / max_format, and both shapes may be [major, minor].
let nf = parsePackMeta(JSON.stringify({ pack: { min_format: [101, 1], max_format: [121, 0] } }));
ck('min_format array parsed', nf.format === 101.1);
ck('min_format range parsed', JSON.stringify(nf.supported) === '[101.1,121]');
ck('min_format scalar parsed', parsePackMeta(JSON.stringify({ pack: { min_format: 121, max_format: 121 } })).format === 121);
ck('min_format wins over pack_format', parsePackMeta(JSON.stringify({ pack: { pack_format: 15, min_format: 101.1, max_format: 121 } })).format === 101.1);
// 26.x range check: a pack that declares min 101.1 / max 121 is ok for 26.3 (expected 121).
ck('26.x pack matching 26.3 -> ok', classifyFormat(nf, '26.3').level === 'ok');
// Bare integer max_format: 94 covers minor versions of major 94 (e.g. 94.1 on 1.21.11).
let bareMax = parsePackMeta(JSON.stringify({ pack: { min_format: 88, max_format: 94 } }));
ck('bare scalar max_format 94 covers 1.21.11 (94.1)', classifyFormat(bareMax, '1.21.11').level === 'ok');

// formatRange / formatForMc (verified against official Minecraft Wiki Data Pack table)
ck('range 15 -> 1.20–1.20.1', formatRange(15).label === '1.20–1.20.1');
ck('range 48 -> 1.21–1.21.1', formatRange(48).label === '1.21–1.21.1');
ck('range unknown -> null', formatRange(999) === null);
ck('mc 1.20.1 -> 15', formatForMc('1.20.1') === 15);
ck('mc 1.20.2 -> 18', formatForMc('1.20.2') === 18);
ck('mc 1.20.4 -> 26', formatForMc('1.20.4') === 26);
ck('mc 1.20.6 -> 41', formatForMc('1.20.6') === 41);
ck('mc 1.21 / 1.21.1 -> 48', formatForMc('1.21') === 48 && formatForMc('1.21.1') === 48);
ck('mc unknown -> null', formatForMc('99.9') === null);
ck('mc 26.3 -> 121.0', formatForMc('26.3') === 121.0);

// classifyFormat
ck('match -> ok', classifyFormat({ format: 18, supported: null }, '1.20.2').level === 'ok');
ck('mismatch -> warn', classifyFormat({ format: 15, supported: null }, '1.20.2').level === 'warn');
ck('no format -> unknown', classifyFormat({ format: null }, '1.20.2').level === 'unknown');
ck('unknown mc -> unknown', classifyFormat({ format: 18, supported: null }, '99.9').level === 'unknown');
ck('supported range covers -> ok', classifyFormat({ format: 15, supported: [15, 26] }, '1.20.2').level === 'ok');
ck('supported_formats object covers 1.21.1 -> ok', classifyFormat(parsePackMeta(JSON.stringify({ pack: { pack_format: 48, supported_formats: { min_inclusive: 48, max_inclusive: 61 } } })), '1.21.1').level === 'ok');
ck('warn note mentions server', /server/.test(classifyFormat({ format: 15 }, '1.20.2').note));

// MCP tools wired + drift-guard covers them via mcp-tools.test.js
const v = getTool('validate_datapack');
const e = getTool('extract_datapack');
ck('validate_datapack exists (read)', v && v.risk === 'read');
ck('extract_datapack exists (write)', e && e.risk === 'write');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
