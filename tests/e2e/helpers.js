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
  return { app, win, userDataDir };
}

async function closeApp(app, userDataDir) {
  try { await app.close(); } catch {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

module.exports = { launchApp, closeApp };
