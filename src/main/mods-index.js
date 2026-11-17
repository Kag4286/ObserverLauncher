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
const { decodePngRgba, encodePng } = require('./custom-item-renders.js');

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

function extractTexRef(v) {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && typeof v.sprite === 'string') return v.sprite.trim();
  return '';
}

function resolveTexVar(tex, val) {
  let cur = extractTexRef(val);
  const seen = new Set();
  while (cur.startsWith('#')) {
    const key = cur.slice(1);
    if (seen.has(key) || !tex[key]) return '';
    seen.add(key);
    cur = tex[key];
  }
  return cur;
}

function normalizeTexLocation(rawRef, defaultNs = 'minecraft') {
  if (!rawRef || rawRef.startsWith('#')) return null;
  const clean = rawRef.replace(/\.png$/i, '');
  let texNs = String(defaultNs || 'minecraft').toLowerCase();
  let texPath = clean;
  if (clean.includes(':')) {
    const idx = clean.indexOf(':');
    texNs = clean.slice(0, idx).toLowerCase();
    texPath = clean.slice(idx + 1);
  }
  if (!isCleanNamespaceAndName(texNs, texPath)) return null;
  return {
    ns: texNs,
    texPath,
    entryPath: `assets/${texNs}/textures/${texPath}.png`,
  };
}

function parseJsonSafe(jsonText) {
  if (!jsonText) return null;
  if (typeof jsonText === 'object') return jsonText;
  try { return JSON.parse(String(jsonText)); } catch { return null; }
}

