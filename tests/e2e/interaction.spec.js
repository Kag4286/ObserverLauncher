// E2E interaction tests: drive real UI flows (not just tab rendering) and assert the
// renderer stays error-free. These cover classes of bug the unit tests cannot see:
// boot-order ReferenceErrors, JS-measured elements inside hidden tabs (0px), i18n text
// owned by JS being clobbered by applyLocale, and settings persistence.
//
// Run with `npm run test:e2e`. One shared app instance (workers:1) keeps the suite fast;
// tests reset any state they change.
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, getRendererErrors, gotoTab, makeFixtureServer, cleanupFixture } = require('./helpers');

let app, win, userDataDir, ctx, fixtureRoot;

// Mark onboarding done (persists onboarded=true) so it never reappears after a reload.
async function completeOnboarding() {
  const modal = win.locator('#onboardingModal');
  if (await modal.isVisible().catch(() => false)) {
    await win.locator('#obSkip').click();
    await expect(modal).toBeHidden();
    // markOnboarded() writes settings.json asynchronously; give it a beat before any reload.
    await win.waitForTimeout(300);
  }
}

async function reloadApp() {
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  // The responsive-breakpoint neutraliser from launchApp is lost on reload; re-inject it.
  await win.addStyleTag({ content: '@media(max-width:1100px){.app-shell{grid-template-columns:260px 1fr}.rail{display:flex}}' });
  await win.locator('#overview').waitFor({ state: 'visible' });
}

test.beforeAll(async () => {
  ctx = await launchApp();
  ({ app, win, userDataDir } = ctx);
  await completeOnboarding();

  // Seed a server folder so settings:save passes its "server folder required" guard. The
  // motion-persistence test would otherwise be silently rejected (no write, no .motion-lite).
  // Seed via the IPC directly, then reload so refreshUI() fills #serverFolderInput from the
  // persisted settings (getSettings() reads the DOM input, not state).
  fixtureRoot = makeFixtureServer();
  await win.evaluate(p => window.observer.saveSettings({ serverPath: p }), fixtureRoot);
  await reloadApp();
});

test.afterAll(async () => {
  if (fixtureRoot) cleanupFixture(fixtureRoot);
  await closeApp(app, userDataDir);
});

test('renderer stays error-free across all tabs and a modal open/close', async () => {
  getRendererErrors(ctx, { clear: true });
  const tabs = ['console', 'players', 'performance', 'content', 'marketplace', 'worlds', 'properties', 'worldmap', 'settings', 'overview'];
  for (const tab of tabs) await gotoTab(win, tab);

  // Open the confirm modal directly (no in-app button path exists without a live server),
  // then close it via its Cancel button — exercises the [hidden] fade wiring + cfCancel.
  await win.evaluate(() => { document.getElementById('confirmModal').hidden = false; });
  await expect(win.locator('#confirmModal')).toBeVisible();
  await win.locator('#cfCancel').click();
  await expect(win.locator('#confirmModal')).toBeHidden();

  expect(getRendererErrors(ctx)).toEqual([]);
});

test('Settings Basic/Advanced switch toggles panes and sizes the glider', async () => {
  await gotoTab(win, 'settings');

  await win.locator('#settingsSeg .seg-switch-btn[data-set-view="advanced"]').click();
  await expect(win.locator('#settings .set-pane[data-set-pane="advanced"]')).toBeVisible();
  await expect(win.locator('#settings .set-pane[data-set-pane="basic"]')).toBeHidden();
  // Regression: the glider measured 0px while the Settings tab was hidden; it must be sized now.
  const advW = await win.locator('#settingsSeg .seg-switch-glider').evaluate(el => el.offsetWidth);
  expect(advW).toBeGreaterThan(0);

  await win.locator('#settingsSeg .seg-switch-btn[data-set-view="basic"]').click();
  await expect(win.locator('#settings .set-pane[data-set-pane="basic"]')).toBeVisible();
  await expect(win.locator('#settings .set-pane[data-set-pane="advanced"]')).toBeHidden();
});

test('language switch re-derives the JS-owned page title when changing tabs', async () => {
  await gotoTab(win, 'settings');
  await win.locator('#languageSelect').selectOption('vi');

  const titleSettings = await win.locator('#pageTitle').innerText();
  await gotoTab(win, 'console');
  const titleConsole = await win.locator('#pageTitle').innerText();

  // #pageTitle has no data-i18n — it is re-derived from the active nav item by applyLocale().
  // The bug this guards: it used to keep the old language / not follow tab changes.
  expect(titleSettings.trim()).not.toEqual('');
  expect(titleConsole.trim()).not.toEqual('');
  expect(titleConsole).not.toEqual(titleSettings);

  // #languageSelect only exists on the Settings tab, so switch back before resetting.
  await gotoTab(win, 'settings');
  await win.locator('#languageSelect').selectOption('en');
});

