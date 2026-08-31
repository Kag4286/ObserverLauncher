const { json } = require('../http.js');

// FEATURE: Vanilla, straight from Mojang — the simplest choice for someone hosting for the first
// time (no need to understand what a "plugin loader" is). Uses Mojang's official
// version_manifest_v2. This module only *resolves* a download descriptor {url, name, version} —
// it does not download or write anything itself, so it's easy to reuse/test in isolation. The
// caller (main.js) is responsible for the actual download() call and the IPC response shape.
async function resolve(version) {
  const manifest = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const targetVersion = version || manifest.latest.release;
  const entry = manifest.versions.find(v => v.id === targetVersion);
  if (!entry) throw new Error(`Could not find Minecraft version "${targetVersion}".`);
  const versionMeta = await json(entry.url);
  const dl = versionMeta.downloads?.server;
  if (!dl?.url) throw new Error('This version has no server download (client-only release).');
  return { url: dl.url, name: `minecraft_server.${targetVersion}.jar`, version: targetVersion };
}

module.exports = { resolve };
