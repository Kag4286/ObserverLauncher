// 2.2.0 (Java gap): figure out which Java a server needs when there is no runnable .jar to
// read a version from — the common NeoForge/Forge case where the server is launched via run.bat
// and the only version clue lives under libraries/. requiredJavaForJar() is name-based and returns
// null for those, so the launcher used to default to Java 21 (wrong for old Forge like 1.16.5).
//
// Pure-ish: only reads the folder's libraries/ tree; the version->Java mapping is delegated to
// requiredJavaForJar (java.js) and the maven-tag->MC mapping to mcFor (forge-versions.js), so the
// logic itself is unit-testable without Electron or network.
const fs = require('fs');
const path = require('path');
const { requiredJavaForJar } = require('./java.js');
const { mcFor } = require('./forge-versions.js');

// List immediate subdirectory names of base, newest-last (best-effort numeric-ish sort).
function versionDirs(base) {
  let dirs = [];
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  // Sort so the highest version wins if several were installed over time (e.g. 21.1.251 vs 21.1.9).
  return dirs.sort((a, b) => {
    const na = a.split(/[.\-]/).map(Number), nb = b.split(/[.\-]/).map(Number);
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      const x = na[i] || 0, y = nb[i] || 0;
      if (x !== y) return x - y;
    }
    return a.localeCompare(b);
  });
}

// Derive the Minecraft version a jar-less Forge/NeoForge server targets, by reading the version
// folder under libraries/:
//   NeoForge: libraries/net/neoforged/neoforge/<ver>       (e.g. 21.1.251 -> 1.21.1)
//   Forge:    libraries/net/minecraftforge/forge/<mc>-<f>  (e.g. 1.16.5-36.2.34 -> 1.16.5)
// Returns the MC version string or null when nothing recognizable is found.
function detectForgeMcVersion(root) {
  if (!root) return null;
  const libs = path.join(root, 'libraries');
  const candidates = [
    versionDirs(path.join(libs, 'net', 'neoforged', 'neoforge')),
    versionDirs(path.join(libs, 'net', 'minecraftforge', 'forge')),
  ];
  for (const list of candidates) {
    // Newest first so a multi-install folder resolves to the current build.
    for (const v of [...list].reverse()) {
      const mc = mcFor(v);
      if (mc && requiredJavaForJar(mc)) return mc;
    }
  }
  return null;
}

// Min Java a server folder needs. Prefers the jar name (authoritative when present); for a jar-less
// Forge/NeoForge server (run.bat only) falls back to the MC version under libraries/.
// serverFilesFn is injected so this stays testable without importing the fs-heavy server-files.js.
function requiredJavaForServer(root, serverFilesFn) {
  if (!root) return null;
  let files;
  try { files = serverFilesFn(root); } catch { return null; }
  const fromJar = requiredJavaForJar(files && files.jar);
  if (fromJar) return fromJar;
  // No usable jar. Only bother with the libraries/ fallback when this actually looks like a
  // script-launched (Forge/NeoForge) server, so a random folder with a stray run.bat is ignored.
  if (!(files && files.launchScript)) return null;
  const mc = detectForgeMcVersion(root);
  return mc ? requiredJavaForJar(mc) : null;
}

module.exports = { detectForgeMcVersion, requiredJavaForServer };
