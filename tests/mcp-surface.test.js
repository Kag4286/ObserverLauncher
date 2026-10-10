// v5.0.0 MCP surface tests: tool annotations + outputSchema (Gói A), prompts (Gói B),
// resource templates + single-source resolver (Gói C). tools.js pulls main modules that require
// electron, so mock it first.
const Module = require('module');
const os = require('os');
const path = require('path');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => path.join(os.tmpdir(), 'ob-mcp-surface') } };
  return origLoad.apply(this, arguments);
};

const { TOOLS, getTool, TOOL_ANNOTATIONS, OUTPUT_SCHEMAS } = require('../src/mcp/tools.js');
const { PROMPTS, getPrompt, promptList } = require('../src/mcp/prompts.js');
const { STATIC_RESOURCES, RESOURCE_TEMPLATES, UI_RESOURCES, resolveResource, resolveUiResource } = require('../src/mcp/resources.js');
// 5.1.0: bridge timeout policy. We can NOT require bridge.js here — it attaches a process.stdin
// listener at load time and would hang the test runner. Parse its SOURCE instead (same approach
// tests/mcp-tools.test.js uses for STATIC_TOOLS).
const bridgeSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'mcp', 'bridge.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// --- Gói A: annotations on every tool, derived from risk ---
check('every tool has annotations', TOOLS.every(t => t.annotations && typeof t.annotations === 'object'));
check('read tools are readOnlyHint', TOOLS.filter(t => t.risk === 'read').every(t => t.annotations.readOnlyHint === true));
check('write/destroy are NOT readOnlyHint', TOOLS.filter(t => t.risk !== 'read').every(t => t.annotations.readOnlyHint === false));
check('destroy tools are destructiveHint', TOOLS.filter(t => t.risk === 'destroy').every(t => t.annotations.destructiveHint === true));
check('non-destroy are NOT destructiveHint', TOOLS.filter(t => t.risk !== 'destroy').every(t => t.annotations.destructiveHint === false));
check('get_status openWorldHint false', getTool('get_status').annotations.openWorldHint === false);
check('search_marketplace openWorldHint true', getTool('search_marketplace').annotations.openWorldHint === true);
check('install_from_market openWorldHint true', getTool('install_from_market').annotations.openWorldHint === true);

// --- Gói A: outputSchema only on tools that exist (no drift) ---
const schemaNames = Object.keys(OUTPUT_SCHEMAS);
const unknownSchema = schemaNames.filter(n => !getTool(n));
if (unknownSchema.length) console.log('  outputSchema for unknown tools:', unknownSchema.join(', '));
check('every outputSchema key is a real tool', unknownSchema.length === 0);
check('every outputSchema tool carries it', schemaNames.every(n => getTool(n).outputSchema && getTool(n).outputSchema.type === 'object'));
check('at least 15 outputSchemas', schemaNames.length >= 15);
check('non-schema read tools have no outputSchema', getTool('list_files').outputSchema === undefined);

// --- Gói B: prompts ---
check('6 prompts', PROMPTS.length === 6);
check('every prompt has name/title/description/arguments/build', PROMPTS.every(p => p.name && p.title && p.description && Array.isArray(p.arguments) && typeof p.build === 'function'));
check('prompt names unique', new Set(PROMPTS.map(p => p.name)).size === PROMPTS.length);
const names = PROMPTS.map(p => p.name);
['diagnose_server','optimize_for_ram','explain_last_crash','set_up_paper_for_players','audit_mods','safe_modpack_install'].forEach(n => check('prompt exists: ' + n, names.includes(n)));
// build returns a non-empty message list with text content
check('build returns messages', PROMPTS.every(p => { const m = p.build({}); return Array.isArray(m) && m.length > 0 && m[0].role === 'user' && m[0].content.type === 'text' && m[0].content.text.length > 0; }));
check('safe_modpack_install interpolates query', getPrompt('safe_modpack_install').build({ query: 'better mc' })[0].content.text.includes('better mc'));
check('getPrompt unknown -> null', getPrompt('nope') === null);
check('promptList strips build', promptList().every(p => p.build === undefined && p.name && p.title));
check('promptList length matches', promptList().length === PROMPTS.length);

// --- Gói C: resources ---
check('8 static resources', STATIC_RESOURCES.length === 8);
check('4 resource templates', RESOURCE_TEMPLATES.length === 4);
check('every template has uriTemplate/name/match', RESOURCE_TEMPLATES.every(t => t.uriTemplate && t.name && typeof t.match === 'function'));
check('resolve static status', JSON.stringify(resolveResource('observer://server/status')) === JSON.stringify({ tool: 'get_status', args: {} }));
check('resolve instance/console template', (() => { const r = resolveResource('observer://instance/abc123/console'); return r && r.tool === 'get_instance_snapshot' && r.args.instance === 'abc123'; })());
check('resolve instance/status template', (() => { const r = resolveResource('observer://instance/x/status'); return r && r.tool === 'get_instance_snapshot' && r.args.instance === 'x'; })());
check('resolve file template', (() => { const r = resolveResource('observer://file/server.properties'); return r && r.tool === 'read_file' && r.args.path === 'server.properties'; })());
check('file template url-decodes', (() => { const r = resolveResource('observer://file/config%2Ffoo.yml'); return r && r.args.path === 'config/foo.yml'; })());
check('unknown resource -> null', resolveResource('observer://nope/x') === null);
check('resolveResource for every static URI non-null', STATIC_RESOURCES.every(r => resolveResource(r.uri)));

// --- 5.1.0 A1: per-tool timeout buckets (source-level assertions) ---
check('bridge defines timeoutForTool', /function timeoutForTool\(/.test(bridgeSrc));
check('bridge has a hard req.setTimeout', /req\.setTimeout\(timeoutForTool\(tool\)/.test(bridgeSrc));
check('BUILD bucket 600000 present', /return 600000;/.test(bridgeSrc));
check('read bucket 30000 present', /return 30000;/.test(bridgeSrc));
check('write bucket 120000 default', /return 120000;/.test(bridgeSrc));
check('create_instance is in BUILD_TOOLS', /BUILD_TOOLS = new Set\(\[[\s\S]*'create_instance'/.test(bridgeSrc));
check('callApp uses a settled guard', /let settled = false;/.test(bridgeSrc));

// --- 5.1.0 A2: create_instance registered (drift guard covers STATIC_TOOLS separately) ---
check('create_instance exists', !!getTool('create_instance'));
check('create_instance is write', getTool('create_instance')?.risk === 'write');

// --- 5.1.0 C spike: ui:// resource ---
check('1 UI resource', UI_RESOURCES.length === 1);
check('ui resource has mcp-app mime', UI_RESOURCES[0].mimeType === 'text/html;profile=mcp-app');
const ui = resolveUiResource('ui://observerlauncher/dashboard');
check('resolveUiResource returns html', ui && /text\/html/.test(ui.mimeType) && /ObserverLauncher/.test(ui.text));
check('resolveUiResource unknown -> null', resolveUiResource('ui://nope') === null);
check('resolveResource ignores ui://', resolveResource('ui://observerlauncher/dashboard') === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
