// skins.js — resolve and cache Minecraft player skins (v6.0.0 Track B1).
//
// WHY: The Player Inspector needs the 2D skin texture to render the 3D model. A user's
// UUID is usually available from the server's usercache.json (or a .dat file), but the
// actual PNG lives on Mojang's servers. This module resolves the UUID to the skin URL,
// downloads it, and caches it locally so we only fetch once.

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./data-dir.js');
const { writeFileAtomic } = require('./fs-utils.js');
const { loadDefaultPlayerTextures } = require('./client-skins.js');

// PURE: parse the Base64 textures property from a Mojang session profile.
// Returns the raw skin URL, or null.
function parseSkinUrl(profileJson) {
  try {
    const prop = (profileJson.properties || []).find(p => p.name === 'textures');
    if (!prop) return null;
    const decoded = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
    return decoded.textures?.SKIN?.url || null;
  } catch { return null; }
}

// PURE: detect a version-3 UUID (offline-mode, name-derived). These never exist on Mojang.
// The 13th hex digit is the version; a 3 means name-based MD5, which is how an offline server
// derives a UUID from the player name.
function isOfflineUuid(input) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input || ''));
}

// Resolve a username or UUID to a Mojang profile.
// If given a 32-char hex string (with or without dashes), treat it as a UUID.
// Otherwise, fetch the UUID from the username first.
async function fetchMojangProfile(input) {
  if (isOfflineUuid(input)) {
    throw new Error('Offline-mode UUID (version 3): no Mojang skin.');
  }
  const isUuid = /^[0-9a-f]{32}$/i.test(String(input).replace(/-/g, ''));
  let uuid = input;
  
  if (!isUuid) {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(input)}`);
    if (res.status === 404) throw new Error(`Player "${input}" not found on Mojang.`);
    if (!res.ok) throw new Error(`Mojang API error: ${res.status}`);
    const data = await res.json();
    uuid = data.id;
  }

  const cleanUuid = String(uuid).replace(/-/g, '');
  const profRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${cleanUuid}`);
  if (profRes.status === 204 || profRes.status === 404) {
    throw new Error('Player has no Mojang skin (likely an offline-mode server).');
  }
  if (!profRes.ok) throw new Error(`Session server error: ${profRes.status}`);
  const text = await profRes.text();
  if (!text) throw new Error('Player has no Mojang skin (empty response).');
  return JSON.parse(text);
}

// Main entry: get the local path to a player's skin PNG.
// Returns { ok: true, file: '/path/to/skin.png', uuid, model: 'classic'|'slim' } or { ok: false, error }.
async function getSkin(input) {
  try {
    const profile = await fetchMojangProfile(input);
    const uuid = profile.id;
    const skinUrl = parseSkinUrl(profile);
    if (!skinUrl) throw new Error('This player has no custom skin (using default).');

    const cacheDir = path.join(dataDir(), 'textures', 'skins');
    const cacheFile = path.join(cacheDir, `${uuid}.png`);
    
    // We also need to know if the model is slim (Alex) or classic (Steve).
    // Mojang stores this in the metadata of the textures property.
    let model = 'classic';
    try {
      const prop = profile.properties.find(p => p.name === 'textures');
      const decoded = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
      if (decoded.textures?.SKIN?.metadata?.model === 'slim') model = 'slim';
    } catch {}

    let buf;
    if (fs.existsSync(cacheFile)) {
      buf = fs.readFileSync(cacheFile);
    } else {
      // Download and cache
      fs.mkdirSync(cacheDir, { recursive: true });
      const imgRes = await fetch(skinUrl);
      if (!imgRes.ok) throw new Error(`Skin download failed: ${imgRes.status}`);
      buf = Buffer.from(await imgRes.arrayBuffer());
      writeFileAtomic(cacheFile, buf);
    }

    // Renderer cần dataUri để nạp thẳng vào WebGL Texture mà không bị CSP file:// chặn.
    const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
    return { ok: true, file: cacheFile, dataUri, uuid, model };
  } catch (e) {
    // Legal-safe fallback: read Steve/Alex from the user's OWN client jar (never bundled). Offline
    // UUIDs and transient fetch failures both land here, so the renderer can still show a real
    // Minecraft face instead of a flat placeholder. When no client is installed, the original
    // error is returned and the renderer falls back to its initials avatar.
    try {
      const defaults = loadDefaultPlayerTextures();
      if (defaults && (defaults.wide || defaults.slim)) {
        const useSlim = !defaults.wide && defaults.slim;
        return {
          ok: true,
          dataUri: useSlim ? defaults.slim : defaults.wide,
          model: useSlim ? 'slim' : 'classic',
          fallback: true,
          error: e.message,
        };
      }
    } catch { /* fall through to the original error */ }
    return { ok: false, error: e.message };
  }
}

module.exports = { parseSkinUrl, getSkin, isOfflineUuid };
