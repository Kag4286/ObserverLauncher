const { json } = require('../http.js');

// FEATURE: Fabric — uses the official "server/jar" endpoint of the Fabric meta API, which returns
// a pre-built server file directly, no need to run an installer like Forge/NeoForge.
async function resolve(version) {
  const gameVersions = await json('https://meta.fabricmc.net/v2/versions/game');
  const targetVersion = version || gameVersions.find(v => v.stable)?.version;
  if (!targetVersion) throw new Error('Could not resolve the latest Fabric-supported Minecraft version.');
  const loaders = await json(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(targetVersion)}`);
  const loaderVersion = loaders.find(x => x.loader?.stable)?.loader?.version || loaders[0]?.loader?.version;
  if (!loaderVersion) throw new Error(`No Fabric loader is available yet for Minecraft ${targetVersion}.`);
  const installers = await json('https://meta.fabricmc.net/v2/versions/installer');
  const installerVersion = installers.find(x => x.stable)?.version || installers[0]?.version;
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(targetVersion)}/${encodeURIComponent(loaderVersion)}/${encodeURIComponent(installerVersion)}/server/jar`;
  return { url, name: `fabric-server-mc.${targetVersion}-loader.${loaderVersion}.jar`, version: targetVersion };
}

module.exports = { resolve };
