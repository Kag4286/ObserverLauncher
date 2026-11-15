// src/main/adapters/pumpkin.js — Adapter for Pumpkin Minecraft Server in Rust
const {
  fetchGitHubReleases, fetchGitHubReleaseByTag, getCachedGitHubReleases,
  resolveChecksumFromRelease, compareSemverDesc,
} = require('./github-releases.js');

const PUMPKIN_REPO = 'Pumpkin-MC/Pumpkin';
const PUMPKIN_DEFAULT_TAG = '0.2.2+26.3-26.60';

const PUMPKIN_FALLBACK_MAP = {
  latest: '0.2.2+26.3-26.60',
  '0.2.2': '0.2.2+26.3-26.60',
  '0.2.1': '0.2.1+26.3-26.51',
  '0.2.0': '0.2.0+26.3-26.51',
  nightly: 'nightly',
  canary: 'canary',
};

const _tagByVersion = new Map(Object.entries(PUMPKIN_FALLBACK_MAP));

function displayVersionForTag(tag) {
  const s = String(tag || '').trim();
  if (!s) return '';
  if (s === 'nightly' || s === 'canary') return s;
  const plusIdx = s.indexOf('+');
  return plusIdx > 0 ? s.slice(0, plusIdx) : s;
}

function getPumpkinPlatform(override = {}) {
  const platform = override.platform || process.platform;
  const arch = override.arch || process.arch;

  if (platform === 'win32') {
    return {
      os: 'windows',
      arch: arch === 'arm64' ? 'arm64' : 'x86_64',
      binaryName: 'pumpkin.exe',
      assetName: arch === 'arm64' ? 'pumpkin-ARM64-Windows.exe' : 'pumpkin-X64-Windows.exe',
    };
  }
  if (platform === 'darwin') {
    return {
      os: 'macos',
      arch: arch === 'arm64' ? 'arm64' : 'x86_64',
      binaryName: 'pumpkin',
      assetName: arch === 'arm64' ? 'pumpkin-ARM64-macOS' : 'pumpkin-X64-macOS',
    };
  }
  return {
    os: 'linux',
    arch: arch === 'arm64' ? 'arm64' : 'x86_64',
    binaryName: 'pumpkin',
    assetName: arch === 'arm64' ? 'pumpkin-ARM64-Linux' : 'pumpkin-X64-Linux',
  };
}

function extractVersionsFromReleases(releases, plat) {
  const stable = [];
  const channels = [];
  const seen = new Set();

  for (const rel of releases) {
    const tag = String(rel?.tag_name || '').trim();
    if (!tag) continue;
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const hasPlatAsset = !plat || assets.some(a => String(a?.name || '').toLowerCase() === plat.assetName.toLowerCase());
    if (assets.length > 0 && !hasPlatAsset) continue;

    const label = displayVersionForTag(tag);
    _tagByVersion.set(label, tag);
    _tagByVersion.set(tag, tag);

    if (seen.has(label)) continue;
    seen.add(label);

    if (tag === 'nightly' || tag === 'canary' || rel.prerelease) {
      channels.push(label);
    } else {
      stable.push(label);
    }
  }

  stable.sort(compareSemverDesc);
  // Keep nightly before canary if both exist
  channels.sort((a, b) => (a === 'nightly' ? -1 : b === 'nightly' ? 1 : a.localeCompare(b)));

  if (stable.length > 0) {
    const newestTag = _tagByVersion.get(stable[0]);
    if (newestTag) _tagByVersion.set('latest', newestTag);
  }
  return [...stable, ...channels];
}

function listVersions() {
  const cached = getCachedGitHubReleases(PUMPKIN_REPO, 30);
  if (cached && cached.length > 0) {
    const versions = extractVersionsFromReleases(cached, getPumpkinPlatform());
    if (versions.length > 0) return versions;
  }
  return ['0.2.2', '0.2.1', '0.2.0', 'nightly', 'canary'];
}

async function fetchVersions() {
  const releases = await fetchGitHubReleases(PUMPKIN_REPO, { perPage: 30 });
  if (Array.isArray(releases) && releases.length > 0) {
    const versions = extractVersionsFromReleases(releases, getPumpkinPlatform());
    if (versions.length > 0) return versions;
  }
  return listVersions();
}

async function findReleaseForInput(raw, releases) {
  const plat = getPumpkinPlatform();
  if (Array.isArray(releases) && releases.length > 0) {
    extractVersionsFromReleases(releases, plat);
    if (!raw || raw === 'latest') {
      const firstStable = releases.find(r => !r.prerelease && r.tag_name) || releases[0];
      if (firstStable) return firstStable;
    }
    const exact = releases.find(r => r.tag_name === raw || displayVersionForTag(r.tag_name) === raw);
    if (exact) return exact;
    const prefix = releases.find(r => String(r.tag_name || '').startsWith(`${raw}+`));
    if (prefix) return prefix;
  }

  const mappedTag = _tagByVersion.get(raw) || PUMPKIN_FALLBACK_MAP[raw] || raw || PUMPKIN_DEFAULT_TAG;
  return fetchGitHubReleaseByTag(PUMPKIN_REPO, mappedTag);
}

async function resolve(version) {
  const p = getPumpkinPlatform();
  const raw = String(version || '').trim();
  const releases = await fetchGitHubReleases(PUMPKIN_REPO, { perPage: 30 });
  const rel = await findReleaseForInput(raw, releases);

  const tag = rel?.tag_name || _tagByVersion.get(raw) || PUMPKIN_FALLBACK_MAP[raw] || (raw && raw !== 'latest' ? raw : PUMPKIN_DEFAULT_TAG);
  const encoded = encodeURIComponent(tag);

  const assets = Array.isArray(rel?.assets) ? rel.assets : [];
  const match = assets.find(it => String(it?.name || '').toLowerCase() === p.assetName.toLowerCase());

  const targetUrl = match?.browser_download_url || `https://github.com/${PUMPKIN_REPO}/releases/download/${encoded}/${p.assetName}`;
  const mirrorUrl = `https://ghfast.top/${targetUrl}`;
  const resolvedVer = rel?.tag_name || tag;
  const sha256 = rel ? await resolveChecksumFromRelease(rel, match?.name || p.assetName, ['checksums.sha256']) : null;

  return {
    url: targetUrl,
    urls: [targetUrl, mirrorUrl],
    name: p.binaryName,
    version: resolvedVer,
    sha256,
  };
}

module.exports = {
  resolve,
  listVersions,
  fetchVersions,
  getPumpkinPlatform,
  PUMPKIN_DEFAULT_TAG,
  displayVersionForTag,
};