function resolveTexturesFromModelJson(jsonText, defaultNs) {
  const parsed = parseJsonSafe(jsonText);
  if (!parsed || typeof parsed !== 'object') return [];
  const sub = collectSubmodels(parsed);
  const out = [];
  const seen = new Set();
  for (const obj of sub.objs) {
    if (!obj || typeof obj !== 'object') continue;
    const tex = {};
    if (obj.textures && typeof obj.textures === 'object') {
      for (const [k, v] of Object.entries(obj.textures)) {
        const s = extractTexRef(v);
        if (s) tex[k] = s;
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (/texture$/i.test(k) && typeof v === 'string' && v.trim()) tex[k] = v.trim();
    }
    const layerKeys = ['layer0', 'layer1', 'layer2', 'layer3'];
    let addedLayer = false;
    for (const k of layerKeys) {
      if (tex[k]) {
        const r = resolveTexVar(tex, tex[k]);
        const loc = normalizeTexLocation(r, defaultNs);
        if (loc && !seen.has(loc.entryPath)) {
          seen.add(loc.entryPath);
          out.push(loc.entryPath);
          addedLayer = true;
        }
      }
    }
    if (addedLayer) continue;
    const priorityKeys = ['texture', 'all', 'top', 'front', 'side', 'particle'];
    for (const k of priorityKeys) {
      if (tex[k]) {
        const r = resolveTexVar(tex, tex[k]);
        const loc = normalizeTexLocation(r, defaultNs);
        if (loc && !seen.has(loc.entryPath)) { seen.add(loc.entryPath); out.push(loc.entryPath); break; }
      }
    }
    if (!out.length) {
      for (const v of Object.values(tex)) {
        const r = resolveTexVar(tex, v);
        const loc = normalizeTexLocation(r, defaultNs);
        if (loc && !seen.has(loc.entryPath)) { seen.add(loc.entryPath); out.push(loc.entryPath); break; }
      }
    }
  }
  return out;
}

// PURE: parse a model JSON descriptor to extract the primary texture file path.
// Handles layer0, layer1, texture, all, #variable aliases, {sprite} objects, and custom keys.
function resolveTextureFromModelJson(jsonText, defaultNs) {
  return resolveTexturesFromModelJson(jsonText, defaultNs)[0] || null;
}

// PURE: parse 1.21.4–26.3 equipment definition JSON (assets/<ns>/equipment/<mat>.json).
function parseEquipmentAssetJson(jsonText, fallbackNs = 'minecraft') {
  const parsed = parseJsonSafe(jsonText);
  const layers = parsed && parsed.layers;
  if (!layers || typeof layers !== 'object') return null;
  const resolveSlot = (arr, folder) => {
    const out = [];
    if (!Array.isArray(arr)) return out;
    for (const item of arr) {
      const raw = typeof item === 'string' ? item : (item && typeof item.texture === 'string' ? item.texture : '');
      const clean = raw.trim().replace(/\.png$/i, '');
      if (!clean) continue;
      const hasNs = clean.includes(':');
      const texNs = hasNs ? clean.split(':')[0].toLowerCase() : 'minecraft';
      const texName = hasNs ? clean.slice(clean.indexOf(':') + 1) : clean;
      if (!isCleanNamespaceAndName(texNs, texName)) continue;
      out.push(`assets/${texNs}/textures/entity/equipment/${folder}/${texName}.png`);
      if (!hasNs && fallbackNs && fallbackNs !== 'minecraft' && isCleanNamespaceAndName(fallbackNs, texName)) {
        out.push(`assets/${fallbackNs}/textures/entity/equipment/${folder}/${texName}.png`);
      }
    }
    return out;
  };
  return {
    humanoid: resolveSlot(layers.humanoid, 'humanoid'),
    humanoid_leggings: resolveSlot(layers.humanoid_leggings, 'humanoid_leggings'),
  };
}

// PURE: extract NeoForge / Forge separate_transforms, composite, or item_layers submodels.
function collectSubmodels(parsed) {
  if (!parsed || typeof parsed !== 'object') return { objs: [], forceNonCube: false };
  const loader = String(parsed.loader || '').toLowerCase();
  const objs = [];
  let forceNonCube = false;
  if (loader.includes('separate_transforms')) {
    const p = parsed.perspectives && typeof parsed.perspectives === 'object' ? parsed.perspectives : {};
    if (p.gui && typeof p.gui === 'object') { objs.push(p.gui); forceNonCube = true; }
    if (parsed.base && typeof parsed.base === 'object') objs.push(parsed.base);
    for (const [k, v] of Object.entries(p)) {
      if (k !== 'gui' && v && typeof v === 'object') objs.push(v);
    }
  } else if (loader.includes('composite')) {
    forceNonCube = true;
    if (parsed.children && typeof parsed.children === 'object') {
      for (const v of Object.values(parsed.children)) {
        if (v && typeof v === 'object') objs.push(v);
      }
    }
  } else if (loader.includes('item_layers')) {
    forceNonCube = true;
  }
  objs.push(parsed);
  return { objs, forceNonCube };
}

// PURE: parse 1.21.4–26.3 client item definitions (assets/<ns>/items/<name>.json).
function resolveItemDefinitionModels(jsonText, defaultNs = 'minecraft') {
  const parsed = parseJsonSafe(jsonText);
  if (!parsed || typeof parsed !== 'object' || !parsed.model || typeof parsed.model !== 'object') return null;
  const modelEntries = [];
  const seen = new Set();
  let isComposite = false;
  let isSpecial = false;
  const addRef = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    const clean = raw.trim().replace(/\.json$/i, '');
    const mNs = clean.includes(':') ? clean.split(':')[0].toLowerCase() : String(defaultNs || 'minecraft').toLowerCase();
    const mPath = clean.includes(':') ? clean.slice(clean.indexOf(':') + 1) : clean;
    if (!isCleanNamespaceAndName(mNs, mPath)) return;
    const entry = `assets/${mNs}/models/${mPath}.json`;
    if (!seen.has(entry)) { seen.add(entry); modelEntries.push(entry); }
  };
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 8) return;
    const t = String(node.type || '').replace(/^minecraft:/, '').toLowerCase();
    if (t === 'empty') return;
    if (t === 'composite' && Array.isArray(node.models)) {
      isComposite = true;
      for (const child of node.models) walk(child, depth + 1);
      return;
    }
    if (t === 'special') {
      isSpecial = true;
      if (typeof node.base === 'string') addRef(node.base);
      return;
    }
    if (t === 'condition') {
      walk(node.on_false, depth + 1);
      walk(node.on_true, depth + 1);
      return;
    }
    if (t === 'select') {
      if (node.fallback) walk(node.fallback, depth + 1);
      if (Array.isArray(node.cases) && node.cases[0]) walk(node.cases[0].model, depth + 1);
      return;
    }
    if (t === 'range_dispatch') {
      if (Array.isArray(node.entries) && node.entries[0]) walk(node.entries[0].model, depth + 1);
      if (node.fallback) walk(node.fallback, depth + 1);
      return;
    }
    if (typeof node.model === 'string') addRef(node.model);
    else if (node.model && typeof node.model === 'object') walk(node.model, depth + 1);
  };
  walk(parsed.model);
  return { modelEntries, isComposite, isSpecial };
}

