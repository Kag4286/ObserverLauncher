const os = require('os');

// 5.2.0: a machine often has MANY IPv4 addresses — the real WiFi/Ethernet one plus virtual adapters
// from VPN clients, containers and hypervisors (Hyper-V, WSL, Docker, VirtualBox, VMware, Tailscale,
// ZeroTier, ...). `os.networkInterfaces()` does NOT order them, so the old code could hand a friend a
// virtual address they cannot reach (e.g. 10.2.0.2 from a VPN adapter shown as "the" LAN address).
// We now RANK physical adapters first and push virtual ones to the end; the first entry is therefore
// the best LAN address. We DEMOTE rather than delete so a machine with only virtual adapters still
// returns something (fallback), and diagnostics can still see every address.
const VIRTUAL_NAME = /(vethernet|hyper-?v|wsl|docker|veth|virtualbox|vbox|vmware|vmnet|tailscale|zerotier|\btap\b|\btun\b|loopback|bluetooth|npcap|radmin|hamachi|openvpn|wireguard|utun|\bppp)/i;
const PHYSICAL_NAME = /(wi-?fi|wireless|wlan|ethernet|\beth\d|\beth\b|en\d|enp|eno|wlp|wlo)/i;

// 0 = physical (best), 1 = unknown, 2 = virtual (worst). Exported for tests.
function interfaceRank(name) {
  const n = String(name || '');
  if (VIRTUAL_NAME.test(n)) return 2;
  if (PHYSICAL_NAME.test(n)) return 0;
  return 1;
}

function localIPv4s() {
  const nets = os.networkInterfaces();
  const entries = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      entries.push({ name, address: net.address, rank: interfaceRank(name) });
    }
  }
  // Stable sort by rank (Array.sort is stable in V8): physical LAN addresses first, virtual last.
  entries.sort((a, b) => a.rank - b.rank);
  return entries.map(e => e.address);
}

module.exports = { localIPv4s, interfaceRank };
