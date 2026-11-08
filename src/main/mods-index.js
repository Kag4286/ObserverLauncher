// mods-index.js — locate an item texture inside a mod jar (v6.0.0 Track B follow-up).
//
// WHY: the PrismarineJS mirror is vanilla-only, so every mod item's icon 404s and the inventory
// falls back to a text label. The mod jar itself ships the PNG, and the plan explicitly allows
// reading it at runtime. This module indexes the server's mods/ folder lazily and extracts ONE
// texture on demand, so an inventory of 40 mod items does not read 40 jars at once.
//
// Cache strategy: per-session caches keyed off a folder signature (name+size+mtime of every jar).
// A jar handle is opened once and reused; an extracted PNG is kept for the session. When the
// folder changes, both caches are dropped on the next lookup, so a mod update is seen on the next
// render without restarting the app.

const fs = require('fs');
const path = require('path');
const { openJar } = require('./jar-reader.js');

// Helper to validate clean namespace and resource names
function isCleanNamespaceAndName(ns, nm) {
  if (!/^[a-z0-9_.-]+$/.test(ns) || !/^[a-z0-9_./-]+$/.test(nm)) return false;
  return !ns.includes('..') && !nm.split('/').includes('..');
}

function prepareResourceName(namespace, name) {
  const ns = String(namespace || '').toLowerCase();
  const nm = String(name || '').toLowerCase();
  if (!isCleanNamespaceAndName(ns, nm)) return null;
  const segs = nm.split('_');
  const inv = (nm.includes('_') && segs.length === 2) ? `${segs[1]}_${segs[0]}` : null;
  return { ns, nm, inv };
}

function expandAssetPaths(namespace, name, formatFn) {
  const p = prepareResourceName(namespace, name);
  if (!p) return [];
  const list = [formatFn(p.ns, p.nm)];
  if (p.inv) list.push(formatFn(p.ns, p.inv));
  return list.flat();
}

// PURE: a Minecraft mod jar packs items as assets/<ns>/textures/item[s]/<name>.png. Return the
// list of candidate entry paths for a namespace/name pair; some packs nest under `item/`, others
// under `items/`, so try both spellings.
function candidateEntries(namespace, name) {
  return expandAssetPaths(namespace, name, (ns, n) => [
    `assets/${ns}/textures/item/${n}.png`,
    `assets/${ns}/textures/items/${n}.png`,
    `assets/${ns}/textures/block/${n}.png`,
    `assets/${ns}/textures/blocks/${n}.png`,
  ]);
}

// PURE: candidate paths for item/block model JSON descriptors inside mod jars.
function candidateModelEntries(namespace, name) {
  return expandAssetPaths(namespace, name, (ns, n) => [
    `assets/${ns}/models/item/${n}.json`,
    `assets/${ns}/models/block/${n}.json`,
  ]);
}

