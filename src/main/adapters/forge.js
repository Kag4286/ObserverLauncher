const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { withTimeout, download } = require('../http.js');

// FEATURE: NeoForge uses the exact same install process as Forge (installer jar runs
// --installServer, producing run.bat + user_jvm_args.txt) — only the Maven domain and version
// number format differ. Unlike the "plain" adapters (vanilla/fabric/purpur), this one performs the
// actual download + install itself (not just URL resolution) because the install step is a real
// side effect (spawns a JVM, writes run.bat) that has to happen before returning — but it needs no
// shared/mutable state from main.js (no background process is left running), so it's safe to fully
// own end-to-end here, unlike Spigot's BuildTools (see spigot.js).
async function install({ software, version, javaInfo, serverPath, onProgress }) {
  if (!javaInfo?.ok) throw new Error(`Java is required to install ${software === 'neoforge' ? 'NeoForge' : 'Forge'}. Set a valid Java path first.`);
  const mavenBase = software === 'neoforge' ? 'https://maven.neoforged.net/releases/net/neoforged/neoforge' : 'https://maven.minecraftforge.net/net/minecraftforge/forge';
  const { signal, cancel } = withTimeout(15000);
  const xml = await (await fetch(`${mavenBase}/maven-metadata.xml`, { signal }).finally(cancel)).text();
  const targetVersion = version || xml.match(/<latest>([^<]+)<\/latest>/)?.[1];
  if (!targetVersion) throw new Error(`Could not resolve the newest ${software === 'neoforge' ? 'NeoForge' : 'Forge'} release.`);
  const name = `${software === 'neoforge' ? 'neoforge' : 'forge'}-${targetVersion}-installer.jar`;
  const url = `${mavenBase}/${encodeURIComponent(targetVersion)}/${encodeURIComponent(name)}`;
  const installerPath = path.join(serverPath, name);
  // Forge/NeoForge installer jars are small (a few MB); cap at 256 MB.
  await download(url, installerPath, onProgress, null, { maxBytes: 256 * 1024 * 1024 });
  // P1e (2.2.0): verify the installer is a plausible jar before running it. A tiny file (an HTML
  // error page, a truncated download) would fail cryptically in the JVM; catch it here.
  let size = 0; try { size = fs.statSync(installerPath).size; } catch {}
  if (size < 4096) {
    try { fs.rmSync(installerPath, { force: true }); } catch {}
    throw new Error(`The ${software} installer download looks corrupt (only ${size} bytes). Check your connection and try again.`);
  }
  const label = software === 'neoforge' ? 'NeoForge' : 'Forge';
  try {
    await new Promise((resolve, reject) => execFile(javaInfo.path, ['-jar', name, '--installServer'], { cwd: serverPath, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(Object.assign(new Error(stderr || stdout || error.message), { code: error.code })) : resolve(stdout)));
  } catch (e) {
    // P1e: name the cause + keep a short tail of the installer output so the real error is visible.
    const tail = String(e?.message || '').split(/\r?\n/).filter(Boolean).slice(-4).join(' ').slice(0, 400);
    throw new Error(`The ${label} installer failed for version ${targetVersion}.${tail ? ' Installer output: ' + tail : ''}\nTry a different ${label} build (some versions need a newer/older Java).`);
  }
  return { name: `${label} server`, version: targetVersion };
}

module.exports = { install };
