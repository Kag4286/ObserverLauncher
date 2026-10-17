// src/main/pinggy.js — Pinggy tunnel adapter (v6.0.0, A2). Pinggy carries UDP, which the free
// Playit plan cannot, so a Bedrock (Geyser) UDP tunnel needs it.
//
// MEASURED in SP1 (docs/v6.0.0-sp1.md), not guessed:
//   echo test| ssh -p 443 -T -R0:localhost:25599 tcp@free.pinggy.io
//   -> tcp://tsdcx-103-216-221-97.run.pinggy-free.link:39069
//   echo test| ssh -p 443 -T -R0:localhost:25599 udp@free.pinggy.io
//   -> udp://toqpo-103-216-221-97.run.pinggy-free.link:41140
// The free tier is ANONYMOUS: any password works, there is no token or account. The password
// prompt is satisfied by piping one dummy line to stdin (a real terminal cannot be relied on:
// cmd.exe hangs on the ssh password prompt, which is why the pipe is mandatory, not cosmetic).
// The free tunnel expires after 60 minutes; the process runs in the foreground until then.
//
// Pure helpers (findSshBinary, buildPinggyArgs, parsePinggyAddress) are unit-tested; the spawn
// wrapper is thin so it can be exercised with a fake child in tests.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PINGGY_FREE_HOST = 'free.pinggy.io';
const PINGGY_SSH_PORT = 443;
// The dummy password line. Pinggy's anonymous free tier accepts any string; we send a constant so
// the behaviour is obvious in a log and never depends on user input.
const DUMMY_PASSWORD = 'observerlauncher';

// Locate an SSH client. Settings override wins (users may point at a custom build), then the
// Windows OpenSSH path, then PATH. Mirrors findPlayitBinary in tunnel.js. Returns null if none.
function findSshBinary() {
  let stored = '';
  try { stored = require('./settings.js').loadSettings().pinggyPath || ''; } catch {}
  stored = String(stored).trim().replace(/^["']+|["']+$/g, '');
  if (stored && fs.existsSync(stored)) return stored;
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe'),
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'OpenSSH', 'ssh.exe'),
    ];
    for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  }
  // PATH lookup. On Windows, scan PATH entries for ssh.exe directly (avoids a `where` spawn).
  const exeNames = process.platform === 'win32' ? ['ssh.exe'] : ['ssh'];
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of exeNames) {
      const p = path.join(dir, name);
      try { if (fs.existsSync(p)) return p; } catch {}
    }
  }
  return null;
}

// Build the ssh argv for a Pinggy free tunnel. `proto` is 'tcp' or 'udp'. Pure so tests pin the
// exact flags. The stdin pipe (dummy password) is handled by the caller, not here.
function buildPinggyArgs(localPort, proto) {
  const p = Number(localPort);
  if (!Number.isFinite(p) || p < 1 || p > 65535) throw new Error('Invalid local port for a Pinggy tunnel.');
  const kind = String(proto || '').toLowerCase();
  if (kind !== 'tcp' && kind !== 'udp') throw new Error('Pinggy proto must be tcp or udp.');
  return [
    '-p', String(PINGGY_SSH_PORT),
    '-o', 'StrictHostKeyChecking=accept-new',  // trust a new host once; refuse a CHANGED key
    // NO BatchMode: the free tier authenticates with a PASSWORD (any string). BatchMode=yes disables
    // password auth entirely, so ssh fails with 'Permission denied' before the dummy stdin line is
    // read. The password prompt is satisfied by piping DUMMY_PASSWORD to stdin (see spawnPinggy).
    '-o', 'ServerAliveInterval=30',            // detect a dead link within ~90s
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',          // exit if the remote forward is refused
    '-T',                                      // no pseudo-terminal
    `-R0:localhost:${p}`,                      // 0 = let Pinggy allocate the public port
    `${kind}@${PINGGY_FREE_HOST}`,
  ];
}

// Parse a Pinggy public-address line. Accepts `tcp://host:port` / `udp://host:port` anywhere in a
// line (the banner has other text). Returns { proto, host, port } or null. Pure.
const ADDR_RE = /\b(tcp|udp):\/\/([\w.-]+):(\d{1,5})\b/i;
function parsePinggyAddress(line) {
  const m = String(line || '').match(ADDR_RE);
  if (!m) return null;
  const port = Number(m[3]);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { proto: m[1].toLowerCase(), host: m[2], port };
}