// Composite multiple same-size RGBA PNG buffers (layer0 + layer1...) using alpha over.
function compositeLayerBuffers(bufs) {
  if (!Array.isArray(bufs) || !bufs.length) return null;
  if (bufs.length === 1) return bufs[0];
  try {
    const base = decodePngRgba(bufs[0]);
    if (!base) return bufs[0];
    const out = Buffer.from(base.rgba);
    for (let i = 1; i < bufs.length; i++) {
      const ov = decodePngRgba(bufs[i]);
      if (!ov || ov.w !== base.w || ov.h !== base.h) continue;
      for (let p = 0; p < out.length; p += 4) {
        const sa = ov.rgba[p + 3] / 255;
        if (sa <= 0) continue;
        const da = out[p + 3] / 255;
        const oa = sa + da * (1 - sa);
        if (oa <= 0) continue;
        for (let c = 0; c < 3; c++) {
          out[p + c] = Math.round((ov.rgba[p + c] * sa + out[p + c] * da * (1 - sa)) / oa);
        }
        out[p + 3] = Math.round(oa * 255);
      }
    }
    return encodePng(base.w, base.h, out);
  } catch {
    return bufs[0];
  }
}

const NON_CUBE_MODEL_RE = /(?:^|\/)(?:generated|handheld(?:_rod)?|builtin\/entity|cross|tinted_cross|crop|flower_pot_cross|template_torch|torch|rail_[a-z_]+|rail|carpet|wall_inventory|template_anvil|button|pressure_plate|trapdoor|door_[a-z_]+|fence_[a-z_]+|fence_gate|banner|sign|hanging_sign|bed|candle|lantern|chain|campfire|pane|spear|template_shelf|harness|trident|shield|spyglass|brush)(?:$|\b)/i;
const CUBE_PARENT_RE = /(?:^|\/)(?:cube(?:_all|_column(?:_horizontal|_uv_locked)?|_bottom_top|_top|_directional|_mirrored(?:_all)?)?|orientable(?:_with_bottom|_vertical)?|leaves|slab(?:_top)?|stairs|template_command_block|template_glazed_terracotta|template_single_face)$/i;

/**
 * Resolve multi-face block textures & shape metadata from a model JSON chain `[child, parent, ...]`.
 * Returns null if the model is a 2D sprite, non-cubic foliage/cross/torch, or lacks block geometry.
 */
