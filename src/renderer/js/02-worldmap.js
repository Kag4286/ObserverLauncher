// js/02-worldmap.js — ObserverLauncher World Map Deluxe Cartography Engine
// 60 FPS hardware-accelerated tile engine, topographic hillshading, slime chunks,
// Nether roof peeler, player vision cones, and waypoint tooling.

// Java Edition Slime Chunk formula for Overworld (chunkX, chunkZ)
function isSlimeChunk(seedBig, cx, cz) {
  if (seedBig === null || seedBig === undefined) return false;
  const sVal = BigInt.asIntN(64, BigInt(seedBig)), bx = BigInt(cx | 0), bz = BigInt(cz | 0);
  const hash = BigInt.asIntN(64, sVal + (bx * bx * 4987142n) + (bx * 5947611n) + (bz * bz * 4392871n) + (bz * 389711n) ^ 987234911n);
  let lcg = (hash ^ 0x5DEECE66Dn) & 0xFFFFFFFFFFFFn;
  lcg = (lcg * 0x5DEECE66Dn + 0xBn) & 0xFFFFFFFFFFFFn;
  return Number((lcg >> 17n) % 10n) === 0;
}

const WM_WP_ICONS = {
  star: '⭐',
  base: '🏠',
  mine: '⛏',
  portal: '🌀',
  death: '💀',
  outpost: '🚩'
};

const STRUCTURE_ICONS = {
  village: '🏘',
  pillager_outpost: '🏹',
  monument: '🔱',
  fortress: '🏰',
  bastion_remnant: '🐷',
  ancient_city: '🏛',
  mansion: '🏰',
  end_city: '🛸',
  mineshaft: '⛏',
  stronghold: '👁',
  swamp_hut: '🧙',
  desert_pyramid: '🔺',
  jungle_pyramid: '🔺',
  trail_ruins: '🏺',
  trial_chambers: '⚔'
};

let wm = {
  level: null,
  players: [],
  waypoints: [],
  structures: new Map(),
  dim: 'overworld',
  cam: { x: 0, z: 0 },
  zoom: 0.25,
  addMode: false,
  drag: null,
  dragWp: null,
  loaded: false,
  seedBig: 0n,
  cheatMode: false,
  layers: {
    terrain: true,
    hillshade: true,
    slime: false,
    structures: false,
    grid: false,
    netherLink: false
  },
  sliceY: null,
  explored: new Set(),
  exploredDim: null,
  biomes: new Map(),
  biomeReqSeq: 0,
  biomeTimer: null,
  lastBiomeRect: '',
  biomeLoading: false,
  biomeTooWide: false,
  biomeTruncated: false,
  miniAt: 0,
  biomeBlend: true,
  biomeBlendW: 0.22,
  fullscreen: false,
  selectedPos: null,
  pendingWpPos: null
};

const BIOME_COLORS = {
  ocean: '#2E5A8A', deep_ocean: '#1E3F63', warm_ocean: '#2F8FA0', lukewarm_ocean: '#3585A0', cold_ocean: '#254A72', frozen_ocean: '#2A4A6A', deep_cold_ocean: '#1A3452', deep_frozen_ocean: '#1C3A55', deep_lukewarm_ocean: '#285570',
  river: '#3E7FB0', frozen_river: '#4E7C9E', beach: '#C9BE8A', snowy_beach: '#D5D8DA', stony_shore: '#8A8477',
  plains: '#7CA94E', sunflower_plains: '#8CB255', snowy_plains: '#DCE1E5', ice_spikes: '#BCCAD6', meadow: '#8CBE63',
  forest: '#4E8A3C', flower_forest: '#5E9846', birch_forest: '#78A056', old_growth_birch_forest: '#85A85F', dark_forest: '#2F5A2A', pale_garden: '#778272',
  taiga: '#4F7C58', snowy_taiga: '#5C7C72', old_growth_pine_taiga: '#427047', old_growth_spruce_taiga: '#406B47',
  jungle: '#2E7D32', sparse_jungle: '#4E8B3E', bamboo_jungle: '#5C9A3E',
  desert: '#D9C97C', badlands: '#B4744A', eroded_badlands: '#A55F33', wooded_badlands: '#9C6B3F', savanna: '#BCB05E', savanna_plateau: '#B3A550', windswept_savanna: '#A89A46',
  swamp: '#5A6B45', mangrove_swamp: '#4E6B4A',
  snowy_slopes: '#DCE1E5', grove: '#5E7C6A', windswept_hills: '#8A8A7E', windswept_gravelly_hills: '#97968B', windswept_forest: '#5E7A55', jagged_peaks: '#C9CDD2', frozen_peaks: '#DCE2E6', stony_peaks: '#9A9C92',
  mushroom_fields: '#8A7C8E', cherry_grove: '#B6DB61',
  nether_wastes: '#7A3B33', crimson_forest: '#8E2E3E', warped_forest: '#2E7A72', soul_sand_valley: '#5A4A3E', basalt_deltas: '#54545C', sulfur_caves: '#ABA64F',
  the_end: '#C9C29A', end_highlands: '#C2BB92', end_midlands: '#B8B189', small_end_islands: '#A8A17C', end_barrens: '#9C9577',
  the_void: '#0A0F14', dripstone_caves: '#8A7355', lush_caves: '#4E8A5A', deep_dark: '#1E3A4A',
  mountains: '#8A8A7E', wooded_mountains: '#5E7A55', gravelly_mountains: '#97968B', modified_gravelly_mountains: '#97968B',
  snowy_tundra: '#DCE1E5', snowy_mountains: '#DCE2E6', stone_shore: '#8A8477',
  giant_tree_taiga: '#427047', giant_tree_taiga_hills: '#427047', giant_spruce_taiga: '#406B47', giant_spruce_taiga_hills: '#406B47',
  tall_birch_forest: '#85A85F', tall_birch_hills: '#85A85F', birch_forest_hills: '#78A056',
  desert_hills: '#D9C97C', desert_lakes: '#D9C97C', wooded_hills: '#4E8A3C', taiga_hills: '#4F7C58', snowy_taiga_hills: '#5C7C72', snowy_taiga_mountains: '#5C7C72',
  jungle_hills: '#2E7D32', jungle_edge: '#4E8B3E', modified_jungle: '#2E7D32', modified_jungle_edge: '#4E8B3E',
  badlands_plateau: '#9C6B3F', wooded_badlands_plateau: '#9C6B3F', modified_badlands_plateau: '#B4744A', modified_wooded_badlands_plateau: '#9C6B3F',
  shattered_savanna: '#A89A46', shattered_savanna_plateau: '#A89A46',
  mushroom_field_shore: '#8A7C8E', swamp_hills: '#5A6B45', bamboo_jungle_hills: '#5C9A3E'
};

const BLOCK_COLORS = {
  coal_ore: '#2B2B2B', deepslate_coal_ore: '#242424', iron_ore: '#D8AF93', deepslate_iron_ore: '#B88F73', copper_ore: '#C06C4E', deepslate_copper_ore: '#9E583E', gold_ore: '#FCEE4B', deepslate_gold_ore: '#D4B830', redstone_ore: '#E02210', deepslate_redstone_ore: '#A8180A', lapis_ore: '#1C4D9C', deepslate_lapis_ore: '#143B7A', diamond_ore: '#5DECF5', deepslate_diamond_ore: '#3CBCC5', emerald_ore: '#17DD62', deepslate_emerald_ore: '#10A848', amethyst_block: '#9A5CC6', glow_lichen: '#788A75', cave_air: '#0A0D12',
  grass_block: '#6B9E44', podzol: '#5B4330', mycelium: '#6E636B', moss_block: '#4E7A3A',
  dirt: '#79553A', coarse_dirt: '#75553B', rooted_dirt: '#906E4E', mud: '#3A3A44', muddy_mangrove_roots: '#40404A',
  sand: '#D9CF97', red_sand: '#BF6B36', gravel: '#7A7370', clay: '#9AA2AA',
  stone: '#7E7E7E', andesite: '#8A8A8A', diorite: '#BCBCBC', granite: '#9A6B5A', deepslate: '#4B4B4B', tuff: '#6E6D64', calcite: '#D8D6CC', dripstone_block: '#866B5B', pointed_dripstone: '#866B5B', sculk: '#0B2028', sculk_catalyst: '#0E2833', sculk_sensor: '#0B2B33', sculk_shrieker: '#1C3840',
  terracotta: '#985E43', red_terracotta: '#8E3B26', orange_terracotta: '#A15325', yellow_terracotta: '#BA8523', white_terracotta: '#D2B6A1', light_gray_terracotta: '#876A61', brown_terracotta: '#4D3323',
  snow: '#E9EDF0', snow_block: '#E9EDF0', powder_snow: '#E9EDF0', ice: '#8FBFE0', packed_ice: '#8FB4D6', blue_ice: '#6FA8DC',
  water: '#2E5A8A', kelp: '#2E5A8A', seagrass: '#2E5A8A',
  netherrack: '#6E2B26', soul_sand: '#52403A', soul_soil: '#4A3830', crimson_nylium: '#7A2733', warped_nylium: '#2E6B60', basalt: '#4E4E54', blackstone: '#3A3236', magma_block: '#8A3B1E', lava: '#C24A0F',
  end_stone: '#D5D0A0', obsidian: '#15121E', bedrock: '#333338',
  mossy_cobblestone: '#5A6B4E', cobblestone: '#6E6E6E', diorite_stairs: '#BCBCBC'
};