// PURE: parse a model JSON descriptor to extract the primary texture file path.
// Handles layer0, layer1, texture, all, and other custom variable assignments.
function resolveTextureFromModelJson(jsonText, defaultNs) {
  if (!jsonText) return null;
  let parsed;
  try {
    parsed = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const tex = (parsed.textures && typeof parsed.textures === 'object') ? { ...parsed.textures } : {};
  for (const [k, v] of Object.entries(parsed)) {
    if (/texture$/i.test(k) && typeof v === 'string') tex[k] = v;
  }
  const priorityKeys = ['layer0', 'layer1', 'texture', 'all', 'top', 'front', 'side', 'particle'];
  let ref = null;
  for (const k of priorityKeys) {
    if (typeof tex[k] === 'string' && tex[k].trim()) {
      ref = tex[k].trim();
      break;
    }
  }
  if (!ref) {
    for (const v of Object.values(tex)) {
      if (typeof v === 'string' && v.trim()) {
        ref = v.trim();
        break;
      }
    }
  }
  if (!ref || ref.startsWith('#')) return null;
  ref = ref.replace(/\.png$/i, '');
  let texNs = defaultNs;
  let texPath = ref;
  if (ref.includes(':')) {
    const idx = ref.indexOf(':');
    texNs = ref.slice(0, idx).toLowerCase();
    texPath = ref.slice(idx + 1);
  }
  return `assets/${texNs}/textures/${texPath}.png`;
}

// PURE: candidate paths for armor worn textures inside mod jars.
// Layer 1 is helmet, chestplate, boots; Layer 2 is leggings.
function candidateArmorEntries(namespace, material, layer) {
  const ns = String(namespace || '').toLowerCase();
  const mat = String(material || '').toLowerCase();
  const l = Number(layer) === 2 ? 2 : 1;
  if (!isCleanNamespaceAndName(ns, mat)) return [];
  const dirs = [
    `assets/${ns}/textures/models/armor/`,
    `assets/${ns}/textures/model/armor/`,
    `assets/${ns}/textures/entity/armor/`,
    `assets/${ns}/textures/armor/`,
  ];
  const fileNames = l === 2
    ? [`${mat}_layer_2.png`, `${mat}_legs.png`, `${mat}_leggings.png`, `${mat}_layer2.png`, `${mat}_2.png`]
    : [`${mat}_layer_1.png`, `${mat}.png`, `${mat}_layer1.png`, `${mat}_1.png`];
  const out = [];
  for (const d of dirs) {
    for (const f of fileNames) out.push(d + f);
  }
  out.push(l === 2
    ? `assets/${ns}/textures/entity/equipment/humanoid_leggings/${mat}.png`
    : `assets/${ns}/textures/entity/equipment/humanoid/${mat}.png`);
  return out;
}

// Signature of a mods/ folder that changes when a jar is added/removed/replaced. Pure over the
// directory listing so a bump means "rebuild the index".
function folderSignature(modsDir) {
  let entries;
  try { entries = fs.readdirSync(modsDir, { withFileTypes: true }); } catch { return ''; }
  const parts = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.jar$/i.test(e.name)) continue;
    try {
      const st = fs.statSync(path.join(modsDir, e.name));
      parts.push(`${e.name}:${st.size}:${Math.floor(st.mtimeMs)}`);
    } catch { /* skip unreadable */ }
  }
  parts.sort();
  return parts.join('|');
}

// PURE: parse the namespace from a jar's entry list. A mod jar packs exactly one
// `assets/<ns>/...` tree in most cases, but a jar with several namespaces is not unusual
// (unified jars, libraries bundled by the loader). Return every namespace found, first seen first.
function namespacesIn(entryNames) {
  const seen = new Set();
  for (const n of entryNames) {
    const m = /^assets\/([a-z0-9_.-]+)\//i.exec(n);
    if (m) seen.add(m[1].toLowerCase());
  }
  return [...seen];
}

class ModsIndex {
  constructor() {
    this.modsDir = null;
    this.signature = '';
    this.byNamespace = new Map(); // ns -> [absJarPath]
    this.jarCache = new Map();    // absJarPath -> jar handle (openJar)
    this.extractCache = new Map(); // `${ns}:${name}` -> Buffer
  }

  // Point at a mods folder. Clearing the caches when the path differs keeps a multi-instance
  // session from serving instance A's item with instance B's folder.
  setModsDir(dir) {
    const d = dir || null;
    if (d === this.modsDir) return;
    this.modsDir = d;
    this.signature = '';
    this.byNamespace.clear();
    this.jarCache.clear();
    this.extractCache.clear();
  }

