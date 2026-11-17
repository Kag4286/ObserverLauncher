// tex:// — version-aware item/block icon protocol.
//
// Why: item icons used to be hardcoded to the single bundled set (assets/textures/26.2), so a
// future Minecraft version (e.g. 26.3) with new items showed blank icons until a new launcher
// release shipped new PNGs. This module serves icons through tex://<version|auto>/item|x/<id>.png:
//   1. userData/textures/<version>/<kind>/<file>   — on-demand cache, filled from (2)
//   2. raw.githubusercontent.com/PrismarineJS/minecraft-assets (data/<v>/items|blocks/) —
//      fetched lazily PER ICON on first miss (no bulk download), then cached forever.
// A miss serves a transparent 1x1 placeholder (200) while the real icon downloads in the
// background; the very next render shows it. NOTE: brand-new versions appear upstream only
// after PrismarineJS extracts them; until then icons stay transparent.
// NO Mojang assets are bundled in this repository — everything is fetched to the user's
// machine at runtime from the public PrismarineJS mirror.
//
// Mojang asset note: textures are fetched to the USER'S machine at runtime from the public
// PrismarineJS mirror — nothing is redistributed inside this repository.

// B1 (v3.0.0): no top-level electron require (throws in plain Node). dataDir() resolves the cache
// root; net/BrowserWindow are required LAZILY inside the GUI-only paths that actually use them.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { dataDir } = require('./data-dir.js');
const {
  singleton: modsIndex,
  resolveModelFacesFromChain,
  parseEquipmentAssetJson,
  resolveItemDefinitionModels,
  resolveTexturesFromModelJson,
  compositeLayerBuffers,
  resolveModelChain,
} = require('./mods-index.js');
const { openJar } = require('./jar-reader.js');
const { readPackTexture } = require('./resource-pack.js');
const { renderCustomModItem, renderCustomVanillaItem, encodePng, decodePngRgba, renderIsometricBlockPng } = require('./custom-item-renders.js');

// Hybrid CDN: jsDelivr is Cloudflare-backed, high-speed, and accessible worldwide (not blocked by
// ISPs that block raw.githubusercontent.com). raw.githubusercontent is retained as a second fallback.

let _activePackPath = null;
function setActiveResourcePackPath(p) {
  _activePackPath = (p && typeof p === 'string' && fs.existsSync(p)) ? p : null;
}
function getActiveResourcePackPath() {
  return _activePackPath;
}
function getEffectivePackPath() {
  if (_activePackPath) return _activePackPath;
  try {
    const { loadSettings } = require('./settings.js');
    const s = loadSettings();
    if (s.resourcePackPath && fs.existsSync(s.resourcePackPath)) return s.resourcePackPath;
  } catch {}
  return null;
}

const CDN_BASES = [
  'https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-assets@master/data',
  'https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data',
];

// BUGFIX: some vanilla items have no texture file of their own. The enchanted golden apple is
// drawn by the game from golden_apple.png plus a glint; the mirror only ships the base file, so
// `enchanted_golden_apple.png` 404s and the slot rendered as an empty label. Aliases map an id to
// the texture that actually exists. Kept tiny and explicit so a wrong guess cannot hide a real
// missing icon behind the wrong picture.
const WOOD_TYPES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'crimson', 'warped', 'mangrove', 'cherry', 'bamboo', 'pale_oak', 'poplar'];
const ITEM_ALIASES = {
  enchanted_golden_apple: 'golden_apple',
  enchanted_book: 'book',
  chipped_anvil: 'anvil',
  damaged_anvil: 'anvil',
};

