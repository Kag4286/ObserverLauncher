const Module = require('module');
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'electron') return { ipcMain: { handle: () => {} }, app: { getPath: () => '.' } };
  return origLoad.apply(this, arguments);
};

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getTool } = require('../src/mcp/tools.js');

let pass = 0, fail = 0;
const check = (name, cond) => cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));

(async () => {
  // Test 1: tReadFile returns result with content and masks passwords
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-mcp-rf-'));
  const propsPath = path.join(tmpDir, 'server.properties');
  fs.writeFileSync(propsPath, 'rcon.password=SuperSecret123\nmotd=A Minecraft Server\nserver-port=25565\n', 'utf8');

  const ctx = { currentServerPath: tmpDir };
  const rf = getTool('read_file');
  const res = await rf.handler(ctx, { path: 'server.properties' });

  check('read_file returned ok', res && res.ok === true);
  check('read_file has result', res && res.result && typeof res.result === 'object');
  check('read_file has content', typeof res?.result?.content === 'string');
  check('password was masked', res.result.content.includes('rcon.password=[redacted]') && !res.result.content.includes('SuperSecret123'));
  check('other props preserved', res.result.content.includes('server-port=25565'));

  // Test 2: Bridge payload unpack logic handles both { ok: true, result: ... } and flat { ok: true, ... }
  const unpack = (r) => r.ok ? (r.result !== undefined ? r.result : (() => { const { ok, ...rest } = r; return Object.keys(rest).length ? rest : { ok: true }; })()) : { ok: false, error: r.error || 'unknown' };
  
  const nested = unpack({ ok: true, result: { content: 'hello' } });
  check('nested result unpacked', nested.content === 'hello');

  const flat = unpack({ ok: true, content: 'world', size: 5 });
  check('flat result preserved content', flat.content === 'world' && flat.size === 5);

  const emptyOk = unpack({ ok: true });
  check('empty ok returns { ok: true }', emptyOk.ok === true && Object.keys(emptyOk).length === 1);

  // Test 3: list_prompts and get_prompt tools
  const lp = getTool('list_prompts');
  const lpRes = await lp.handler(ctx, {});
  check('list_prompts returns prompts', lpRes && lpRes.ok && Array.isArray(lpRes.result?.prompts) && lpRes.result.prompts.length === 9);

  const gp = getTool('get_prompt');
  const gpRes = await gp.handler(ctx, { name: 'diagnose_server' });
  check('get_prompt returns messages', gpRes && gpRes.ok && Array.isArray(gpRes.result?.messages) && gpRes.result.messages.length > 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

