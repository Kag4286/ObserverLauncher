// src/main/adapters/pumpkin.js — Adapter for Pumpkin Minecraft Server in Rust
const { json } = require('../http.js');

const PUMPKIN_DEFAULT_TAG = '0.2.1+26.3-26.51';

const PUMPKIN_TAG_MAP = {
  latest: '0.2.1+26.3-26.51',
  '0.2.1': '0.2.1+26.3-26.51',
  '0.2.0': '0.2.0+26.3-26.51',
  nightly: 'nightly',
  canary: 'canary',
};

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
      arch: 'arm64',
      binaryName: 'pumpkin',
      assetName: 'pumpkin-ARM64-macOS',
    };
  }
  return {
    os: 'linux',
    arch: arch === 'arm64' ? 'arm64' : 'x86_64',
    binaryName: 'pumpkin',
    assetName: arch === 'arm64' ? 'pumpkin-ARM64-Linux' : 'pumpkin-X64-Linux',
  };
}

async function resolve(version) {
  const p = getPumpkinPlatform();
  const raw = String(version || '').trim();
  const tag = PUMPKIN_TAG_MAP[raw] || (raw.startsWith('0.2.1') ? PUMPKIN_DEFAULT_TAG : (raw || PUMPKIN_DEFAULT_TAG));
  const encoded = encodeURIComponent(tag);

  const directUrl = `https://github.com/Pumpkin-MC/Pumpkin/releases/download/${encoded}/${p.assetName}`;
  const mirrorUrl = `https://ghfast.top/${directUrl}`;

  let targetUrl = directUrl;
  let resolvedVer = tag;

  try {
    const res = await json(`https://api.github.com/repos/Pumpkin-MC/Pumpkin/releases/tags/${encoded}`);
    const match = (res?.assets || []).find(it => it.name.toLowerCase() === p.assetName.toLowerCase());
    if (match?.browser_download_url) {
      targetUrl = match.browser_download_url;
      resolvedVer = res.tag_name || tag;
    }
  } catch {}

  return {
    url: targetUrl,
    urls: [targetUrl, mirrorUrl],
    name: p.binaryName,
    version: resolvedVer,
    sha256: null,
  };
}

function listVersions() {
  return ['0.2.1', 'nightly', 'canary'];
}

module.exports = {
  resolve,
  listVersions,
  getPumpkinPlatform,
  PUMPKIN_DEFAULT_TAG,
};
