// MCP tool registry + risk gating tests. tools.js pulls in many main modules that require
// electron, so mock electron before requiring.
const Module = require('module');
const os = require('os');
const path = require('path');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => path.join(os.tmpdir(), 'ob-mcp-test') } };
  return origLoad.apply(this, arguments);
};

const { TOOLS, getTool } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

// --- registry sanity ---
check('has tools', TOOLS.length >= 30);
check('every tool has name', TOOLS.every(t => typeof t.name === 'string' && t.name.length));
check('every tool has risk', TOOLS.every(t => ['read', 'write', 'destroy'].includes(t.risk)));
const noHandler = TOOLS.filter(t => typeof t.handler !== 'function').map(t => t.name);
if (noHandler.length) console.log('  tools missing handler:', noHandler.join(', '));
check('every tool has handler', noHandler.length === 0);
check('every tool has description', TOOLS.every(t => typeof t.description === 'string' && t.description.length));
check('every tool has inputSchema', TOOLS.every(t => t.inputSchema && t.inputSchema.type === 'object'));
check('no duplicate tool names', new Set(TOOLS.map(t => t.name)).size === TOOLS.length);

// --- risk tiers ---
const riskOf = n => (getTool(n) || {}).risk;
check('get_status is read', riskOf('get_status') === 'read');
check('read_file is read', riskOf('read_file') === 'read');
check('install_from_market is write', riskOf('install_from_market') === 'write');
check('start_server is write', riskOf('start_server') === 'write');
check('stop_server is destroy', riskOf('stop_server') === 'destroy');
check('delete_backup is destroy', riskOf('delete_backup') === 'destroy');
check('restore_backup is destroy', riskOf('restore_backup') === 'destroy');

// --- counts by tier ---
const byRisk = r => TOOLS.filter(t => t.risk === r).length;
check('at least 15 read tools', byRisk('read') >= 15);
check('at least 10 write tools', byRisk('write') >= 10);
check('at least 4 destroy tools', byRisk('destroy') >= 4);
check('read+write+destroy = total', byRisk('read') + byRisk('write') + byRisk('destroy') === TOOLS.length);

// --- getTool ---
check('getTool unknown -> null', getTool('nope_not_real') === null);
check('getTool known -> object', getTool('get_status') && getTool('get_status').name === 'get_status');

// --- key tools exist (the ones the user specifically asked for) ---
for (const name of ['read_file', 'search_files', 'install_from_market', 'install_local_jar', 'write_file', 'edit_file', 'list_content', 'search_marketplace']) {
  check('tool exists: ' + name, !!getTool(name));
}

// --- schema shape ---
const rf = getTool('read_file');
check('read_file requires path', (rf.inputSchema.required || []).includes('path'));
check('read_file path is string', rf.inputSchema.properties.path.type === 'string');

// --- 0.9.0 additions ---
check('get_schedule is read', getTool('get_schedule')?.risk === 'read');
check('set_schedule is write', getTool('set_schedule')?.risk === 'write');
check('list_waypoints is read', getTool('list_waypoints')?.risk === 'read');
check('kick_player is write', getTool('kick_player')?.risk === 'write');
check('kick_player requires name', (getTool('kick_player').inputSchema.required || []).includes('name'));
// search_marketplace now advertises a source param (Modrinth/Hangar/Spigot parity)
check('search_marketplace has source param', 'source' in (getTool('search_marketplace').inputSchema.properties || {}));
check('search_marketplace has offset param', 'offset' in (getTool('search_marketplace').inputSchema.properties || {}));

// --- 1.2.0 doctor + MCP upgrade ---
for (const name of ['diagnose_server', 'analyze_console', 'explain_crash', 'check_performance', 'validate_config', 'check_port', 'read_many_files', 'doctor_report', 'read_audit_log', 'prepare_and_start', 'safe_restart']) {
  check('doctor tool exists: ' + name, !!getTool(name));
}
check('diagnose_server is read', riskOf('diagnose_server') === 'read');
check('doctor_report is read', riskOf('doctor_report') === 'read');
check('read_audit_log is read', riskOf('read_audit_log') === 'read');
check('prepare_and_start is write', riskOf('prepare_and_start') === 'write');
// safe_restart stops a running server -> must be destroy (same class as stop_server), not write.
check('safe_restart is destroy', riskOf('safe_restart') === 'destroy');
// install_from_market advertises a source param so Hangar/Spigot installs are reachable (parity with search).
check('install_from_market has source param', 'source' in (getTool('install_from_market').inputSchema.properties || {}));
check('read_many_files requires paths', (getTool('read_many_files').inputSchema.required || []).includes('paths'));

