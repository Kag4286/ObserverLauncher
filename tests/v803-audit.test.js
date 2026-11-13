// v8.0.3 audit test suite: security hardening, archive safety, RCON buffer cap,
// WCAG 2.2 AA accessibility attributes, and Velocity UI localization.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const W = require('../src/main/webhook.js');
const ED = require('../src/main/editor.js');
const RCON = require('../src/main/rcon.js');
const WIZ = require('../src/main/wizard.js');

let passed = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  passed++;
}

(async () => {
  // --- 1. Webhook SSRF redirect guard ---
  {
    let seenOpts = null;
    const rLoop = await W.fire(
      { webhookUrl: 'https://discord.com/api/webhooks/1/a', webhookEvents: ['start'] },
      { type: 'start', instance: 'S' },
      {
        fetchFn: async (_u, opts) => {
          seenOpts = opts;
          return { status: 302, headers: { get: (h) => h.toLowerCase() === 'location' ? 'http://127.0.0.1:25565/steal' : null } };
        },
      }
    );
    ok('webhook uses manual redirect mode', seenOpts && seenOpts.redirect === 'manual');
    ok('webhook blocks redirect to loopback', rLoop.sent === false && rLoop.reason === 'unsafe redirect');

    const rMeta = await W.fire(
      { webhookUrl: 'https://discord.com/api/webhooks/1/a', webhookEvents: ['start'] },
      { type: 'start' },
      {
        fetchFn: async () => ({ status: 307, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
      }
    );
    ok('webhook blocks redirect to cloud metadata IP', rMeta.sent === false && rMeta.reason === 'unsafe redirect');

    let hops = 0;
    const rValid = await W.fire(
      { webhookUrl: 'https://hooks.example.com/v1', webhookEvents: ['start'] },
      { type: 'start' },
      {
        fetchFn: async (u) => {
          hops++;
          if (u === 'https://hooks.example.com/v1') {
            return { status: 308, headers: { get: () => 'https://hooks.example.com/v2' } };
          }
          return { status: 204 };
        },
      }
    );
    ok('webhook follows safe public HTTPS redirect', rValid.sent === true && rValid.status === 204 && hops === 2);

    const rTooMany = await W.fire(
      { webhookUrl: 'https://hooks.example.com/loop', webhookEvents: ['start'] },
      { type: 'start' },
      {
        fetchFn: async () => ({ status: 302, headers: { get: () => 'https://hooks.example.com/loop' } }),
      }
    );
    ok('webhook stops after MAX_REDIRECTS', rTooMany.sent === false && rTooMany.reason === 'too many redirects');
  }

  // --- 2. Editor SKIP_DIRS and dotfile isolation ---
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-v803-ed-'));
    try {
      fs.mkdirSync(path.join(root, 'libraries', 'com'), { recursive: true });
      fs.mkdirSync(path.join(root, 'observerlauncher-backups'), { recursive: true });
      fs.mkdirSync(path.join(root, '.git'), { recursive: true });
      fs.mkdirSync(path.join(root, 'config'), { recursive: true });
      fs.writeFileSync(path.join(root, 'libraries', 'com', 'guava.yml'), 'a: 1');
      fs.writeFileSync(path.join(root, 'observerlauncher-backups', 'manifest.json'), '{"keep":true}');
      fs.writeFileSync(path.join(root, '.git', 'config.yml'), 'secret: true');
      fs.writeFileSync(path.join(root, '.secret.yml'), 'token: abc');
      fs.writeFileSync(path.join(root, 'config', 'ok.yml'), 'ok: true');

      const e1 = ED.openFile(root, 'libraries/com/guava.yml');
      ok('editor openFile blocks libraries/', !e1.ok && e1.error === 'notAllowed');

      const e2 = ED.openFile(root, 'observerlauncher-backups/manifest.json');
      ok('editor openFile blocks observerlauncher-backups/', !e2.ok && e2.error === 'notAllowed');

      const e3 = ED.openFile(root, '.git/config.yml');
      ok('editor openFile blocks .git/', !e3.ok && e3.error === 'notAllowed');

      const e4 = ED.openFile(root, '.secret.yml');
      ok('editor openFile blocks dotfiles', !e4.ok && e4.error === 'notAllowed');

      const s1 = ED.saveFile(root, 'observerlauncher-backups/manifest.json', '{"hacked":true}', 0, true);
      ok('editor saveFile blocks observerlauncher-backups/', !s1.ok && s1.error === 'notAllowed');
      ok('backup manifest untouched after blocked save', fs.readFileSync(path.join(root, 'observerlauncher-backups', 'manifest.json'), 'utf8') === '{"keep":true}');

      const s2 = ED.saveFile(root, 'config/../.git/config.yml', 'x', 0, true);
      ok('editor saveFile blocks normalized path into .git/', !s2.ok && s2.error === 'notAllowed');

      const listed = ED.listFiles(root).files.map(f => f.path);
      ok('editor listFiles excludes dotfiles', !listed.includes('.secret.yml'));
      ok('editor listFiles still includes normal config', listed.includes('config/ok.yml'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  // --- 3. RCON buffer overflow guard ---
  {
    const client = new RCON.RconClient();
    let destroyed = false;
    let rejectedMsg = '';
    client.connected = true;
    client.socket = { destroy() { destroyed = true; } };
    const pending = client._await(1).catch(err => { rejectedMsg = err.message; });
    client._onData(Buffer.alloc(RCON.MAX_BUFFER + 1));
    await pending;
    ok('RCON buffer overflow clears buffer and closes socket', client._buf.length === 0 && !client.connected && destroyed);
    ok('RCON buffer overflow rejects pending requests', /overflow/i.test(rejectedMsg));
  }

  // --- 4. Horizon zip archive safety check ---
  {
    const tmpArchive = path.join(os.tmpdir(), `ob-v803-hz-${Date.now()}.zip`);
    fs.writeFileSync(tmpArchive, 'dummy');
    WIZ.assertSafeArchiveEntries(['horizon-1.0/horizon', 'horizon-1.0/README.md'], tmpArchive);
    ok('Horizon assertSafeArchiveEntries allows clean paths', fs.existsSync(tmpArchive));

    let threw = false;
    try {
      WIZ.assertSafeArchiveEntries(['horizon-1.0/horizon', '../../etc/passwd'], tmpArchive);
    } catch (e) {
      threw = /unsafe path/i.test(e.message);
    }
    ok('Horizon assertSafeArchiveEntries rejects traversal and removes archive', threw && !fs.existsSync(tmpArchive));

    let threwWin = false;
    try {
      WIZ.assertSafeArchiveEntries(['C:\\Windows\\evil.exe'], null);
    } catch (e) {
      threwWin = /unsafe path/i.test(e.message);
    }
    ok('Horizon assertSafeArchiveEntries rejects Windows drive paths', threwWin);
  }

  // --- 5. WCAG 2.2 AA Accessibility & Velocity UI checks ---
  {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
    const labeledIds = [
      'connectPublic', 'tunnelManual', 'jvmArgsInput', 'contentFilter', 'fbSearch',
      'marketQuery', 'wmWpNameInput', 'javaPathInput', 'autoBackupCustomInput',
      'remoteTokenInput', 'cfKeyInput', 'webhookUrlInput', 'prometheusPortInput',
      'nswVersionInput',
    ];
    for (const id of labeledIds) {
      const re = new RegExp(`<input[^>]*\\bid="${id}"[^>]*\\baria-label="[^"]+"`, 'i');
      ok(`index.html #${id} has aria-label`, re.test(indexHtml));
    }
    ok('onboardingModal has dialog ARIA', /<div id="onboardingModal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="onboardingModalTitle"/.test(indexHtml));
    ok('newServerModal has dialog ARIA', /<div id="newServerModal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="nswModalTitle"/.test(indexHtml));
    ok('proxyRawHead section exists before propertiesRaw', indexHtml.includes('id="proxyRawHead"'));

    const remoteHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'remote-ui', 'index.html'), 'utf8');
    ok('remote #langSel has aria-label', /id="langSel"[^>]*aria-label="[^"]+"/.test(remoteHtml));
    ok('remote #cmdInput has aria-label', /id="cmdInput"[^>]*aria-label="[^"]+"/.test(remoteHtml));
    ok('remote #tokenInput has aria-label', /id="tokenInput"[^>]*aria-label="[^"]+"/.test(remoteHtml));
    ok('remote #gate has dialog ARIA', /id="gate"[^>]*role="dialog"[^>]*aria-modal="true"/.test(remoteHtml));

    const remoteApp = fs.readFileSync(path.join(__dirname, '..', 'src', 'remote-ui', 'app.js'), 'utf8');
    ok('remote #instPicker sets aria-label', remoteApp.includes("setAttribute('aria-label'"));

    const overviewJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '07-overview.js'), 'utf8');
    ok('07-overview toggles proxyRawHead visibility', overviewJs.includes("$('#proxyRawHead')"));

    const localesDir = path.join(__dirname, '..', 'src', 'renderer', 'locales');
    const localeFiles = fs.readdirSync(localesDir).filter(f => f.endsWith('.js') && f !== 'meta.js');
    ok('7 locale files present', localeFiles.length === 7);
    for (const lf of localeFiles) {
      const txt = fs.readFileSync(path.join(localesDir, lf), 'utf8');
      ok(`${lf} defines prx.rawTitle and prx.rawSub`, txt.includes("'prx.rawTitle'") && txt.includes("'prx.rawSub'"));
    }
  }

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
