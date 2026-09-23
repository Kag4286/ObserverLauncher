// M12 (MCP fix): saveSettingsFor writes the flat per-instance view into a SPECIFIC instance, not
// the active one - the bug that made set_setting/get_settings with an `instance` arg hit the wrong
// server. Global keys must stay top-level; other instances must be untouched.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = path.join(os.tmpdir(), 'ob-mcp-instset-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.apply(this, arguments);
};

const S = require('../src/main/settings.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

try {
  const a = S.addInstance({ serverPath: '/srv/A', name: 'Alpha' });
  const b = S.addInstance({ serverPath: '/srv/B', name: 'Beta' });
  S.switchInstance(a.id); // A active

  // Write memoryMax onto B while A is active.
  const flatB = S.loadSettingsFor(b.id);
  flatB.memoryMax = 12;
  S.saveSettingsFor(b.id, flatB);

  ok('B got the new value', S.loadSettingsFor(b.id).memoryMax === 12);
  ok('A unchanged', S.loadSettingsFor(a.id).memoryMax !== 12);
  ok('active still A', S.getActiveInstanceId() === a.id);

  // Both instances survive (write did not drop the array).
  ok('still 2 instances', S.loadSettingsStore().instances.length === 2);

  // Global keys land top-level, not inside an instance.
  const raw = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  ok('global locale at top level', typeof raw.locale === 'string');
  ok('no per-instance key leaked to top', raw.serverPath === undefined && raw.memoryMax === undefined);

  // Unknown id -> falls back to active (never throws).
  const flatA = S.loadSettingsFor(a.id);
  flatA.memoryMin = 3;
  S.saveSettingsFor('does-not-exist', flatA);
  ok('unknown id fell back to active A', S.loadSettingsFor(a.id).memoryMin === 3);
} finally {
  fs.rmSync(userData, { recursive: true, force: true });
}
console.log(`\n${passed} passed, 0 failed`);