function shadeHex(hex, h) {
  const f = 0.72 + Math.max(0, Math.min(1, (Number(h) - 60) / 140)) * 0.53;
  const n = parseInt(String(hex).slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function applyHillshade(hex, factor) {
  if (Math.abs(factor) < 0.005) return hex;
  const n = parseInt(String(hex).slice(1), 16);
  const mul = 1 + factor;
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * mul)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * mul)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * mul)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function mixHex(a, b, t) {
  const na = parseInt(String(a).slice(1), 16), nb = parseInt(String(b).slice(1), 16);
  const r = Math.round(((na >> 16) & 255) * (1 - t) + ((nb >> 16) & 255) * t);
  const g = Math.round(((na >> 8) & 255) * (1 - t) + ((nb >> 8) & 255) * t);
  const bl = Math.round((na & 255) * (1 - t) + (nb & 255) * t);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

function blockColor(name) {
  if (!name) return null;
  const k = String(name).replace(/^[a-z0-9_.-]+:/, '');
  if (BLOCK_COLORS[k]) return BLOCK_COLORS[k];
  if (/leaves/.test(k)) return '#3F7A3A';
  if (/log|wood/.test(k)) return '#5B4330';
  if (/grass_block|grass/.test(k)) return '#6B9E44';
  if (/dirt|podzol/.test(k)) return '#79553A';
  if (/mushroom_block/.test(k)) return '#A13430';
  if (/sand/.test(k)) return '#D9CF97';
  if (/snow/.test(k)) return '#E9EDF0';
  if (/ice/.test(k)) return '#8FBFE0';
  if (/water/.test(k)) return '#2E5A8A';
  if (/lava/.test(k)) return '#D05825';
  if (/diamond_ore/.test(k)) return '#5DECF5';
  if (/emerald_ore/.test(k)) return '#17DD62';
  if (/gold_ore/.test(k)) return '#FCEE4B';
  if (/iron_ore/.test(k)) return '#D8AF93';
  if (/copper_ore/.test(k)) return '#C06C4E';
  if (/redstone_ore/.test(k)) return '#E02210';
  if (/lapis_ore/.test(k)) return '#1C4D9C';
  if (/coal_ore/.test(k)) return '#2B2B2B';
  if (/amethyst/.test(k)) return '#9A5CC6';
  if (/sculk/.test(k)) return '#0B2028';
  if (/dripstone/.test(k)) return '#866B5B';
  if (/deepslate/.test(k)) return '#4B4B4B';
  return null;
}

function surfaceColor(blockName, biomeId) {
  const b = blockColor(blockName);
  if (!b) return null;
  const bare = String(blockName || '').replace(/^[a-z0-9_.-]+:/, '');
  if (/grass|moss|podzol|mycelium|leaves/.test(bare)) {
    return mixHex(b, biomeColor(biomeId), 0.45);
  }
  return b;
}

function blendCells(colors, w) {
  if (!(w > 0)) return colors;
  const out = colors.slice();
  for (let z = 0; z < 4; z++) {
    for (let x = 0; x < 4; x++) {
      const i = z * 4 + x;
      const n = [];
      if (x > 0) n.push(colors[i - 1]); if (x < 3) n.push(colors[i + 1]);
      if (z > 0) n.push(colors[i - 4]); if (z < 3) n.push(colors[i + 4]);
      if (!n.length || !colors[i]) continue;
      let acc = colors[i];
      for (const c of n) acc = mixHex(acc, c, w / n.length);
      out[i] = acc;
    }
  }
  return out;
}

const wmColorCache = new Map();

function wmChunkColors(ck, cx, cz) {
  const key = `${wm.dim}:${ck}:${wm.layers.hillshade ? 'h' : 'f'}:${wm.sliceY ?? 's'}`;
  const hit = wmColorCache.get(key); if (hit) return hit;
  const rec = wm.biomes.get(wm.dim + ':' + ck);
  let out;
  if (rec && rec[2] !== undefined) {
    const grid = rec[5], surface = rec[6];
    const base = biomeColor(rec[2]);
    if (rec[3]) {
      out = new Array(16);
      const heights = rec[3];
      for (let oz = 0; oz < 4; oz++) {
        for (let ox = 0; ox < 4; ox++) {
          const i = oz * 4 + ox;
          const bid = grid ? grid[i] : rec[2];
          const h = heights[i];
          let c = (surface && surfaceColor(surface[i], bid)) || biomeColor(bid);
          c = shadeHex(c, h);

          // Topographic hillshading: sun from 315 NW
          if (wm.layers.hillshade) {
            const hL = ox > 0 ? heights[i - 1] : h;
            const hR = ox < 3 ? heights[i + 1] : h;
            const dx = (hR - hL) * 0.5;
            const hU = oz > 0 ? heights[i - 4] : h;
            const hD = oz < 3 ? heights[i + 4] : h;
            const dz = (hD - hU) * 0.5;
            const slopeFactor = Math.max(-0.35, Math.min(0.28, (dx + dz) * 0.06));
            c = applyHillshade(c, slopeFactor);
          }

          // Fluid / water depth gradient
          if (rec[4] && rec[4][i]) {
            c = mixHex(c, '#0284c7', 0.65);
          }
          out[i] = c;
        }
      }
      if (wm.biomeBlend) out = blendCells(out, wm.biomeBlendW);
    } else if (grid) {
      out = new Array(16);
      for (let i = 0; i < 16; i++) out[i] = grid[i] ? ((surface && surfaceColor(surface[i], grid[i])) || biomeColor(grid[i])) : '#20262E';
      if (wm.biomeBlend) out = blendCells(out, wm.biomeBlendW);
    } else if (rec[2]) {
      out = [base];
    } else {
      out = null;
    }
  } else {
    out = null;
  }
  lruSet(wmColorCache, key, out, 4000);
  return out;
}

function hashBiomeColor(k) {
  let h = 0; const s = String(k || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360, sat = 0.34, lig = 0.52;
  const c = (1 - Math.abs(2 * lig - 1)) * sat, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = lig - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; } else if (hue < 120) { r = x; g = c; } else if (hue < 180) { g = c; b = x; } else if (hue < 240) { r = x; g = c; } else if (hue < 300) { r = x; b = c; } else { r = c; b = x; }
  const to = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

function biomeColor(id) {
  if (!id) return '#3A4250';
  const k = String(id).replace(/^[a-z0-9_.-]+:/, '');
  if (BIOME_COLORS[k]) return BIOME_COLORS[k];
  if (/ocean|sea/.test(k)) return '#2E5A8A';
  if (/river/.test(k)) return '#3E7FB0';
  if (/forest|wood|taiga|grove|rainforest|orchard/.test(k)) return '#3F7A3A';
  if (/jungle/.test(k)) return '#2E7D32';
  if (/desert|sand|badland|wasteland|dune/.test(k)) return '#D8C77A';
  if (/snow|frozen|ice|alp|glacier|tundra/.test(k)) return '#D7DCE0';
  if (/mountain|peak|hill|slope|highland|cliff/.test(k)) return '#8A8A7E';
  if (/swamp|mangrove|bayou|marsh|bog|fen|sludge/.test(k)) return '#5A6B45';
  if (/savanna|steppe|prairie|plain|meadow|pasture|grassland/.test(k)) return '#7CA94E';
  if (/beach|shore/.test(k)) return '#C9BE8A';
  if (/cave|dripstone|deep_dark/.test(k)) return '#5A5548';
  if (/nether|crimson|warped|basalt|soul|volcano/.test(k)) return '#7A3B33';
  if (/end/.test(k)) return '#C2BB92';
  return hashBiomeColor(k);
}

const WM_BIOME_MAX_CHUNKS = 1600;
const WM_BIOME_MIN_ZOOM = 0.06;
const WM_LABEL_MIN_ZOOM = 0.15;
const WM_BIOME_CACHE_MAX = 2000;

function wmSetBiome(ck, row, dim) {
  lruSet(wm.biomes, (dim || wm.dim) + ':' + ck, row, WM_BIOME_CACHE_MAX);
  // Invalidate tile cache intersecting this chunk
  const p = ck.split(',');
  const cx = parseInt(p[0], 10), cz = parseInt(p[1], 10);
  const tx = Math.floor(cx / 16), tz = Math.floor(cz / 16);
  const tk = `${dim || wm.dim}:${tx},${tz}:${wm.layers.hillshade ? 'h' : 'f'}:${wm.sliceY ?? 's'}`;
  wmTileCache.delete(tk);
}

let wmPrefetchReqSeq = 0;

function wmIngestBiomePayload(payload, targetDimension) {
  if (!payload || !payload.ok) return 0;
  if (Array.isArray(payload.structures)) {
    for (const item of payload.structures) {
      wm.structures.set(`${item.id}:${item.x},${item.z}`, { ...item, dim: targetDimension });
    }
  }
  let count = 0;
  if (Array.isArray(payload.biomes)) {
    for (const entry of payload.biomes) {
      if (entry && entry.length >= 2) {
        wmSetBiome(`${entry[0]},${entry[1]}`, entry, targetDimension);
        count++;
      }
    }
  }
  return count;
}

function wmScheduleBiomes() {
  if (!wm.level || !wm.layers.terrain || !wm.explored.size) return;
  const cv = $('#wmCanvas'); if (!cv) return;
  const W = cv.clientWidth || 800, H = cv.clientHeight || 520;
  let cx0 = Math.floor((wm.cam.x - W / 2 / wm.zoom) / 16), cx1 = Math.floor((wm.cam.x + W / 2 / wm.zoom) / 16);
  let cz0 = Math.floor((wm.cam.z - H / 2 / wm.zoom) / 16), cz1 = Math.floor((wm.cam.z + H / 2 / wm.zoom) / 16);

  // When zoomed far out, clamp fetch rect to 45-chunk radius around camera center (90x90 chunks = 1440x1440 blocks)
  // so the view around the player / camera vantage point always loads authentic world terrain.
  const MAX_RADIUS = 45;
  const ccx = Math.floor(wm.cam.x / 16), ccz = Math.floor(wm.cam.z / 16);
  if (cx1 - cx0 > MAX_RADIUS * 2) {
    cx0 = ccx - MAX_RADIUS;
    cx1 = ccx + MAX_RADIUS;
  }
  if (cz1 - cz0 > MAX_RADIUS * 2) {
    cz0 = ccz - MAX_RADIUS;
    cz1 = ccz + MAX_RADIUS;
  }

  const rect = [cx0, cz0, cx1, cz1, wm.sliceY ?? ''].join(',');
  if (rect === wm.lastBiomeRect) return;

  clearTimeout(wm.biomeTimer);
  wm.biomeTimer = setTimeout(async () => {
    wm.lastBiomeRect = rect;
    const reqId = ++wm.biomeReqSeq;
    const currentDim = wm.dim;
    wm.biomeLoading = true;
    wmDrawSoon();
    const res = await window.observer.worldmapBiomes({
      dim: currentDim,
      cx0,
      cz0,
      cx1,
      cz1,
      sliceY: wm.sliceY
    }).catch(() => null);
    if (reqId !== wm.biomeReqSeq) return;
    wm.biomeLoading = false;
    if (!res || !res.ok) {
      wm.lastBiomeRect = '';
      return;
    }
    wm.biomeTruncated = !!res.truncated;
    const ingested = wmIngestBiomePayload(res, currentDim);
    if (ingested || wm.biomeTruncated) {
      wmDrawSoon();
      wmRenderLegend();
    }
  }, 220);
}

async function wmPrefetchBiomes(ccx, ccz, half) {
  if (!wm.level) return;
  const pfId = ++wmPrefetchReqSeq;
  const pfDim = wm.dim;
  wm.biomeLoading = true;
  wmDrawSoon();
  const pfRes = await window.observer.worldmapBiomes({
    dim: pfDim,
    cx0: ccx - half,
    cz0: ccz - half,
    cx1: ccx + half,
    cz1: ccz + half,
    sliceY: wm.sliceY
  }).catch(() => null);
  if (pfId !== wmPrefetchReqSeq) return;
  wm.biomeLoading = false;
  if (wmIngestBiomePayload(pfRes, pfDim)) {
    wmDrawSoon();
    wmRenderLegend();
  }
}

const WM_COLORS = ['#FF3B5C', '#00E5FF', '#FFD23F', '#00E5A0', '#C792EA', '#FF8C42'];

// ============ 60 FPS GPU-ACCELERATED TILE BITMAP CACHE ============
const WM_TILE_BLOCKS = 256; // 16 chunks = 256 blocks per tile
const WM_TILE_CACHE_MAX = 36;
const wmTileCache = new Map();

function wmGetTile(tx, tz) {
  const tk = `${wm.dim}:${tx},${tz}:${wm.layers.hillshade ? 'h' : 'f'}:${wm.sliceY ?? 's'}`;
  const hit = wmTileCache.get(tk);
  if (hit) return hit;

  const cv = document.createElement('canvas');
  cv.width = WM_TILE_BLOCKS;
  cv.height = WM_TILE_BLOCKS;
  const ctx = cv.getContext('2d');

  const chunkX0 = tx * 16;
  const chunkZ0 = tz * 16;

  for (let cz = chunkZ0; cz < chunkZ0 + 16; cz++) {
    for (let cx = chunkX0; cx < chunkX0 + 16; cx++) {
      const ck = cx + ',' + cz;
      const hasExplored = wm.explored.size ? wm.explored.has(ck) : true;
      if (!hasExplored && wm.explored.size > 0) continue;

      const cols = wmChunkColors(ck, cx, cz);
      const px = (cx - chunkX0) * 16;
      const pz = (cz - chunkZ0) * 16;

      if (cols && cols.length === 16) {
        for (let oz = 0; oz < 4; oz++) {
          for (let ox = 0; ox < 4; ox++) {
            ctx.fillStyle = cols[oz * 4 + ox];
            ctx.fillRect(px + ox * 4, pz + oz * 4, 4, 4);
          }
        }
      } else if (cols && cols.length === 1) {
        ctx.fillStyle = cols[0];
        ctx.fillRect(px, pz, 16, 16);
      } else {
        // Explored chunk pending real biome load: draw neutral dark cartographic tone
        ctx.fillStyle = wm.dim === 'nether' ? '#1E1212' : (wm.dim === 'end' ? '#1B1A14' : '#141E28');
        ctx.fillRect(px, pz, 16, 16);
      }
    }
  }

  lruSet(wmTileCache, tk, cv, WM_TILE_CACHE_MAX);
  const metricEl = document.getElementById('wmTileMetric');
  if (metricEl) metricEl.textContent = `${wmTileCache.size} tiles cached · 60 FPS`;
  return cv;
}

function wmShow(view) { $('#wmNoWorld').hidden = view !== 'none'; $('#wmApp').hidden = view !== 'app'; }

function wmSyncCheatMode() {
  const curState = (typeof state !== 'undefined' ? state : window.state) || {};
  const isCheat = !!(curState.settings && curState.settings.worldmapCheatMode);
  wm.cheatMode = isCheat;
  const cheatElements = [$('#wmSlime'), $('#wmStructures'), $('#wmNetherLink'), $('#wmSliceCtrl')];
  for (const el of cheatElements) {
    if (el) { el.hidden = !isCheat; el.style.display = isCheat ? '' : 'none'; }
  }
  if (!isCheat) {
    wm.layers.slime = false;
    wm.layers.structures = false;
    wm.layers.netherLink = false;
    wm.sliceY = null;
    $('#wmSlime')?.classList.remove('active');
    $('#wmStructures')?.classList.remove('active');
    $('#wmNetherLink')?.classList.remove('active');
    if (wmSliceSlider) wmSliceSlider.value = 320;
    if (wmSliceLabel) wmSliceLabel.textContent = 'Y: Surface';
  }
}
window.wmSyncCheatMode = wmSyncCheatMode;

async function wmLoad() {
  wmSyncCheatMode();
  let r;
  try {
    r = await window.observer.worldmapLoad();
  } catch (e) {
    wmShow('none');
    toast(t('wm.loadFail', { m: e?.message || e }), 'error');
    return;
  }
  if (!r) { wmShow('none'); return; }
  wm.level = (r && r.level && r.level.ok) ? r.level : null;
  wm.players = (r && r.players && r.players.players) || [];
  wm.waypoints = (r && r.waypoints) || [];
  if (!wm.level) { wmShow('none'); if (r.error && r.error !== 'noWorld') toast(t('nav.worldmap') + ': ' + r.error, 'error'); return; }
  wmShow('app');

  (function () {
    const note = $('#wmModdedNote'); if (!note) return;
    const jar = String((typeof state !== 'undefined' && state.files && state.files.jar) || '');
    const modded = /forge|neoforge|fabric|quilt/i.test(jar);
    const custom = (r.dimensions || []).filter(d => !d.startsWith('minecraft:'));
    if (!modded && !custom.length) { note.hidden = true; note.textContent = ''; return; }
    let msg = t('wm.moddedNote');
    if (custom.length) msg += ' ' + t('wm.moddedDims', { list: custom.join(', ') });
    note.textContent = msg; note.hidden = false;
  })();

  try { wm.seedBig = BigInt(wm.level.seed); } catch { wm.seedBig = 0n; }
  $('#wmSeed').textContent = wm.level.seed;
  $('#wmSeed').title = wm.level.levelName + ' · ' + wm.level.version.name;

  const f = wm.players[0] ? wm.players[0].pos : wm.level.spawn;
  wm.cam = { x: f.x, z: f.z }; if (wm.zoom < 0.1) wm.zoom = 0.25;

  wmClearCaches();
  _wmLgSig = '';
  wmLoadChunks(wm.dim);
  wmRenderList(); wmRenderLegend(); wmDraw();
  wmPrefetchBiomes(Math.floor(f.x / 16), Math.floor(f.z / 16), 12);
}

function wmVisible() {
  if (!wm.level) return [];
  const list = (wm.dim === 'overworld' ? [{ type: 'spawn', ...wm.level.spawn, name: t('wm.spawn'), color: '#00E5A0' }] : []);
  for (const p of wm.players) {
    if (p.dim === wm.dim) {
      list.push({
        type: 'player',
        ...p.pos,
        name: p.name || p.uuid.slice(0, 8),
        color: '#00E5FF',
        seenAt: p.seenAt,
        uuid: p.uuid,
        yaw: p.yaw,
        health: p.health,
        food: p.food
      });
    }
  }
  for (const w of wm.waypoints) {
    if (w.dim === wm.dim) {
      list.push({
        type: 'wp',
        ...w,
        color: w.color || '#B8C2CC',
        icon: w.icon || 'star'
      });
    }
  }
  return list;
}

function wmClearCaches() {
  for (const cv of wmTileCache.values()) {
    try { cv.width = 0; cv.height = 0; } catch {}
  }
  wm.biomes.clear();
  wmColorCache.clear();
  wmTileCache.clear();
  wm.lastBiomeRect = '';
  wm.biomeTooWide = false;
  wm.biomeTruncated = false;
}

// Distance helper
function wmDistanceToPlayer(wx, wz) {
  if (!wm.players.length) return null;
  let minD = Infinity;
  for (const p of wm.players) {
    if (p.dim === wm.dim && p.pos) {
      const d = Math.hypot(p.pos.x - wx, p.pos.z - wz);
      if (d < minD) minD = d;
    }
  }
  return Number.isFinite(minD) ? Math.round(minD) : null;
}

// Player skin head image cache
const headImgCache = new Map();
function getPlayerHeadImg(uuid) {
  if (!uuid) return null;
  if (headImgCache.has(uuid)) return headImgCache.get(uuid);
  const globalAv = window.headAvatarCache && window.headAvatarCache[uuid];
  if (globalAv) {
    const img = new Image();
    img.src = globalAv;
    img.onload = () => wmDrawSoon();
    headImgCache.set(uuid, img);
    return img;
  }
  return null;
}

// ============ MAIN RENDER PIPELINE ============
function wmDraw() {
  if (!wm.level) return;
  const cv = $('#wmCanvas'); if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = devicePixelRatio || 1;
  const W = cv.clientWidth || 800, H = cv.clientHeight || 520;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background
  ctx.fillStyle = '#0A0F14';
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  const toS = (wx, wz) => [(wx - wm.cam.x) * wm.zoom + cx, (wz - wm.cam.z) * wm.zoom + cy];

  // 1. TILE HARDWARE BLIT (60 FPS)
  if (wm.layers.terrain) {
    const tx0 = Math.floor((wm.cam.x - W / 2 / wm.zoom) / WM_TILE_BLOCKS);
    const tx1 = Math.floor((wm.cam.x + W / 2 / wm.zoom) / WM_TILE_BLOCKS);
    const tz0 = Math.floor((wm.cam.z - H / 2 / wm.zoom) / WM_TILE_BLOCKS);
    const tz1 = Math.floor((wm.cam.z + H / 2 / wm.zoom) / WM_TILE_BLOCKS);

    ctx.imageSmoothingEnabled = wm.zoom < 0.9;
    if (wm.zoom < 0.9) ctx.imageSmoothingQuality = 'high';

    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = wmGetTile(tx, tz);
        if (!tile) continue;
        const [sx, sy] = toS(tx * WM_TILE_BLOCKS, tz * WM_TILE_BLOCKS);
        const span = WM_TILE_BLOCKS * wm.zoom;
        ctx.drawImage(tile, sx, sy, span, span);
      }
    }
  }

  // 2. SLIME CHUNKS OVERLAY (Overworld cheat mode only)
  if (wm.cheatMode && wm.layers.slime && wm.dim === 'overworld') {
    const cx0 = Math.floor((wm.cam.x - W / 2 / wm.zoom) / 16);
    const cx1 = Math.floor((wm.cam.x + W / 2 / wm.zoom) / 16);
    const cz0 = Math.floor((wm.cam.z - H / 2 / wm.zoom) / 16);
    const cz1 = Math.floor((wm.cam.z + H / 2 / wm.zoom) / 16);

    const chunkPx = 16 * wm.zoom;
    if (chunkPx >= 6) {
      ctx.fillStyle = 'rgba(74, 222, 128, 0.22)';
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.65)';
      ctx.lineWidth = 1;
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (isSlimeChunk(wm.seedBig, cx, cz)) {
            const [sx, sy] = toS(cx * 16, cz * 16);
            ctx.fillRect(sx, sy, chunkPx, chunkPx);
            ctx.strokeRect(sx, sy, chunkPx, chunkPx);
            if (chunkPx >= 48) {
              ctx.font = '700 10px "JetBrains Mono",monospace';
              ctx.fillStyle = '#34d399';
              ctx.fillText('🧪 SLIME', sx + 4, sy + 14);
            }
          }
        }
      }
    }
  }

  // 3. GRID OVERLAY
  if (wm.layers.grid) {
    const chunkPx = 16 * wm.zoom;
    if (chunkPx >= 8) {
      // 16x16 chunk grid
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      const startCX = Math.floor(wm.cam.x - W / 2 / wm.zoom / 16) * 16;
      const endCX = wm.cam.x + W / 2 / wm.zoom;
      for (let x = startCX; x <= endCX; x += 16) {
        const [sx] = toS(x, 0);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
      }
      const startCZ = Math.floor(wm.cam.z - H / 2 / wm.zoom / 16) * 16;
      const endCZ = wm.cam.z + H / 2 / wm.zoom;
      for (let z = startCZ; z <= endCZ; z += 16) {
        const [, sy] = toS(0, z);
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      }
    }
    // 512x512 region grid
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.32)';
    ctx.lineWidth = 1.5;
    const startRX = Math.floor(wm.cam.x - W / 2 / wm.zoom / 512) * 512;
    const endRX = wm.cam.x + W / 2 / wm.zoom;
    for (let x = startRX; x <= endRX; x += 512) {
      const [sx] = toS(x, 0);
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
    }
    const startRZ = Math.floor(wm.cam.z - H / 2 / wm.zoom / 512) * 512;
    const endRZ = wm.cam.z + H / 2 / wm.zoom;
    for (let z = startRZ; z <= endRZ; z += 512) {
      const [, sy] = toS(0, z);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      if (wm.zoom >= 0.08) {
        ctx.font = '600 10px "JetBrains Mono",monospace';
        ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
        ctx.fillText(`r.${Math.floor(startRX / 512)}.${Math.floor(z / 512)}`, 6, sy + 14);
      }
    }
  }

  // 4. AXES
  ctx.strokeStyle = 'rgba(34,197,94,.25)'; ctx.lineWidth = 1.5;
  const [ax] = toS(0, 0); ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax, H); ctx.stroke();
  const [, ay] = toS(0, 0); ctx.beginPath(); ctx.moveTo(0, ay); ctx.lineTo(W, ay); ctx.stroke();

  // 5. NETHER PORTAL LINK RADIUS CIRCLE (Cheat mode only)
  if (wm.cheatMode && wm.selectedPos && (wm.layers.netherLink || wm.selectedPos.showPortal)) {
    const [sx, sy] = toS(wm.selectedPos.x, wm.selectedPos.z);
    const radiusBlocks = wm.dim === 'nether' ? 16 : 128;
    const radiusPx = radiusBlocks * wm.zoom;
    ctx.beginPath();
    ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(168, 85, 247, 0.1)';
    ctx.fill();
  }

  // 6. DISCOVERED STRUCTURES (Cheat mode only)
  if (wm.cheatMode && wm.layers.structures && wm.structures.size > 0) {
    for (const st of wm.structures.values()) {
      if (st.dim !== wm.dim) continue;
      const [sx, sy] = toS(st.x, st.z);
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;

      const emoji = STRUCTURE_ICONS[st.name] || '🏛';
      ctx.beginPath(); ctx.arc(sx, sy, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(26, 32, 44, 0.88)';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();

      ctx.font = '12px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(emoji, sx, sy);

      if (wm.zoom >= WM_LABEL_MIN_ZOOM) {
        ctx.font = '700 9.5px "JetBrains Mono",monospace';
        ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.fillStyle = '#fef08a';
        ctx.textAlign = 'center';
        ctx.strokeText(st.name, sx, sy + 18);
        ctx.fillText(st.name, sx, sy + 18);
      }
    }
  }

  // 7. MARKERS & PLAYERS
  for (const m of wmVisible()) {
    const [sx, sy] = toS(m.x, m.z);
    if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) continue;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (m.type === 'wp') {
      const emoji = WM_WP_ICONS[m.icon] || '⭐';
      ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();

      ctx.font = '11px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(emoji, sx, sy);
    } else if (m.type === 'spawn') {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 3.5 : 8, a = -Math.PI / 2 + i * Math.PI / 5;
        ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = m.color;
      ctx.strokeStyle = '#05070A';
      ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();
    } else {
      // Player: vision cone
      if (m.yaw !== undefined) {
        const rad = ((m.yaw + 90) * Math.PI) / 180;
        const coneLen = 32;
        const coneSpread = Math.PI / 4;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, coneLen, rad - coneSpread / 2, rad + coneSpread / 2);
        ctx.closePath();
        const grad = ctx.createRadialGradient(sx, sy, 4, sx, sy, coneLen);
        grad.addColorStop(0, 'rgba(0, 229, 255, 0.45)');
        grad.addColorStop(1, 'rgba(0, 229, 255, 0.0)');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      }

      // Player avatar
      const headImg = getPlayerHeadImg(m.uuid);
      if (headImg && headImg.complete && headImg.naturalWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(headImg, sx - 10, sy - 10, 20, 20);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.strokeStyle = '#00E5FF';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fillStyle = m.color; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#05070A'; ctx.fill();
      }
    }

    // Marker labels
    if (wm.zoom >= WM_LABEL_MIN_ZOOM) {
      ctx.font = '700 10.5px "JetBrains Mono",monospace';
      const coordText = Math.round(m.x) + ' ' + Math.round(m.z);
      const tw = Math.max(ctx.measureText(m.name).width, ctx.measureText(coordText).width);
      const right = sx + 14 + tw < W - 4;
      const lx = right ? sx + 14 : Math.max(4, sx - 14 - tw);
      const ly = Math.max(2, Math.min(sy - 14, H - 24));
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(m.name, lx, ly); ctx.strokeText(coordText, lx, ly + 12);
      ctx.fillStyle = m.color; ctx.fillText(m.name, lx, ly);
      ctx.fillStyle = 'rgba(232,244,248,.9)'; ctx.fillText(coordText, lx, ly + 12);
    }
  }

  wmScheduleBiomes();

  // Biome hint
  const hint = !wm.explored.size ? null : (wm.biomeLoading ? t('wm.loadingBiomes') : ((wm.biomeTooWide || wm.biomeTruncated) ? t('wm.zoomInBiomes') : null));
  if (hint) {
    ctx.fillStyle = 'rgba(232,244,248,.75)';
    ctx.font = '600 10.5px "JetBrains Mono",monospace';
    ctx.fillText(hint, 14, 20);
  }

  // Empty chunks card
  if (!wm.explored.size) {
    ctx.save();
    const cardW = Math.min(480, W - 32), cardH = 92;
    const cardX = (W - cardW) / 2, cardY = (H - cardH) / 2;
    ctx.fillStyle = 'rgba(10, 15, 20, 0.88)';
    ctx.strokeStyle = 'rgba(59, 203, 141, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cardX, cardY, cardW, cardH, 10);
    else ctx.rect(cardX, cardY, cardW, cardH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#3BCB8D';
    ctx.font = 'bold 13.5px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('◈ ' + t('wm.emptyChunksTitle'), W / 2, cardY + 16);

    ctx.fillStyle = 'rgba(232, 244, 248, 0.85)';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    const curState = (typeof state !== 'undefined' ? state : window.state) || {};
    const f = curState.files || {};
    const isPumpkin = (f.target && f.target.software === 'pumpkin') || (f.nativeBinary && /pumpkin/i.test(f.nativeBinary)) || f.hasPumpkinConfig;
    const emptySub = isPumpkin ? t('wm.emptyChunksSubPumpkin') : t('wm.emptyChunksSub');
    ctx.fillText(emptySub, W / 2, cardY + 42);

    ctx.fillStyle = 'rgba(184, 194, 204, 0.7)';
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillText(t('wm.emptyChunksTip'), W / 2, cardY + 63);
    ctx.restore();
  }

  wmDrawMini();

  // Scale bar
  const steps = [16, 64, 256, 1024, 4096, 16384];
  let step = steps[steps.length - 1];
  for (const s of steps) { if (s * wm.zoom >= 26) { step = s; break; } }
  const px = step * wm.zoom;
  ctx.fillStyle = 'rgba(232,244,248,.7)'; ctx.font = '600 9.5px "JetBrains Mono",monospace';
  ctx.fillText(step + ' blocks', 14, H - 14);
  ctx.strokeStyle = 'rgba(232,244,248,.7)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(14, H - 24); ctx.lineTo(14 + px, H - 24); ctx.stroke();
}

