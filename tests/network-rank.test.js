// 5.2.0: localIPv4s() must rank PHYSICAL adapters before virtual ones so a friend is never handed
// an unreachable VPN/container address (the 10.2.0.2 bug). Demote, never delete (fallback).
const { interfaceRank } = require('../src/main/network.js');
let pass = 0, fail = 0;
const check = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// physical -> 0
['Wi-Fi', 'WiFi', 'Wireless LAN adapter', 'Ethernet', 'eth0', 'en0', 'enp3s0', 'wlp2s0'].forEach(n => check('physical: ' + n, interfaceRank(n) === 0));
// virtual -> 2
['vEthernet (WSL)', 'Hyper-V Virtual Ethernet', 'Docker0', 'veth1a2b', 'VirtualBox Host-Only', 'VMware Network Adapter VMnet1', 'Tailscale', 'ZeroTier One', 'OpenVPN TAP', 'WireGuard Tunnel', 'utun3', 'Hamachi'].forEach(n => check('virtual: ' + n, interfaceRank(n) === 2));
// unknown -> 1
['SomeRandom0', 'bond0', ''].forEach(n => check('unknown: ' + JSON.stringify(n), interfaceRank(n) === 1));

// localIPv4s returns a (possibly empty) array of strings and never throws
const { localIPv4s } = require('../src/main/network.js');
const ips = localIPv4s();
check('localIPv4s returns array', Array.isArray(ips));
check('localIPv4s entries are strings', ips.every(x => typeof x === 'string'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
