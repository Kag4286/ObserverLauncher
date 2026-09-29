// data-dir.js — the ONE place that resolves the launcher's writable data folder.
//
// WHY (v3.0.0 Phase B1): every module used `app.getPath('userData')` directly, which welded the
// backend to Electron — `require('electron')` returns a STRING in plain Node (the binary path),
// not an object with `app`, so those modules threw at require-time and could never run headless.
// Routing every data path through dataDir() lets the same backend run under Electron AND under a
// plain `node src/headless.js` process (Phase B3).
//
// Resolution order:
//   1. OBSERVER_DATA_DIR env   — explicit override (headless/CLI/Docker; also used by tests).
//   2. Electron app.getPath('userData') — normal GUI launch. Required LAZILY and guarded: in a
//      plain Node process there is no real app object, so we fall through instead of throwing.
//   3. Per-platform default    — sensible location when neither of the above exists.
const os = require('os');
const path = require('path');
const fs = require('fs');

function platformDefaultDir() {
  const name = 'ObserverLauncher';
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', name);
  }
  // Linux/other: XDG_CONFIG_HOME (or ~/.config). Matches Electron's userData on Linux.
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name);
}

// P4 (v3.1.0): make sure the resolved data folder actually EXISTS. A non-existent OBSERVER_DATA_DIR
// (typo, an unmounted volume, a Docker bind that was not created) would otherwise fail later at the
// first write with a confusing ENOENT. Memoized per path so the hot path (dataDir() is called on
// every settings/runtime read+write) never pays an fs call more than once per resolved directory.
const ensured = new Set();
function ensureDir(dir) {
  if (ensured.has(dir)) return;
  try { fs.mkdirSync(dir, { recursive: true }); ensured.add(dir); } catch { /* best-effort: leave it to the caller's error handling */ }
}

function dataDir() {
  // 1) Explicit override always wins (and stays live — OBSERVER_DATA_DIR may change between calls
  //    in tests, so we deliberately do NOT cache the result).
  const override = process.env.OBSERVER_DATA_DIR;
  if (override && String(override).trim()) { const dir = String(override).trim(); ensureDir(dir); return dir; }

  // 2) Electron userData when running under a real app object. Guarded because `require('electron')`
  //    yields a string (the binary path) in plain Node, and may be undefined under some mock setups.
  //    (Electron creates userData itself, so we do not mkdir here.)
  try {
    const electron = require('electron');
    const app = electron && electron.app;
    if (app && typeof app.getPath === 'function') {
      const ud = app.getPath('userData');
      if (ud) return ud;
    }
  } catch { /* no electron available -> fall through to the platform default */ }

  // 3) Per-platform default — ensure it exists too (a fresh headless/CLI run has no installer to
  //    create it).
  const def = platformDefaultDir();
  ensureDir(def);
  return def;
}

// The OS temp dir. Replaces `app.getPath('temp')` so staging/import paths work headless too.
function tempDir() {
  return os.tmpdir();
}

module.exports = { dataDir, tempDir, platformDefaultDir };
