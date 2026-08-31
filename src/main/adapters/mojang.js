// Hard-sync Java requirements straight from Mojang's version manifest.
// Every entry in version_manifest_v2 points at a version JSON that carries an authoritative
// `javaVersion.majorVersion` (e.g. 26.1/26.2 → 25, 1.21.x → 21). This is the ground truth the
// wizard displays instead of relying only on the static version→Java mapping.
// The manifest itself is cached for 5 minutes — it is large and version lookups can burst.
const { json } = require('../http.js');

let manifestCache = null, manifestAt = 0;
const MANIFEST_TTL = 5 * 60 * 1000;

async function manifest() {
  const now = Date.now();
  if (!manifestCache || now - manifestAt > MANIFEST_TTL) {
    manifestCache = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    manifestAt = now;
  }
  return manifestCache;
}

// Returns the exact required Java major for a Minecraft version id, or null when unknown.
async function javaVersionFor(mcId) {
  const id = String(mcId || '').trim();
  if (!id) return null;
  const m = await manifest();
  const entry = m.versions.find(v => v.id === id);
  if (!entry) return null;
  const meta = await json(entry.url);
  const jv = meta && meta.javaVersion && meta.javaVersion.majorVersion;
  return Number.isFinite(jv) ? Number(jv) : null;
}

module.exports = { javaVersionFor };