  // Rebuild the index when the folder's signature changed. Idempotent within a signature.
  refresh() {
    if (!this.modsDir) return;
    const sig = folderSignature(this.modsDir);
    if (sig === this.signature) return;
    this.signature = sig;
    this.byNamespace.clear();
    this.jarCache.clear();
    this.extractCache.clear();
    let entries;
    try { entries = fs.readdirSync(this.modsDir); } catch { return; }
    for (const name of entries) {
      if (!/\.jar$/i.test(name)) continue;
      const jarPath = path.join(this.modsDir, name);
      let jar;
      try { jar = openJar(jarPath); } catch { continue; }
      let list;
      try { list = jar.list(); } catch { continue; }
      // Cache the jar handle: the search below would otherwise reopen the file per namespace.
      this.jarCache.set(jarPath, jar);
      for (const ns of namespacesIn(list)) {
        if (!this.byNamespace.has(ns)) this.byNamespace.set(ns, []);
        this.byNamespace.get(ns).push(jarPath);
      }
    }
  }

  _getJarsForNamespace(ns) {
    let jars = this.byNamespace.get(ns) || [];
    if (!jars.length) {
      const cleanNs = ns.replace(/[^a-z0-9]/g, '');
      if (this.byNamespace.has(cleanNs)) jars = this.byNamespace.get(cleanNs) || [];
      else if (ns === 'c' || ns === 'forge' || ns === 'common') jars = [...this.jarCache.keys()];
    }
    return jars;
  }

  _findInJars(ns, wanted, cacheKey, fallbackMatcher) {
    const jars = this._getJarsForNamespace(ns);
    if (!wanted.length && !fallbackMatcher) return null;
    for (const jarPath of jars) {
      let jar = this.jarCache.get(jarPath);
      if (!jar) { try { jar = openJar(jarPath); this.jarCache.set(jarPath, jar); } catch { continue; } }
      for (const entry of wanted) {
        try {
          const buf = jar.read(entry);
          this.extractCache.set(cacheKey, buf);
          return buf;
        } catch {}
      }
      if (typeof fallbackMatcher === 'function') {
        try {
          const fallback = jar.list().find(fallbackMatcher);
          if (fallback) {
            const buf = jar.read(fallback);
            this.extractCache.set(cacheKey, buf);
            return buf;
          }
        } catch {}
      }
    }
    return null;
  }