const wmDrawSoon = rafCoalesce(() => wmDraw());

function wmJump(x, z) { wm.cam = { x, z }; wmDrawSoon(); }

function wmGoTo() {
  const el = $('#wmGotoInput'); if (!el) return;
  const nums = String(el.value).match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) { toast(t('wm.badCoords')); return; }
  wmJump(Number(nums[0]), Number(nums[1]));
}
$('#wmGotoBtn')?.addEventListener('click', wmGoTo);
$('#wmGotoInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); wmGoTo(); } });

function wmZoomBy(f) { wm.zoom = Math.max(0.02, Math.min(16, wm.zoom * f)); wmDrawSoon(); }
$('#wmZoomIn')?.addEventListener('click', () => wmZoomBy(1.25));
$('#wmZoomOut')?.addEventListener('click', () => wmZoomBy(1 / 1.25));

function wmFitSpawn() {
  const sp = (wm.level && wm.level.spawn) || { x: 0, z: 0 };
  const cv = $('#wmCanvas'); const span = Math.min(cv.clientWidth || 800, cv.clientHeight || 520);
  wm.zoom = Math.max(0.02, Math.min(16, span / 512));
  wm.cam = { x: sp.x, z: sp.z };
  wmDrawSoon();
}
$('#wmFitSpawn')?.addEventListener('click', wmFitSpawn);

// Fullscreen toggle
function wmToggleFullscreen(force) {
  const target = force !== undefined ? !!force : !wm.fullscreen;
  wm.fullscreen = target;
  const wmSection = document.getElementById('worldmap');
  if (wmSection) wmSection.classList.toggle('wm-fullscreen', target);
  const btn = $('#wmFullscreen');
  if (btn) btn.classList.toggle('active', target);
  requestAnimationFrame(() => wmDraw());
}
$('#wmFullscreen')?.addEventListener('click', () => wmToggleFullscreen());
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && wm.fullscreen) wmToggleFullscreen(false);
});