function itemCandidateUrls(file) {
  const base = String(file || '').replace(/\.png$/, '');
  const out = [`items/${file}`, `blocks/${file}`];
  const push = p => { if (p && !out.includes(p)) out.push(p); };

  const explicit = {
    crafting_table: ['blocks/crafting_table_front.png', 'blocks/crafting_table_top.png'],
    furnace: ['blocks/furnace_front.png', 'blocks/furnace_top.png'],
    blast_furnace: ['blocks/blast_furnace_front.png'],
    smoker: ['blocks/smoker_front.png'],
    hay_block: ['blocks/hay_block_side.png', 'blocks/hay_block_top.png'],
    shield: ['items/empty_armor_slot_shield.png', 'entity/shield_base_nopattern.png', 'blocks/dark_oak_planks.png'],
    clock: ['items/clock_00.png'],
    compass: ['items/compass_00.png'],
    recovery_compass: ['items/recovery_compass_00.png'],
    crossbow: ['items/crossbow_standby.png'],
    enchanted_golden_apple: ['items/golden_apple.png'],
    enchanted_book: ['items/book.png'],
    lectern: ['blocks/lectern_top.png'],
    tnt: ['blocks/tnt_side.png', 'blocks/tnt.png'],
    torch: ['blocks/torch.png', 'items/torch.png'],
    redstone_torch: ['blocks/redstone_torch.png'],
    soul_torch: ['blocks/soul_torch.png'],
    chest: ['blocks/chest.png', 'blocks/oak_planks.png'],
    ender_chest: ['blocks/ender_chest.png', 'blocks/obsidian.png'],
    barrel: ['blocks/barrel_side.png', 'blocks/barrel_top.png'],
    cobblestone: ['blocks/cobblestone.png'],
    iron_block: ['blocks/iron_block.png'],
    gold_block: ['blocks/gold_block.png'],
    diamond_block: ['blocks/diamond_block.png'],
    obsidian: ['blocks/obsidian.png'],
    oak_planks: ['blocks/oak_planks.png'],
    pumpkin: ['blocks/pumpkin_side.png', 'blocks/pumpkin_top.png'],
    carved_pumpkin: ['blocks/carved_pumpkin.png'],
    jack_o_lantern: ['blocks/jack_o_lantern.png'],
    melon: ['blocks/melon_side.png', 'blocks/melon_top.png'],
    stone_button: ['blocks/stone.png'],
    polished_blackstone_button: ['blocks/polished_blackstone.png'],
    stone_pressure_plate: ['blocks/stone.png'],
    polished_blackstone_pressure_plate: ['blocks/polished_blackstone.png'],
    heavy_weighted_pressure_plate: ['blocks/iron_block.png'],
    light_weighted_pressure_plate: ['blocks/gold_block.png'],
    repeater: ['items/repeater.png'],
    comparator: ['items/comparator.png'],
    lever: ['blocks/lever.png', 'items/lever.png'],
    tripwire_hook: ['blocks/tripwire_hook.png'],
    dispenser: ['blocks/dispenser_front.png', 'blocks/dispenser_front_horizontal.png'],
    dropper: ['blocks/dropper_front.png', 'blocks/dropper_front_horizontal.png'],
    observer: ['blocks/observer_front.png', 'blocks/observer_top.png'],
    piston: ['blocks/piston_side.png', 'blocks/piston_top.png'],
    sticky_piston: ['blocks/piston_top_sticky.png', 'blocks/piston_side.png'],
    sponge: ['blocks/sponge.png'],
    wet_sponge: ['blocks/wet_sponge.png'],
    honeycomb_block: ['blocks/honeycomb_block.png'],
    slime_block: ['blocks/slime_block.png'],
    honey_block: ['blocks/honey_block_side.png', 'blocks/honey_block_top.png'],
    bookshelf: ['blocks/bookshelf.png'],
    glass: ['blocks/glass.png'],
    glass_pane: ['blocks/glass.png'],
    iron_bars: ['blocks/iron_bars.png'],
    chain: ['blocks/chain.png', 'items/chain.png'],
    lantern: ['blocks/lantern.png', 'items/lantern.png'],
    soul_lantern: ['blocks/soul_lantern.png', 'items/soul_lantern.png'],
    campfire: ['blocks/campfire_log.png'],
    soul_campfire: ['blocks/soul_campfire_log.png'],
    cauldron: ['items/cauldron.png', 'blocks/cauldron_side.png'],
    brewing_stand: ['items/brewing_stand.png', 'blocks/brewing_stand_base.png'],
    anvil: ['blocks/anvil.png', 'blocks/anvil_top.png'],
    chipped_anvil: ['blocks/chipped_anvil_top.png', 'blocks/anvil.png', 'blocks/anvil_top.png'],
    damaged_anvil: ['blocks/damaged_anvil_top.png', 'blocks/anvil.png', 'blocks/anvil_top.png'],
    bell: ['blocks/bell_body.png'],
    beacon: ['blocks/beacon.png'],
    glowstone: ['blocks/glowstone.png'],
    sea_lantern: ['blocks/sea_lantern.png'],
    shroomlight: ['blocks/shroomlight.png'],
    magma_block: ['blocks/magma.png', 'blocks/magma_block.png'],
    netherrack: ['blocks/netherrack.png'],
    soul_sand: ['blocks/soul_sand.png'],
    soul_soil: ['blocks/soul_soil.png'],
    basalt: ['blocks/basalt_side.png'],
    smooth_stone: ['blocks/smooth_stone.png'],
    smooth_stone_slab: ['blocks/smooth_stone.png'],
    cactus: ['blocks/cactus_side.png', 'blocks/cactus_top.png'],
  };
  if (explicit[base]) {
    for (const p of explicit[base]) push(p);
  }

  if (base.endsWith('_button')) {
    const root = base.replace(/_button$/, '');
    if (WOOD_TYPES.includes(root)) push(`blocks/${root}_planks.png`);
    else push(`blocks/${root}.png`);
  } else if (base.endsWith('_pressure_plate')) {
    const root = base.replace(/_pressure_plate$/, '');
    if (WOOD_TYPES.includes(root)) push(`blocks/${root}_planks.png`);
    else push(`blocks/${root}.png`);
  } else if (base.endsWith('_stairs')) {
    const root = base.slice(0, -7);
    if (WOOD_TYPES.includes(root)) push(`blocks/${root}_planks.png`);
    else { push(`blocks/${root}.png`); push(`blocks/${root}_top.png`); }
  } else if (base.endsWith('_slab')) {
    const root = base.slice(0, -5);
    if (WOOD_TYPES.includes(root)) push(`blocks/${root}_planks.png`);
    else { push(`blocks/${root}.png`); push(`blocks/${root}_top.png`); }
  } else if (base.endsWith('_fence') || base.endsWith('_fence_gate')) {
    const root = base.replace(/_fence(_gate)?$/, '');
    if (WOOD_TYPES.includes(root)) push(`blocks/${root}_planks.png`);
    else push(`blocks/${root}.png`);
  } else if (base.endsWith('_trapdoor')) {
    push(`blocks/${base}.png`);
    push(`items/${base}.png`);
  } else if (base === 'straw_bed') {
    push('blocks/hay_block_side.png');
    push(`items/${base}.png`);
  } else if (base.endsWith('_bed')) {
    const color = base.slice(0, -4);
    push(`blocks/${color}_wool.png`);
    push(`items/${base}.png`);
  } else if (base.endsWith('_cushion')) {
    const color = base.slice(0, -8);
    push(`blocks/${color}_wool.png`);
  } else if (base.endsWith('_shelf')) {
    const root = base.slice(0, -6);
    if (WOOD_TYPES.includes(root)) push(`blocks/${root}_planks.png`);
  } else if (base.endsWith('_banner')) {
    const color = base.slice(0, -7);
    push(`blocks/${color}_wool.png`);
    push(`items/${base}.png`);
  } else if (base.endsWith('_sign')) {
    const root = base.replace(/_hanging_sign$/, '').replace(/_sign$/, '');
    if (WOOD_TYPES.includes(root)) push(`blocks/${root}_planks.png`);
    else push(`items/${base}.png`);
  } else if (base.endsWith('_door')) {
    push(`items/${base}.png`);
    push(`blocks/${base}_bottom.png`);
  } else if (base.endsWith('_carpet')) {
    const color = base.slice(0, -7);
    push(`blocks/${color}_wool.png`);
  } else if (base.endsWith('_wool') || base.endsWith('_terracotta') || base.endsWith('_concrete') || base.endsWith('_concrete_powder')) {
    push(`blocks/${base}.png`);
  } else if (base.endsWith('_glass_pane')) {
    const root = base.replace(/_pane$/, '');
    push(`blocks/${root}.png`);
  }
  return out;
}