function resolveModelFacesFromChain(modelsChain, defaultNs = 'minecraft', blockNameHint = '') {
  const chain = (Array.isArray(modelsChain) ? modelsChain : [modelsChain])
    .map(m => {
      if (!m) return null;
      if (typeof m === 'string') { try { return JSON.parse(m); } catch { return null; } }
      return (typeof m === 'object') ? m : null;
    })
    .filter(Boolean);
  if (!chain.length) return null;

  const parents = chain
    .map(m => String(m.parent || '').replace(/^minecraft:/, '').toLowerCase())
    .filter(Boolean);

  for (const m of chain) {
    if (m.loader && /separate_transforms|composite|item_layers/i.test(String(m.loader))) return null;
  }

  for (const p of parents) {
    if (NON_CUBE_MODEL_RE.test(p)) return null;
  }

  // Merge textures from root ancestor -> child so child keys override parents
  const tex = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    const tObj = chain[i].textures;
    if (!tObj || typeof tObj !== 'object') continue;
    for (const [k, v] of Object.entries(tObj)) {
      const s = extractTexRef(v);
      if (s) tex[k] = s;
    }
  }

  let elements = null;
  for (const m of chain) {
    if (Array.isArray(m.elements) && m.elements.length) {
      elements = m.elements;
      break;
    }
  }

  const isCubeParent = parents.some(p => CUBE_PARENT_RE.test(p));
  const hasFullElements = Array.isArray(elements) && elements.some(el => {
    if (!el || !Array.isArray(el.from) || !Array.isArray(el.to)) return false;
    const dx = Math.abs(el.to[0] - el.from[0]);
    const dy = Math.abs(el.to[1] - el.from[1]);
    const dz = Math.abs(el.to[2] - el.from[2]);
    return dx >= 8 && dz >= 8 && (dy >= 7 || elements.length >= 4);
  });

  if (tex.layer0 && !isCubeParent && !hasFullElements) return null;
  if (!isCubeParent && !hasFullElements) return null;

  const loc = (val) => {
    const r = resolveTexVar(tex, val);
    return r ? normalizeTexLocation(r, defaultNs) : null;
  };
  const pick = (...keys) => {
    for (const k of keys) {
      if (tex[k]) {
        const hit = loc(tex[k]);
        if (hit) return hit;
      }
    }
    return null;
  };

  let top = null, front = null, side = null, bottom = null, overlay = null;
  let tintTop = false, tintFront = false, tintSide = false, tintOverlay = false;

  if (Array.isArray(elements) && elements.length) {
    for (let i = 0; i < elements.length; i++) {
      const faces = elements[i]?.faces;
      if (!faces || typeof faces !== 'object') continue;
      if (i === 0 || elements.length > 2) {
        if (!top && faces.up?.texture) {
          top = loc(faces.up.texture);
          if (faces.up.tintindex != null) tintTop = true;
        }
        if (!front && (faces.north?.texture || faces.south?.texture)) {
          const fFace = faces.north?.texture ? faces.north : faces.south;
          front = loc(fFace.texture);
          if (fFace.tintindex != null) tintFront = true;
        }
        if (!side && (faces.east?.texture || faces.west?.texture)) {
          const sFace = faces.east?.texture ? faces.east : faces.west;
          side = loc(sFace.texture);
          if (sFace.tintindex != null) tintSide = true;
        }
        if (!bottom && faces.down?.texture) {
          bottom = loc(faces.down.texture);
        }
      } else {
        // Secondary element (e.g. grass_block side overlay)
        const ovFace = faces.north || faces.east || faces.south || faces.west;
        if (!overlay && ovFace?.texture) {
          overlay = loc(ovFace.texture);
          if (ovFace.tintindex != null) tintOverlay = true;
        }
      }
    }
  }

  const orientVert = parents.some(p => p.includes('orientable_vertical'));
  const isColumn = parents.some(p => p.includes('cube_column'));
  if (!top) {
    top = orientVert
      ? pick('front', 'top', 'up', 'end', 'all', 'side', 'texture')
      : isColumn
        ? pick('end', 'top', 'up', 'all', 'side', 'texture')
        : pick('up', 'top', 'end', 'all', 'side', 'front', 'texture');
  }
  if (!front) {
    front = orientVert
      ? pick('side', 'front', 'north', 'all', 'top', 'texture')
      : pick('north', 'front', 'side', 'all', 'end', 'top', 'texture');
  }
  if (!side) {
    side = pick('east', 'west', 'side', 'front', 'all', 'end', 'top', 'texture');
  }
  if (!bottom) bottom = pick('down', 'bottom', 'end', 'all');
  if (!overlay && tex.overlay) {
    overlay = pick('overlay');
    tintOverlay = true;
  }

  if (!top && !front && !side) return null;

  const isLeavesParent = parents.some(p => /(?:^|\/)leaves$/.test(p));
  const nmLower = String(blockNameHint || '').toLowerCase();
  // Cherry leaves bake pink petals directly in texture without runtime biome greening
  if (nmLower === 'cherry_leaves' || nmLower === 'pale_oak_leaves') {
    tintTop = false; tintFront = false; tintSide = false;
  } else if (isLeavesParent) {
    tintTop = true; tintFront = true; tintSide = true;
  }

  let shape = 'cube';
  if (parents.some(p => /(?:^|\/)slab(?:_top)?$/.test(p))) shape = 'slab';
  else if (parents.some(p => /(?:^|\/)stairs$/.test(p))) shape = 'stairs';

  return {
    shape,
    top: top || front || side,
    front: front || side || top,
    side: side || front || top,
    bottom,
    overlay,
    tintTop,
    tintFront,
    tintSide,
    tintOverlay,
  };
}

