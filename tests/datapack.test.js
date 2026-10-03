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
ck('supported_formats array', JSON.stringify(parsePackMeta(JSON.stringify({ pack: { pack_format: 15, supported_formats: [15, 22] } })).supported) === '[15,22]');
ck('supported_formats number -> range', JSON.stringify(parsePackMeta(JSON.stringify({ pack: { pack_format: 15, supported_formats: 22 } })).supported) === '[22,22]');

// formatRange / formatForMc
ck('range 15 -> 1.20.2', formatRange(15).label === '1.20.2');
ck('range unknown -> null', formatRange(999) === null);
ck('mc 1.20.1 -> 12', formatForMc('1.20.1') === 12);
ck('mc unknown -> null', formatForMc('26.2') === null);

// classifyFormat
ck('match -> ok', classifyFormat({ format: 15, supported: null }, '1.20.2').level === 'ok');
ck('mismatch -> warn', classifyFormat({ format: 12, supported: null }, '1.20.2').level === 'warn');
ck('no format -> unknown', classifyFormat({ format: null }, '1.20.2').level === 'unknown');
ck('unknown mc -> unknown', classifyFormat({ format: 15, supported: null }, '26.2').level === 'unknown');
ck('supported range covers -> ok', classifyFormat({ format: 12, supported: [12, 22] }, '1.20.2').level === 'ok');
ck('warn note mentions server', /server/.test(classifyFormat({ format: 12 }, '1.20.2').note));

// MCP tools wired + drift-guard covers them via mcp-tools.test.js
const v = getTool('validate_datapack');
const e = getTool('extract_datapack');
ck('validate_datapack exists (read)', v && v.risk === 'read');
ck('extract_datapack exists (write)', e && e.risk === 'write');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