function itemAliasOf(file) {
  if (!file) return null;
  const base = String(file).replace(/\.png$/, '');
  const alias = ITEM_ALIASES[base];
  return alias ? `${alias}.png` : null;
}
// item/block icons; armor layer 1 (helmet/chest/boots) and layer 2 (leggings); itemmod reads a
// texture from the server's own mods/*.jar (the mirror is vanilla-only, so a modded server's
// inventory was all text labels before this).
const KINDS = ['item', 'block', 'armor', 'armorlegs', 'itemmod', 'armormod', 'armormodlegs', 'pack'];

// Modern list kept strictly 26.x/1.21.x/1.20.x for test assertion contract.
const MIRROR_VERSIONS = ['26.1', '1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.1', '1.20.2'];
// Full version list covering all Minecraft releases down to 1.8.8.
const ALL_MIRROR_VERSIONS = [
  ...MIRROR_VERSIONS,
  '1.19.1', '1.18.1', '1.17.1', '1.16.4', '1.16.1', '1.15.2', '1.14.4', '1.13.2', '1.13',
  '1.12', '1.11.2', '1.10', '1.9', '1.8.8',
];
const DEFAULT_VERSION = MIRROR_VERSIONS[0];

// Which mirror version to fetch from for a server running `wanted`.
function mirrorVersion(wanted) {
  const v = String(wanted || '');
  if (!v) return DEFAULT_VERSION;
  if (ALL_MIRROR_VERSIONS.includes(v)) return v;
  const key = parseVersion(v);
  if (!key) return DEFAULT_VERSION;
  let best = null, bestDist = Infinity;
  for (const cand of ALL_MIRROR_VERSIONS) {
    const c = parseVersion(cand);
    if (!c) continue;
    // Same major.minor line first (1.16.5 -> 1.16.4), then anything, nearest by distance.
    const sameLine = c.major === key.major && c.minor === key.minor;
    const dist = sameLine ? Math.abs(c.patch - key.patch) : 1000 + Math.abs(c.major - key.major) * 100 + Math.abs(c.minor - key.minor);
    if (dist < bestDist) { bestDist = dist; best = cand; }
  }
  return best || DEFAULT_VERSION;
}
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v || ''));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +(m[3] || 0) };
}

// --- Hybrid: scan user's local Minecraft client installation (Offline-first, 0ms, 100% EULA safe) ---
function findLocalClientJar(version) {
  const os = require('os');
  const home = os.homedir();
  const dirs = [];
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(
      path.join(appdata, '.minecraft', 'versions'),
      path.join(local, '.minecraft', 'versions'),
      path.join(appdata, 'PrismLauncher', 'libraries'),
      path.join(appdata, 'com.modrinth.launcher', 'meta', 'versions'),
      path.join(home, 'curseforge', 'minecraft', 'Install', 'versions')
    );
  } else if (process.platform === 'darwin') {
    dirs.push(
      path.join(home, 'Library', 'Application Support', 'minecraft', 'versions'),
      path.join(home, 'Library', 'Application Support', 'PrismLauncher', 'libraries')
    );
  } else {
    dirs.push(
      path.join(home, '.minecraft', 'versions'),
      path.join(home, '.local', 'share', 'PrismLauncher', 'libraries')
    );
  }
  try {
    const { loadSettings } = require('./settings.js');
    const sp = loadSettings().serverPath;
    if (sp) dirs.push(sp);
  } catch {}

  const vKey = String(version || '');
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      if (vKey) {
        const direct = path.join(dir, vKey, `${vKey}.jar`);
        if (fs.existsSync(direct)) return direct;
        const loose = path.join(dir, `${vKey}.jar`);
        if (fs.existsSync(loose)) return loose;
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const jar = path.join(dir, ent.name, `${ent.name}.jar`);
          if (fs.existsSync(jar)) return jar;
        } else if (ent.isFile() && /\.jar$/i.test(ent.name) && !/(server|installer|universal|forge|fabric)/i.test(ent.name)) {
          return path.join(dir, ent.name);
        }
      }
    } catch {}
  }
  return null;
}

let _cachedClientJarHandle = null;
let _cachedClientJarPath = null;
function getClientJarHandle(version) {
  const jarPath = findLocalClientJar(version);
  if (!jarPath) return null;
  if (_cachedClientJarPath === jarPath && _cachedClientJarHandle) return _cachedClientJarHandle;
  try {
    _cachedClientJarHandle = openJar(jarPath);
    _cachedClientJarPath = jarPath;
    return _cachedClientJarHandle;
  } catch {
    _cachedClientJarHandle = null;
    _cachedClientJarPath = null;
    return null;
  }
}

function readJarTexLayers(jar, entryPaths) {
  const bufs = [];
  for (let i = 0; i < entryPaths.length; i++) {
    const ep = entryPaths[i];
    if (i > 0 && /_overlay\.png$/i.test(ep)) continue;
    try {
      const data = jar.read(ep);
      if (data && data.length) bufs.push(data);
    } catch {}
  }
  return compositeLayerBuffers(bufs);
}

function openClientItemDef(version, file) {
  const jar = getClientJarHandle(version);
  if (!jar) return null;
  const name = String(file || '').replace(/\.png$/, '');
  const def = readJarJsonSafe(jar, `assets/minecraft/items/${name}.json`);
  const parsedDef = def ? resolveItemDefinitionModels(def, 'minecraft') : null;
  return { jar, name, parsedDef };
}

