const path = require('path');
const { json } = require('../http.js');

// BUGFIX (the "404 while downloading server.jar" bug): the Fill v3 API returns versions as an
// OBJECT keyed by release family — {"26.2":["26.2",...],"1.21":[...],...} — NOT a flat array.
// The old code read versions[versions.length-1]; .length is undefined on an object, so the index
// was NaN and the resolved version was undefined → requests went to /versions/undefined/builds
// and every "Latest" download for Paper/Folia/Velocity failed with 404.
function flattenVersions(meta) {
  if (Array.isArray(meta.versions)) return meta.versions;
  return Object.values(meta.versions || {}).flat(); // families are newest-first in the response
}

async function listFillVersions(project) { return flattenVersions(await json(`https://fill.papermc.io/v3/projects/${project}`)); }

async function downloadFillProject(project, targetVersion) {
  const versions = await listFillVersions(project);
  const resolvedVersion = targetVersion || versions[0]; // first entry = newest release
  if (!resolvedVersion) throw new Error(`The ${project} project returned no versions — try again later.`);
  if (!versions.includes(resolvedVersion)) {
    throw new Error(`"${resolvedVersion}" is not an available ${project} version. Nearest releases: ${versions.slice(0, 6).join(', ')}.`);
  }
  const builds = await json(`https://fill.papermc.io/v3/projects/${project}/versions/${encodeURIComponent(resolvedVersion)}/builds`);
  const buildList = Array.isArray(builds) ? builds : (builds.builds || []);
  const build = buildList.filter(x => x.channel === 'STABLE').at(-1);
  if (!build) {
    // BUGFIX: previously fell back silently to the newest build even when it was EXPERIMENTAL,
    // which could install an unstable server jar without the user realising. Now refuse clearly
    // and explain what is available so the user can pick an older version on purpose.
    const latest = buildList.at(-1);
    const latestChannel = latest?.channel || 'unknown';
    throw new Error(`No stable ${project} build exists for "${resolvedVersion}" (newest available: ${latestChannel}). Pick a different version with stable builds.`);
  }
  const dl = build.downloads?.['server:default'] || Object.values(build.downloads || {})[0];
  if (!dl?.url) throw new Error(`No downloadable ${project} server jar was found for this build.`);
  // sha256 (when the API provides it) is verified by the caller after download.
  return { url: dl.url, name: dl.name || path.basename(new URL(dl.url).pathname), version: resolvedVersion, sha256: dl.checksums?.sha256 || null };
}

module.exports = { downloadFillProject, listFillVersions };
