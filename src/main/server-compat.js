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
const { compareVersions } = require('./version-compare.js');

// mcFromName: pull a Minecraft version out of a jar/script filename (same shape modpacks.js used).
function mcFromName(name) {
  const str = String(name || '');
  // Explicit mc prefix first (e.g. "mod-mc1.16.4-1.0.jar", "foo_mc1.21.1.jar", "fabric-server-mc.1.20.1.jar")
  const mcPrefixed = str.match(/(?:^|[^0-9a-z])mc[-_.]?([0-9]+\.[0-9]+(?:\.[0-9]+)?)(?:[^0-9]|$)/i);
  if (mcPrefixed) return mcPrefixed[1];
  // Standard delimiter-bounded MC versions for modding are 1.7 through 1.29 (or 26.x NeoForge).
  // Sub-1.7 versions (e.g. 1.0, 1.2, 1.5) in modern filenames are mod build numbers (e.g. "cloth-config-1.0.jar").
  const m = str.match(/(?:^|[^0-9])(1\.(?:[7-9]|[1-2]\d)(?:\.\d{1,2})?|26\.\d{1,2}(?:\.\d{1,2})?)(?:[^0-9]|$)/);
  return m ? m[1] : null;
}

function listDirEntries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function anyFile(folder, re) {
  return listDirEntries(folder).some(d => re.test(d.name));
}

function pickNewestMcVersion(list) {
  const clean = list.filter(Boolean).sort(compareVersions);
  return clean.length ? clean[clean.length - 1] : null;
}