// Layer toggle buttons
$('#wmTerrain')?.addEventListener('click', () => {
  wm.layers.terrain = !wm.layers.terrain;
  $('#wmTerrain').classList.toggle('active', wm.layers.terrain);
  wmTileCache.clear();
  wmDrawSoon();
});

$('#wmHillshade')?.addEventListener('click', () => {
  wm.layers.hillshade = !wm.layers.hillshade;
  $('#wmHillshade').classList.toggle('active', wm.layers.hillshade);
  wmTileCache.clear();
  wmColorCache.clear();
  wmDrawSoon();
});

$('#wmSlime')?.addEventListener('click', () => {
  wm.layers.slime = !wm.layers.slime;
  $('#wmSlime').classList.toggle('active', wm.layers.slime);
  wmDrawSoon();
});

$('#wmStructures')?.addEventListener('click', () => {
  wm.layers.structures = !wm.layers.structures;
  $('#wmStructures').classList.toggle('active', wm.layers.structures);
  wmDrawSoon();
});

$('#wmGrid')?.addEventListener('click', () => {
  wm.layers.grid = !wm.layers.grid;
  $('#wmGrid').classList.toggle('active', wm.layers.grid);
  wmDrawSoon();
});

$('#wmNetherLink')?.addEventListener('click', () => {
  wm.layers.netherLink = !wm.layers.netherLink;
  $('#wmNetherLink').classList.toggle('active', wm.layers.netherLink);
  wmDrawSoon();
});

