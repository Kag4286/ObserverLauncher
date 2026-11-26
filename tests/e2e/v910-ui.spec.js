// E2E tests for ObserverLauncher v9.1.0 UI features:
//   - C1: Cross-Instance World Clone modal with registered instance target selector
//   - D1: Multi-rule scheduler controls (restart time, countdown selector, custom rule add/remove)
//   - D2: Interactive Server Doctor modal on Overview
//   - D3: Guided Minecraft Version Upgrade Assistant modal on Overview
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, getRendererErrors, gotoTab, makeFixtureServer, cleanupFixture } = require('./helpers');

let app, win, userDataDir, ctx, fixtureRoot, fixtureRoot2;

async function completeOnboarding() {
  const modal = win.locator('#onboardingModal');
  await modal.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await modal.isVisible().catch(() => false)) {
    const adv = win.locator('#obModeAdvanced');
    if (await adv.isVisible().catch(() => false)) await adv.click();
    await win.locator('#obSkip').click();
    await expect(modal).toBeHidden();
    await win.waitForTimeout(300);
  }
}

async function reloadApp() {
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.addStyleTag({ content: '@media(max-width:1100px){.app-shell{grid-template-columns:260px 1fr}.rail{display:flex}}' });
  await win.locator('#overview').waitFor({ state: 'visible' });
}

test.beforeAll(async () => {
  ctx = await launchApp();
  ({ app, win, userDataDir } = ctx);
  await completeOnboarding();

  fixtureRoot = makeFixtureServer();
  fixtureRoot2 = makeFixtureServer();
  // Ensure fixture 1 has a Paper jar so Upgrade Assistant sees a supported JVM engine.
  const jars = fs.readdirSync(fixtureRoot).filter(f => f.endsWith('.jar'));
  for (const j of jars) fs.unlinkSync(path.join(fixtureRoot, j));
  fs.writeFileSync(path.join(fixtureRoot, 'paper-1.20.4-496.jar'), 'stub');

  await win.evaluate(p => window.observer.saveSettings({ serverPath: p }), fixtureRoot);
  await win.evaluate(p => window.observer.instanceAdd({ serverPath: p, name: 'Second Server' }), fixtureRoot2);
  await reloadApp();
});

test.afterAll(async () => {
  if (fixtureRoot) cleanupFixture(fixtureRoot);
  if (fixtureRoot2) cleanupFixture(fixtureRoot2);
  await closeApp(app, userDataDir);
});

test('v9.1.0 D2: Server Doctor modal opens from Overview, scans cleanly, and closes', async () => {
  getRendererErrors(ctx, { clear: true });
  await gotoTab(win, 'overview');
  await expect(win.locator('#doctorOpenBtn')).toBeVisible();
  await win.locator('#doctorOpenBtn').click();
  await expect(win.locator('#doctorModal')).toBeVisible();
  await expect(win.locator('#docSummary')).not.toHaveText('');
  await win.locator('#docDoneBtn').click();
  await expect(win.locator('#doctorModal')).toBeHidden();
  expect(getRendererErrors(ctx)).toEqual([]);
});

test('v9.1.0 C1: Cross-Instance World Clone modal lists registered target instances', async () => {
  getRendererErrors(ctx, { clear: true });
  await gotoTab(win, 'worlds');
  const cloneBtn = win.locator('[data-clone-world]').first();
  await expect(cloneBtn).toBeVisible();
  await cloneBtn.click();
  await expect(win.locator('#worldCloneModal')).toBeVisible();
  const options = await win.locator('#wcTargetSelect option').allTextContents();
  expect(options.length).toBeGreaterThanOrEqual(2);
  expect(options.some(o => /Second Server/i.test(o))).toBe(true);
  await win.locator('#wcCancel').click();
  await expect(win.locator('#worldCloneModal')).toBeHidden();
  expect(getRendererErrors(ctx)).toEqual([]);
});

test('v9.1.0 D1: Multi-rule scheduler allows adding, saving, and removing custom daily rules', async () => {
  getRendererErrors(ctx, { clear: true });
  await gotoTab(win, 'settings');
  await win.locator('#settingsSeg .seg-switch-btn[data-set-view="automation"]').click();

  const schedToggle = win.locator('#scheduleEnabledInput');
  if (!(await schedToggle.isChecked())) {
    await win.locator('label.switch:has(#scheduleEnabledInput)').click();
  }
  await expect(win.locator('#scheduleFields')).toBeVisible();
  await expect(win.locator('#scheduleRestartInput')).toBeVisible();
  await expect(win.locator('#scheduleRulesBox')).toBeVisible();

  await win.locator('#scheduleRuleTime').fill('04:30');
  await win.locator('#scheduleRuleAddBtn').click();
  await expect(win.locator('#scheduleRulesList .sch-rule-row')).toHaveCount(1);

  await win.locator('#saveSettings').click();
  await win.waitForTimeout(250);

  await win.locator('#scheduleRulesList [data-del-rule="0"]').click();
  await expect(win.locator('#scheduleRulesList .sch-rule-row')).toHaveCount(0);
  expect(getRendererErrors(ctx)).toEqual([]);
});

test('v9.1.0 D3: Upgrade Assistant modal opens for Paper server and displays current setup', async () => {
  getRendererErrors(ctx, { clear: true });
  await gotoTab(win, 'overview');
  await expect(win.locator('#upgradeServerBtn')).toBeVisible();
  await win.locator('#upgradeServerBtn').click();
  await expect(win.locator('#upgradeModal')).toBeVisible();
  await expect(win.locator('#upgCurrentLabel')).toContainText(/paper/i);
  await win.locator('#upgCancelBtn').click();
  await expect(win.locator('#upgradeModal')).toBeHidden();
  expect(getRendererErrors(ctx)).toEqual([]);
});
