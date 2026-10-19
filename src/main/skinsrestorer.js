// skinsrestorer.js — read player skins from a SkinsRestorer plugin folder (v6.0.0).
//
// WHY: an offline-mode server has no Mojang profile for its players, so the session-server lookup
// always 404s and the inspector fell through to the mirror's Steve. SkinsRestorer stores the skin
// the server actually applied, per player, on disk. Reading it at runtime (the plan's "read files on
// the user's machine" rule) shows the skin players really see.
//
// Storage layout verified by a read-only spike on a real 15.x install:
//   plugins/SkinsRestorer/players/<player-uuid>.player   -> JSON { skinIdentifier: { identifier } }
//   plugins/SkinsRestorer/skins/<skin-uuid>.playerskin   -> JSON { value, signature, timestamp }
// `value` is base64 of a Mojang textures property, the same shape the session server returns:
//   { textures: { SKIN: { url, metadata?: { model: 'slim' } } } }
// Downloading that URL is the SAME legal model as tex:// and the client-jar fallback: nothing is
// bundled, the PNG is fetched to the user's machine and cached there.
//
// Only the FILE backend is supported. MySQL/Postgres storage needs a driver this project does not
// ship; the reader returns a clear error and the caller falls back to Mojang.

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./data-dir.js');
const { writeFileAtomic } = require('./fs-utils.js');

function srDirOf(serverRoot) {
  if (!serverRoot) return null;
  const dir = path.join(serverRoot, 'plugins', 'SkinsRestorer');
  try { return fs.statSync(dir).isDirectory() ? dir : null; } catch { return null; }
}

// The skin UUID assigned to a player. Null when the plugin has no record for that player.
function skinUuidFor(srDir, playerUuid) {
  if (!srDir || !playerUuid) return null;
  const clean = String(playerUuid).replace(/-/g, '').toLowerCase();
  let files;
  try { files = fs.readdirSync(path.join(srDir, 'players')); } catch { return null; }
  const match = files.find(f => {
    if (!/\.player$/i.test(f)) return false;
    const base = f.replace(/\.player$/i, '');
    return base.toLowerCase() === String(playerUuid).toLowerCase() || base.replace(/-/g, '').toLowerCase() === clean;
  });
  if (!match) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(srDir, 'players', match), 'utf8')); } catch { return null; }
  const id = j && j.skinIdentifier && j.skinIdentifier.identifier;
  return id ? String(id) : null;
}

// Decode a .playerskin file into { url, model }. Null when the file is missing or malformed.
function readSkinFile(srDir, skinUuid) {
  if (!srDir || !skinUuid) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(srDir, 'skins', `${skinUuid}.playerskin`), 'utf8')); } catch { return null; }
  if (!j || typeof j.value !== 'string') return null;
  let decoded;
  try { decoded = JSON.parse(Buffer.from(j.value, 'base64').toString('utf8')); } catch { return null; }
  const skin = decoded && decoded.textures && decoded.textures.SKIN;
  if (!skin || !skin.url) return null;
  const model = skin.metadata && skin.metadata.model === 'slim' ? 'slim' : 'classic';
  return { url: skin.url, model, skinUuid };
}

// Download and cache the texture under dataDir/textures/skins/sr/<player>.png. Returns a data URI
// or null. Cached on disk because the same player is opened repeatedly and the URL never changes.
async function downloadAndCache(url, playerUuid) {
  const safeUuid = String(playerUuid || '').replace(/[^a-zA-Z0-9-]/g, '') || 'unknown';
  const dir = path.join(dataDir(), 'textures', 'skins', 'sr');
  const file = path.join(dir, `${safeUuid}.png`);
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    if (buf.length > 100) return 'data:image/png;base64,' + buf.toString('base64');
  }
  let r;
  try { r = await fetch(url); } catch { return null; }
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 100) return null;
  try { fs.mkdirSync(dir, { recursive: true }); writeFileAtomic(file, buf); } catch { /* cache best-effort */ }
  return 'data:image/png;base64,' + buf.toString('base64');
}

// Main entry: resolve a player's skin through SkinsRestorer.
// Returns { ok:true, dataUri, model, source:'skinsrestorer' } or { ok:false, error }.
async function getSkinFromSkinsRestorer(serverRoot, playerUuid) {
  const srDir = srDirOf(serverRoot);
  if (!srDir) return { ok: false, error: 'SkinsRestorer is not installed on this server.' };
  const skinUuid = skinUuidFor(srDir, playerUuid);
  if (!skinUuid) return { ok: false, error: 'This player has no SkinsRestorer skin.' };
  const info = readSkinFile(srDir, skinUuid);
  if (!info) return { ok: false, error: 'The SkinsRestorer skin file is missing or malformed.' };
  const dataUri = await downloadAndCache(info.url, playerUuid);
  if (!dataUri) return { ok: false, error: 'Could not download the SkinsRestorer texture.' };
  return { ok: true, dataUri, model: info.model, source: 'skinsrestorer' };
}

module.exports = { srDirOf, skinUuidFor, readSkinFile, getSkinFromSkinsRestorer };
