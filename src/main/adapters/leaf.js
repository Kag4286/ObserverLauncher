const { json } = require('../http.js');

// Leaf (a Paper fork, https://leafmc.one) publishes builds through its own API which follows
// PaperMC's older v2 convention (project -> versions -> builds -> download), not the newer 'fill'
// v3 API papermc.js uses. Confirmed endpoint shape: api.leafmc.one/v2/projects/leaf/...
async function resolve(version) {
  const project = await json('https://api.leafmc.one/v2/projects/leaf');
  const targetVersion = version || project.versions[project.versions.length - 1];
  const versionInfo = await json(`https://api.leafmc.one/v2/projects/leaf/versions/${encodeURIComponent(targetVersion)}`);
  const builds = versionInfo.builds || [];
  if (!builds.length) throw new Error(`No Leaf build found for version "${targetVersion}".`);
  const build = builds[builds.length - 1];
  const buildInfo = await json(`https://api.leafmc.one/v2/projects/leaf/versions/${encodeURIComponent(targetVersion)}/builds/${build}`);
  const name = buildInfo.downloads?.application?.name || `leaf-${targetVersion}-${build}.jar`;
  const url = `https://api.leafmc.one/v2/projects/leaf/versions/${encodeURIComponent(targetVersion)}/builds/${build}/downloads/${name}`;
  return { url, name, version: targetVersion };
}

module.exports = { resolve };
