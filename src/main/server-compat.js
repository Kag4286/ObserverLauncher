// 2.3.0: detect the TARGET (loader + Minecraft version) of a server folder, correctly handling a
// jar-less NeoForge/Forge server (run.bat only). The old detectServerCompat() only looked at the
// jar/launchScript NAME, so a run.bat NeoForge server resolved to { mc: null, loader: 'vanilla' }
// and the modpack planner could not filter out Forge/Fabric mods for the wrong loader or MC.
//
// Reuses detectForgeMcVersion() (libraries/ tree) and requiredJavaForJar-adjacent mappings so the
// loader/MC detection lives in ONE place. Pure-ish: reads the folder, no Electron, no network.
const fs = require('fs');
const path = require('path');
const { detectForgeMcVersion } = require('./server-java.js');

// mcFromJar: pull a Minecraft version out of a jar/script filename (same shape modpacks.js used).
function mcFromName(name) {
  const m = String(name || '').match(/\b(1\.\d{1,2}(?:\.\d{1,2})?|26\.\d{1,2})\b/);
  return m ? m[1] : null;
}

// Read the newest version dir of a mods/ subfolder name if any, to guess the loader from CONTENT
// when the filename is inconclusive (a run.bat server with mods/ full of .jar files).
function anyFile(folder, re) {
  try { return fs.readdirSync(folder).some(f => re.test(f)); } catch { return false; }
}

// Detect { mc, loader } for a server root. `files` is optional serverFiles(root) (passed in to avoid
// a second scan). Loader values match the rest of the codebase: neoforge|forge|fabric|quilt|paper|
// proxy|vanilla.
function detectServerTarget(root, files) {
  const f = files || {};
  const name = String(f.jar || f.launchScript || '').toLowerCase();
  // Proxy first (a Velocity server has no worlds/mods of its own).
  if (/velocity|bungee|waterfall/.test(name)) return { mc: mcFromName(name), loader: 'proxy' };
  // Explicit loader in the filename wins.
  if (/neoforge/.test(name)) return { mc: mcFromName(name) || detectForgeMcVersion(root), loader: 'neoforge' };
  if (/forge/.test(name)) return { mc: mcFromName(name) || detectForgeMcVersion(root), loader: 'forge' };
  if (/quilt/.test(name)) return { mc: mcFromName(name), loader: 'quilt' };
  if (/fabric/.test(name)) return { mc: mcFromName(name), loader: 'fabric' };
  if (/paper|purpur|leaf|folia/.test(name) || f.hasSpigotConfig) return { mc: mcFromName(name), loader: 'paper' };
  // jar-less Forge/NeoForge (run.bat): read libraries/ for the MC version + loader.
  if (f.launchScript || root) {
    const libRoot = path.join(String(root || ''), 'libraries', 'net');
    const neo = anyFile(path.join(libRoot, 'neoforged'), /neoforge/i);
    const forge = anyFile(path.join(libRoot, 'minecraftforge'), /forge/i);
    if (neo) return { mc: detectForgeMcVersion(root), loader: 'neoforge' };
    if (forge) return { mc: detectForgeMcVersion(root), loader: 'forge' };
  }
  // Filename was a plain server jar with an MC version -> treat as the right family by name.
  const mc = mcFromName(name);
  if (mc && /server/.test(name)) return { mc, loader: 'vanilla' };
  return { mc: mc || null, loader: 'vanilla' };
}

// Should a resolved download be REJECTED for this server? Returns { ok, reason } where reason is
// one of 'loader' | 'mc' | null. Only rejects when BOTH the item's metadata and the server are
// known — an unknown version on either side is NOT a rejection (avoids false positives).
//   dl: { gameVersions?: string[], loaders?: string[] }
//   server: { mc, loader } from detectServerTarget
const LOADER_FAMILY = {
  paper: ['paper', 'spigot', 'purpur', 'folia', 'bukkit'],
  forge: ['forge'],
  neoforge: ['neoforge'],
  fabric: ['fabric', 'quilt'],
  quilt: ['fabric', 'quilt'],
};
function versionMatchesServer(dl, server) {
  const srv = server || {};
  const item = dl || {};
  // MC mismatch (both known).
  if (srv.mc && Array.isArray(item.gameVersions) && item.gameVersions.length && !item.gameVersions.includes(srv.mc)) {
    return { ok: false, reason: 'mc' };
  }
  // Loader mismatch: only mod-like loaders with a known family.
  const fam = LOADER_FAMILY[srv.loader];
  if (fam && Array.isArray(item.loaders) && item.loaders.length) {
    if (!item.loaders.some(l => fam.includes(l))) return { ok: false, reason: 'loader' };
  }
  return { ok: true, reason: null };
}

module.exports = { detectServerTarget, versionMatchesServer, mcFromName, LOADER_FAMILY };