// Elevation slice slider
const wmSliceSlider = document.getElementById('wmSliceSlider');
const wmSliceLabel = document.getElementById('wmSliceLabel');
const wmSliceReset = document.getElementById('wmSliceReset');

if (wmSliceSlider) {
  wmSliceSlider.addEventListener('input', e => {
    const val = Number(e.target.value);
    if (val >= 320) {
      wm.sliceY = null;
      if (wmSliceLabel) wmSliceLabel.textContent = 'Y: Surface';
    } else {
      wm.sliceY = val;
      if (wmSliceLabel) wmSliceLabel.textContent = `Y: ${val}`;
    }
    wmClearCaches();
    wmScheduleBiomes();
    wmDrawSoon();
  });
}

if (wmSliceReset) {
  wmSliceReset.addEventListener('click', () => {
    wm.sliceY = null;
    if (wmSliceSlider) wmSliceSlider.value = 320;
    if (wmSliceLabel) wmSliceLabel.textContent = 'Y: Surface';
    wmClearCaches();
    wmScheduleBiomes();
    wmDrawSoon();
  });
}

// Waypoint List Rendering
function wmRenderList() {
  const box = $('#wmWpList'); const list = wm.waypoints;
  $('#wmWpCount').textContent = String(list.length);
  box.innerHTML = list.length ? list.map(w => {
    const emoji = WM_WP_ICONS[w.icon] || '⭐';
    const dist = wmDistanceToPlayer(w.x, w.z);
    const distStr = dist !== null ? tf('wm.dist', { d: dist }) : '';
    return `<div class="wm-wprow" data-id="${esc(w.id)}">
      <span class="wm-dot" style="background:${esc(w.color || '#B8C2CC')}"></span>
      <div class="wm-wpmain">
        <b>${emoji} ${esc(w.name)} ${distStr ? `<span class="wm-wp-dist">${distStr}</span>` : ''}</b>
        <small>${esc(w.dim)} · ${Math.round(w.x)} ${Math.round(w.z)}</small>
      </div>
      <div class="wm-wp-actions">
        <button class="text-btn" data-wm-jump="${esc(w.id)}" title="${esc(t('wm.jump'))}">🎯</button>
        <button class="text-btn" data-wm-tp="${esc(w.id)}" title="${esc(t('wm.copyTp'))}">/tp</button>
        <button class="text-btn danger" data-wm-del="${esc(w.id)}" title="${esc(t('wm.delete'))}">✕</button>
      </div>
    </div>`;
  }).join('') : `<p class="field-hint">${esc(t('wm.none'))}</p>`;

  box.querySelectorAll('[data-wm-jump]').forEach(b => b.onclick = () => {
    const w = wm.waypoints.find(x => x.id === b.dataset.wmJump);
    if (w) {
      wmJump(w.x, w.z);
      if (w.dim !== wm.dim) {
        wm.dim = w.dim;
        wmSyncDimTabs();
        wmDrawSoon();
      }
    }
  });

  box.querySelectorAll('[data-wm-tp]').forEach(b => b.onclick = async () => {
    const w = wm.waypoints.find(x => x.id === b.dataset.wmTp);
    if (w) {
      const cmd = `/tp @s ${Math.round(w.x)} ${Math.round(w.y || 64)} ${Math.round(w.z)}`;
      try {
        await navigator.clipboard.writeText(cmd);
        toast(t('wm.tpCopied') + `: ${cmd}`, 'success');
      } catch {
        toast(cmd);
      }
    }
  });

  box.querySelectorAll('[data-wm-del]').forEach(b => b.onclick = async () => {
    wm.waypoints = wm.waypoints.filter(x => x.id !== b.dataset.wmDel);
    await window.observer.worldmapSetWaypoints(wm.waypoints);
    wmRenderList(); wmDrawSoon();
  });
}

