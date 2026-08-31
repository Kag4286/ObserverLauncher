const os = require('os');

let impl;
if (process.platform === 'win32') {
  impl = require('./win32');
} else {
  // linux, darwin, freebsd — use linux-like impl (procfs / ps / tar)
  impl = require('./linux');
}

module.exports = {
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
  isMac: process.platform === 'darwin',
  ...impl,
};
