// E2E smoke tests for the renderer. These launch the real Electron app (isolated user-data
// dir) and assert the UI boots and the main tabs render. Run with `npm run test:e2e`.
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, getRendererErrors, selectByValue } = require('./helpers');

// A fresh user-data dir means onboarding is not completed, so the welcome modal shows first.
// Wait briefly for it to appear, pick Advanced mode so all rail tabs are visible, then dismiss it.
async function dismissOnboarding(win) {
  const modal = win.locator('#onboardingModal');
  await modal.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await modal.isVisible().catch(() => false)) {
    // Onboarding defaults to Beginner and persists obMode on close; pick Advanced so every rail
    // tab (including performance, content, marketplace, worlds, worldmap) stays visible to test.
    const adv = win.locator('#obModeAdvanced');
    if (await adv.isVisible().catch(() => false)) await adv.click();
    await win.locator('#onboardingClose').click();
    await expect(modal).toBeHidden();
  }
}

let ctx, app, win, userDataDir;

test.beforeAll(async () => {
  ctx = await launchApp();
  ({ app, win, userDataDir } = ctx);
  await dismissOnboarding(win);
});

test.afterAll(async () => { await closeApp(app, userDataDir); });

test('boots with the Overview tab active and no renderer errors', async () => {
  await expect(win.locator('#pageTitle')).toHaveText(/Overview/i);
  await expect(win.locator('#overview')).toHaveClass(/active/);
  await expect(win.locator('body')).not.toHaveClass(/beginner-mode/);
  expect(getRendererErrors(ctx)).toEqual([]);
});

test('every main tab renders when clicked', async () => {
  const tabs = ['console', 'players', 'performance', 'content', 'marketplace', 'worlds', 'properties'];
  for (const tab of tabs) {
    await win.locator(`.nav-item[data-tab="${tab}"]`).click();
    await expect(win.locator(`#${tab}`)).toHaveClass(/active/);
  }
});

test('World Map and Settings tabs open', async () => {
  await win.locator('.nav-item[data-tab="worldmap"]').click();
  await expect(win.locator('#worldmap')).toHaveClass(/active/);
  await win.locator('.nav-item[data-tab="settings"]').click();
  await expect(win.locator('#settings')).toHaveClass(/active/);
});

test('language switch updates the UI strings after Apply', async () => {
  // v5.3.1: the language dropdown follows the edit->Apply flow (like motion level + beginner
  // mode). Picking a value only marks the form dirty; clicking Apply persists it and repaints.
  await win.locator('.nav-item[data-tab="settings"]').click();
  await selectByValue(win, '#languageSelect', 'vi');
  await win.locator('#saveSettings').click();
  await expect(win.locator('#pageTitle')).toHaveText(/Cài đặt/i);
  await selectByValue(win, '#languageSelect', 'en');
  await win.locator('#saveSettings').click();
  await expect(win.locator('#pageTitle')).toHaveText(/Settings/i);
});
