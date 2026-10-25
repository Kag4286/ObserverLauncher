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

// NOTE (v6.0.0 memory fix): a JarHandle now holds only the parsed central directory (a few KB per
// jar), not the whole jar body. Caching the handle is therefore cheap and saves re-parsing the
// index on every icon lookup. readTexture still opens/closes the file per entry, so no file
// descriptor is held open between calls.

// PURE: a Minecraft mod jar packs items as assets/<ns>/textures/item[s]/<name>.png. Return the
// list of candidate entry paths for a namespace/name pair; some packs nest under `item/`, others
// under `items/`, so try both spellings.
function candidateEntries(namespace, name) {
  const ns = String(namespace || '').toLowerCase();
  const nm = String(name || '').toLowerCase();
  if (!/^[a-z0-9_.-]+$/.test(ns) || !/^[a-z0-9_./-]+$/.test(nm)) return [];
  // Defense in depth: a jar entry name is compared verbatim, so a `..` segment cannot escape the
  // zip, but rejecting it here keeps a caller from ever building a path with it downstream.
  if (ns.includes('..') || nm.split('/').includes('..')) return [];
  // BUGFIX: a mod often registers an item as a BlockItem (Create's cogwheel, AE2's cable, a
  // Botania flower). Its texture lives under textures/block/, not textures/item/, so the old two
  // candidates missed it and the cell fell back to an initials badge. Item spellings come first
  // because a plain item of the same name should win over a block of that name.
  return [
    `assets/${ns}/textures/item/${nm}.png`,
    `assets/${ns}/textures/items/${nm}.png`,
    `assets/${ns}/textures/block/${nm}.png`,
    `assets/${ns}/textures/blocks/${nm}.png`,
  ];
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

  // Extract `assets/<ns>/textures/item[s]/<name>.png` from the first jar that has it.
  // Returns a Buffer or null. Cached per session; invalidated by the folder signature.
  readTexture(namespace, name) {
    if (!this.modsDir) return null;
    this.refresh();
    const ns = String(namespace || '').toLowerCase();
    const cacheKey = `${ns}:${String(name || '').toLowerCase()}`;
    if (this.extractCache.has(cacheKey)) return this.extractCache.get(cacheKey);
    const jars = this.byNamespace.get(ns) || [];
    const wanted = candidateEntries(namespace, name);
    if (!wanted.length) return null;
    for (const jarPath of jars) {
      let jar = this.jarCache.get(jarPath);
      if (!jar) { try { jar = openJar(jarPath); this.jarCache.set(jarPath, jar); } catch { continue; } }
      for (const entry of wanted) {
        try {
          const buf = jar.read(entry);
          this.extractCache.set(cacheKey, buf);
          return buf;
        } catch { /* try next spelling */ }
      }
      try {
        const nm = String(name || '').toLowerCase();
        const fallback = jar.list().find(e => e.startsWith(`assets/${ns}/textures/`) && e.endsWith(`/${nm}.png`));
        if (fallback) {
          const buf = jar.read(fallback);
          this.extractCache.set(cacheKey, buf);
          return buf;
        }
      } catch {}
    }
    return null;
  }

  // Test seam: namespaces currently indexed (call refresh() first).
  knownNamespaces() {
    return [...this.byNamespace.keys()].sort();
  }
}

const singleton = new ModsIndex();

module.exports = { ModsIndex, singleton, candidateEntries, folderSignature, namespacesIn };
