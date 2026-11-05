// src/main/adapters/pumpkin.js — Adapter for Pumpkin Minecraft Server in Rust
const { json } = require('../http.js');

const PUMPKIN_DEFAULT_TAG = '0.2.1+26.3-26.51';

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
  const tag = (version && version !== 'latest') ? version : PUMPKIN_DEFAULT_TAG;
  let targetUrl = `https://github.com/Pumpkin-MC/Pumpkin/releases/download/${encodeURIComponent(tag)}/${p.assetName}`;
  let tagFound = tag;

  try {
    const res = await json('https://api.github.com/repos/Pumpkin-MC/Pumpkin/releases/latest');
    const directMatch = (res?.assets || []).find(it => it.name === p.assetName);
    if (directMatch?.browser_download_url) {
      targetUrl = directMatch.browser_download_url;
      tagFound = res.tag_name || tag;
    }
  } catch {}

  return {
    url: targetUrl,
    name: p.binaryName,
    version: tagFound,
    sha256: null,
  };
}

function listVersions() {
  return ['latest', '0.2.1'];
}

module.exports = {
  resolve,
  listVersions,
  getPumpkinPlatform,
  PUMPKIN_DEFAULT_TAG,
};
