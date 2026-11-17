// E2E spec verifying Fabric 1.20.1 Content issue scanning, Marketplace server-target sync, and Install Modal build sorting/filtering.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, closeApp, getRendererErrors, gotoTab } = require('./helpers');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function buildZipBuffer(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

function makeFabric1201Fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-e2e-fab1201-'));
  fs.writeFileSync(path.join(root, 'eula.txt'), 'eula=true\n');
  fs.writeFileSync(path.join(root, 'server.properties'), 'motd=Fabric 1.20.1 Server\nserver-port=25565\n');
  fs.writeFileSync(path.join(root, 'fabric-server-mc.1.20.1-loader.0.16.10.jar'), 'stub');
  fs.mkdirSync(path.join(root, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(root, 'world'), { recursive: true });

  const nestedLib = buildZipBuffer([
    ['fabric.mod.json', JSON.stringify({ id: 'embedded_lib', version: '1.0.0', environment: '*' })],
  ]);
  fs.writeFileSync(path.join(root, 'mods', 'good-mod-1.20.x.jar'), buildZipBuffer([
    ['fabric.mod.json', JSON.stringify({
      id: 'goodmod',
      name: 'Good Mod',
      version: '1.2.0',
      environment: '*',
      jars: [{ file: 'META-INF/jars/embedded_lib.jar' }],
      depends: { minecraft: '1.20.x', embedded_lib: '*' },
    })],
    ['META-INF/jars/embedded_lib.jar', nestedLib],
  ]));
  fs.writeFileSync(path.join(root, 'mods', 'wrong-mc-mod.jar'), buildZipBuffer([
    ['fabric.mod.json', JSON.stringify({
      id: 'wrongmcmod',
      name: 'Future Mod',
      version: '2.0.0',
      environment: '*',
      depends: { minecraft: '1.21.4' },
    })],
  ]));
  return root;
}

let ctx, app, win, userDataDir, fixtureRoot;

test.beforeAll(async () => {
  ctx = await launchApp();
  ({ app, win, userDataDir } = ctx);
  const modal = win.locator('#onboardingModal');
  await modal.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await modal.isVisible().catch(() => false)) {
    const adv = win.locator('#obModeAdvanced');
    if (await adv.isVisible().catch(() => false)) await adv.click();
    await win.locator('#obSkip').click();
    await expect(modal).toBeHidden();
    await win.waitForTimeout(300);
  }
  fixtureRoot = makeFabric1201Fixture();
  await win.evaluate(p => window.observer.saveSettings({ serverPath: p }), fixtureRoot);
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.addStyleTag({ content: '@media(max-width:1100px){.app-shell{grid-template-columns:260px 1fr}.rail{display:flex}}' });
  await win.locator('#overview').waitFor({ state: 'visible' });
});

