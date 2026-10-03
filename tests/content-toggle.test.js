// CB6 (v3.3.0): enable/disable a content file by renaming <name> <-> <name>.disabled. Pure name
// logic + the real rename on disk, and serverFiles must still LIST disabled files (so they can be
// re-enabled, not lost).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { toggledName, contentFolder, toggleContent } = require('../src/main/content-ops.js');
const { serverFiles } = require('../src/main/server-files.js');
const { getTool, TOOLS } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// pure name logic
ck('disable jar -> .disabled', toggledName('X.jar', 'disable') === 'X.jar.disabled');
ck('enable .disabled -> jar', toggledName('X.jar.disabled', 'enable') === 'X.jar');
ck('toggle plain -> disabled', toggledName('X.jar', 'toggle') === 'X.jar.disabled');
ck('toggle disabled -> plain', toggledName('X.jar.disabled', 'toggle') === 'X.jar');
ck('disable already disabled -> null', toggledName('X.jar.disabled', 'disable') === null);
ck('enable not-disabled -> null', toggledName('X.jar', 'enable') === null);
ck('contentFolder plugin', contentFolder('plugin', 'world') === 'plugins');
ck('contentFolder mod', contentFolder('mod', 'world') === 'mods');

// real rename + listing
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-tog-'));
fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=world\n');
fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
fs.writeFileSync(path.join(root, 'plugins', 'LuckPerms.jar'), 'jar');
ck('enabled plugin listed', serverFiles(root).plugins.includes('LuckPerms.jar'));

let r = toggleContent(root, 'plugin', 'LuckPerms.jar', 'disable');
ck('disable ok', r.ok === true && r.to === 'LuckPerms.jar.disabled');
ck('file renamed on disk', fs.existsSync(path.join(root, 'plugins', 'LuckPerms.jar.disabled')));
ck('original gone', !fs.existsSync(path.join(root, 'plugins', 'LuckPerms.jar')));
ck('disabled plugin STILL listed', serverFiles(root).plugins.includes('LuckPerms.jar.disabled'));

r = toggleContent(root, 'plugin', 'LuckPerms.jar.disabled', 'enable');
ck('enable ok', r.ok === true && r.to === 'LuckPerms.jar');
ck('file restored', fs.existsSync(path.join(root, 'plugins', 'LuckPerms.jar')));

// refusals
ck('path escape refused', toggleContent(root, 'plugin', '../evil.jar', 'disable').ok === false);
ck('missing file refused', toggleContent(root, 'plugin', 'nope.jar', 'disable').ok === false);

// MCP tool wired + in registry
const tool = getTool('toggle_content');
ck('toggle_content tool exists', !!tool);
ck('toggle_content is write', tool && tool.risk === 'write');
ck('toggle_content handler present', tool && typeof tool.handler === 'function');

(async () => {
  const tr = await tool.handler({ currentServerPath: root }, { kind: 'plugin', name: 'LuckPerms.jar', action: 'disable' });
  ck('tool disable works', tr && tr.ok === true);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
