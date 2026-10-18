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

// Resolve a username or UUID to a Mojang profile.
// If given a 32-char hex string (with or without dashes), treat it as a UUID.
// Otherwise, fetch the UUID from the username first.
async function fetchMojangProfile(input) {
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
  if (!profRes.ok) throw new Error(`Session server error: ${profRes.status}`);
  return profRes.json();
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
    return { ok: false, error: e.message };
  }
}

module.exports = { parseSkinUrl, getSkin };