function readFromLocalClientJar(version, file) {
  const ctx = openClientItemDef(version, file);
  if (!ctx) return null;
  const { jar, name, parsedDef } = ctx;
  if (parsedDef && parsedDef.modelEntries.length) {
    const layerBufs = [];
    for (const me of parsedDef.modelEntries) {
      const mObj = readJarJsonSafe(jar, me);
      if (!mObj) continue;
      const hit = readJarTexLayers(jar, resolveTexturesFromModelJson(mObj, 'minecraft'));
      if (hit) layerBufs.push(hit);
    }
    const merged = compositeLayerBuffers(layerBufs);
    if (merged) return merged;
  }
  const rels = itemCandidateUrls(file);
  const candidates = [
    `assets/minecraft/textures/item/${file}`,
    `assets/minecraft/textures/items/${file}`,
    `assets/minecraft/textures/block/${file}`,
    `assets/minecraft/textures/blocks/${file}`,
  ];
  for (const r of rels) candidates.push(`assets/minecraft/textures/${r}`);
  for (const c of candidates) {
    try {
      const data = jar.read(c);
      if (data && data.length) return data;
    } catch {}
  }
  const modelObj = readJarJsonSafe(jar, `assets/minecraft/models/item/${name}.json`)
    || readJarJsonSafe(jar, `assets/minecraft/models/block/${name}.json`);
  if (modelObj) {
    const mHit = readJarTexLayers(jar, resolveTexturesFromModelJson(modelObj, 'minecraft'));
    if (mHit) return mHit;
  }
  return null;
}

function readFromLocalClientJarArmor(version, file, legs) {
  const jar = getClientJarHandle(version);
  if (!jar) return null;
  const mat = String(file || '').replace(/\.png$/, '').toLowerCase();
  const eqObj = readJarJsonSafe(jar, `assets/minecraft/equipment/${mat}.json`);
  const eq = eqObj ? parseEquipmentAssetJson(eqObj, 'minecraft') : null;
  const candidates = [];
  if (eq) candidates.push(...(legs ? eq.humanoid_leggings : eq.humanoid));
  for (const [dir, sfx] of armorCandidates(version, legs)) {
    candidates.push(`assets/minecraft/textures/${dir}/${mat}${sfx}.png`);
  }
  for (const c of candidates) {
    try {
      const d = jar.read(c);
      if (d && d.length) return d;
    } catch {}
  }
  return null;
}

function readJarJsonSafe(jar, entryPath) {
  try {
    const b = jar.read(entryPath);
    if (b && b.length) return JSON.parse(b.toString('utf8'));
  } catch {}
  return null;
}

function renderFacesIso64(faces, { top, front, side, overlay }) {
  return renderIsometricBlockPng({
    shape: faces.shape,
    top: top || null,
    front: front || null,
    side: side || null,
    overlay: overlay || null,
    tintTop: faces.tintTop,
    tintFront: faces.tintFront,
    tintSide: faces.tintSide,
    tintOverlay: faces.tintOverlay,
  }, 64);
}

function readFromLocalClientJarBlock3D(version, file) {
  const ctx = openClientItemDef(version, file);
  if (!ctx) return null;
  const { jar, name, parsedDef } = ctx;
  if (parsedDef && (parsedDef.isSpecial || parsedDef.isComposite)) return null;
  let root = null;
  if (parsedDef && parsedDef.modelEntries.length) {
    for (const me of parsedDef.modelEntries) {
      root = readJarJsonSafe(jar, me);
      if (root) break;
    }
  }
  if (!root) {
    root = readJarJsonSafe(jar, `assets/minecraft/models/item/${name}.json`)
      || readJarJsonSafe(jar, `assets/minecraft/models/block/${name}.json`);
  }
  if (!root) return null;

  const chain = resolveModelChain((_ns, entry) => readJarJsonSafe(jar, entry), root, 'minecraft', true);

  const faces = resolveModelFacesFromChain(chain, 'minecraft', name);
  if (!faces) return null;

  const readLoc = (loc) => {
    if (!loc) return null;
    try {
      const d = jar.read(loc.entryPath);
      if (d && d.length) return d;
    } catch {}
    return null;
  };
  return renderFacesIso64(faces, {
    top: readLoc(faces.top),
    front: readLoc(faces.front),
    side: readLoc(faces.side),
    overlay: readLoc(faces.overlay),
  });
}

let serverNames = () => [];
let notifyIcon = null;
let modsDirOf = () => null;
const inflight = new Set();

function versionTargets(version) {
  return [version, mirrorVersion(version)].filter((v, i, a) => v && a.indexOf(v) === i);
}

function runInflight(key, asyncFn) {
  if (inflight.has(key)) return;
  inflight.add(key);
  (async () => {
    try {
      await asyncFn();
    } catch {} finally {
      inflight.delete(key);
    }
  })();
}

// 1×1 TRANSPARENT PNG — served on a cache miss instead of a 404 so the DevTools console isn't
// spammed with failed icon loads while the real icon downloads in the background.
//
// The previous constant decoded to a solid BLUE pixel (RGBA 0,0,255,127), not a transparent
// one, so every unresolved icon rendered as a flat blue square — which is exactly what the
// Player Inspector showed for a whole inventory on a server whose version the mirror lacks.
// Verified: this one inflates to scanline [0,0,0,0,0] -> RGBA(0,0,0,0).
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64'
);

function broadcast(channel, payload) {
  if (typeof notifyIcon === 'function') { notifyIcon(channel, payload); return; }
  try {
    const { BrowserWindow } = require('electron');
    if (!BrowserWindow) return;
    for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(channel, payload); } catch {} }
  } catch { /* headless: no windows to notify */ }
}
function init({ serverNames: getNames, notify, modsDir }) {
  if (typeof getNames === 'function') serverNames = getNames;
  if (typeof notify === 'function') notifyIcon = notify;
  // A getter, not a path: the active instance can change while the app runs, so the mods folder
  // must be re-read per request. Returning null disables the itemmod kind gracefully.
  if (typeof modsDir === 'function') modsDirOf = modsDir;
}

