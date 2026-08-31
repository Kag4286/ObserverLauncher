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
  await download(url, path.join(serverPath, name), onProgress);
  await new Promise((resolve, reject) => execFile(javaInfo.path, ['-jar', name, '--installServer'], { cwd: serverPath, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
  return { name: software === 'neoforge' ? 'NeoForge server' : 'Forge server', version: targetVersion };
}

module.exports = { install };