test.afterAll(async () => {
  try { if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch {}
  await closeApp(app, userDataDir);
});

test('Content tab detects genuine mc-incompatible on Fabric 1.20.1 without JiJ/wildcard false positives', async () => {
  getRendererErrors(ctx, { clear: true });
  await gotoTab(win, 'content');
  await expect(win.locator('#contentSeg .seg[data-ckind="mod"]')).toHaveClass(/active/);

  const banner = win.locator('#contentConflictsBanner');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(win.locator('#ccbTitle')).toContainText('1 issue(s) detected');

  await win.locator('#ccbToggle').click();
  await expect(win.locator('#ccbList')).toContainText('Wrong MC');
  await expect(win.locator('#ccbList')).toContainText('wrong-mc-mod.jar');
  await expect(win.locator('#ccbList')).not.toContainText('good-mod-1.20.x.jar');

  const wrongRow = win.locator('#modsList li[data-name="wrong-mc-mod.jar"]');
  await expect(wrongRow.locator('.cr-badge.issue')).toContainText('Wrong MC');
  expect(getRendererErrors(ctx)).toEqual([]);
});

test('Marketplace auto-locks to Fabric 1.20.1, updates quick chips, disables Hangar/Spigot for mods, and prioritizes 1.20.1 builds in Install Modal', async () => {
  getRendererErrors(ctx, { clear: true });

  await gotoTab(win, 'marketplace');
  await expect(win.locator('#marketServerTarget')).toContainText('fabric · 1.20.1');
  await expect(win.locator('#marketKindSeg .seg[data-mkind="mod"]')).toHaveClass(/active/);
  await expect(win.locator('#marketVersion')).toHaveValue('1.20.1');
  await expect(win.locator('#marketLoader')).toHaveValue('fabric');
  await expect(win.locator('#marketQuickChips')).toContainText('Fabric API');
  await expect(win.locator('#marketSourceSeg .seg[data-source="hangar"]')).toBeDisabled();
  await expect(win.locator('#marketSourceSeg .seg[data-source="spigot"]')).toBeDisabled();

  // Exercise deterministic multi-version sorting & filter controls inside #installModal
  await win.evaluate(() => {
    const item = {
      source: 'modrinth',
      id: 'sodium',
      slug: 'sodium',
      title: 'Sodium',
      author: 'jellysquid3',
      description: 'Modern rendering engine for Fabric.',
      downloads: 10000000,
      kind: 'fabric',
      loaders: ['fabric', 'quilt'],
      gameVersions: ['1.20', '1.20.1', '1.21.4'],
      env: { client: 'required', server: 'optional', normalized: 'both' },
    };
    renderMarket([item]);
    const srv = imDetectServer();
    item.software = srv.software;
    item.loader = srv.loader;
    item.targetLoader = srv.loader;
    installState = { item, detail: null, versionId: null, busy: false, done: false, targetLoader: 'fabric', buildMode: 'compat', stableOnly: false, buildQuery: '' };
    const m = document.getElementById('installModal');
    m.hidden = false;
    document.getElementById('imTitle').textContent = item.title;
    installState.detail = {
      ok: true,
      title: 'Sodium',
      author: 'jellysquid3',
      description: 'Modern rendering engine for Fabric.',
      loaders: ['fabric', 'quilt'],
      env: { client: 'required', server: 'optional', normalized: 'both' },
      versions: [
        { id: 'v-1214', number: '0.6.5+mc1.21.4', date: '2026-01-10T00:00:00Z', gameVersions: ['1.21.4'], loaders: ['fabric'], size: 950000, versionType: 'release', dependencies: [] },
        { id: 'v-1201-beta', number: '0.5.9-beta', date: '2025-12-01T00:00:00Z', gameVersions: ['1.20.1'], loaders: ['fabric'], size: 840000, versionType: 'beta', dependencies: [] },
        { id: 'v-1201-rel', number: '0.5.8+mc1.20.1', date: '2025-11-01T00:00:00Z', gameVersions: ['1.20.1'], loaders: ['fabric'], size: 830000, versionType: 'release', dependencies: [] },
      ],
    };
    imRenderVersionPicker();
    imRefreshModalState();
    document.getElementById('imInstall').disabled = false;
  });

  await expect(win.locator('#installModal')).toBeVisible();
  await expect(win.locator('#imVersionCards .im-vcard').first()).toContainText('0.5.8+mc1.20.1');
  await expect(win.locator('#imVersionCards .im-vcard').first()).toHaveClass(/selected/);
  await expect(win.locator('#imModeCompatBtn')).toContainText('Compatible (2)');
  await expect(win.locator('#imModeAllBtn')).toContainText('All builds (3)');

  await win.locator('#imStableToggle').click();
  await expect(win.locator('#imVersionCards .im-vcard')).toHaveCount(1);

  await win.locator('#imModeAllBtn').click();
  await expect(win.locator('#imVersionCards .im-vcard')).toHaveCount(2);

  await win.locator('#imClose').click();
  await expect(win.locator('#installModal')).toBeHidden();
  expect(getRendererErrors(ctx)).toEqual([]);
});
