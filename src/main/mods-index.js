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

// PURE: a Minecraft mod jar packs items as assets/<ns>/textures/item[s]/<name>.png. Return the
// list of candidate entry paths for a namespace/name pair; some packs nest under `item/`, others
// under `items/`, so try both spellings.
function candidateEntries(namespace, name) {
  const ns = String(namespace || '').toLowerCase();
  const nm = String(name || '').toLowerCase();
  if (!isCleanNamespaceAndName(ns, nm)) return [];
  const out = [
    `assets/${ns}/textures/item/${nm}.png`,
    `assets/${ns}/textures/items/${nm}.png`,
    `assets/${ns}/textures/block/${nm}.png`,
    `assets/${ns}/textures/blocks/${nm}.png`,
  ];
  if (nm.includes('_')) {
    const segs = nm.split('_');
    if (segs.length === 2) {
      const inv = `${segs[1]}_${segs[0]}`;
      out.push(
        `assets/${ns}/textures/item/${inv}.png`,
        `assets/${ns}/textures/items/${inv}.png`,
        `assets/${ns}/textures/block/${inv}.png`,
        `assets/${ns}/textures/blocks/${inv}.png`,
      );
    }
  }
  return out;
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
    this.lastSignatureCheck = 0;
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
    this.lastSignatureCheck = 0;
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

  _findInJars(ns, wanted, cacheKey, fallbackMatcher) {
    let jars = this.byNamespace.get(ns) || [];
    if (!jars.length) {
      const cleanNs = ns.replace(/[^a-z0-9]/g, '');
      if (this.byNamespace.has(cleanNs)) {
        jars = this.byNamespace.get(cleanNs) || [];
      } else if (ns === 'c' || ns === 'forge' || ns === 'common') {
        jars = [...this.jarCache.keys()];
      }
    }
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

  // Extract `assets/<ns>/textures/item[s]/<name>.png` from the first jar that has it.
  readTexture(namespace, name) {
    if (!this.modsDir) return null;
    this.refresh();
    const ns = String(namespace || '').toLowerCase();
    const nm = String(name || '').toLowerCase();
    const cacheKey = `${ns}:${nm}`;
    if (this.extractCache.has(cacheKey)) return this.extractCache.get(cacheKey);
    const isCommonTag = ns === 'c' || ns === 'forge' || ns === 'common';
    const wanted = isCommonTag ? [] : candidateEntries(namespace, name);
    const invertedNm = nm.includes('_') ? nm.split('_').reverse().join('_') : '';
    const matcher = e => {
      const lower = e.toLowerCase();
      if (!lower.includes('/textures/') || !lower.endsWith('.png')) return false;
      if (!isCommonTag && !lower.startsWith(`assets/${ns}/`)) return false;
      const base = path.basename(lower, '.png');
      return base === nm || (invertedNm && base === invertedNm);
    };
    return this._findInJars(ns, wanted, cacheKey, matcher);
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

module.exports = { ModsIndex, singleton, candidateEntries, candidateArmorEntries, folderSignature, namespacesIn };