test('changing motion level to Lite persists across a renderer reload', async () => {
  await gotoTab(win, 'settings');
  await win.locator('#motionLevelSelect').selectOption('lite');
  await win.locator('#saveSettings').click();
  await win.waitForTimeout(400); // let settings:save write settings.json

  await reloadApp();
  await expect(win.locator('html')).toHaveClass(/motion-lite/);

  // Reset to the default (Full) so later tests see the stock UI.
  await gotoTab(win, 'settings');
  await win.locator('#motionLevelSelect').selectOption('full');
  await win.locator('#saveSettings').click();
  await win.waitForTimeout(400);
});

// --- Phase 2: real data flows against the fixture server folder ---

test('Content tab renders an installed plugin row from the server folder', async () => {
  await gotoTab(win, 'content');
  // Content lists filter *.jar, so the fixture's TestPlugin.jar must appear as a data row.
  const rows = win.locator('#pluginsList li[data-name]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('TestPlugin.jar');

  // Switching kind to Mods shows the (empty) mods list and hides the plugins list.
  await win.locator('#contentSeg .seg[data-ckind="mod"]').click();
  await expect(win.locator('#modsList')).toBeVisible();
  await expect(win.locator('#pluginsList')).toBeHidden();
  await win.locator('#contentSeg .seg[data-ckind="plugin"]').click();
});

test('file browser shows a folder tree, opens a file, and saves an edit', async () => {
  await gotoTab(win, 'content');
  await win.locator('#edBrowse').click();
  await expect(win.locator('#fileBrowser')).toBeVisible();

  // The tree groups files under their folder; plugins/ holds config.yml.
  await expect(win.locator('#fbList .fb-dir')).toHaveCount(1);
  await win.locator('#fbList .fb-dir').first().click();
  const fileRow = win.locator('#fbList .fb-row[data-rel="plugins/config.yml"]');
  await expect(fileRow).toBeVisible();
  await fileRow.click();

  await expect(win.locator('#fileEditor')).toBeVisible();
  await expect(win.locator('#edText')).toHaveValue(/enabled: true/);

  await win.locator('#edText').fill('enabled: false\n');
  await win.locator('#edSave').click();
  await win.waitForTimeout(300);

  // Verify through the app's own editor IPC (the fixture lives outside the bridge root).
  const check = await win.evaluate(() => window.observer.editorOpen('plugins/config.yml'));
  expect(check.ok).toBe(true);
  expect(check.content).toContain('enabled: false');
});

test('Properties tab edits server.properties and persists the change', async () => {
  await gotoTab(win, 'properties');

  // Filter to the motd row (also auto-opens its collapsed group) so it is actionable.
  await win.locator('#propertiesSearch').fill('motd');
  await win.waitForTimeout(150);
  const motd = win.locator('[data-property="motd"]');
  await expect(motd).toBeVisible();
  await motd.fill('E2E Edited');
  await win.locator('#saveProperties').click();
  await win.waitForTimeout(300);

  const check = await win.evaluate(() => window.observer.editorOpen('server.properties'));
  expect(check.ok).toBe(true);
  expect(check.content).toContain('motd=E2E Edited');
});

// --- 1.5.0: responsive breakpoint (the addStyleTag hack is bypassed on purpose here) ---
// launchApp injects a style tag that neutralises the 1100px breakpoint so nav clicks work on small
// CI screens. That leaves the REAL responsive layout untested. This test removes the injected hack,
// sets a small viewport and asserts the production breakpoint actually applies (.rail hides below
// 1100px, shows at/above it), then restores the desktop layout for the remaining tests.
test('responsive breakpoint hides the rail on narrow screens and shows it on wide', async () => {
  // Remove the injected breakpoint-neutraliser so the real CSS media query governs layout.
  await win.evaluate(() => {
    document.querySelectorAll('style').forEach(s => {
      if (s.textContent && s.textContent.includes('max-width:1100px') && s.textContent.includes('.rail')) s.remove();
    });
  });

  await win.setViewportSize({ width: 820, height: 720 });
  await win.waitForTimeout(150);
  const railHidden = await win.locator('.rail').evaluate(el => getComputedStyle(el).display === 'none');
  expect(railHidden).toBe(true);

  await win.setViewportSize({ width: 1280, height: 800 });
  await win.waitForTimeout(150);
  const railShown = await win.locator('.rail').evaluate(el => getComputedStyle(el).display !== 'none');
  expect(railShown).toBe(true);

  // Restore the neutraliser so later tests can still click rail nav items on any runner.
  await win.addStyleTag({ content: '@media(max-width:1100px){.app-shell{grid-template-columns:260px 1fr}.rail{display:flex}}' });
});