// Inspect on-disk Fabric artifacts when the server jar is opaque (e.g. fabric-server-launch.jar or renamed server.jar).
function detectFabricDiskInfo(root) {
  if (!root) return { found: false, mc: null };
  const mcCandidates = [];
  let found = false;

  const remapped = listDirEntries(path.join(root, '.fabric', 'remappedJars'));
  if (remapped.length) found = true;
  for (const d of remapped) {
    const m = d.name.match(/minecraft[-_]([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
    if (m) mcCandidates.push(m[1]);
  }

  const interDirs = listDirEntries(path.join(root, 'libraries', 'net', 'fabricmc', 'intermediary'))
    .filter(d => d.isDirectory())
    .map(d => d.name);
  if (interDirs.length) found = true;
  for (const name of interDirs) {
    const mc = mcFromName(name);
    if (mc) mcCandidates.push(mc);
  }

  const launchProps = path.join(root, 'fabric-server-launch.properties');
  if (fs.existsSync(launchProps)) {
    found = true;
    try {
      const txt = fs.readFileSync(launchProps, 'utf8');
      const m = txt.match(/serverJar\s*=\s*(.+)/i);
      if (m) {
        const mc = mcFromName(m[1].trim());
        if (mc) mcCandidates.push(mc);
      }
    } catch {}
  }

  if (fs.existsSync(path.join(root, '.fabric')) || anyFile(path.join(root, 'libraries', 'net', 'fabricmc', 'fabric-loader'), /.+/)) {
    found = true;
  }

  return { found, mc: pickNewestMcVersion(mcCandidates) };
}

function detectQuiltDiskInfo(root) {
  if (!root) return { found: false, mc: null };
  const hashed = listDirEntries(path.join(root, 'libraries', 'org', 'quiltmc', 'hashed'))
    .filter(d => d.isDirectory())
    .map(d => mcFromName(d.name))
    .filter(Boolean);
  const found = hashed.length > 0
    || fs.existsSync(path.join(root, '.quilt'))
    || anyFile(path.join(root, 'libraries', 'org', 'quiltmc', 'quilt-loader'), /.+/);
  return { found, mc: pickNewestMcVersion(hashed) };
}

function detectPaperDiskMc(root) {
  if (!root) return null;
  const candidates = [];
  for (const d of listDirEntries(path.join(root, 'cache'))) {
    const m = d.name.match(/^mojang[-_]([0-9]+\.[0-9]+(?:\.[0-9]+)?)\.jar$/i);
    if (m) candidates.push(m[1]);
  }
  for (const d of listDirEntries(path.join(root, 'versions'))) {
    const mc = mcFromName(d.name);
    if (mc) candidates.push(mc);
  }
  return pickNewestMcVersion(candidates);
}

function detectLaunchScriptInfo(root, scriptName) {
  if (!root || !scriptName) return { loader: null, mc: null };
  try {
    const p = path.join(root, scriptName);
    const st = fs.statSync(p);
    if (st.size > 64 * 1024) return { loader: null, mc: null };
    const txt = fs.readFileSync(p, 'utf8');
    let loader = null;
    if (/neoforge/i.test(txt)) loader = 'neoforge';
    else if (/minecraftforge|forge/i.test(txt)) loader = 'forge';
    else if (/quilt/i.test(txt)) loader = 'quilt';
    else if (/fabric/i.test(txt)) loader = 'fabric';
    else if (/paper|purpur|leaf|folia|spigot/i.test(txt)) loader = 'paper';
    const mc = mcFromName(txt);
    return { loader, mc };
  } catch {
    return { loader: null, mc: null };
  }
}

// Detect { mc, loader } for a server root. `files` is optional serverFiles(root) (passed in to avoid
// a second scan). Loader values match the rest of the codebase: neoforge|forge|fabric|quilt|paper|
// proxy|vanilla.
function detectServerTarget(root, files) {
  const f = files || {};
  const name = String(f.jar || f.launchScript || f.nativeBinary || '').toLowerCase();
  if (/pumpkin/.test(name) || (f.hasPumpkinConfig && !f.jar && !f.launchScript)) return { mc: 'latest', loader: 'pumpkin', engineType: 'native' };
  if (/horizon/.test(name) || (f.nativeBinary && !/pumpkin/.test(f.nativeBinary)) || (f.hasHorizonConfig && !f.jar && !f.launchScript)) return { mc: '26.3', loader: 'horizon', engineType: 'native' };
  // Proxy first (a Velocity server has no worlds/mods of its own).
  if (/velocity|bungee|waterfall/.test(name)) return { mc: mcFromName(name), loader: 'proxy' };
  // Explicit loader in the filename wins, falling back to on-disk metadata when filename omits MC.
  if (/neoforge/.test(name)) return { mc: mcFromName(name) || detectForgeMcVersion(root), loader: 'neoforge' };
  if (/forge/.test(name)) return { mc: mcFromName(name) || detectForgeMcVersion(root), loader: 'forge' };
  if (/quilt/.test(name)) {
    const q = detectQuiltDiskInfo(root);
    return { mc: mcFromName(name) || q.mc || detectFabricDiskInfo(root).mc, loader: 'quilt' };
  }
  if (/fabric/.test(name)) {
    return { mc: mcFromName(name) || detectFabricDiskInfo(root).mc, loader: 'fabric' };
  }
  if (/paper|purpur|leaf|folia|spigot|bukkit|craftbukkit/i.test(name)) {
    return { mc: mcFromName(name) || detectPaperDiskMc(root), loader: 'paper' };
  }
  // Ambiguous filename (e.g. server.jar) or jar-less script (run.bat): inspect libraries/ and launch artifacts.
  if (f.launchScript || root) {
    const libRoot = path.join(String(root || ''), 'libraries', 'net');
    if (anyFile(path.join(libRoot, 'neoforged'), /neoforge/i)) return { mc: detectForgeMcVersion(root), loader: 'neoforge' };
    if (anyFile(path.join(libRoot, 'minecraftforge'), /forge/i)) return { mc: detectForgeMcVersion(root), loader: 'forge' };
    const q = detectQuiltDiskInfo(root);
    if (q.found) return { mc: mcFromName(name) || q.mc || detectFabricDiskInfo(root).mc, loader: 'quilt' };
    const fab = detectFabricDiskInfo(root);
    if (fab.found) return { mc: mcFromName(name) || fab.mc, loader: 'fabric' };
    const scriptInfo = detectLaunchScriptInfo(root, f.launchScript);
    if (scriptInfo.loader) {
      const mc = scriptInfo.mc || mcFromName(name) || (scriptInfo.loader === 'forge' || scriptInfo.loader === 'neoforge' ? detectForgeMcVersion(root) : null);
      return { mc, loader: scriptInfo.loader };
    }
  }
  if (f.hasSpigotConfig) return { mc: mcFromName(name) || detectPaperDiskMc(root), loader: 'paper' };
  // Filename was a plain server jar with an MC version -> treat as vanilla.
  const mc = mcFromName(name) || detectPaperDiskMc(root);
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
  horizon: ['horizon'],
  pumpkin: ['pumpkin'],
};
const { areMcVersionsCompatible } = require('./mc-compat.js');

function versionMatchesServer(dl, server) {
  const srv = server || {};
  const item = dl || {};
  // MC mismatch (both known): evaluates direct match + cross-patch bridges (v6.1.6).
  if (srv.mc && Array.isArray(item.gameVersions) && item.gameVersions.length) {
    if (!areMcVersionsCompatible(srv.mc, item.gameVersions)) {
      return { ok: false, reason: 'mc' };
    }
  }
  // Loader mismatch: only mod-like loaders with a known family.
  const fam = LOADER_FAMILY[srv.loader];
  if (fam && Array.isArray(item.loaders) && item.loaders.length) {
    if (!item.loaders.some(l => fam.includes(l))) return { ok: false, reason: 'loader' };
  }
  return { ok: true, reason: null };
}

module.exports = { detectServerTarget, versionMatchesServer, mcFromName, LOADER_FAMILY };
