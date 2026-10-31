// src/main/adapters/horizon.js — Adapter for Horizon Dedicated Server (Rust Native MC 26.3)
const os = require('os');
const { getDefaultHorizonToml } = require('../horizon-config.js');
const { json } = require('../http.js');

const HORIZON_VERSION = '26.3';

function getHorizonPlatform() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    return {
      os: 'windows',
      arch: 'x86_64',
      binaryName: 'horizon-server.exe',
      assetName: 'horizon-windows-x64.zip',
    };
  }
  if (platform === 'darwin') {
    return {
      os: 'macos',
      arch: arch === 'arm64' ? 'arm64' : 'x86_64',
      binaryName: 'horizon-server',
      assetName: 'horizon-macos-arm64.zip',
    };
  }
  return {
    os: 'linux',
    arch: 'x86_64',
    binaryName: 'horizon-server',
    assetName: 'horizon-server-linux-x86_64.tar.gz',
  };
}

async function resolve(version) {
  const plat = getHorizonPlatform();
  const targetVersion = version && version !== 'latest' ? version : HORIZON_VERSION;

  let downloadUrl = `https://github.com/horizon-rust/horizon/releases/download/nightly/${plat.assetName}`;
  let sha256 = null;

  try {
    const rel = await json('https://api.github.com/repos/horizon-rust/horizon/releases/tags/nightly');
    if (rel && Array.isArray(rel.assets)) {
      const match = rel.assets.find(a => a.name === plat.assetName || a.name.includes(plat.os));
      if (match && match.browser_download_url) {
        downloadUrl = match.browser_download_url;
      }
    }
  } catch {}

  return {
    url: downloadUrl,
    name: plat.binaryName,
    archiveName: plat.assetName,
    version: targetVersion,
    platform: plat,
    sha256,
  };
}

function listVersions() {
  return [HORIZON_VERSION, 'nightly'];
}

module.exports = {
  resolve,
  listVersions,
  getHorizonPlatform,
  HORIZON_VERSION,
};
