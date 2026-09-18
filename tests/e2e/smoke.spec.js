// E2E smoke tests for the renderer. These launch the real Electron app (isolated user-data
// dir) and assert the UI boots and the main tabs render. Run with `npm run test:e2e`.
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

// A fresh user-data dir means onboarding is not completed, so the welcome modal shows first.
// Dismiss it so the tabs are reachable (the modal covers the app).
async function dismissOnboarding(win) {
  const modal = win.locator('#onboardingModal');
  if (await modal.isVisible().catch(() => false)) {
    await win.locator('#onboardingClose').click();
    await expect(modal).toBeHidden();
  }
}

let app, win, userDataDir;

test.beforeAll(async () => {
  ({ app, win, userDataDir } = await launchApp());
  await dismissOnboarding(win);
});

test.afterAll(async () => { await closeApp(app, userDataDir); });

test('boots with the Overview tab active and no renderer errors', async () => {
  await expect(win.locator('#pageTitle')).toHaveText(/Overview/i);
  await expect(win.locator('#overview')).toHaveClass(/active/);
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

test('language switch updates the UI strings', async () => {
  await win.locator('.nav-item[data-tab="settings"]').click();
  await win.locator('#languageSelect').selectOption('vi');
  await expect(win.locator('#pageTitle')).toHaveText(/Cài đặt/i);
  await win.locator('#languageSelect').selectOption('en');
});