function wmSyncDimTabs() {
  $$('#wmDims .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.dim === wm.dim));
}

// Biome Legend
const WM_LEGEND = {
  overworld: [['water', '#2E5A8A'], ['plains', '#6FA84E'], ['forest', '#3F7A3A'], ['desert', '#D8C77A'], ['snow', '#D7DCE0'], ['mountain', '#8A8A7E'], ['swamp', '#5A6B45']],
  nether: [['nether', '#7A3B33']],
  end: [['end', '#C9C29A']]
};

function wmLegendRows() {
  const counts = new Map();
  for (const rec of wm.biomes.values()) {
    if (!rec || rec[2] == null) continue;
    const grid = rec[5];
    if (grid) { for (const b of grid) { if (b) counts.set(b, (counts.get(b) || 0) + 1); } }
    else counts.set(rec[2], (counts.get(rec[2]) || 0) + 1);
  }
  if (!counts.size) return WM_LEGEND[wm.dim] || WM_LEGEND.overworld;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id]) => [String(id).replace(/^minecraft:/, ''), biomeColor(id)]);
}

let _wmLgSig = '';
function wmRenderLegend() {
  const box = $('#wmLgGrid'); if (!box) return;
  const rows = wmLegendRows();
  const sig = rows.map(r => r[0]).join('|');
  if (sig === _wmLgSig) return;
  _wmLgSig = sig;
  box.innerHTML = rows.map(([k, c]) => {
    const label = t('wm.lg.' + k) || k.split('_').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
    return `<span class="wm-lg-chip"><i style="background:${esc(c)}"></i>${esc(label)}</span>`;
  }).join('');
}

// Inspector Popup
let wmPopEl = null;
function wmHidePopup() { if (wmPopEl) { wmPopEl.remove(); wmPopEl = null; } }

function wmShowPopup(px, py, data) {
  wmHidePopup();
  const cv = $('#wmCanvas'); if (!cv) return;
  const wrap = cv.parentElement;
  wmPopEl = document.createElement('div');
  wmPopEl.id = 'wmPopup';
  wmPopEl.innerHTML = `<button type="button" class="wm-pop-x" aria-label="Close">✕</button>
    <div class="wm-pop-title"><b>${esc(data.title)}</b></div>
    ${data.lines.map(l => `<div class="wm-pop-line">${esc(l)}</div>`).join('')}
    ${data.copy ? `<button type="button" class="btn sm secondary wm-pop-copy">${esc(t('wm.copyTp'))}</button>` : ''}`;
  wrap.appendChild(wmPopEl);

  wmPopEl.querySelector('.wm-pop-x').onclick = wmHidePopup;
  const copyBtn = wmPopEl.querySelector('.wm-pop-copy');
  if (copyBtn && data.copy) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(data.copy);
        toast(t('wm.tpCopied') + `: ${data.copy}`, 'success');
      } catch {
        toast(data.copy);
      }
    };
  }

  const r = wmPopEl.getBoundingClientRect();
  const maxL = cv.clientWidth - r.width - 8, maxT = cv.clientHeight - r.height - 8;
  const left = Math.max(8, Math.min(px + 12, maxL));
  const top = Math.max(8, Math.min(py + 12, maxT));
  wmPopEl.style.left = left + 'px'; wmPopEl.style.top = top + 'px';
}

function wmToScreen(wx, wz) {
  const cv = $('#wmCanvas');
  const cx = (cv.clientWidth || 800) / 2, cy = (cv.clientHeight || 520) / 2;
  return [(wx - wm.cam.x) * wm.zoom + cx, (wz - wm.cam.z) * wm.zoom + cy];
}