  _findModelTexture(ns, modelCandidates, cacheKey) {
    const jars = this._getJarsForNamespace(ns);
    for (const jarPath of jars) {
      let jar = this.jarCache.get(jarPath);
      if (!jar) { try { jar = openJar(jarPath); this.jarCache.set(jarPath, jar); } catch { continue; } }
      for (const modelEntry of modelCandidates) {
        try {
          const jsonBuf = jar.read(modelEntry);
          if (jsonBuf) {
            let pngTarget = resolveTextureFromModelJson(jsonBuf.toString('utf8'), ns);
            if (!pngTarget) {
              try {
                const parsed = JSON.parse(jsonBuf.toString('utf8'));
                if (parsed && typeof parsed.parent === 'string') {
                  const pNs = parsed.parent.includes(':') ? parsed.parent.split(':')[0].toLowerCase() : ns;
                  const pPath = parsed.parent.replace(/^[^:]+:/, '');
                  const pBuf = jar.read(`assets/${pNs}/models/${pPath}.json`);
                  if (pBuf) pngTarget = resolveTextureFromModelJson(pBuf.toString('utf8'), pNs);
                }
              } catch {}
            }
            if (pngTarget) {
              try {
                const pngBuf = jar.read(pngTarget);
                if (pngBuf) {
                  this.extractCache.set(cacheKey, pngBuf);
                  return pngBuf;
                }
              } catch {}
              const match = pngTarget.match(/^assets\/([a-z0-9_.-]+)\//i);
              const targetNs = match ? match[1].toLowerCase() : ns;
              if (targetNs !== ns) {
                const crossBuf = this._findInJars(targetNs, [pngTarget], cacheKey);
                if (crossBuf) return crossBuf;
              }
            }
          }
        } catch {}
      }
    }
    return null;
  }

  // Extract `assets/<ns>/textures/item[s]/<name>.png` from the first jar that has it.
  readTexture(namespace, name) {
    if (!this.modsDir) return null;
    this.refresh();
    const ns = String(namespace || '').toLowerCase();
    const nm = String(name || '').toLowerCase();
    const cacheKey = `${ns}:${nm}`;
    if (this.extractCache.has(cacheKey)) return this.extractCache.get(cacheKey);
    const isCommonTag = ns === 'c' || ns === 'forge' || ns === 'common';

    // 1. Minecraft standard: model JSON descriptors (assets/<ns>/models/item/<name>.json)
    // define the exact layer0 / texture mapping chosen by the mod author.
    if (!isCommonTag) {
      const modelCandidates = candidateModelEntries(namespace, name);
      const modelBuf = this._findModelTexture(ns, modelCandidates, cacheKey);
      if (modelBuf) return modelBuf;
    }

    // 2. Direct texture entry under textures/item/ or textures/block/
    const wanted = isCommonTag ? [] : candidateEntries(namespace, name);
    const directBuf = this._findInJars(ns, wanted, cacheKey, null);
    if (directBuf) return directBuf;

    // 3. Fallback: match texture filename in subdirectories, but NEVER match entity textures
    // (entity textures are unwrapped 3D mob/vehicle UV skins, not inventory icons).
    const invertedNm = nm.includes('_') ? nm.split('_').reverse().join('_') : '';
    const matcher = e => {
      const lower = e.toLowerCase();
      if (!lower.includes('/textures/') || !lower.endsWith('.png')) return false;
      if (lower.includes('/entity/') || lower.includes('/entities/')) return false;
      if (!isCommonTag && !lower.startsWith(`assets/${ns}/`)) return false;
      const base = path.basename(lower, '.png');
      return base === nm || (invertedNm && base === invertedNm);
    };
    const matchedBuf = this._findInJars(ns, [], cacheKey, matcher);
    if (matchedBuf) return matchedBuf;

    // 4. Entity fallback for specific wearable containers like backpacks
    if (!isCommonTag && (nm.includes('backpack') || nm.includes('bag'))) {
      const entityCandidates = [`assets/${ns}/textures/entity/${nm}.png`, `assets/${ns}/textures/entity/backpack.png`];
      const entityBuf = this._findInJars(ns, entityCandidates, cacheKey);
      if (entityBuf) return entityBuf;
    }
    return null;
  }

  // Extract worn armor texture from the first jar that has it.
  readArmorTexture(namespace, material, layer) {
    if (!this.modsDir) return null;
    this.refresh();
    const ns = String(namespace || '').toLowerCase();
    const mat = String(material || '').toLowerCase();
    const l = Number(layer) === 2 ? 2 : 1;
    const cacheKey = `armor:${ns}:${mat}:${l}`;
    if (this.extractCache.has(cacheKey)) return this.extractCache.get(cacheKey);
    const wanted = candidateArmorEntries(namespace, material, l);
    return this._findInJars(ns, wanted, cacheKey, e => {
      if (!e.startsWith(`assets/${ns}/textures/`) || !e.endsWith('.png')) return false;
      const lower = e.toLowerCase();
      if (!lower.includes(mat)) return false;
      if (l === 2) {
        return lower.includes('layer_2') || lower.includes('_legs') || lower.includes('layer2') || lower.includes('leggings') || lower.includes('_2.png');
      }
      return lower.includes('layer_1') || lower.includes('layer1') || lower.includes('_1.png') || (!lower.includes('layer_2') && !lower.includes('_legs') && !lower.includes('leggings') && !lower.includes('_2.png'));
    });
  }

  // Test seam: namespaces currently indexed (call refresh() first).
  knownNamespaces() {
    return [...this.byNamespace.keys()].sort();
  }
}

const singleton = new ModsIndex();

module.exports = {
  ModsIndex,
  singleton,
  candidateEntries,
  candidateModelEntries,
  resolveTextureFromModelJson,
  candidateArmorEntries,
  folderSignature,
  namespacesIn
};
