const os = require('os');

let impl;
if (process.platform === 'win32') {
  impl = require('./win32');
} else {
  // linux, darwin, freebsd — use linux-like impl (procfs / ps / tar)
  impl = require('./linux');
}

// B5: total system RAM in MB for the multi-instance RAM budget. os.totalmem() is already
// cross-platform, so a single implementation here is enough (no per-OS override needed).
function getTotalMemoryMB() {
  try { return Math.round(require('os').totalmem() / (1024 * 1024)); } catch { return 0; }
}

module.exports = {
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
  isMac: process.platform === 'darwin',
  getTotalMemoryMB,
  ...impl,
};
