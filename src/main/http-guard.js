// http-guard.js — the two shared HTTP guards that every loopback server in this app runs first
// (v6.0.0 F4: extracted so remote.js and prometheus.js cannot drift; the no-dup test enforces it).
//
// WHY: both servers reject browser-shaped cross-origin requests (localhost CSRF / DNS rebinding)
// and both must confine to loopback. The rules are identical; only the Host allowlist differs
// (remote.js supports a wildcard bind, prometheus.js stays loopback). Extracting the two common
// guards keeps the security posture in one place and lets each server own only its Host rule.
const { hostFromHeader } = require('./validate.js');

// True when the request's Origin header (if present) is either absent or same-origin as the Host.
// A cross-origin browser Origin -> false; the caller answers 403. No response is written here so a
// caller can log or vary the body, but every existing caller answers 403 'forbidden'.
function originOk(req) {
  const origin = req.headers['origin'];
  if (!origin) return true;
  try { return new URL(origin).host === String(req.headers['host'] || ''); } catch { return false; }
}

// True when the socket's peer address is a real loopback (::1, ::ffff:127.0.0.1, or empty when the
// socket is not ready). Any other address -> false.
function ipIsLoopback(req) {
  const ip = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip === '';
}

module.exports = { originOk, ipIsLoopback, hostFromHeader };