function wmMapClick(px, py, wx, wz) {
  // Hit test markers
  const hitRadius = 14;
  for (const m of wmVisible()) {
    const [sx, sy] = wmToScreen(m.x, m.z);
    if (Math.hypot(px - sx, py - sy) <= hitRadius) {
      const lines = [
        `${m.type === 'wp' ? 'Waypoint' : m.type === 'player' ? 'Player' : 'Spawn'} · ${Math.round(m.x)} ${Math.round(m.z)}`,
        wm.dim
      ];
      if (m.health !== undefined) lines.push(`❤ Health: ${m.health} / 20`);
      if (m.food !== undefined) lines.push(`🍗 Food: ${m.food} / 20`);
      const tpCmd = `/tp @s ${Math.round(m.x)} ${Math.round(m.y || 64)} ${Math.round(m.z)}`;
      wmShowPopup(px, py, { title: m.name, lines, copy: tpCmd });
      return;
    }
  }

  // Hit test structures (cheat mode only)
  if (wm.cheatMode) {
    for (const st of wm.structures.values()) {
      if (st.dim !== wm.dim) continue;
      const [sx, sy] = wmToScreen(st.x, st.z);
      if (Math.hypot(px - sx, py - sy) <= hitRadius) {
        const tpCmd = `/tp @s ${st.x} ~ ${st.z}`;
        wmShowPopup(px, py, {
          title: st.name.toUpperCase(),
          lines: [`Coordinates: ${st.x} ${st.z}`, `Dimension: ${st.dim}`],
          copy: tpCmd
        });
        return;
      }
    }
  }

  // Terrain inspect
  const cx = Math.floor(wx / 16), cz = Math.floor(wz / 16);
  const rec = wm.biomes.get(wm.dim + ':' + cx + ',' + cz);
  const lines = [`${wm.dim} · Chunk ${cx}, ${cz}`];

  if (rec && rec[2]) {
    lines.push(`Biome: ${rec[2].replace(/^minecraft:/, '')}`);
    if (wm.cheatMode && rec[3]) {
      const lx = ((wx % 16) + 16) % 16, lz = ((wz % 16) + 16) % 16;
      const cellIdx = Math.floor(lz / 4) * 4 + Math.floor(lx / 4);
      lines.push(`Elevation Y: ${rec[3][cellIdx]}`);
      if (rec[6] && rec[6][cellIdx]) lines.push(`Block: ${rec[6][cellIdx].replace(/^minecraft:/, '')}`);
    }
  }

  // Slime chunk & Nether portal link calculations (cheat mode only)
  if (wm.cheatMode) {
    if (wm.dim === 'overworld') {
      const isSlime = isSlimeChunk(wm.seedBig, cx, cz);
      lines.push(`Slime Chunk: ${isSlime ? '✅ YES' : '❌ NO'}`);
      const nx = Math.floor(wx / 8), nz = Math.floor(wz / 8);
      lines.push(`🌀 ${t('wm.inspectPortal')}: ${nx} ${nz}`);
      lines.push(t('wm.safetyRadius'));
    } else if (wm.dim === 'nether') {
      const ox = wx * 8, oz = wz * 8;
      lines.push(`🌀 ${t('wm.inspectPortal')}: ${ox} ${oz}`);
    }
  }

  if (wm.cheatMode) {
    wm.selectedPos = { x: wx, z: wz, showPortal: true };
  } else {
    wm.selectedPos = null;
  }
  wmDrawSoon();

  const copyTp = `/tp @s ${wx} ~ ${wz}`;
  wmShowPopup(px, py, { title: `${wx} ${wz}`, lines, copy: copyTp });
}

// Live refresh ticker
let wmLiveTick = 0, wmRefreshing = false;
setInterval(() => {
  if (wmRefreshing || !state.running || !wm.level) return;
  const tab = document.getElementById('worldmap');
  if (!tab || !tab.classList.contains('active')) return;
  wmLiveRefresh();
}, 15000);

async function wmLiveRefresh() {
  if (wmRefreshing || !state.running || !wm.level) return;
  wmRefreshing = true;
  try {
    const r = await window.observer.worldmapLoad();
    if (r && r.level && r.level.ok) {
      wm.players = (r.players && r.players.players) || [];
      wm.level = r.level;
      try { $('#wmSeed').textContent = wm.level.seed; } catch {}
      wmRenderList(); wmDrawSoon();
      if (++wmLiveTick % 3 === 0) wmLoadChunks(wm.dim);
    }
  } catch {}
  wmRefreshing = false;
}

// Waypoint Modal Management
let selectedWpIcon = 'star';
let selectedWpColor = WM_COLORS[0];

function wmOpenAddWaypointModal(x, z) {
  wm.pendingWpPos = { x: Math.round(x), z: Math.round(z) };
  const modal = $('#wmWpModal'); if (!modal) return;
  const nameInput = $('#wmWpNameInput');
  if (nameInput) {
    nameInput.value = `${t('wm.waypoints')} ${wm.waypoints.length + 1}`;
    nameInput.focus();
  }
  const preview = $('#wmWpCoordsPreview');
  if (preview) preview.textContent = `${wm.dim.toUpperCase()} · X: ${Math.round(x)}, Z: ${Math.round(z)}`;

  // Populate color swatches
  const colorBox = $('#wmColorSelector');
  if (colorBox) {
    colorBox.innerHTML = WM_COLORS.map((c, i) =>
      `<span class="wm-color-circle ${i === 0 ? 'active' : ''}" style="background:${c}" data-color="${c}"></span>`
    ).join('');
    selectedWpColor = WM_COLORS[0];
    colorBox.querySelectorAll('.wm-color-circle').forEach(el => {
      el.onclick = () => {
        colorBox.querySelectorAll('.wm-color-circle').forEach(s => s.classList.remove('active'));
        el.classList.add('active');
        selectedWpColor = el.dataset.color;
      };
    });
  }

  // Icon selector
  const iconBox = $('#wmIconSelector');
  if (iconBox) {
    iconBox.querySelectorAll('.filter-chip').forEach(b => {
      b.onclick = () => {
        iconBox.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        b.classList.add('active');
        selectedWpIcon = b.dataset.icon || 'star';
      };
    });
  }

  modal.hidden = false;
}

function wmCloseAddWaypointModal() {
  const modal = $('#wmWpModal');
  if (modal) modal.hidden = true;
  wm.pendingWpPos = null;
}

$('#wmWpModalClose')?.addEventListener('click', wmCloseAddWaypointModal);
$('#wmWpModalCancel')?.addEventListener('click', wmCloseAddWaypointModal);

$('#wmWpModalSave')?.addEventListener('click', async () => {
  if (!wm.pendingWpPos) return;
  const nameInput = $('#wmWpNameInput');
  const name = String(nameInput?.value || '').trim() || (`Waypoint ${wm.waypoints.length + 1}`);
  const wp = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    x: wm.pendingWpPos.x,
    y: 64,
    z: wm.pendingWpPos.z,
    dim: wm.dim,
    icon: selectedWpIcon,
    color: selectedWpColor
  };
  wm.waypoints.push(wp);
  const r = await window.observer.worldmapSetWaypoints(wm.waypoints);
  if (!r || !r.ok) toast(t('toast.wpSaveFail'), 'error');
  else toast(`${name} ✓`, 'success');
  wmCloseAddWaypointModal();
  wmRenderList();
  wmDrawSoon();
  wmJump(wp.x, wp.z);
});

$('#wmReload').onclick = wmLoad;
$('#wmReload2').onclick = wmLoad;

$('#wmCopySeed').onclick = async () => {
  if (!wm.level) return;
  try {
    await navigator.clipboard.writeText(wm.level.seed);
    toast(t('toast.copied'), 'success');
  } catch {
    toast(wm.level.seed);
  }
};

// Switch dimension
$$('#wmDims .filter-chip').forEach(c => c.onclick = () => {
  const oldDim = wm.dim;
  const newDim = c.dataset.dim;
  if (oldDim !== newDim) {
    if (oldDim === 'overworld' && newDim === 'nether') {
      wm.cam = { x: Math.round(wm.cam.x / 8), z: Math.round(wm.cam.z / 8) };
    } else if (oldDim === 'nether' && newDim === 'overworld') {
      wm.cam = { x: Math.round(wm.cam.x * 8), z: Math.round(wm.cam.z * 8) };
    } else if (newDim === 'end') {
      wm.cam = { x: 0, z: 0 };
    }
  }
  wm.dim = newDim;
  // Nether auto-peel: default Y=126 in Nether to peel bedrock roof (only in cheat mode)
  if (wm.cheatMode && newDim === 'nether') {
    wm.sliceY = 126;
    if (wmSliceSlider) wmSliceSlider.value = 126;
    if (wmSliceLabel) wmSliceLabel.textContent = 'Y: 126';
  } else {
    wm.sliceY = null;
    if (wmSliceSlider) wmSliceSlider.value = 320;
    if (wmSliceLabel) wmSliceLabel.textContent = 'Y: Surface';
  }

  clearTimeout(wm.biomeTimer);
  wm.biomeReqSeq++;
  wm.biomeLoading = false;
  wmClearCaches();
  wm.explored = new Set();
  wm.exploredDim = null;
  wmSyncDimTabs();
  wmRenderLegend();
  wmLoadChunks(wm.dim);
  wmDrawSoon();
});

$('#wmAdd').onclick = () => {
  wm.addMode = !wm.addMode;
  $('#wmAdd').classList.toggle('active', wm.addMode);
};