// "paper-26.3.jar" → "26.3", "minecraft_server.1.21.4.jar" → "1.21.4", else null.
function detectMcVersion(names) {
  for (const n of names || []) {
    const m = String(n).match(/\b(1\.\d{1,2}(?:\.\d{1,2})?|26\.\d{1,2}(?:\.\d{1,2})?)\b/);
    if (m) return m[1];
  }
  return null;
}

function cacheRoot() { return path.join(dataDir(), 'textures'); }

// kind is the renderer's singular form ('item'|'block'); both cache and bundled use that layout.
function resolveLocal(version, kind, file) {
  if (!version) return null;
  const p = path.join(cacheRoot(), version, kind, file);
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch {}
  return null;
}

// Every tex:// response carries ACAO because the scheme is registered corsEnabled (see main.js).
// Without it a WebGL texImage2D from a file:// page is a cross-origin pixel read and Chromium
// refuses to upload the texture, which is what made armor silently vanish.
const PNG_HEADERS = { 'content-type': 'image/png', 'access-control-allow-origin': '*' };
function pngResponse(file) {
  try { return new Response(fs.readFileSync(file), { headers: PNG_HEADERS }); }
  catch { return new Response('', { status: 404 }); }
}

function respondWithCachedPng(buf, version, kind, file) {
  if (buf && buf.length) {
    const dest = path.join(cacheRoot(), version, kind, file);
    try { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, buf); } catch {}
    return new Response(buf, { headers: { ...PNG_HEADERS, 'cache-control': 'no-store' } });
  }
  return new Response(PLACEHOLDER_PNG, { headers: { ...PNG_HEADERS, 'cache-control': 'no-store' } });
}

function resolveActiveModsDir() {
  let dir = null;
  try { dir = modsDirOf(); } catch { dir = null; }
  if (!dir) {
    try {
      const { loadSettings } = require('./settings.js');
      const sp = loadSettings().serverPath;
      if (sp) dir = path.join(sp, 'mods');
    } catch {}
  }
  return dir;
}

function handle(request) {
  let u;
  try { u = new URL(request.url); } catch { return new Response('', { status: 400 }); }
  // Split BEFORE decoding: an itemmod name may contain an encoded slash (%2F), and decoding the
  // whole pathname first would turn it into a path separator and break the two-part shape.
  const parts = u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  if (parts.length !== 2) return new Response('', { status: 400 });
  const [kind, rawFile] = parts;
  if (!KINDS.includes(kind)) return new Response('', { status: 400 });
  // itemmod files are written as <namespace>_<name>.png because a tex:// path segment cannot
  // contain a slash. Every other kind keeps the strict lower-case name-only pattern.
  const file = String(rawFile).toLowerCase();
  const isModKind = kind === 'itemmod' || kind === 'armormod' || kind === 'armormodlegs';
  const fileOk = isModKind
    ? /^[a-z0-9_.-]+~[a-z0-9_./-]+\.png$/.test(file) && !file.includes('..')
    : /^[a-z0-9_-]+\.png$/.test(file) && !file.includes('..');
  if (!fileOk) return new Response('', { status: 400 });

  const version = u.hostname === 'auto'
    ? (detectMcVersion(serverNames()) || DEFAULT_VERSION)
    : u.hostname;

  // Mod textures come from the server's mod jars. Query the mod index first so
  // newly discovered model JSON definitions or updated mod jars take immediate effect
  // and update any existing disk cache rather than being bypassed by stale files.
  if (kind === 'itemmod') {
    const modParts = splitModFile(file);
    if (modParts) {
      const custom = renderCustomModItem(modParts.namespace, modParts.name);
      if (custom) return respondWithCachedPng(custom, version, kind, file);
    }
    const modBuf = readModTexture(file, version);
    if (modBuf) return respondWithCachedPng(modBuf, version, kind, file);
    return new Response(PLACEHOLDER_PNG, { headers: { ...PNG_HEADERS, 'cache-control': 'no-store' } });
  }

  if (kind === 'armormod' || kind === 'armormodlegs') {
    const layer = kind === 'armormodlegs' ? 2 : 1;
    const armorInfo = readModArmorInfo(file, layer);
    const warnStatus = armorInfo.isCustomGeo ? 'custom-geo' : (armorInfo.nonStandardUv ? 'nonstandard-uv' : '');
    if (armorInfo.buffer) {
      const dest = path.join(cacheRoot(), version, kind, file);
      try { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, armorInfo.buffer); } catch {}
      const headers = { ...PNG_HEADERS, 'cache-control': 'no-store' };
      if (warnStatus) headers['x-observer-armor-status'] = warnStatus;
      return new Response(armorInfo.buffer, { headers });
    }
    return new Response(PLACEHOLDER_PNG, {
      headers: {
        ...PNG_HEADERS,
        'cache-control': 'no-store',
        'x-observer-armor-status': armorInfo.isCustomGeo ? 'custom-geo' : 'missing',
      },
    });
  }

  if (kind === 'item' || kind === 'block') {
    const isoLocal = resolveLocal(version, 'iso3d-v2', file);
    if (isoLocal) return pngResponse(isoLocal);

    const baseName = file.replace(/\.png$/, '');
    const customVanilla = renderCustomVanillaItem(baseName);
    if (customVanilla) return respondWithCachedPng(customVanilla, version, kind, file);

    // Offline-first 3D Client JAR block model composite
    const jar3d = readFromLocalClientJarBlock3D(version, file);
    if (jar3d) return respondWithCachedPng(jar3d, version, 'iso3d-v2', file);
  }

  const local = resolveLocal(version, kind, file);
  if (local) {
    if (kind === 'item' || kind === 'block') {
      // Lazily upgrade any pre-v9.1 single-face cached block PNG to 64x64 multi-face 3D iso
      queueBlockCompositeIfNeeded(version, kind, file);
      if (file.endsWith('_bed.png')) {
        try {
          if (fs.statSync(local).size <= 500) fs.unlinkSync(local);
          else return pngResponse(local);
        } catch { return pngResponse(local); }
      } else {
        return pngResponse(local);
      }
    } else {
      return pngResponse(local);
    }
  }
  // An aliased item serves the base texture's cached copy immediately, so the second open of the
  // inspector does not flash the placeholder first.
  if (kind === 'item') {
    const alias = itemAliasOf(file);
    if (alias) { const a = resolveLocal(version, kind, alias); if (a) return pngResponse(a); }
  }

  // Hybrid: Try reading from a local Minecraft client JAR if available on the system (0ms offline)
  if (kind === 'item' || kind === 'block') {
    const localBuf = readFromLocalClientJar(version, file);
    if (localBuf && localBuf.length) {
      const dest = path.join(cacheRoot(), version, kind, file);
      try { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, localBuf); } catch {}
      return new Response(localBuf, { headers: { ...PNG_HEADERS, 'cache-control': 'no-store' } });
    }
  } else if (kind === 'armor' || kind === 'armorlegs') {
    const localArmor = readFromLocalClientJarArmor(version, file, kind === 'armorlegs');
    if (localArmor && localArmor.length) {
      const dest = path.join(cacheRoot(), version, kind, file);
      try { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, localArmor); } catch {}
      return new Response(localArmor, { headers: { ...PNG_HEADERS, 'cache-control': 'no-store' } });
    }
  }

  queueRemote(version, kind, file); // fire-and-forget: next render hits the cache
  // Transparent 1×1 instead of 404: no console error spam, no broken-image flash. The renderer
  // re-renders icon grids when the real icon lands (icons:update event + ?e= cache-buster).
  return new Response(PLACEHOLDER_PNG, { headers: { ...PNG_HEADERS, 'cache-control': 'no-store' } });
}

