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

// Builds for one version (STABLE channel first). Returns [] when the version has no builds yet.
async function listBuilds(project, version) {
  const builds = await json(`https://fill.papermc.io/v3/projects/${project}/versions/${encodeURIComponent(version)}/builds`);
  return Array.isArray(builds) ? builds : (builds.builds || []);
}

// The newest STABLE build for an exact version, or null when that version is only ALPHA/BETA.
async function stableBuildFor(project, version) {
  const buildList = await listBuilds(project, version);
  return buildList.filter(x => x.channel === 'STABLE').at(-1) || null;
}

// 2.2.0 (option 1a): the newest version that actually HAS a stable build. The wizard used to default
// to versions[0], which is frequently a just-released version Paper/Folia only ships as ALPHA/BETA —
// so "Latest" failed with "No stable build exists". Walk the newest N versions until one is stable.
// Returns { version, build } or null (no stable build found in the scanned window).
async function resolveStableVersion(project, maxScan = 8) {
  const versions = await listFillVersions(project);
  for (const v of versions.slice(0, Math.max(1, maxScan))) {
    const build = await stableBuildFor(project, v);
    if (build) return { version: v, build };
  }
  return null;
}

// Which of the newest N versions currently have a stable build — for the wizard version picker.
// Returns [{ version, stable, channel }] in API order (newest first). One HEAD-ish build call each.
async function listFillVersionsWithStatus(project, maxScan = 12) {
  const versions = await listFillVersions(project);
  const out = [];
  for (const v of versions.slice(0, Math.max(1, maxScan))) {
    try {
      const buildList = await listBuilds(project, v);
      const stable = buildList.some(x => x.channel === 'STABLE');
      const latest = buildList.at(-1);
      out.push({ version: v, stable, channel: latest?.channel || null });
    } catch {
      out.push({ version: v, stable: false, channel: null });
    }
  }
  return out;
}

async function downloadFillProject(project, targetVersion) {
  let resolvedVersion = targetVersion;
  let build = null;
  if (!resolvedVersion) {
    // 2.2.0: "Latest" = newest STABLE, not newest version. Falls back through the newest few
    // versions so a just-released (alpha/beta-only) version never breaks the default download.
    const stable = await resolveStableVersion(project);
    if (!stable) throw new Error(`No stable ${project} build was found for the newest versions — PaperMC may be between releases. Try again later, or pick an older version manually.`);
    resolvedVersion = stable.version;
    build = stable.build;
  }
  const versions = await listFillVersions(project);
  if (!versions.includes(resolvedVersion)) {
    throw new Error(`"${resolvedVersion}" is not an available ${project} version. Nearest releases: ${versions.slice(0, 6).join(', ')}.`);
  }
  if (!build) build = await stableBuildFor(project, resolvedVersion);
  if (!build) {
    // BUGFIX: previously fell back silently to the newest build even when it was EXPERIMENTAL,
    // which could install an unstable server jar without the user realising. Now refuse clearly
    // and explain what is available so the user can pick an older version on purpose.
    const buildList = await listBuilds(project, resolvedVersion);
    const latest = buildList.at(-1);
    const latestChannel = latest?.channel || 'unknown';
    let hint = '';
    try { const s = await resolveStableVersion(project); if (s) hint = ` The newest stable ${project} is ${s.version}.`; } catch {}
    throw new Error(`No stable ${project} build exists for "${resolvedVersion}" (newest available: ${latestChannel}).${hint}`);
  }
  const dl = build.downloads?.['server:default'] || Object.values(build.downloads || {})[0];
  if (!dl?.url) throw new Error(`No downloadable ${project} server jar was found for this build.`);
  // sha256 (when the API provides it) is verified by the caller after download.
  return { url: dl.url, name: dl.name || path.basename(new URL(dl.url).pathname), version: resolvedVersion, sha256: dl.checksums?.sha256 || null };
}

module.exports = { downloadFillProject, listFillVersions, listFillVersionsWithStatus, resolveStableVersion };
