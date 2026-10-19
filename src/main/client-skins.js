// client-skins.js — read Steve/Alex textures from the user's own Minecraft client (v6.0.0 Track B).
//
// WHY: this repository never bundles Mojang assets (see DESIGN.md, plan Legal rules). The app is
// allowed to read the user's installed client at runtime though, so when a player has no Mojang
// skin (offline-mode server, transient fetch failure), we can still show a real Steve or Alex
// face instead of a flat placeholder.
//
// Sources tried in order, per platform:
//   Windows: %APPDATA%\.minecraft
//   macOS:   ~/Library/Application Support/minecraft
//   Linux:   ~/.minecraft (XDG_DATA_HOME/minecraft as fallback)
// We look for any jar that contains the wide and slim player textures, newest version first.
// No write, no cache on disk: the caller caches the data URI in memory for the session.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { openJar } = require('./jar-reader.js');

const WIDE = 'assets/minecraft/textures/entity/player/wide/steve.png';
const SLIM = 'assets/minecraft/textures/entity/player/slim/alex.png';
// Older client jars (pre-1.20) kept the textures at a single shared path with no model split.
const LEGACY_WIDE = 'assets/minecraft/textures/entity/steve.png';
const LEGACY_SLIM = 'assets/minecraft/textures/entity/alex.png';

// PURE: candidate minecraft roots per platform, most likely first. Returns an array of paths.
function candidateRoots() {
  const home = os.homedir();
  const roots = [];
  if (process.platform === 'win32') {
    if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, '.minecraft'));
    roots.push(path.join(home, 'AppData', 'Roaming', '.minecraft'));
  } else if (process.platform === 'darwin') {
    roots.push(path.join(home, 'Library', 'Application Support', 'minecraft'));
  } else {
    if (process.env.XDG_DATA_HOME) roots.push(path.join(process.env.XDG_DATA_HOME, 'minecraft'));
    roots.push(path.join(home, '.minecraft'));
  }
  return roots;
}

// PURE: list jar candidates under a versions folder, newest-looking first. Full semver ordering
// is not needed; a numeric compare on the trimmed version segments is enough and cheap.
function versionJars(versionsDir) {
  let names;
  try { names = fs.readdirSync(versionsDir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const d of names) {
    if (!d.isDirectory()) continue;
    const jar = path.join(versionsDir, d.name, `${d.name}.jar`);
    try { if (fs.statSync(jar).isFile()) out.push({ version: d.name, jar }); } catch { /* skip */ }
  }
  // Sort by numeric segments, newest first; non-numeric tags (snapshots) end up at the bottom.
  out.sort((a, b) => {
    const pa = a.version.split(/[.-]/).map(x => parseInt(x, 10) || 0);
    const pb = b.version.split(/[.-]/).map(x => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const va = pa[i] || 0, vb = pb[i] || 0;
      if (va !== vb) return vb - va;
    }
    return 0;
  });
  return out;
}

// Try one jar. Returns { wide?, slim? } as Buffers, or null when the jar has neither texture.
function texturesFromJar(jarPath) {
  let jar;
  try { jar = openJar(jarPath); } catch { return null; }
  const out = {};
  const tryRead = (name, key) => {
    try { out[key] = jar.read(name); } catch { /* missing */ }
  };
  tryRead(WIDE, 'wide');
  tryRead(SLIM, 'slim');
  if (!out.wide) tryRead(LEGACY_WIDE, 'wide');
  if (!out.slim) tryRead(LEGACY_SLIM, 'slim');
  return (out.wide || out.slim) ? out : null;
}

// Main entry: find and read the player textures from the first client jar that has them.
// Returns { wide: 'data:image/png;base64,...', slim: '...' } (each optional), or null when the
// user has no Minecraft client jar on this machine.
function loadDefaultPlayerTextures() {
  for (const root of candidateRoots()) {
    const versionsDir = path.join(root, 'versions');
    for (const { jar } of versionJars(versionsDir)) {
      const tex = texturesFromJar(jar);
      if (tex) {
        const out = {};
        if (tex.wide) out.wide = 'data:image/png;base64,' + tex.wide.toString('base64');
        if (tex.slim) out.slim = 'data:image/png;base64,' + tex.slim.toString('base64');
        return out;
      }
    }
  }
  return null;
}

module.exports = { candidateRoots, versionJars, texturesFromJar, loadDefaultPlayerTextures };