// Mojang moved the humanoid armor textures in 1.21.2:
//   before 1.21.2  textures/models/armor/<mat>_layer_1.png   (+ _layer_2 = leggings)
//   1.21.2+        textures/entity/equipment/humanoid/<mat>.png (+ humanoid_leggings/)
// The mirror keeps the same split, so a 1.21.4+ server 404s on the OLD path -- which is exactly
// what the player inspector asked for, so the 3D model rendered with no armor at all.
// Compare (major, minor, patch) numerically: "1.9.4" must not sort above "1.21.2", and 26.x must.
function newArmorLayout(version) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(version || ''));
  if (!m) return true; // unrecognised id (custom build) -> try the current layout, then the old
  const major = +m[1], minor = +m[2], patch = +(m[3] || 0);
  if (major !== 1) return major > 1;
  if (minor !== 21) return minor > 21;
  return patch >= 2;
}

// [directory, filename suffix] pairs to try, this version's own layout first. The second entry
// is the other layout, so a jar whose version was misdetected (renamed jar, custom id) still
// gets its armor -- one reload later, since a miss only queues a background fetch.
function armorCandidates(version, legs) {
  const layer = legs ? 2 : 1;
  const build = modern => modern
    ? [`entity/equipment/${legs ? 'humanoid_leggings' : 'humanoid'}`, '']
    : ['models/armor', `_layer_${layer}`];
  return newArmorLayout(version) ? [build(true), build(false)] : [build(false), build(true)];
}

const blocksModelsMem = new Map();
const blocksModelsInflight = new Map();
const nonBlockCompositeSkip = new Set();

