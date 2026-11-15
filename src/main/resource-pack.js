// src/main/resource-pack.js — Custom Resource Pack reader for player models & item textures (v7.0.0Z).
// Reads textures on demand directly from a user-supplied resource pack .zip using jar-reader.
// No Mojang assets are bundled in this launcher.
const fs = require('fs');
const path = require('path');
const { openJar } = require('./jar-reader.js');
const { normalizeFormat } = require('./datapack.js');
const {
  parseEquipmentAssetJson,
  resolveItemDefinitionModels,
  resolveTexturesFromModelJson,
  candidateModelEntries,
} = require('./mods-index.js');

const JAR_CACHE = new Map();

function getJar(zipPath) {
  if (!zipPath || typeof zipPath !== 'string') return null;
  const hit = JAR_CACHE.get(zipPath);
  if (hit) return hit;
  try {
    if (!fs.existsSync(zipPath)) return null;
    const jar = openJar(zipPath);
    // Build a lowercase index for case-insensitive matching
    const index = new Map();
    for (const key of jar.list()) {
      index.set(key.toLowerCase(), key);
    }
    const wrap = { jar, index };
    JAR_CACHE.set(zipPath, wrap);
    if (JAR_CACHE.size > 8) JAR_CACHE.delete(JAR_CACHE.keys().next().value);
    return wrap;
  } catch {
    return null;
  }
}

function clearPackCache() {
  JAR_CACHE.clear();
}

function inspectResourcePack(zipPath) {
  if (!zipPath || typeof zipPath !== 'string') return { ok: false, error: 'No file path provided.' };
  if (!fs.existsSync(zipPath)) return { ok: false, error: 'Resource pack file not found.' };
  try {
    const handle = getJar(zipPath);
    if (!handle) return { ok: false, error: 'Could not parse ZIP file.' };
    let description = '';
    let packFormat = null;
    const mcmetaKey = handle.index.get('pack.mcmeta');
    if (mcmetaKey) {
      try {
        const raw = handle.jar.read(mcmetaKey).toString('utf8');
        const parsed = JSON.parse(raw);
        if (parsed.pack) {
          description = parsed.pack.description || '';
          if (typeof description === 'object') {
            description = description.text || JSON.stringify(description);
          }
          packFormat = normalizeFormat(parsed.pack.pack_format ?? parsed.pack.min_format ?? null);
        }
      } catch {}
    }
    const hasIcon = handle.index.has('pack.png');
    return {
      ok: true,
      path: zipPath,
      name: path.basename(zipPath),
      description: String(description || ''),
      packFormat,
      hasIcon,
    };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to inspect resource pack.' };
  }
}

function getCandidates(kind, file) {
  const f = String(file || '').toLowerCase();
  const base = f.replace(/\.png$/, '');
  if (kind === 'pack' && (f === 'icon.png' || f === 'pack.png')) {
    return ['pack.png'];
  }
  if (kind === 'item') {
    return [
      `assets/minecraft/textures/item/${f}`,
      `assets/minecraft/textures/items/${f}`,
      `assets/minecraft/textures/block/${f}`,
      `assets/minecraft/textures/blocks/${f}`,
    ];
  }
  if (kind === 'block') {
    return [
      `assets/minecraft/textures/block/${f}`,
      `assets/minecraft/textures/blocks/${f}`,
    ];
  }
  if (kind === 'armor') {
    return [
      `assets/minecraft/textures/models/armor/${base}_layer_1.png`,
      `assets/minecraft/textures/entity/equipment/humanoid/${f}`,
    ];
  }
  if (kind === 'armorlegs') {
    return [
      `assets/minecraft/textures/models/armor/${base}_layer_2.png`,
      `assets/minecraft/textures/entity/equipment/humanoid_leggings/${f}`,
    ];
  }
  return [];
}

function readEntryCaseInsensitive(handle, relPath) {
  const realKey = handle.index.get(String(relPath || '').toLowerCase());
  if (!realKey) return null;
  try { return handle.jar.read(realKey); } catch { return null; }
}

function readPackTexture(zipPath, kind, file) {
  const handle = getJar(zipPath);
  if (!handle) return null;
  const cands = getCandidates(kind, file);
  for (const c of cands) {
    const buf = readEntryCaseInsensitive(handle, c);
    if (buf) return buf;
  }
  const base = String(file || '').toLowerCase().replace(/\.png$/, '');
  if (kind === 'armor' || kind === 'armorlegs') {
    const eqBuf = readEntryCaseInsensitive(handle, `assets/minecraft/equipment/${base}.json`);
    if (eqBuf) {
      const eq = parseEquipmentAssetJson(eqBuf.toString('utf8'), 'minecraft');
      const eqList = eq ? (kind === 'armorlegs' ? eq.humanoid_leggings : eq.humanoid) : [];
      for (const ep of eqList) {
        const hit = readEntryCaseInsensitive(handle, ep);
        if (hit) return hit;
      }
    }
  } else if (kind === 'item' || kind === 'block') {
    let modelEntries = [];
    const defBuf = readEntryCaseInsensitive(handle, `assets/minecraft/items/${base}.json`);
    if (defBuf) {
      const def = resolveItemDefinitionModels(defBuf.toString('utf8'), 'minecraft');
      if (def && def.modelEntries.length) modelEntries = def.modelEntries;
    }
    if (!modelEntries.length) modelEntries = candidateModelEntries('minecraft', base);
    for (const me of modelEntries) {
      const mBuf = readEntryCaseInsensitive(handle, me);
      if (!mBuf) continue;
      const texPaths = resolveTexturesFromModelJson(mBuf.toString('utf8'), 'minecraft');
      for (const tp of texPaths) {
        const hit = readEntryCaseInsensitive(handle, tp);
        if (hit) return hit;
      }
    }
  }
  return null;
}

module.exports = {
  inspectResourcePack,
  readPackTexture,
  clearPackCache,
};

