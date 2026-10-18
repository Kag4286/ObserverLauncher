// proxy-config.js — read and write the backend server list in a Velocity proxy's config (v6.0.0 E1).
//
// WHY: a proxy (Velocity/BungeeCord) connects players to backend servers. The backend list lives in
// `velocity.toml` under [servers], and the order players fall back on lives under `try`. Editing it by
// hand is error-prone (TOML, quotes, lists) and easy to break. This module provides a small line-based
// parser/writer so the GUI can add a backend instance in one click without destroying the rest of the
// file (comments, other sections, etc).
//
// SAFETY: line-level edit only (never re-serialize the whole TOML). A datapack/geyser write already
// proved this is the only way to preserve the user's own comments and spacing.
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./fs-utils.js');

const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

// PURE: parse the [servers] block and the try list from a velocity.toml string.
// Returns { servers: { name: 'ip:port' }, try: ['name'] }. Safe on malformed/missing sections.
function parseVelocityServers(toml) {
  const servers = {};
  const tryList = [];
  let inServers = false;
  let inTry = false;
  for (const line of String(toml || '').split(/\r?\n/)) {
    const t = line.trim();
    if (t === '[servers]') { inServers = true; inTry = false; continue; }
    if (t.startsWith('[') && t !== '[servers]') { inServers = false; inTry = false; continue; }
    if (inServers && t.startsWith('try = [')) {
      // A one-line try array: try = ["lobby", "survival"]
      const oneLine = t.match(/^try\s*=\s*\[(.*)\]$/);
      if (oneLine) {
        const items = oneLine[1].match(/"([^"]+)"/g) || [];
        tryList.push(...items.map(x => x.replace(/"/g, '')));
        continue;
      }
      inTry = true;
      continue;
    }
    if (inTry) {
      if (t === ']') { inTry = false; continue; }
      const m = t.match(/^"([^"]+)"\s*,?$/);
      if (m) tryList.push(m[1]);
      continue;
    }
    if (inServers) {
      const m = t.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"$/);
      if (m) servers[m[1]] = m[2];
    }
  }
  return { servers, try: tryList };
}

// PURE: insert a new server into the [servers] block, preserving the file's style. Returns the new
// text. Refuses an invalid name (letters/digits/_/- only) or address (must contain ':').
function addVelocityServer(toml, name, address) {
  const raw = String(toml || '');
  const n = String(name || '').trim();
  const a = String(address || '').trim();
  if (!NAME_RE.test(n)) return { ok: false, error: 'Server name must be letters, numbers, _ or -.' };
  if (!a.includes(':') || /[\s"'`]/.test(a)) return { ok: false, error: 'Address must be ip:port (no spaces).' };
  const { servers } = parseVelocityServers(raw);
  if (servers[n]) return { ok: false, error: `A server named "${n}" already exists.` };

  const lines = raw.split(/\r?\n/);
  let insertAt = -1;
  let inServers = false;
  let lastServerLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '[servers]') { inServers = true; insertAt = i + 1; continue; }
    if (t.startsWith('[') && t !== '[servers]') {
      if (inServers) { insertAt = i; inServers = false; }
      continue;
    }
    if (inServers && /^[a-zA-Z0-9_-]+\s*=\s*"/.test(t)) {
      lastServerLine = i;
      insertAt = i + 1;
    }
  }

  if (insertAt < 0) {
    // No [servers] block at all: append one.
    lines.push('', '[servers]', `${n} = "${a}"`);
    return { ok: true, text: lines.join('\n') };
  }

  // Insert after the last server line, or right after the [servers] header when it is empty.
  const newLine = `${n} = "${a}"`;
  lines.splice(insertAt, 0, newLine);
  return { ok: true, text: lines.join('\n') };
}

// PURE: remove a server from [servers] and its entry from `try`. Returns the new text.
function removeVelocityServer(toml, name) {
  const n = String(name || '');
  if (!NAME_RE.test(n)) return { ok: false, error: 'Invalid server name.' };
  const lines = String(toml || '').split(/\r?\n/);
  let inServers = false;
  let inTry = false;
  let removed = false;
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t === '[servers]') { inServers = true; inTry = false; out.push(line); continue; }
    if (t.startsWith('[') && t !== '[servers]') { inServers = false; inTry = false; out.push(line); continue; }
    if (inServers && t.startsWith('try = [')) {
      if (t.includes(']')) {
        // One-line try array: filter in place.
        const filtered = t.replace(/"([^"]+)"/g, (match, inner) => inner === n ? '' : match).replace(/,\s*,/g, ',').replace(/\[\s*,/, '[').replace(/,\s*\]/, ']');
        out.push(filtered);
      } else {
        inTry = true;
        out.push(line);
      }
      continue;
    }
    if (inTry) {
      if (t === ']') { inTry = false; out.push(line); continue; }
      const m = t.match(/^"([^"]+)"\s*,?$/);
      if (m && m[1] === n) continue; // drop this try line
      out.push(line); continue;
    }
    if (inServers) {
      const m = t.match(/^([a-zA-Z0-9_-]+)\s*=\s*"/);
      if (m && m[1] === n) { removed = true; continue; }
    }
    out.push(line);
  }
  return { ok: true, text: out.join('\n'), removed };
}

// IO: read velocity.toml from the server root. Returns { ok, text } or { ok: false, error }.
function readProxyConfig(root) {
  const p = path.join(root, 'velocity.toml');
  try { return { ok: true, text: fs.readFileSync(p, 'utf8') }; }
  catch { return { ok: false, error: 'No velocity.toml found. Start the proxy once to generate it.' }; }
}

// IO: back up velocity.toml then write the new text. Returns { ok, backup } or { ok: false, error }.
function writeProxyConfig(root, newText) {
  const p = path.join(root, 'velocity.toml');
  try {
    if (fs.existsSync(p)) {
      const backup = `${p}.bak-${Date.now()}`;
      fs.copyFileSync(p, backup);
      writeFileAtomic(p, newText);
      return { ok: true, backup };
    }
    writeFileAtomic(p, newText);
    return { ok: true, backup: null };
  } catch (e) { return { ok: false, error: e?.message || 'Could not write velocity.toml.' }; }
}

module.exports = { NAME_RE, parseVelocityServers, addVelocityServer, removeVelocityServer, readProxyConfig, writeProxyConfig };