function resolveModelFacesFromJson(jsonOrObj, defaultNs = 'minecraft', parentOrChain = null, blockNameHint = '') {
  const chain = [jsonOrObj];
  if (Array.isArray(parentOrChain)) chain.push(...parentOrChain);
  else if (parentOrChain) chain.push(parentOrChain);
  return resolveModelFacesFromChain(chain, defaultNs, blockNameHint);
}

// Shared parent-chain loader for both client JAR and mod JAR block models.
function resolveModelChain(readJsonFn, rootParsed, defaultNs = 'minecraft', allowMinecraft = false) {
  const chain = [rootParsed];
  const seen = new Set();
  let cur = rootParsed;
  let curNs = String(defaultNs || 'minecraft').toLowerCase();
  for (let depth = 0; depth < 6 && cur && typeof cur.parent === 'string'; depth++) {
    const rawParent = cur.parent.trim();
    const pNs = rawParent.includes(':') ? rawParent.split(':')[0].toLowerCase() : curNs;
    const pPath = rawParent.replace(/^[^:]+:/, '');
    if (!allowMinecraft && (pNs === 'minecraft' || pNs === 'block')) break;
    const entry = `assets/${pNs}/models/${pPath}.json`;
    if (seen.has(entry)) break;
    seen.add(entry);
    const next = readJsonFn(pNs, entry);
    if (!next) break;
    chain.push(next);
    cur = next;
    curNs = pNs;
  }
  return chain;
}

// PURE: check whether jar entries include a GeckoLib/AzureLib .geo.json skeleton matching material.
function hasBedrockGeoModel(entryNames, ns, mat) {
  if (!Array.isArray(entryNames) || !entryNames.length || !mat) return false;
  const cleanMat = String(mat).toLowerCase().replace(/^armor_/, '').replace(/_armor$/, '');
  const tokens = cleanMat.split('_').filter(t => t.length >= 3);
  const geoPrefix = `assets/${String(ns || '').toLowerCase()}/geo/`;
  for (const e of entryNames) {
    const lower = String(e || '').toLowerCase();
    if (!lower.startsWith(geoPrefix) || !/\.geo(?:\.json)?$/i.test(lower)) continue;
    const base = path.basename(lower).replace(/\.geo(?:\.json)?$/i, '');
    if (base.includes(mat) || (cleanMat && base.includes(cleanMat))) return true;
    if (tokens.length && tokens.every(tok => base.includes(tok))) return true;
  }
  return false;
}

