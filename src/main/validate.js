// Shared input validators for IPC handlers (defense in depth).
//
// Every value here arrives from the renderer (or a remote API) and must be
// treated as untrusted — even though settings-handlers.js already validates
// some of them, the lower layers (platform/*, players, backups) re-validate
// so a forgotten check at one call site can't become an injection.
const path = require('path');

function isValidPort(port) {
  const p = Number(port);
  return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : null;
}

// Java-edition usernames: 3-16 chars, alphanumerics + underscore.
// Rejects newlines/spaces/semicolons so `whitelist add ${name}` / `ban` /
// `op` / `kick` can never smuggle a second console command via stdin.
function isSafePlayerName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(name);
}

// Ban reasons are free text shown in banned-players.json and appended to the
// `ban <name> <reason>` console command — allow spaces/punctuation but never
// a line break (which would split into two commands on stdin).
function isSafeReason(reason) {
  if (reason === undefined || reason === null || reason === '') return true;
  return typeof reason === 'string' && reason.length <= 200 && !/[\r\n]/.test(reason);
}

// Console commands come from the Console tab input (single line). A `\n` or
// `\r` inside would be executed as an extra command after the intended one
// (e.g. a crafted player name `Notch\nstop` smuggled through `kick ${name}`).
function isSafeConsoleCommand(cmd) {
  return typeof cmd === 'string' && cmd.trim().length > 0 && cmd.length <= 2000 && !/[\r\n]/.test(cmd);
}

// Backup file names must be plain basenames ending in .zip — no directories,
// no traversal, no absolute paths. Without this, `../world/x.zip` still
// passes safeTarget (it stays inside the server folder) but points OUTSIDE
// observerlauncher-backups, letting restore/delete touch arbitrary zips.
function isSafeBackupName(name) {
  if (typeof name !== 'string' || !name || name.length > 255) return false;
  if (!/\.zip$/i.test(name)) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name === '.' || name === '..') return false;
  if (path.basename(name) !== name) return false;
  return true;
}

// Archive entries (zip/tar) must never escape the destination on restore.
// Rejects absolute paths (C:\..., /etc/...) and any `..` segment.
function isSafeArchiveEntry(entry) {
  if (typeof entry !== 'string' || !entry) return false;
  const e = entry.replace(/\\/g, '/');
  if (!e || e === '/' || e === '.') return false;
  if (path.posix.isAbsolute(e) || /^[A-Za-z]:\//.test(e)) return false;
  if (e.split('/').includes('..')) return false;
  return true;
}

// World folder names passed to zip/tar must be plain relative dir names —
// a name starting with `-` would otherwise be parsed as a CLI flag, and a
// name with `/` or `..` would archive/restore outside the server folder.
function isSafeWorldName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255
    && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..'
    && !name.startsWith('-') && path.basename(name) === name;
}

// SECURITY: download URLs inside a .mrpack come from an untrusted file the user
// opens, and were fetched verbatim — a crafted pack could point at file:// (local
// read) or a private/loopback host (SSRF to the user's router/cloud metadata).
// Only allow http(s) to a public host; reject file:, localhost, and private ranges.
function isSafeDownloadUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === '::1') return false;
  // CurseForge CDN (used for the download URLs its API returns) is a legitimate public host.
  // (The API itself is api.curseforge.com; files live on forgecdn.net.)
  if (host === 'forgecdn.net' || host.endsWith('.forgecdn.net')) return true;
  // IPv4 private / loopback / link-local / CGNAT
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

// SECURITY: player UUIDs from the renderer are joined into a file path
// (<world>/playerdata/<uuid>.dat). A value with `/`, `\` or `..` could point outside the
// world folder, so require a plain UUID (with or without dashes).
function isSafeUuid(uuid) {
  return typeof uuid === 'string' && /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/.test(uuid.trim());
}

// SECURITY: IP bans interpolate the address into a console command (`ban-ip ${ip}`). Accept only
// a plain IPv4/IPv6 (hex, dots, colons) with no spaces/newlines that could smuggle a second command.
function isSafeIp(ip) {
  if (typeof ip !== 'string') return false;
  const s = ip.trim();
  if (!s || s.length > 45) return false;
  // IPv4: 4 dotted octets.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split('.').every(o => Number(o) >= 0 && Number(o) <= 255);
  // IPv6: hex groups + colons (allow ::). No newlines/spaces (already excluded by the class).
  if (/^[0-9a-fA-F:]+$/.test(s) && s.includes(':')) {
    if (!/[0-9a-fA-F]/.test(s)) return false;              // reject ':::' (only colons)
    if ((s.match(/::/g) || []).length > 1) return false;   // at most one '::'
    return true;
  }
  return false;
}

module.exports = {
  isValidPort,
  isSafeIp,
  isSafePlayerName,
  isSafeReason,
  isSafeConsoleCommand,
  isSafeBackupName,
  isSafeArchiveEntry,
  isSafeWorldName,
  isSafeDownloadUrl,
  isSafeUuid,
};
