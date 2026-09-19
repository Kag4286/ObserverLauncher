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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
