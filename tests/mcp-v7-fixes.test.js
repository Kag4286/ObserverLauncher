// Tests for v7.0.1 MCP fixes:
// 1. Delete content path traversal guard (rejects '../server.properties')
// 2. Secret masking on direct file reads (tReadFile, tReadManyFiles)
// 3. MCP privilege escalation defense (mcpAutoAllowWrite / mcpReadOnly not settable via MCP)
// 4. Modpack export system directory protection
// 5. Stale PID cleanup in bridge
// 6. Expanded prompt workflows and resource templates
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTool } = require('../src/mcp/tools.js');
const { getPrompt, PROMPTS } = require('../src/mcp/prompts.js');
const { resolveResource, STATIC_RESOURCES, RESOURCE_TEMPLATES } = require('../src/mcp/resources.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-mcp-v7-'));
  const ctx = {
    currentServerPath: tmp,
    inst: () => 'default',
    runInInstance: (id, fn) => fn(),
  };

  // Setup mock server files
  fs.mkdirSync(path.join(tmp, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'server.properties'), 'rcon.password=SuperSecretPass123\nserver-port=25565\nmotd=Test Server\n');
  fs.writeFileSync(path.join(tmp, 'velocity.toml'), 'bind = "0.0.0.0:25577"\nforwarding-secret = "SecretForwardToken456"\n');
  fs.writeFileSync(path.join(tmp, 'plugins', 'MyPlugin.jar'), 'dummy-plugin');

  // --- 1. tDeleteContent path traversal ---
  const delTool = getTool('delete_content');
  const evilDel1 = await delTool.handler(ctx, { kind: 'plugin', name: '../server.properties' });
  check('delete_content rejects ../ traversal', evilDel1.ok === false && evilDel1.error === 'Invalid file name.');
  check('server.properties still exists', fs.existsSync(path.join(tmp, 'server.properties')));

  const evilDel2 = await delTool.handler(ctx, { kind: 'mod', name: '..\\server.properties' });
  check('delete_content rejects ..\\ traversal', evilDel2.ok === false && evilDel2.error === 'Invalid file name.');

  // Legitimate delete works
  const goodDel = await delTool.handler(ctx, { kind: 'plugin', name: 'MyPlugin.jar' });
  check('delete_content accepts safe file name', goodDel.ok === true && goodDel.result.deleted === 'MyPlugin.jar');
  check('MyPlugin.jar is deleted', !fs.existsSync(path.join(tmp, 'plugins', 'MyPlugin.jar')));

  // --- 2. Secret masking on direct file reads ---
  const readTool = getTool('read_file');
  const readProps = await readTool.handler(ctx, { path: 'server.properties' });
  check('read_file server.properties succeeds', readProps.ok === true);
  check('read_file masks rcon.password', readProps.content.includes('[redacted]'));
  check('read_file does NOT leak SuperSecretPass123', !readProps.content.includes('SuperSecretPass123'));
  check('read_file preserves server-port', readProps.content.includes('server-port=25565'));

  const readToml = await readTool.handler(ctx, { path: 'velocity.toml' });
  check('read_file velocity.toml succeeds', readToml.ok === true);
  check('read_file masks forwarding-secret', readToml.content.includes('[redacted]'));
  check('read_file does NOT leak SecretForwardToken456', !readToml.content.includes('SecretForwardToken456'));

  // Multi-file read
  const readManyTool = getTool('read_many_files');
  const readMany = await readManyTool.handler(ctx, { paths: ['server.properties', 'velocity.toml'] });
  check('read_many_files succeeds', readMany.ok === true);
  const f1 = readMany.result.files.find(f => f.path === 'server.properties');
  const f2 = readMany.result.files.find(f => f.path === 'velocity.toml');
  check('read_many_files masks server.properties secrets', f1 && f1.content.includes('[redacted]') && !f1.content.includes('SuperSecretPass123'));
  check('read_many_files masks velocity.toml secrets', f2 && f2.content.includes('[redacted]') && !f2.content.includes('SecretForwardToken456'));

  // --- 3. Privilege escalation defense in set_setting ---
  const setTool = getTool('set_setting');
  const autoAllowAttempt = await setTool.handler(ctx, { key: 'mcpAutoAllowWrite', value: true });
  check('set_setting refuses mcpAutoAllowWrite', autoAllowAttempt.ok === false && /not settable over MCP/i.test(autoAllowAttempt.error));

  const readOnlyAttempt = await setTool.handler(ctx, { key: 'mcpReadOnly', value: false });
  check('set_setting refuses mcpReadOnly', readOnlyAttempt.ok === false && /not settable over MCP/i.test(readOnlyAttempt.error));

  // --- 4. Export modpack system directory defense ---
  const expTool = getTool('export_modpack');
  if (process.platform === 'win32') {
    const sysExp = await expTool.handler(ctx, { path: 'C:\\Windows\\System32\\evil.mrpack' });
    check('export_modpack blocks C:\\Windows destination', sysExp.ok === false && /Cannot export to a system directory/i.test(sysExp.error));
  } else {
    const sysExp = await expTool.handler(ctx, { path: '/etc/evil.mrpack' });
    check('export_modpack blocks /etc destination', sysExp.ok === false && /Cannot export to a system directory/i.test(sysExp.error));
  }

  // --- 5. New Prompts ---
  const pRecover = getPrompt('recover_corrupted_world');
  check('recover_corrupted_world prompt registered', !!pRecover);
  const mRecover = pRecover.build({});
  check('recover_corrupted_world builds messages', Array.isArray(mRecover) && mRecover[0].content.text.includes('corrupted'));

  const pUpgrade = getPrompt('update_minecraft_version');
  check('update_minecraft_version prompt registered', !!pUpgrade);
  const mUpgrade = pUpgrade.build({ target_version: '1.21.4' });
  check('update_minecraft_version interpolates target_version', Array.isArray(mUpgrade) && mUpgrade[0].content.text.includes('1.21.4'));

  const pGeyser = getPrompt('setup_geyser_bedrock');
  check('setup_geyser_bedrock prompt registered', !!pGeyser);
  const mGeyser = pGeyser.build({});
  check('setup_geyser_bedrock builds messages', Array.isArray(mGeyser) && mGeyser[0].content.text.includes('Bedrock'));

  // --- 6. New Resource Templates & Statics ---
  const rCrash = resolveResource('observer://crash-reports/latest');
  check('resolve observer://crash-reports/latest', rCrash && rCrash.tool === 'read_crash_report');

  const rInstProps = resolveResource('observer://instance/inst-42/properties');
  check('resolve observer://instance/{id}/properties', rInstProps && rInstProps.tool === 'get_properties' && rInstProps.args.instance === 'inst-42');

  const rInstPlayers = resolveResource('observer://instance/inst-42/players');
  check('resolve observer://instance/{id}/players', rInstPlayers && rInstPlayers.tool === 'list_players' && rInstPlayers.args.instance === 'inst-42');

  // Clean up
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('FAIL unexpected error:', e);
  process.exit(1);
});