async function wmLoadChunks(dim) {
  if (!dim) dim = wm.dim;
  try {
    const r = await window.observer.worldmapChunks(dim);
    if (r && r.ok && r.dim === dim) {
      wm.explored = new Set(r.chunks);
      wm.exploredDim = dim;
      wmTileCache.clear();
      wmDrawSoon();
    }
  } catch {}
}

$('#wmWpImport')?.addEventListener('click', async () => {
  const raw = await promptDialog({
    title: t('wm.wpImportTitle'),
    body: t('wm.wpImportDesc'),
    placeholder: 'waypoint:Name:N:X:Y:Z:9... or JourneyMap JSON',
    ok: t('wm.wpImportBtn')
  });
  if (!raw) return;
  const r = await window.observer.waypointsImport({ data: raw, dim: wm.dim });
  if (!r.ok) return toast(r.error || 'Failed');
  wm.waypoints = r.waypoints || [];
  wmRenderList(); wmDrawSoon();
  toast(t('wm.wpImportSuccess', { n: r.added }));
});

$('#wmWpExport')?.addEventListener('click', async () => {
  const r = await window.observer.waypointsExport({ format: 'xaero', dim: wm.dim });
  if (!r.ok) return toast(r.error || 'Failed');
  if (!r.count) return toast(t('wm.wpNoWaypoints'));
  const blob = new Blob([r.data], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `waypoints-${wm.dim}-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(t('wm.wpExportSuccess', { n: r.count }));
});

$('#wmExport').onclick = () => {
  const cv = $('#wmCanvas');
  cv.toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'observerlauncher-map-' + (wm.level?.seed?.slice(-6) || 'map') + '.png';
    a.click(); URL.revokeObjectURL(a.href);
    toast(t('wm.exported'), 'success');
  });
};

// Pointer Events: pan, zoom, click
(function () {
  const cv = $('#wmCanvas');
  let dragging = false, lx = 0, ly = 0, downPos = null;

  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try { cv.focus({ preventScroll: true }); } catch {}

    if (!wm.addMode && wm.level) {
      const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const wps = wm.waypoints.filter(w => w.dim === wm.dim);
      for (let i = wps.length - 1; i >= 0; i--) {
        const [sx, sy] = wmToScreen(wps[i].x, wps[i].z);
        if (Math.hypot(px - sx, py - sy) <= 14) {
          wm.dragWp = wps[i];
          downPos = null;
          try { cv.setPointerCapture(e.pointerId); } catch {}
          wmHidePopup();
          return;
        }
      }
    }

    dragging = true; lx = e.clientX; ly = e.clientY; downPos = { x: e.clientX, y: e.clientY };
    try { cv.setPointerCapture(e.pointerId); } catch {}
    wmHidePopup();
  });

  cv.addEventListener('pointerup', e => {
    if (wm.dragWp) {
      wm.dragWp = null;
      try { cv.releasePointerCapture(e.pointerId); } catch {}
      window.observer.worldmapSetWaypoints(wm.waypoints).catch(() => {});
      wmRenderList();
      return;
    }
    if (!dragging) return;
    dragging = false;
    try { cv.releasePointerCapture(e.pointerId); } catch {}

    if (!wm.level) { downPos = null; return; }
    if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 5) { downPos = null; return; }
    downPos = null;

    const r = cv.getBoundingClientRect();
    const x = Math.round((e.clientX - r.left - WM_CX()) / wm.zoom + wm.cam.x);
    const z = Math.round((e.clientY - r.top - WM_CY()) / wm.zoom + wm.cam.z);

    if (wm.addMode) {
      wmOpenAddWaypointModal(x, z);
      wm.addMode = false; $('#wmAdd').classList.remove('active');
      return;
    }
    wmMapClick(e.clientX - r.left, e.clientY - r.top, x, z);
  });

  cv.addEventListener('pointercancel', () => { dragging = false; downPos = null; wm.dragWp = null; });

  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect();
    const wx = Math.round((e.clientX - r.left - WM_CX()) / wm.zoom + wm.cam.x);
    const wz = Math.round((e.clientY - r.top - WM_CY()) / wm.zoom + wm.cam.z);
    $('#wmCoord').textContent = wx + ' ' + wz;
    if (wm.dragWp) { wm.dragWp.x = wx; wm.dragWp.z = wz; wmDrawSoon(); return; }
    if (!dragging) return;
    wm.cam.x -= (e.clientX - lx) / wm.zoom;
    wm.cam.z -= (e.clientY - ly) / wm.zoom;
    lx = e.clientX; ly = e.clientY;
    wmDrawSoon();
  });

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const wx = (e.clientX - r.left - WM_CX()) / wm.zoom + wm.cam.x;
    const wz = (e.clientY - r.top - WM_CY()) / wm.zoom + wm.cam.z;
    wm.zoom = Math.max(0.02, Math.min(16, wm.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    wm.cam = { x: wx - (e.clientX - r.left - WM_CX()) / wm.zoom, z: wz - (e.clientY - r.top - WM_CY()) / wm.zoom };
    wmDrawSoon();
  }, { passive: false });

  cv.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const pan = 80 / wm.zoom;
    switch (e.key) {
      case 'ArrowLeft': wm.cam.x -= pan; break;
      case 'ArrowRight': wm.cam.x += pan; break;
      case 'ArrowUp': wm.cam.z -= pan; break;
      case 'ArrowDown': wm.cam.z += pan; break;
      case '+': case '=': wmZoomBy(1.25); e.preventDefault(); return;
      case '-': case '_': wmZoomBy(1 / 1.25); e.preventDefault(); return;
      case '0': wmFitSpawn(); e.preventDefault(); return;
      default: return;
    }
    e.preventDefault();
    wmDrawSoon();
  });

  new ResizeObserver(() => wmDraw()).observe(cv);
})();

function WM_CX() { return ($('#wmCanvas').clientWidth || 800) / 2; }
function WM_CY() { return ($('#wmCanvas').clientHeight || 520) / 2; }

// Minimap
const WM_MINI_PX = 160;
function wmDrawMini(force) {
  const cv = $('#wmMini'); if (!cv || !wm.level) return;
  const now = Date.now(); if (!force && now - (wm.miniAt || 0) < 400) return; wm.miniAt = now;
  const ctx = cv.getContext('2d'), S = WM_MINI_PX, dpr = devicePixelRatio || 1;
  if (cv.width !== S * dpr) { cv.width = S * dpr; cv.height = S * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, S, S);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const size = wm.explored.size, stride = size > 4000 ? Math.ceil(size / 4000) : 1;
  const pts = []; let idx = 0;
  for (const k of wm.explored) {
    const p = k.split(','), ax = Number(p[0]), az = Number(p[1]);
    if (!isFinite(ax) || !isFinite(az)) continue;
    if (ax < minX) minX = ax; if (ax > maxX) maxX = ax; if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;
    if (idx++ % stride === 0) pts.push([ax, az]);
  }
  const vw = ((($('#wmCanvas').clientWidth || 800)) / 2) / wm.zoom, vh = ((($('#wmCanvas').clientHeight || 520)) / 2) / wm.zoom;
  minX = Math.min(minX, wm.cam.x - vw); maxX = Math.max(maxX, wm.cam.x + vw);
  minZ = Math.min(minZ, wm.cam.z - vh); maxZ = Math.max(maxZ, wm.cam.z + vh);
  if (!isFinite(minX)) { minX = wm.cam.x - 1000; maxX = wm.cam.x + 1000; minZ = wm.cam.z - 1000; maxZ = wm.cam.z + 1000; }
  const span = Math.max(maxX - minX, maxZ - minZ, 32) * 1.12, midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
  const toM = (wx, wz) => [(wx - (midX - span / 2)) / span * S, (wz - (midZ - span / 2)) / span * S];
  const dot = Math.max(1, (16 / span) * S);
  ctx.fillStyle = 'rgba(34,197,94,.28)';
  for (const [ax, az] of pts) { const [sx, sy] = toM(ax * 16 + 8, az * 16 + 8); if (sx < 0 || sx > S || sy < 0 || sy > S) continue; ctx.fillRect(sx, sy, dot, dot); }
  for (const m of wmVisible()) { const [sx, sy] = toM(m.x, m.z); ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(sx, sy, 1.8, 0, 7); ctx.fill(); }
  const [vx0, vy0] = toM(wm.cam.x - vw, wm.cam.z - vh), [vx1, vy1] = toM(wm.cam.x + vw, wm.cam.z + vh);
  ctx.strokeStyle = 'rgba(232,244,248,.85)'; ctx.lineWidth = 1;
  ctx.strokeRect(vx0, vy0, Math.max(2, vx1 - vx0), Math.max(2, vy1 - vy0));
}
