// Shared helpers for the Electron E2E suite.
//
// launchApp() boots the real app with an isolated, throwaway user-data dir so tests never
// touch the developer's own settings.json. It also attaches renderer-error capture: any
// uncaught pageerror or console.error is collected so a test can assert a clean renderer.
//
// OBSERVER_E2E=1 is set here; the app reads it (preload `observer.isE2E`, java.js, 08-shell.js)
// to skip network/toolchain work during boot so E2E stays deterministic and offline.
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

  // Renderer-error capture: uncaught exceptions + console.error accumulate here. Tests call
  // getRendererErrors() to assert nothing blew up during the flow they exercised.
  const errors = [];
  win.on('pageerror', err => errors.push(`pageerror: ${err && err.message ? err.message : String(err)}`));
  win.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });

  return { app, win, userDataDir, errors };
}

async function closeApp(app, userDataDir) {
  try { await app.close(); } catch {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

// Returns the renderer errors captured since launch. Pass {clear:true} to reset the buffer.
function getRendererErrors(ctx, opts = {}) {
  const list = ctx.errors ? ctx.errors.slice() : [];
  if (opts.clear && ctx.errors) ctx.errors.length = 0;
  return list;
}

// Click a left-rail nav item and wait until its tab panel is active.
async function gotoTab(win, tab) {
  await win.locator(`.nav-item[data-tab="${tab}"]`).click();
  await win.locator(`#${tab}`).waitFor({ state: 'visible' });
}

// Create a throwaway "server" folder with the files the Content / Editor / Properties /
// World Map tabs read, so those flows can be driven without a real Minecraft server or
// any network access. Returns the absolute path (also usable as settings.serverPath).
function makeFixtureServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-fixture-'));
  fs.writeFileSync(path.join(root, 'eula.txt'), 'eula=true\n');
  fs.writeFileSync(
    path.join(root, 'server.properties'),
    ['motd=E2E Fixture Server', 'server-port=25565', 'online-mode=false', 'max-players=20', ''].join('\n')
  );
  fs.mkdirSync(path.join(root, 'plugins'));
  // A plugin jar so the Content tab renders a real row (content lists filter *.jar).
  fs.writeFileSync(path.join(root, 'plugins', 'TestPlugin.jar'), 'not a real jar\n');
  // An allowlisted config file so the editor file-tree shows an expandable folder
  // (plugins/) plus an editable file inside it.
  fs.writeFileSync(path.join(root, 'plugins', 'config.yml'), 'enabled: true\n');
  fs.mkdirSync(path.join(root, 'mods'));
  fs.mkdirSync(path.join(root, 'logs'));
  fs.writeFileSync(path.join(root, 'logs', 'latest.log'), '[00:00:00] [Server thread/INFO]: Fixture log line\n');
  fs.mkdirSync(path.join(root, 'world'));
  fs.writeFileSync(path.join(root, 'world', 'level.dat'), '');
  return root;
}

function cleanupFixture(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}

module.exports = { launchApp, closeApp, getRendererErrors, gotoTab, makeFixtureServer, cleanupFixture };
