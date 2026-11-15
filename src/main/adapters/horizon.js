// src/main/adapters/horizon.js — Adapter for Horizon Dedicated Server (Rust Native)
const { getDefaultHorizonToml } = require('../horizon-config.js');
const {
  fetchGitHubReleases, fetchGitHubReleaseByTag, getCachedGitHubReleases,
  resolveChecksumFromRelease, compareSemverDesc,
} = require('./github-releases.js');

const HORIZON_REPO = 'horizon-rust/horizon';
const HORIZON_VERSION = '26.3';

function getHorizonPlatform(override = {}) {
  const platform = override.platform || process.platform;
  const arch = override.arch || process.arch;

  if (platform === 'win32') {
    const isArm = arch === 'arm64';
    return {
      os: 'windows',
      arch: isArm ? 'arm64' : 'x86_64',
      binaryName: 'horizon-server.exe',
      assetName: isArm ? 'horizon-windows-arm64.zip' : 'horizon-windows-x64.zip',
      fallbackAssets: isArm ? ['horizon-windows-x64.zip'] : [],
    };
  }
  if (platform === 'darwin') {
    const isArm = arch === 'arm64';
    return {
      os: 'macos',
      arch: isArm ? 'arm64' : 'x86_64',
      binaryName: 'horizon-server',
      assetName: isArm ? 'horizon-macos-arm64.zip' : 'horizon-macos-x64.zip',
      fallbackAssets: isArm ? ['horizon-macos-x64.zip'] : ['horizon-macos-arm64.zip'],
    };
  }
  return {
    os: 'linux',
    arch: arch === 'arm64' ? 'arm64' : 'x86_64',
    binaryName: 'horizon-server',
    assetName: 'horizon-server-linux-x86_64.tar.gz',
    fallbackAssets: ['horizon-linux-x86_64.tar.gz'],
  };
}

/**
 * Horizon shares its GitHub releases feed between desktop app (`launcher@*`) and server builds.
 * Accept only server releases containing horizon server archives (never `horizon-launcher-*`).
 */
function isHorizonServerRelease(rel) {
  const tag = String(rel?.tag_name || '').trim();
  if (!tag || tag.startsWith('launcher@')) return false;
  const assets = Array.isArray(rel?.assets) ? rel.assets : [];
  return assets.some(a => /^horizon-(?:server-)?(?:windows|linux|macos)-/i.test(String(a?.name || '')));
}

function pickPlatformAsset(rel, plat) {
  const assets = Array.isArray(rel?.assets) ? rel.assets : [];
  const exact = assets.find(a => String(a?.name || '').toLowerCase() === plat.assetName.toLowerCase());
  if (exact) return exact;
  for (const fb of (plat.fallbackAssets || [])) {
    const m = assets.find(a => String(a?.name || '').toLowerCase() === fb.toLowerCase());
    if (m) return m;
  }
  return assets.find(a => {
    const n = String(a?.name || '').toLowerCase();
    return n.startsWith(`horizon-${plat.os}-`) || n.startsWith(`horizon-server-${plat.os}-`);
  }) || null;
}

function extractVersionsFromReleases(releases) {
  const serverRels = releases.filter(isHorizonServerRelease);
  const stable = [];
  let hasNightly = false;

  for (const rel of serverRels) {
    const tag = String(rel.tag_name || '').trim();
    if (!tag) continue;
    if (tag === 'nightly' || /^nightly-/i.test(tag) || rel.prerelease) {
      if (tag === 'nightly') hasNightly = true;
    } else if (!stable.includes(tag)) {
      stable.push(tag);
    }
  }

  stable.sort(compareSemverDesc);
  if (hasNightly || serverRels.some(r => /^nightly/i.test(r.tag_name || ''))) {
    // Keep newest stable at [0] as recommended latest, and place nightly right after it for visibility
    if (stable.length > 0) return [stable[0], 'nightly', ...stable.slice(1)];
    return ['nightly'];
  }
  return stable;
}

function listVersions() {
  const cached = getCachedGitHubReleases(HORIZON_REPO, 100);
  if (cached && cached.length > 0) {
    const versions = extractVersionsFromReleases(cached);
    if (versions.length > 0) return versions;
  }
  return ['v0.2.97', 'nightly'];
}

async function fetchVersions() {
  const releases = await fetchGitHubReleases(HORIZON_REPO, { perPage: 100 });
  if (Array.isArray(releases) && releases.length > 0) {
    const versions = extractVersionsFromReleases(releases);
    if (versions.length > 0) return versions;
  }
  return listVersions();
}

async function findServerRelease(target, releases, plat) {
  const serverRels = (releases || []).filter(isHorizonServerRelease);
  const isLatestOrBlank = !target || target === 'latest' || target === HORIZON_VERSION;

  if (serverRels.length > 0) {
    if (isLatestOrBlank) {
      const stableList = serverRels.filter(r => !r.prerelease && !/^nightly/i.test(r.tag_name || ''));
      stableList.sort((a, b) => compareSemverDesc(a.tag_name, b.tag_name));
      const picked = stableList.find(r => pickPlatformAsset(r, plat)) || stableList[0] || serverRels[0];
      if (picked) return picked;
    }

    if (target === 'nightly') {
      const nightlies = serverRels.filter(r => r.tag_name === 'nightly' || /^nightly-/i.test(r.tag_name || ''));
      const exactArch = nightlies.find(r =>
        (r.assets || []).some(a => String(a?.name || '').toLowerCase() === plat.assetName.toLowerCase())
      );
      if (exactArch) return exactArch;
      const headNightly = nightlies.find(r => r.tag_name === 'nightly') || nightlies[0];
      if (headNightly) return headNightly;
    }

    const match = serverRels.find(r => {
      const tag = String(r.tag_name || '');
      return tag === target || tag.replace(/^v/i, '') === target.replace(/^v/i, '');
    });
    if (match) return match;
  }

  const tagFallback = (!isLatestOrBlank && target) ? target : 'nightly';
  const direct = await fetchGitHubReleaseByTag(HORIZON_REPO, tagFallback);
  return (direct && isHorizonServerRelease(direct)) ? direct : null;
}

async function resolve(version) {
  const plat = getHorizonPlatform();
  const raw = String(version || '').trim();
  const releases = await fetchGitHubReleases(HORIZON_REPO, { perPage: 100 });
  const rel = await findServerRelease(raw, releases, plat);

  const match = rel ? pickPlatformAsset(rel, plat) : null;
  const resolvedTag = rel?.tag_name || (raw && raw !== 'latest' && raw !== HORIZON_VERSION ? raw : 'v0.2.97');
  const assetName = match?.name || plat.assetName;
  const downloadUrl = match?.browser_download_url || `https://github.com/${HORIZON_REPO}/releases/download/${encodeURIComponent(resolvedTag)}/${assetName}`;
  const sha256 = rel ? await resolveChecksumFromRelease(rel, assetName, ['SHA256SUMS']) : null;

  return {
    url: downloadUrl,
    name: plat.binaryName,
    archiveName: assetName,
    version: resolvedTag,
    platform: plat,
    sha256,
  };
}

module.exports = {
  resolve,
  listVersions,
  fetchVersions,
  getHorizonPlatform,
  isHorizonServerRelease,
  HORIZON_VERSION,
  getDefaultHorizonToml,
};