// Detect whether a decoded PNG buffer matches standard humanoid armor atlas geometry (2:1 like 64x32/128x64
// or extended 64x64). Larger square atlases (128x128+) are typically Bedrock/GeckoLib custom meshes.
function isStandardHumanoidArmorPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return true;
  if (buf.readUInt32BE(0) !== 0x89504e47) return true;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (!w || !h) return true;
  if (w === h * 2) return true;
  return w === 64 && h === 64;
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
    `assets/${ns}/textures/entity/armour/`,
    `assets/${ns}/textures/armour/`,
    `assets/${ns}/textures/item/armor/`,
  ];
  const fileNames = l === 2
    ? [`${mat}_layer_2.png`, `${mat}_legs.png`, `${mat}_leggings.png`, `${mat}_layer2.png`, `${mat}_2.png`, `${mat}_armor_layer_2.png`, `armor_${mat}_layer_2.png`, `${mat}/layer_2.png`, `${mat}/${mat}_layer_2.png`]
    : [`${mat}_layer_1.png`, `${mat}.png`, `${mat}_layer1.png`, `${mat}_1.png`, `${mat}_armor_layer_1.png`, `armor_${mat}_layer_1.png`, `${mat}/layer_1.png`, `${mat}/${mat}_layer_1.png`];
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

  _prepLookup(namespace, name) {
    if (!this.modsDir) return null;
    this.refresh();
    return {
      ns: String(namespace || '').toLowerCase(),
      nm: String(name || '').toLowerCase(),
    };
  }

  _eachJar(ns, visitor) {
    for (const jarPath of this._getJarsForNamespace(ns)) {
      let jar = this.jarCache.get(jarPath);
      if (!jar) {
        try { jar = openJar(jarPath); this.jarCache.set(jarPath, jar); } catch { continue; }
      }
      const hit = visitor(jar);
      if (hit !== undefined) return hit;
    }
    return null;
  }

  _findInJars(ns, wanted, cacheKey, fallbackMatcher) {
    if (!wanted.length && !fallbackMatcher) return null;
    return this._eachJar(ns, jar => {
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
    });
  }

  _readTexBuffer(jar, ns, pngTarget) {
    try {
      const pngBuf = jar.read(pngTarget);
      if (pngBuf && pngBuf.length) return pngBuf;
    } catch {}
    const match = pngTarget.match(/^assets\/([a-z0-9_.-]+)\//i);
    const targetNs = match ? match[1].toLowerCase() : ns;
    if (targetNs !== ns) {
      return this._eachJar(targetNs, tj => {
        try { const b = tj.read(pngTarget); if (b && b.length) return b; } catch {}
      });
    }
    return null;
  }

  _findModelTexture(ns, modelCandidates, cacheKey) {
    return this._eachJar(ns, jar => {
      for (const modelEntry of modelCandidates) {
        try {
          const jsonBuf = jar.read(modelEntry);
          if (!jsonBuf) continue;
          const mNsMatch = modelEntry.match(/^assets\/([a-z0-9_.-]+)\//i);
          const mNs = mNsMatch ? mNsMatch[1].toLowerCase() : ns;
          let parsed = JSON.parse(jsonBuf.toString('utf8'));
          let pngTargets = resolveTexturesFromModelJson(parsed, mNs);
          let cur = parsed;
          let curNs = mNs;
          for (let hop = 0; !pngTargets.length && hop < 4 && cur && typeof cur.parent === 'string'; hop++) {
            const pNs = cur.parent.includes(':') ? cur.parent.split(':')[0].toLowerCase() : curNs;
            const pPath = cur.parent.replace(/^[^:]+:/, '');
            const pBuf = jar.read(`assets/${pNs}/models/${pPath}.json`) || (pNs !== mNs ? this._readTexEntry(pNs, `assets/${pNs}/models/${pPath}.json`) : null);
            if (!pBuf) break;
            cur = JSON.parse(pBuf.toString('utf8'));
            curNs = pNs;
            pngTargets = resolveTexturesFromModelJson(cur, pNs);
          }
          if (pngTargets.length) {
            const layerBufs = [];
            for (let i = 0; i < pngTargets.length; i++) {
              const target = pngTargets[i];
              // Skip grayscale _overlay masks unless it's the primary texture (i === 0)
              if (i > 0 && /_overlay\.png$/i.test(target)) continue;
              const buf = this._readTexBuffer(jar, mNs, target);
              if (buf) layerBufs.push(buf);
            }
            const combined = compositeLayerBuffers(layerBufs);
            if (combined) {
              this.extractCache.set(cacheKey, combined);
              return combined;
            }
          }
        } catch {}
      }
    });
  }

  _readItemDefModelEntries(ns, nm) {
    const defBuf = this._readTexEntry(ns, `assets/${ns}/items/${nm}.json`);
    if (!defBuf) return null;
    try { return resolveItemDefinitionModels(defBuf.toString('utf8'), ns); } catch { return null; }
  }

  // Extract `assets/<ns>/textures/item[s]/<name>.png` from the first jar that has it.
  readTexture(namespace, name) {
    const ctx = this._prepLookup(namespace, name);
    if (!ctx) return null;
    const { ns, nm } = ctx;
    const cacheKey = `${ns}:${nm}`;
    if (this.extractCache.has(cacheKey)) return this.extractCache.get(cacheKey);
    const isCommonTag = ns === 'c' || ns === 'forge' || ns === 'common';

    // 1. 1.21.4–26.3 Client item definition JSON (assets/<ns>/items/<name>.json) + standard model JSONs
    if (!isCommonTag) {
      const itemDef = this._readItemDefModelEntries(ns, nm);
      if (itemDef && itemDef.modelEntries.length) {
        if (itemDef.isComposite && itemDef.modelEntries.length > 1) {
          const parts = itemDef.modelEntries.map(me => this._findModelTexture(ns, [me], `${cacheKey}~part~${me}`)).filter(Boolean);
          const merged = compositeLayerBuffers(parts);
          if (merged) { this.extractCache.set(cacheKey, merged); return merged; }
        }
        const defBuf = this._findModelTexture(ns, itemDef.modelEntries, cacheKey);
        if (defBuf) return defBuf;
      }
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

  // Check whether any indexed mod jar for `ns` declares GeckoLib/AzureLib .geo.json for `mat`.
  hasArmorCustomGeo(namespace, material) {
    const ctx = this._prepLookup(namespace, material);
    if (!ctx) return false;
    const { ns, nm: mat } = ctx;
    return Boolean(this._eachJar(ns, jar => {
      const names = typeof jar.list === 'function' ? jar.list() : [];
      if (hasBedrockGeoModel(names, ns, mat)) return true;
    }));
  }

  // Extract worn armor texture + custom geometry metadata from the first jar that has it.
  readArmorTextureInfo(namespace, material, layer) {
    const ctx = this._prepLookup(namespace, material);
    if (!ctx) return { buffer: null, isCustomGeo: false, nonStandardUv: false };
    const { ns, nm: mat } = ctx;
    const l = Number(layer) === 2 ? 2 : 1;
    const cacheKey = `armor:${ns}:${mat}:${l}`;
    const isCustomGeo = this.hasArmorCustomGeo(ns, mat);
    const wrapHit = buf => ({
      buffer: buf || null,
      isCustomGeo,
      nonStandardUv: buf ? !isStandardHumanoidArmorPng(buf) : false,
    });
    if (this.extractCache.has(cacheKey)) {
      return wrapHit(this.extractCache.get(cacheKey));
    }

    // 1. 1.21.2-26.3 Equipment asset JSON (assets/<ns>/equipment/ & 1.21.2-1.21.3 models/equipment/)
    const eqBuf = this._readTexEntry(ns, `assets/${ns}/equipment/${mat}.json`)
      || this._readTexEntry(ns, `assets/${ns}/models/equipment/${mat}.json`);
    if (eqBuf) {
      const eq = parseEquipmentAssetJson(eqBuf.toString('utf8'), ns);
      const eqList = eq ? (l === 2 ? eq.humanoid_leggings : eq.humanoid) : [];
      for (const ep of eqList) {
        const hit = this._readTexEntry(ns, ep);
        if (hit) { this.extractCache.set(cacheKey, hit); return wrapHit(hit); }
        const epMatch = ep.match(/^assets\/([a-z0-9_.-]+)\//i);
        const epNs = epMatch ? epMatch[1].toLowerCase() : ns;
        if (epNs !== ns) {
          const cross = this._readTexEntry(epNs, ep);
          if (cross) { this.extractCache.set(cacheKey, cross); return wrapHit(cross); }
        }
      }
    }

    // 2. Direct & token-normalized search across armor/equipment subdirectories (supports nested mat folders)
    const stripped = mat.replace(/^armor_/, '').replace(/_armor$/, '').replace(/_(?:set|heavy|light|metal|plate)$/, '');
    const wanted = [...candidateArmorEntries(namespace, material, l)];
    if (stripped && stripped !== mat) {
      for (const w of candidateArmorEntries(namespace, stripped, l)) {
        if (!wanted.includes(w)) wanted.push(w);
      }
    }
    const tokens = stripped.split('_').filter(t => t.length >= 2);
    const texPrefix = `assets/${ns}/textures/`;
    const buffer = this._findInJars(ns, wanted, cacheKey, e => {
      const lower = e.toLowerCase();
      if (!lower.startsWith(texPrefix) || !lower.endsWith('.png')) return false;
      if (!lower.includes('/armor') && !lower.includes('/armour') && !lower.includes('/equipment/')) return false;
      const relTex = lower.slice(texPrefix.length, -4);
      const base = path.basename(lower, '.png');
      const matchesName = base.includes(mat) || relTex.includes(`/${mat}/`)
        || (stripped && (base.includes(stripped) || relTex.includes(`/${stripped}/`)))
        || (tokens.length >= 2 && tokens.every(tok => relTex.includes(tok)));
      if (!matchesName) return false;
      const isLegsFile = lower.includes('layer_2') || lower.includes('_legs') || lower.includes('layer2') || lower.includes('leggings') || lower.includes('_2.png') || lower.includes('humanoid_leggings');
      if (l === 2) return isLegsFile;
      return !isLegsFile;
    });
    return wrapHit(buffer);
  }

  // Extract worn armor texture from the first jar that has it.
  readArmorTexture(namespace, material, layer) {
    return this.readArmorTextureInfo(namespace, material, layer).buffer;
  }

  _readModelEntry(ns, modelEntry) {
    return this._eachJar(ns, jar => {
      try {
        const buf = jar.read(modelEntry);
        if (buf) return { jar, parsed: JSON.parse(buf.toString('utf8')) };
      } catch {}
    });
  }

  _readTexEntry(ns, entryPath) {
    if (!entryPath) return null;
    return this._eachJar(ns, jar => {
      try {
        const buf = jar.read(entryPath);
        if (buf && buf.length) return buf;
      } catch {}
    });
  }

  // Extract multi-face model metadata + JAR texture buffers for mod blocks (walks parent chain).
  readBlockFaces(namespace, name) {
    const ctx = this._prepLookup(namespace, name);
    if (!ctx) return null;
    const { ns, nm } = ctx;
    if (!isCleanNamespaceAndName(ns, nm) || ns === 'c' || ns === 'forge' || ns === 'common') return null;

    const cacheKey = `faces:${ns}:${nm}`;
    if (this.extractCache.has(cacheKey)) return this.extractCache.get(cacheKey);

    const itemDef = this._readItemDefModelEntries(ns, nm);
    if (itemDef && (itemDef.isSpecial || itemDef.isComposite)) {
      this.extractCache.set(cacheKey, null);
      return null;
    }
    const modelCandidates = itemDef && itemDef.modelEntries.length
      ? [...itemDef.modelEntries, ...candidateModelEntries(ns, nm)]
      : candidateModelEntries(ns, nm);
    let rootEntry = null;
    for (const candidate of modelCandidates) {
      const hit = this._readModelEntry(ns, candidate);
      if (hit) { rootEntry = hit; break; }
    }
    if (!rootEntry) {
      this.extractCache.set(cacheKey, null);
      return null;
    }

    const chain = resolveModelChain(
      (pNs, entry) => {
        const next = this._readModelEntry(pNs, entry);
        return next ? next.parsed : null;
      },
      rootEntry.parsed,
      ns,
      false,
    );

    const resolved = resolveModelFacesFromChain(chain, ns, nm);
    if (!resolved) {
      this.extractCache.set(cacheKey, null);
      return null;
    }

    const readLoc = (loc) => {
      if (!loc || loc.ns === 'minecraft') return null;
      return this._readTexEntry(loc.ns, loc.entryPath);
    };
    const result = {
      ...resolved,
      buffers: {
        top: readLoc(resolved.top),
        front: readLoc(resolved.front),
        side: readLoc(resolved.side),
        overlay: readLoc(resolved.overlay),
      },
    };
    this.extractCache.set(cacheKey, result);
    return result;
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
  resolveTexturesFromModelJson,
  parseEquipmentAssetJson,
  resolveItemDefinitionModels,
  resolveModelChain,
  hasBedrockGeoModel,
  compositeLayerBuffers,
  resolveModelFacesFromChain,
  resolveModelFacesFromJson,
  candidateArmorEntries,
  folderSignature,
  namespacesIn
};