function resolveVanillaModelFromMap(blockName, modelsMap) {
  if (!modelsMap || typeof modelsMap !== 'object' || !blockName) return null;
  const cleanName = String(blockName).replace(/^minecraft:/, '').replace(/^block\//, '');
  const root = modelsMap[cleanName];
  if (!root || typeof root !== 'object') return null;
  const chain = [root];
  const seen = new Set([cleanName]);
  let cur = root;
  for (let depth = 0; depth < 8 && cur && typeof cur.parent === 'string'; depth++) {
    const pKey = cur.parent.replace(/^minecraft:/, '').replace(/^block\//, '');
    if (seen.has(pKey)) break;
    seen.add(pKey);
    const next = modelsMap[pKey];
    if (!next || typeof next !== 'object') break;
    chain.push(next);
    cur = next;
  }
  return resolveModelFacesFromChain(chain, 'minecraft', cleanName);
}

async function ensureBlocksModels(targets) {
  for (const ver of targets) {
    if (blocksModelsMem.has(ver)) {
      const hit = blocksModelsMem.get(ver);
      if (hit) return { ver, map: hit };
      continue;
    }
    const diskPath = path.join(cacheRoot(), ver, 'blocks_models.json');
    try {
      if (fs.existsSync(diskPath)) {
        const parsed = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          blocksModelsMem.set(ver, parsed);
          return { ver, map: parsed };
        }
      }
    } catch {}
    if (!blocksModelsInflight.has(ver)) {
      blocksModelsInflight.set(ver, (async () => {
        for (const baseCdn of CDN_BASES) {
          const buf = await downloadBuffer(`${baseCdn}/${encodeURIComponent(ver)}/blocks_models.json`);
          if (!buf || !buf.length) continue;
          try {
            const parsed = JSON.parse(buf.toString('utf8'));
            if (parsed && typeof parsed === 'object') {
              try { fs.mkdirSync(path.dirname(diskPath), { recursive: true }); fs.writeFileSync(diskPath, buf); } catch {}
              blocksModelsMem.set(ver, parsed);
              return parsed;
            }
          } catch {}
        }
        blocksModelsMem.set(ver, null);
        return null;
      })().finally(() => blocksModelsInflight.delete(ver)));
    }
    const fetched = await blocksModelsInflight.get(ver);
    if (fetched) return { ver, map: fetched };
  }
  return null;
}

function cdnPathFromTexLoc(loc) {
  const tp = String(loc.texPath || '').replace(/^\/+/, '');
  const rel = tp.startsWith('block/') ? 'blocks/' + tp.slice(6)
    : tp.startsWith('item/') ? 'items/' + tp.slice(5)
    : tp;
  return `${rel}.png`;
}

async function fetchRawFaceTexture(loc, targets, version) {
  if (!loc || !loc.texPath) return null;
  if (loc.ns === 'minecraft') {
    const jar = getClientJarHandle(version);
    if (jar) {
      try {
        const jb = jar.read(loc.entryPath);
        if (jb && jb.length) return jb;
      } catch {}
    }
  }
  const safeName = `${loc.ns}_${loc.texPath.replace(/[^\w.-]/g, '_')}.png`;
  const rawCache = path.join(cacheRoot(), version, 'raw_tex', safeName);
  try {
    if (fs.existsSync(rawCache)) return fs.readFileSync(rawCache);
  } catch {}
  if (loc.ns !== 'minecraft') return null;
  const cdnRel = cdnPathFromTexLoc(loc);
  for (const baseCdn of CDN_BASES) {
    for (const v of targets) {
      const buf = await downloadBuffer(`${baseCdn}/${encodeURIComponent(v)}/${cdnRel}`);
      if (buf && buf.length > 32) {
        try { fs.mkdirSync(path.dirname(rawCache), { recursive: true }); fs.writeFileSync(rawCache, buf); } catch {}
        return buf;
      }
    }
  }
  return null;
}

async function compositeVanillaBlockIso(version, file, targets) {
  const name = String(file || '').replace(/\.png$/, '');
  const skipKey = `${version}/${name}`;
  if (nonBlockCompositeSkip.has(skipKey)) return false;
  const bm = await ensureBlocksModels(targets);
  if (!bm || !bm.map) return false;
  const faces = resolveVanillaModelFromMap(name, bm.map);
  if (!faces) {
    nonBlockCompositeSkip.add(skipKey);
    return false;
  }

  // Deduplicate unique texture fetches cleanly
  const uniqueLocs = new Map();
  for (const loc of [faces.top, faces.front, faces.side, faces.overlay]) {
    if (loc && !uniqueLocs.has(loc.entryPath)) {
      uniqueLocs.set(loc.entryPath, fetchRawFaceTexture(loc, targets, version));
    }
  }
  const resolved = new Map();
  await Promise.all([...uniqueLocs.entries()].map(async ([k, p]) => { resolved.set(k, await p); }));

  const isoBuf = renderFacesIso64(faces, {
    top: faces.top ? resolved.get(faces.top.entryPath) : null,
    front: faces.front ? resolved.get(faces.front.entryPath) : null,
    side: faces.side ? resolved.get(faces.side.entryPath) : null,
    overlay: faces.overlay ? resolved.get(faces.overlay.entryPath) : null,
  });
  if (!isoBuf) return false;

  const dest = path.join(cacheRoot(), version, 'iso3d-v2', file);
  try { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, isoBuf); } catch {}
  return true;
}

function queueBlockCompositeIfNeeded(version, kind, file) {
  const name = String(file || '').replace(/\.png$/, '');
  if (nonBlockCompositeSkip.has(`${version}/${name}`)) return;
  runInflight(`${version}/iso3d-v2/${file}`, async () => {
    const targets = versionTargets(version);
    if (await compositeVanillaBlockIso(version, file, targets)) {
      broadcast('icons:update', { rel: `${version}/${kind}/${file}` });
    }
  });
}

function queueRemote(version, kind, file) {
  runInflight(`${version}/${kind}/${file}`, async () => {
    const mat = file.replace(/\.png$/, '');
    const targets = versionTargets(version);

    if (kind === 'item' || kind === 'block') {
      if (await compositeVanillaBlockIso(version, file, targets)) {
        broadcast('icons:update', { rel: `${version}/${kind}/${file}` });
        return;
      }
    }

    const candidateRels = [];
    if (kind === 'armor' || kind === 'armorlegs') {
      for (const [dir, sfx] of armorCandidates(targets[0], kind === 'armorlegs')) {
        candidateRels.push(`${dir}/${mat}${sfx}.png`);
      }
    } else if (kind === 'item') {
      for (const rel of itemCandidateUrls(file)) {
        candidateRels.push(rel);
      }
    } else {
      candidateRels.push(`blocks/${file}`);
    }

    const urls = [];
    if (kind === 'item') {
      urls.push(`https://cdn.jsdelivr.net/gh/Owen1212055/mc-assets@main/item-assets/${encodeURIComponent(mat.toUpperCase())}.png`);
    }
    // Prioritize jsDelivr global CDN first, fallback to raw github second
    for (const baseCdn of CDN_BASES) {
      for (const v of targets) {
        for (const rel of candidateRels) {
          urls.push(`${baseCdn}/${encodeURIComponent(v)}/${rel}`);
        }
      }
    }

    // Cache under the version the renderer asked for, so the next request hits resolveLocal
    // without another round trip.
    for (const url of urls) {
      if (await fetchInto(url, kind, file, version)) {
        broadcast('icons:update', { rel: `${version}/${kind}/${file}` });
        return;
      }
    }
  });
}

