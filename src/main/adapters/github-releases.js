// src/main/adapters/github-releases.js — Shared cached GitHub Releases fetcher & SHA-256 checksum parser
const { json, text } = require('../http.js');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const _releaseCache = new Map(); // repo -> { at, releases, inflight }
const _checksumCache = new Map(); // url -> { at, map }

/**
 * Fetch GitHub releases for `owner/repo` with an in-memory TTL cache and in-flight coalescing.
 * Falls back cleanly to stale cache (or empty array) when offline.
 */
async function fetchGitHubReleases(repo, { perPage = 30, ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
  const key = `${repo}:${perPage}`;
  const now = Date.now();
  const entry = _releaseCache.get(key) || { at: 0, releases: null, inflight: null };

  if (!force && entry.releases && (now - entry.at) < ttlMs) {
    return entry.releases;
  }
  if (entry.inflight) return entry.inflight;

  const url = `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`;
  entry.inflight = json(url, { Accept: 'application/vnd.github+json' }, 'GET', null, 12000)
    .then((data) => {
      const list = Array.isArray(data) ? data : [];
      entry.releases = list;
      entry.at = Date.now();
      entry.inflight = null;
      _releaseCache.set(key, entry);
      return list;
    })
    .catch(() => {
      entry.inflight = null;
      _releaseCache.set(key, entry);
      return Array.isArray(entry.releases) ? entry.releases : [];
    });

  _releaseCache.set(key, entry);
  return entry.inflight;
}

function getCachedGitHubReleases(repo, perPage = 30) {
  const entry = _releaseCache.get(`${repo}:${perPage}`);
  return Array.isArray(entry?.releases) ? entry.releases : null;
}

async function fetchGitHubReleaseByTag(repo, tag) {
  const encoded = encodeURIComponent(tag);
  try {
    return await json(
      `https://api.github.com/repos/${repo}/releases/tags/${encoded}`,
      { Accept: 'application/vnd.github+json' },
      'GET',
      null,
      10000
    );
  } catch {
    return null;
  }
}

/**
 * Parse sha256sum / shasum output (`<64-hex>  <filename>`) into Map<lowercaseBasename, lowercaseHex>.
 */
function parseSha256Sums(raw) {
  const map = new Map();
  if (!raw || typeof raw !== 'string') return map;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(trimmed);
    if (!m) continue;
    const hex = m[1].toLowerCase();
    const file = m[2].trim().replace(/^\.\//, '');
    if (file) map.set(file.toLowerCase(), hex);
  }
  return map;
}

/**
 * Resolve SHA-256 digest for `assetName` on a GitHub release object, checking:
 * 1) `asset.digest` (`sha256:<hex>`) if populated by GitHub API
 * 2) Accompanying checksums file (`checksums.sha256` / `SHA256SUMS`) downloaded & cached
 */
async function resolveChecksumFromRelease(release, assetName, checksumNames = ['checksums.sha256', 'SHA256SUMS']) {
  if (!release || !assetName) return null;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const lowerTarget = String(assetName).toLowerCase();

  const targetAsset = assets.find(a => String(a?.name || '').toLowerCase() === lowerTarget);
  if (targetAsset && typeof targetAsset.digest === 'string') {
    const dm = /^sha256:([a-fA-F0-9]{64})$/i.exec(targetAsset.digest.trim());
    if (dm) return dm[1].toLowerCase();
  }

  const wanted = checksumNames.map(n => n.toLowerCase());
  const sumAsset = assets.find(a => wanted.includes(String(a?.name || '').toLowerCase()));
  if (!sumAsset?.browser_download_url) return null;

  const url = sumAsset.browser_download_url;
  const cached = _checksumCache.get(url);
  if (cached && (Date.now() - cached.at) < DEFAULT_TTL_MS) {
    return cached.map.get(lowerTarget) || null;
  }

  try {
    const body = await text(url, { Accept: 'text/plain' }, 10000);
    const map = parseSha256Sums(body);
    _checksumCache.set(url, { at: Date.now(), map });
    return map.get(lowerTarget) || null;
  } catch {
    return null;
  }
}

/**
 * Compare two version/tag strings descending by leading dotted semver components (v0.2.97 > 0.2.2 > 0.2.1).
 */
function compareSemverDesc(a, b) {
  const extract = s => {
    const clean = String(s || '').replace(/^v/i, '').split(/[+-]/)[0];
    const parts = clean.split('.').map(n => parseInt(n, 10));
    return parts.every(Number.isFinite) ? parts : null;
  };
  const pa = extract(a);
  const pb = extract(b);
  if (!pa && !pb) return String(b).localeCompare(String(a));
  if (!pa) return 1;
  if (!pb) return -1;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  const aPre = /-[a-z]/i.test(String(a).split('+')[0]);
  const bPre = /-[a-z]/i.test(String(b).split('+')[0]);
  if (aPre !== bPre) return aPre ? 1 : -1;
  return 0;
}

module.exports = {
  fetchGitHubReleases,
  fetchGitHubReleaseByTag,
  getCachedGitHubReleases,
  parseSha256Sums,
  resolveChecksumFromRelease,
  compareSemverDesc,
};