// Is the process's stdout line one of the informational banners we recognise (so the parser can
// skip it instead of mistaking `Allocated port 3 ...` for an address)? Pure.
function isPinggyBanner(line) {
  return /Allocated port|You are not authenticated|tunnel will expire|Upgrade to Pinggy/i.test(String(line || ''));
}

// Start a Pinggy tunnel. Returns { ok, child, addressPromise } where addressPromise resolves to
// { ok, address:{proto,host,port}, raw } or { ok:false, error } after ADDRESS_TIMEOUT. The caller
// owns the child and must call stopPinggy when done. This wrapper does NOT touch ctx (testable);
// the tunnel-manager wiring passes a spawnFn for tests.
const ADDRESS_TIMEOUT = 25000;
// Windows OpenSSH reads the password from a CONSOLE handle, not stdin, so piping it does nothing
// when the app spawns ssh without a console (measured: ssh reaches 'Next authentication method:
// password' then hangs). The standard non-interactive fix is an SSH_ASKPASS helper: a tiny script
// that prints the password, used when SSH_ASKPASS_REQUIRE=force. Write it once into the data dir.
let _askpassPath = null;
function ensureAskpassHelper() {
  if (_askpassPath) return _askpassPath;
  const fs = require('fs');
  const path = require('path');
  let dir;
  try { dir = require('./data-dir.js').dataDir(); } catch { dir = require('os').tmpdir(); }
  const isWin = process.platform === 'win32';
  const file = path.join(dir, isWin ? 'pinggy-askpass.bat' : 'pinggy-askpass.sh');
  const body = isWin
    ? `@echo off\r\necho ${DUMMY_PASSWORD}\r\n`
    : `#!/bin/sh\necho ${DUMMY_PASSWORD}\n`;
  try { fs.mkdirSync(dir, { recursive: true }); require('./fs-utils.js').writeFileAtomic(file, body); if (!isWin) fs.chmodSync(file, 0o700); } catch {}
  _askpassPath = file;
  return file;
}

function spawnPinggy({ sshBinary, localPort, proto, spawnFn }) {
  const doSpawn = spawnFn || spawn;
  const args = buildPinggyArgs(localPort, proto);
  // SSH_ASKPASS answers the password prompt without a console. SSH_ASKPASS_REQUIRE=force makes ssh
  // use it even though stdin is a pipe. DISPLAY is set only because some builds check it first.
  const askpass = ensureAskpassHelper();
  const env = { ...process.env, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force' };
  if (!env.DISPLAY) env.DISPLAY = ':0';
  let child;
  try {
    child = doSpawn(sshBinary || 'ssh', args, { windowsHide: true, env });
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not start the Pinggy tunnel.' };
  }
  const addressPromise = new Promise(resolve => {
    let settled = false;
    let raw = '';
    const finish = res => { if (settled) return; settled = true; clearTimeout(timer); resolve(res); };
    const timer = setTimeout(() => finish({ ok: false, error: 'Pinggy did not return an address in time.' }), ADDRESS_TIMEOUT);
    const onLine = line => {
      raw += line + '\n';
      if (isPinggyBanner(line)) return;             // recognised noise, keep waiting
      const addr = parsePinggyAddress(line);
      if (addr) finish({ ok: true, address: addr, raw });
    };
    const wire = stream => {
      if (!stream || typeof stream.on !== 'function') return;
      let buf = '';
      stream.on('data', d => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
      });
    };
    wire(child.stdout);
    wire(child.stderr);
    if (child.on) child.on('error', e => finish({ ok: false, error: e?.message || 'Pinggy process error.' }));
    if (child.on) child.on('exit', code => finish({ ok: false, error: `Pinggy exited (${code}) before an address.` }));
    // Pipe the dummy password so ssh's prompt is satisfied without a terminal. Close stdin after
    // so ssh does not wait for more input.
    try { if (child.stdin && child.stdin.writable) { child.stdin.write(DUMMY_PASSWORD + '\n'); child.stdin.end(); } } catch {}
  });
  return { ok: true, child, addressPromise };
}

module.exports = {
  PINGGY_FREE_HOST, PINGGY_SSH_PORT, DUMMY_PASSWORD, ADDRESS_TIMEOUT,
  findSshBinary, buildPinggyArgs, parsePinggyAddress, isPinggyBanner, spawnPinggy,
};
