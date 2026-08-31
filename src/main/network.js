const os = require('os');

function localIPv4s() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) for (const net of nets[name] || []) if (net.family === 'IPv4' && !net.internal) out.push(net.address);
  return out;
}
module.exports = { localIPv4s };
