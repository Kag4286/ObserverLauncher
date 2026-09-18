// Shared helper: launch the real Electron app with an isolated, throwaway user-data dir so
// E2E tests never read or write the developer's own settings.json.
const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function launchApp() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-e2e-'));
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, OBSERVER_E2E: '1' },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // CI runner screens can be small (GitHub Actions defaults to 1024x768), which trips the
  // renderer's 1100px responsive breakpoint -> .rail{display:none}, so the left nav is not
  // visible and click() times out. Neutralise that breakpoint for the test (test-only CSS
  // injection; app behaviour is untouched) so the smoke tests exercise the desktop layout
  // regardless of the runner's screen. Done via the page, NOT app.evaluate — Playwright's
  // Electron app.evaluate throws "promise was garbage collected" on headless Linux.
  await win.addStyleTag({ content: '@media(max-width:1100px){.app-shell{grid-template-columns:260px 1fr}.rail{display:flex}}' });
  return { app, win, userDataDir };
}

async function closeApp(app, userDataDir) {
  try { await app.close(); } catch {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

module.exports = { launchApp, closeApp };