async function downloadBuffer(url) {
  try {
    const { net } = require('electron');
    if (net && typeof net.fetch === 'function') {
      const r = await net.fetch(url);
      if (r && r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length) return buf;
      }
    }
  } catch {}
  return new Promise(resolve => {
    try {
      const https = require('https');
      const req = https.get(url, { headers: { 'User-Agent': 'ObserverLauncher' }, timeout: 6000 }, res => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch {
      resolve(null);
    }
  });
}

async function fetchInto(url, kind, file, version) {
  const buf = await downloadBuffer(url);
  if (!buf || !buf.length) return false;
  const dest = path.join(cacheRoot(), version, kind, file);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

// Split an itemmod filename `<namespace>~<name>.png` back into its parts. The tilde is the
// separator because it is not valid in a resource location, so it cannot appear inside the
// namespace or the item name (both allow underscores: cofh_core, diamond_sword). Returns null on
// a malformed name.
function splitModFile(file) {
  const base = String(file || '').replace(/\.png$/, '');
  const i = base.indexOf('~');
  if (i <= 0 || i === base.length - 1) return null;
  return { namespace: base.slice(0, i), name: base.slice(i + 1) };
}

// Read a mod texture through the singleton index. The dir comes from the getter because the active
// instance can change; readTexture caches per session and drops the cache on a folder signature
// change, so a mod update is picked up on the next request.
function prepareModLookup(file) {
  const parts = splitModFile(file);
  if (!parts) return null;
  const dir = resolveActiveModsDir();
  if (!dir) return null;
  modsIndex.setModsDir(dir);
  return parts;
}

function queueModHybridComposite(file, parts, faces, version) {
  runInflight(`itemmod3d:${version}/${file}`, async () => {
    const targets = versionTargets(version);
    const pickBuf = async (loc, jarBuf) => {
      if (jarBuf && jarBuf.length) return jarBuf;
      if (loc && loc.ns === 'minecraft') return await fetchRawFaceTexture(loc, targets, version);
      return null;
    };
    const [top, front, side, overlay] = await Promise.all([
      pickBuf(faces.top, faces.buffers.top),
      pickBuf(faces.front, faces.buffers.front),
      pickBuf(faces.side, faces.buffers.side),
      pickBuf(faces.overlay, faces.buffers.overlay),
    ]);
    const isoBuf = renderFacesIso64(faces, { top, front, side, overlay });
    if (isoBuf) {
      modsIndex.extractCache.set(`iso3d:${parts.namespace}:${parts.name}`, isoBuf);
      broadcast('icons:update', { rel: `${version}/itemmod/${file}` });
    }
  });
}

function readModTexture(file, version = DEFAULT_VERSION) {
  const parts = prepareModLookup(file);
  if (!parts) return null;
  const custom = renderCustomModItem(parts.namespace, parts.name);
  if (custom) return custom;

  const isoKey = `iso3d:${parts.namespace}:${parts.name}`;
  if (modsIndex.extractCache.has(isoKey)) return modsIndex.extractCache.get(isoKey);

  const faces = modsIndex.readBlockFaces(parts.namespace, parts.name);
  if (faces) {
    const jar = getClientJarHandle(version);
    const jarOrBuf = (loc, modBuf) => {
      if (modBuf && modBuf.length) return modBuf;
      if (jar && loc && loc.ns === 'minecraft') {
        try { const d = jar.read(loc.entryPath); if (d && d.length) return d; } catch {}
      }
      return null;
    };
    const top = jarOrBuf(faces.top, faces.buffers.top);
    const front = jarOrBuf(faces.front, faces.buffers.front);
    const side = jarOrBuf(faces.side, faces.buffers.side);
    const overlay = jarOrBuf(faces.overlay, faces.buffers.overlay);
    const needsMissingVanilla =
      (!top && faces.top?.ns === 'minecraft') ||
      (!front && faces.front?.ns === 'minecraft') ||
      (!side && faces.side?.ns === 'minecraft');
    if (needsMissingVanilla) {
      queueModHybridComposite(file, parts, faces, version);
    } else if (top || front || side) {
      const isoBuf = renderFacesIso64(faces, { top, front, side, overlay });
      if (isoBuf) {
        modsIndex.extractCache.set(isoKey, isoBuf);
        return isoBuf;
      }
    }
  }
  return modsIndex.readTexture(parts.namespace, parts.name);
}

function patchIceAndFireArmorBlack(blackBuf) {
  try {
    const grayBuf = modsIndex.readArmorTexture('iceandfire', 'armor_gray', 1);
    if (!grayBuf) return blackBuf;
    const gray = decodePngRgba(grayBuf);
    if (!gray || gray.w !== 64 || gray.h !== 64) return blackBuf;
    // armor_black.png in Ice & Fire is an unfinished template file containing Blockbench UV debug
    // markers (pure cyan, magenta, yellow, blue wireframe markers) and raw white fill intended
    // for OpenGL runtime glColor4f tinting.
    // armor_gray.png has the full genuine textured dragon scales for both helmet and body.
    // Tone armor_gray across all 64x64 rows to 0.50 luminance for authentic dark black dragon scales,
    // leaving the untextured background completely transparent without injecting any debug pixels.
    const combined = Buffer.alloc(64 * 64 * 4);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const idx = (y * 64 + x) * 4;
        const ga = gray.rgba[idx + 3];
        if (ga > 10) {
          combined[idx] = Math.round(gray.rgba[idx] * 0.50);
          combined[idx + 1] = Math.round(gray.rgba[idx + 1] * 0.50);
          combined[idx + 2] = Math.round(gray.rgba[idx + 2] * 0.50);
          combined[idx + 3] = ga;
        }
      }
    }
    return encodePng(64, 64, combined);
  } catch {
    return blackBuf;
  }
}

function readModArmorInfo(file, layer) {
  const parts = prepareModLookup(file);
  if (!parts) return { buffer: null, isCustomGeo: false };
  const info = modsIndex.readArmorTextureInfo(parts.namespace, parts.name, layer);
  if (!info.buffer) return info;
  if (parts.namespace === 'iceandfire' && Number(layer) === 1 && parts.name === 'armor_black') {
    return { buffer: patchIceAndFireArmorBlack(info.buffer), isCustomGeo: info.isCustomGeo };
  }
  return info;
}

function readModArmorTexture(file, layer) {
  return readModArmorInfo(file, layer).buffer;
}

module.exports = { init, handle, setActiveResourcePackPath, getActiveResourcePackPath, detectMcVersion, newArmorLayout, armorCandidates, mirrorVersion, MIRROR_VERSIONS, splitModFile, itemAliasOf, readModArmorTexture, readModArmorInfo, resolveVanillaModelFromMap };
