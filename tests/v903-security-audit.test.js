// v9.0.3 Security Audit & Hardening regression tests.
// Covers all 11 defensive findings fixed in v9.0.3 (SSRF/DNS-rebinding, modpack exec/secret
// sanitization, SkinsRestorer hardening, MCP jvmArgs/kick/write/search/auth/loopback guards,
// Electron navigation/permissions/files:open, tex:// validation, Linux polyglot archive lock,
// fail-closed ipIsLoopback, world-ops clone target check, renderer esc(src)).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isPrivateIp, isSafeDownloadUrl, assertPublicHost } = require('../src/main/validate.js');
const { isBlockedModpackFile, sanitizePropertiesForExport } = require('../src/main/modpacks.js');
const { MAX_SKIN_BYTES, fetchSafePngBuffer } = require('../src/main/skins.js');
const { readSkinFile } = require('../src/main/skinsrestorer.js');
const { ipIsLoopback } = require('../src/main/http-guard.js');
const { getTool, isSafeMcpJvmArgs } = require('../src/mcp/tools.js');
const { sendConsoleCommand } = require('../src/main/server-lifecycle.js');
const webhook = require('../src/main/webhook.js');

const VALID_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 0x42),
]);

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    await fn();
    passed++;
  };

  // 1. Modpack blocked executable files & server.properties sanitization
  await test('modpack blocks OS executables, scripts, and root-level JS', () => {
    for (const bad of [
      'run.bat', 'run.sh', 'start.cmd', 'config/hook.ps1', 'mods/drop.exe',
      'mods/native.dll', 'mods/lib.so', 'mods/a.dylib', 'evil.vbs', 'evil.hta',
      'evil.lnk', 'mods/fake.jar.exe', 'index.js', 'setup.mjs', 'hook.cjs',
    ]) {
      assert.strictEqual(isBlockedModpackFile(bad), true, `expected blocked: ${bad}`);
    }
    for (const ok of [
      'mods/sodium-fabric.jar', 'config/paper-global.yml', 'server.properties',
      'kubejs/server_scripts/recipes.js', 'kubejs/startup_scripts/init.js',
      'world/datapacks/custom.zip',
    ]) {
      assert.strictEqual(isBlockedModpackFile(ok), false, `expected allowed: ${ok}`);
    }
  });

  await test('sanitizePropertiesForExport strips RCON & secret keys while keeping safe settings', () => {
    const raw = [
      '#Minecraft server properties',
      'motd=Hello World',
      'server-port=25565',
      'enable-rcon=true',
      'rcon.port=25575',
      'rcon.password=SuperSecretRcon123!',
      'server-ip=192.168.1.44',
      'custom.api_key=abc123',
      'plugin_secret_token=xyz999',
      'gamemode=survival',
    ].join('\n');
    const clean = sanitizePropertiesForExport(raw);
    assert.ok(clean.includes('motd=Hello World'));
    assert.ok(clean.includes('server-port=25565'));
    assert.ok(clean.includes('gamemode=survival'));
    assert.ok(!clean.includes('SuperSecretRcon123'));
    assert.ok(!clean.includes('rcon.password'));
    assert.ok(!clean.includes('rcon.port'));
    assert.ok(!clean.includes('enable-rcon'));
    assert.ok(!clean.includes('server-ip'));
    assert.ok(!clean.includes('abc123'));
    assert.ok(!clean.includes('xyz999'));
  });

  // 2. SkinsRestorer traversal & shared fetchSafePngBuffer SSRF / size / PNG guards
  await test('SkinsRestorer readSkinFile rejects path traversal and accepts valid skin file', () => {
    const tmp = makeTempDir('ob-v903-sr-');
    try {
      const srDir = path.join(tmp, 'plugins', 'SkinsRestorer');
      fs.mkdirSync(path.join(srDir, 'skins'), { recursive: true });
      const payload = Buffer.from(JSON.stringify({
        textures: { SKIN: { url: 'https://textures.minecraft.net/texture/abc', metadata: { model: 'slim' } } },
      })).toString('base64');
      fs.writeFileSync(path.join(srDir, 'skins', 'valid-skin.playerskin'), JSON.stringify({ value: payload }));
      fs.writeFileSync(path.join(tmp, 'outside.playerskin'), JSON.stringify({ value: payload }));

      assert.strictEqual(readSkinFile(srDir, '../../outside'), null);
      assert.strictEqual(readSkinFile(srDir, '..\\..\\outside'), null);
      assert.strictEqual(readSkinFile(srDir, 'sub/valid-skin'), null);
      assert.strictEqual(readSkinFile(srDir, '..'), null);

      const good = readSkinFile(srDir, 'valid-skin');
      assert.ok(good && good.url === 'https://textures.minecraft.net/texture/abc' && good.model === 'slim');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('fetchSafePngBuffer enforces SSRF, DNS-rebinding, redirect, PNG magic, and 512KB cap', async () => {
    let calls = 0;
    const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const privateLookup = async () => [{ address: '127.0.0.1', family: 4 }];
    const okFetch = async () => {
      calls++;
      return { ok: true, status: 200, headers: new Map([['content-length', String(VALID_PNG.length)]]), arrayBuffer: async () => VALID_PNG };
    };

    // Private/loopback/file URLs blocked before fetch
    assert.strictEqual(await fetchSafePngBuffer('http://127.0.0.1/skin.png', { fetchFn: okFetch, lookupFn: publicLookup }), null);
    assert.strictEqual(await fetchSafePngBuffer('http://169.254.169.254/latest/meta-data', { fetchFn: okFetch, lookupFn: publicLookup }), null);
    assert.strictEqual(await fetchSafePngBuffer('file:///etc/passwd', { fetchFn: okFetch, lookupFn: publicLookup }), null);
    // DNS rebinding blocked before fetch
    assert.strictEqual(await fetchSafePngBuffer('https://rebind.example/skin.png', { fetchFn: okFetch, lookupFn: privateLookup }), null);
    assert.strictEqual(calls, 0, 'fetchFn must not be called for blocked/rebinding URLs');

    // Redirect to private IP blocked
    const redirectFetch = async (u) => {
      if (u.includes('cdn.example')) return { ok: false, status: 302, headers: new Map([['location', 'http://127.0.0.1/secret.png']]) };
      return okFetch();
    };
    assert.strictEqual(await fetchSafePngBuffer('https://cdn.example/skin.png', { fetchFn: redirectFetch, lookupFn: publicLookup }), null);

    // Non-PNG body rejected
    const htmlFetch = async () => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => Buffer.from('<html>not a png</html>') });
    assert.strictEqual(await fetchSafePngBuffer('https://cdn.example/skin.png', { fetchFn: htmlFetch, lookupFn: publicLookup }), null);

    // Oversized body (> MAX_SKIN_BYTES) rejected
    const bigPng = Buffer.concat([VALID_PNG, Buffer.alloc(MAX_SKIN_BYTES + 16, 0)]);
    const bigFetch = async () => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => bigPng });
    assert.strictEqual(await fetchSafePngBuffer('https://cdn.example/skin.png', { fetchFn: bigFetch, lookupFn: publicLookup }), null);

    // Valid PNG from public host succeeds
    const res = await fetchSafePngBuffer('https://textures.minecraft.net/texture/ok.png', { fetchFn: okFetch, lookupFn: publicLookup });
    assert.ok(Buffer.isBuffer(res) && res.length === VALID_PNG.length);
  });

  // 3. IPv6 private ranges, ff-hostname false positive fix, DNS-rebinding assertPublicHost & webhook
  await test('validate.js IPv6 ranges, ff-hostname public fix, and assertPublicHost DNS rebinding', async () => {
    assert.strictEqual(isSafeDownloadUrl('https://ff.example.com/mod.jar'), true, 'public hostname starting with ff must be allowed');
    assert.strictEqual(isPrivateIp('fec0::1'), true);
    assert.strictEqual(isPrivateIp('64:ff9b::127.0.0.1'), true);
    assert.strictEqual(isPrivateIp('64:ff9b:1::1'), true);
    assert.strictEqual(isPrivateIp('100::1'), true);
    assert.strictEqual(isPrivateIp('ff02::1'), true);
    assert.strictEqual(isPrivateIp('fe80::1%eth0'), true);
    assert.strictEqual(isSafeDownloadUrl('http://[fec0::1]/x'), false);
    assert.strictEqual(isSafeDownloadUrl('http://[64:ff9b::7f00:1]/x'), false);

    const reb = await assertPublicHost('https://127.0.0.1.nip.io/file.jar', {
      lookupFn: async () => [{ address: '127.0.0.1', family: 4 }],
    });
    assert.strictEqual(reb.ok, false);

    const meta = await assertPublicHost('https://meta.evil.example/x', {
      lookupFn: async () => [{ address: '169.254.169.254', family: 4 }],
    });
    assert.strictEqual(meta.ok, false);

    const pub = await assertPublicHost('https://cdn.modrinth.com/mod.jar', {
      lookupFn: async () => [{ address: '104.21.10.2', family: 4 }],
    });
    assert.strictEqual(pub.ok, true);
  });

  await test('webhook.fire blocks DNS rebinding to private IP via lookupFn', async () => {
    let called = false;
    const res = await webhook.fire(
      { webhookUrl: 'https://hooks.evil.example/cb', webhookEvents: ['start'] },
      { type: 'start', serverName: 'Test' },
      {
        fetchFn: async () => { called = true; return { ok: true, status: 204 }; },
        lookupFn: async () => [{ address: '10.0.0.8', family: 4 }],
      }
    );
    assert.strictEqual(res.sent, false);
    assert.strictEqual(called, false, 'webhook fetch must not fire when host resolves to private IP');
  });

  // 4. MCP jvmArgs hardening
  await test('MCP jvmArgs rejects dangerous RCE/agent/debugger/argfile flags and allows safe GC flags', () => {
    for (const bad of [
      '-XX:OnError=calc',
      '-XX:OnOutOfMemoryError=sh',
      '-javaagent:evil.jar',
      '-agentlib:jdwp=transport=dt_socket,server=y',
      '-agentpath:/tmp/evil.so',
      '-Xrunjdwp:transport=dt_socket',
      '-Xdebug',
      '@/tmp/jvm-args.txt',
      '-Xmx4G @extra.txt',
      '-Xmx4G\n-Xms2G',
      '-Xmx4G -Djava.security.manager=allow',
    ]) {
      assert.strictEqual(isSafeMcpJvmArgs(bad), false, `expected dangerous jvmArgs rejected: ${bad}`);
    }
    for (const good of [
      '',
      '-Xms2G -Xmx6G -XX:+UseG1GC -XX:MaxGCPauseMillis=200',
      '-XX:+AlwaysPreTouch -XX:+DisableExplicitGC -XX:G1NewSizePercent=30',
    ]) {
      assert.strictEqual(isSafeMcpJvmArgs(good), true, `expected safe jvmArgs allowed: ${good}`);
    }
  });

  // 5. MCP kick_player & sendConsoleCommand newline injection
  await test('kick_player and sendConsoleCommand reject embedded newlines', async () => {
    let wrote = false;
    const fakeCtx = {
      serverProcess: { stdin: { writable: true, write: () => { wrote = true; } } },
      appendLog: () => {},
    };
    const kickTool = getTool('kick_player');
    const r1 = await kickTool.handler(fakeCtx, { name: 'Steve', reason: 'rule break\nstop' });
    assert.strictEqual(r1.ok, false);
    assert.strictEqual(wrote, false);

    const r2 = await sendConsoleCommand(fakeCtx, 'say hello\r\nop EvilPlayer');
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(wrote, false);
  });

  // 6. MCP write_file/edit_file SKIP_DIRS guard + search_files object-path & secret masking
  await test('MCP write_file blocks SKIP_DIRS/dotfiles and search_files finds matches with secrets masked', async () => {
    const tmp = makeTempDir('ob-v903-mcp-');
    try {
      fs.writeFileSync(path.join(tmp, 'server.properties'), 'motd=MyServer\nrcon.password=TopSecretPass999\n');
      const ctx = { currentServerPath: tmp };

      const writeTool = getTool('write_file');
      for (const badPath of ['.git/config.txt', 'observerlauncher-backups/hack.json', '.hidden.txt', 'libraries/bad.json']) {
        const res = await writeTool.handler(ctx, { path: badPath, content: 'x' });
        assert.strictEqual(res.ok, false, `expected write_file to refuse ${badPath}`);
      }

      const searchTool = getTool('search_files');
      const sr = await searchTool.handler(ctx, { query: 'rcon.password' });
      assert.strictEqual(sr.ok, true);
      assert.ok(sr.result.hits.length >= 1, 'search_files must find hits when editor.listFiles returns { path, size, ext } objects');
      assert.ok(!JSON.stringify(sr.result.hits).includes('TopSecretPass999'), 'search_files must mask secrets in matched lines');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // 7. http-guard ipIsLoopback fail-closed
  await test('ipIsLoopback fails closed on missing/empty remoteAddress and allows loopback only', () => {
    assert.strictEqual(ipIsLoopback({ socket: {} }), false);
    assert.strictEqual(ipIsLoopback({ socket: { remoteAddress: '' } }), false);
    assert.strictEqual(ipIsLoopback({ socket: { remoteAddress: '192.168.1.10' } }), false);
    assert.strictEqual(ipIsLoopback({ socket: { remoteAddress: '127.0.0.1' } }), true);
    assert.strictEqual(ipIsLoopback({ socket: { remoteAddress: '::1' } }), true);
    assert.strictEqual(ipIsLoopback({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  });

  // 8. Source-level hardening invariants
  await test('source-level hardening invariants across Electron, MCP, Linux archive, textures, settings, UI', () => {
    const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

    const lifecycle = read('src/main/app-lifecycle.js');
    assert.ok(lifecycle.includes('setPermissionRequestHandler'), 'app-lifecycle must deny permission requests');
    assert.ok(lifecycle.includes('pathToFileURL') && lifecycle.includes('allowedAppUrl'), 'app-lifecycle must restrict will-navigate to exact renderer index.html');

    const contentHandlers = read('src/main/content-handlers.js');
    assert.ok(contentHandlers.includes('SAFE_OPEN_EXTS') && contentHandlers.includes('showItemInFolder'), 'files:open must restrict shell.openPath to safe non-executable extensions');

    const textures = read('src/main/textures.js');
    assert.ok(textures.includes('/^[0-9]+(?:\\.[0-9]+){1,2}$/'), 'textures.js must strictly validate tex:// version hostname');

    const linux = read('src/main/platform/linux.js');
    assert.ok(linux.includes('listArchiveEntriesWithFormat') && linux.includes("listed.format === 'zip'"), 'linux.js must lock extraction format to the verified listing tool');

    const mcpServer = read('src/mcp/server.js');
    assert.ok(mcpServer.includes('ipIsLoopback(req)'), 'mcp/server.js must enforce loopback peer check');
    assert.ok(mcpServer.includes('authLimiter'), 'mcp/server.js must enforce auth brute-force lockout');
    assert.ok(mcpServer.includes('server.requestTimeout = 15000'), 'mcp/server.js must set requestTimeout');
    assert.ok(mcpServer.includes('resolveInstanceId'), 'mcp/server.js /resource must validate instance id');

    const srvLife = read('src/main/server-lifecycle.js');
    assert.ok(srvLife.includes('/^run\\.(bat|sh)$/i'), 'server-lifecycle.js must verify launchScript basename');

    const playersUi = read('src/renderer/js/03-players.js');
    assert.ok(playersUi.includes('<img src="${esc(src)}"'), '03-players.js must escape img src attribute');

    const worldOps = read('src/main/world-ops.js');
    assert.ok(worldOps.includes('rawList.instances'), 'world-ops.js must unwrap listInstances().instances');

    const settingsSrc = read('src/main/settings.js');
    assert.ok(settingsSrc.includes('{ mode: 0o600 }'), 'settings.js must write settings with 0o600 permissions');
  });

  console.log(`v903-security-audit.test.js: all ${passed} checks passed`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