// --- 1.3.5 diagnostic tools ---
check('tool exists: list_crash_reports', !!getTool('list_crash_reports'));
check('list_crash_reports is read', getTool('list_crash_reports')?.risk === 'read');
check('tool exists: read_server_log', !!getTool('read_server_log'));
check('read_server_log is read', getTool('read_server_log')?.risk === 'read');
check('tool exists: get_metrics_history', !!getTool('get_metrics_history'));
check('get_metrics_history is read', getTool('get_metrics_history')?.risk === 'read');
check('ban_player has ip param', 'ip' in (getTool('ban_player').inputSchema.properties || {}));
check('op_player has level param', 'level' in (getTool('op_player').inputSchema.properties || {}));

// --- 1.5.0 modpack planner/assembler ---
check('tool exists: plan_modpack', !!getTool('plan_modpack'));
check('plan_modpack is read', getTool('plan_modpack')?.risk === 'read');
check('plan_modpack requires items', (getTool('plan_modpack').inputSchema.required || []).includes('items'));
// REGRESSION (review): normalizePlanItem must accept 'curseforge', else CF items are silently
// coerced to Modrinth and resolve the wrong project. Parse the source allowlist from tools.js.
const toolsSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'mcp', 'tools.js'), 'utf8');
check('normalizePlanItem allows curseforge', /\['modrinth', 'hangar', 'spigot', 'curseforge'\]/.test(toolsSrc));
check('tool exists: assemble_modpack', !!getTool('assemble_modpack'));
check('assemble_modpack is write', getTool('assemble_modpack')?.risk === 'write');
check('assemble_modpack requires items', (getTool('assemble_modpack').inputSchema.required || []).includes('items'));


// --- v2.5.0 Autonomous Doctor + marketplace loader bugfix regression ---
check('tool exists: propose_fix', !!getTool('propose_fix'));
check('propose_fix is read', getTool('propose_fix')?.risk === 'read');
check('tool exists: apply_fix', !!getTool('apply_fix'));
check('apply_fix is destroy', getTool('apply_fix')?.risk === 'destroy');
check('apply_fix requires actions', (getTool('apply_fix').inputSchema.required || []).includes('actions'));
// BUG (found by a live MCP test on 2.5.0): a generic kind:'mod' search fell through to the
// PLUGIN loader group, so a mod lookup (apply_fix installing a missing dep) matched nothing.
// And `explicit` was computed but never used, so the loader param did nothing.
const mpSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main', 'marketplace.js'), 'utf8');
check('marketplace loaderGroups has a mod key', /\bmod:\s*\['loaders:forge'/.test(mpSrc));
check('marketplace uses explicit loader', /const loaderGroup = explicit \|\|/.test(mpSrc));
// --- STATIC_TOOLS drift guard (this class of bug shipped 3 times) ---
// bridge.js offline list must name the SAME tools as the live registry. Parse the source instead of
// require()-ing bridge.js (which attaches a stdin listener and would hang the test runner).
const bridgeSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'mcp', 'bridge.js'), 'utf8');
const staticNames = [...bridgeSrc.matchAll(/\['([a-z_]+)',\s*'/g)].map(m => m[1]);
const liveNames = TOOLS.map(t => t.name);
const missingOffline = liveNames.filter(n => !staticNames.includes(n));
const staleOffline = staticNames.filter(n => !liveNames.includes(n));
if (missingOffline.length) console.log('  missing from STATIC_TOOLS:', missingOffline.join(', '));
if (staleOffline.length) console.log('  stale in STATIC_TOOLS:', staleOffline.join(', '));
check('STATIC_TOOLS has no missing tools', missingOffline.length === 0);
check('STATIC_TOOLS has no stale tools', staleOffline.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
