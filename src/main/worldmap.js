// World Map backend — reads REAL data from the world save (no approximations):
//   level.dat   → world seed, level name, version, spawn point
//   playerdata/ → per-player last position + dimension (names resolved via usercache.json)
//   observerlauncher-waypoints.json → user waypoints (created on demand)
// 64-bit world seeds are returned as DECIMAL STRINGS (JS numbers lose precision above 2^53).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');
const { readJsonList, writeFileAtomic } = require('./fs-utils.js');

// 3.2.5: insert into a Map and evict the oldest entry (FIFO) once it exceeds max. Shared by the
// explored/biome region caches so the eviction rule is written once.
function lruSet(map, key, val, max) { map.set(key, val); if (map.size > max) map.delete(map.keys().next().value); return map; }

function longToBigInt(v) {
  if (typeof v === 'bigint') return v;
  if (Array.isArray(v)) return ((BigInt(v[0] | 0) & 0xFFFFFFFFn) << 32n) | (BigInt(v[1] | 0) & 0xFFFFFFFFn);
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  return 0n;
}

function dimName(v) {
  if (typeof v === 'number') return v === -1 ? 'nether' : v === 1 ? 'end' : 'overworld';
  const s = String(v || '');
  if (s.includes('nether')) return 'nether';
  if (s.includes('the_end')) return 'end';
  return 'overworld';
}

async function readLevel(root, levelName) {
  if (!root) return { ok: false, error: 'noWorld' };
  const name = String(levelName || 'world').replace(/[\\/]/g, '') || 'world';
  const candidates = [
    path.join(root, name, 'level.dat'), path.join(root, name, 'level.dat_old'),
    path.join(root, 'level.dat'), path.join(root, 'level.dat_old'),
  ];
  let buf = null, src = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { buf = fs.readFileSync(p); src = path.relative(root, p); break; }
  }
  if (!buf) {
    const rDirs = getRegionDirs(root, name, 'overworld');
    let hasReg = false;
    for (const d of rDirs) { try { if (fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.mca'))) { hasReg = true; break; } } catch {} }
    if (hasReg) {
      return { ok: true, source: 'region', seed: '0', levelName: name, spawn: { x: 0, y: 64, z: 0 }, version: { name: '26.3 (Native)', id: 0, snapshot: false }, dataVersion: 0, hardcore: false };
    }
    return { ok: false, error: 'noWorld', tried: name + '/level.dat, level.dat' };
  }
  let parsed;
  try { parsed = await nbt.parse(buf); } catch { return { ok: false, error: 'corrupt' }; }
  const D = nbt.simplify(parsed.parsed).Data || {};
  const seedBig = longToBigInt(D.WorldGenSettings?.seed ?? D.RandomSeed ?? 0);
  const spawn = { x: D.SpawnX | 0, y: D.SpawnY | 0, z: D.SpawnZ | 0 };
  return {
    ok: true,
    source: src,
    seed: seedBig.toString(),
    levelName: D.LevelName || 'World',
    spawn,
    version: { name: D.Version?.Name || (D.DataVersion ? ('DataVersion ' + D.DataVersion) : (D.version ? ('Anvil v' + D.version) : '?')), id: D.Version?.Id | 0, snapshot: !!D.Version?.Snapshot },
    dataVersion: D.DataVersion | 0,
    hardcore: !!D.hardcore,
  };
}

async function readPlayers(root, levelName) {
  if (!root) return { ok: true, players: [] };
  const name = String(levelName || 'world').replace(/[\\/]/g, '') || 'world';
  // modern: <world>/playerdata — legacy: <root>/playerdata
  // BUGFIX: Minecraft 26.x moved player data to <world>/players/data/; added that path
  // so world-map markers show real player positions on newer servers too.
  let files = [];
  for (const dir of [
    path.join(root, name, 'players', 'data'),
    path.join(root, name, 'playerdata'),
    path.join(root, 'playerdata'),
  ]) {
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.dat')); if (files.length) { files = files.map(f => path.join(dir, f)); break; } } catch {}
  }
  // uuid -> name from usercache.json
  const names = {};
  try { for (const c of readJsonList(root, 'usercache.json')) if (c.uuid && c.name) names[String(c.uuid).toLowerCase()] = c.name; } catch {}
  const players = [];
  for (const f of files) {
    try {
      const uuid = path.basename(f, '.dat');
      const parsed = await nbt.parse(fs.readFileSync(f));
      const S = nbt.simplify(parsed.parsed);
      const pos = S.Pos || [0, 64, 0];
      // FEATURE: file mtime = last time the server flushed this player to
      // disk (logout + periodic autosave). The map shows it as "saved HH:MM"
      // so users can tell live-ish positions from stale ones.
      let seenAt = 0;
      try { seenAt = fs.statSync(f).mtimeMs; } catch {}
      players.push({
        uuid,
        name: names[uuid.toLowerCase()] || null,
        pos: { x: +pos[0], y: +pos[1], z: +pos[2] },
        dim: dimName(S.Dimension),
        gamemode: S.playerGameType | 0,
        seenAt,
      });
    } catch {}
  }
  return { ok: true, players };
}

function getRegionDirs(root, levelName, dim) {
  const base = path.join(root, String(levelName || 'world').replace(/[\\/]/g, '') || 'world');
  if (dim === 'overworld') return [
    path.join(base, 'dimensions', 'minecraft', 'overworld', 'region'),
    path.join(base, 'region'),
    path.join(root, 'region'),
  ];
  if (dim === 'nether') return [
    path.join(base, 'dimensions', 'minecraft', 'the_nether', 'region'),
    path.join(base, 'dimensions', 'minecraft', 'the_nether'),
    path.join(base + '_nether', 'DIM-1', 'region'),
    path.join(base + '_nether', 'region'),
    path.join(base, 'DIM-1', 'region'),
    path.join(root, 'DIM-1', 'region'),
  ];
  if (dim === 'end') return [
    path.join(base, 'dimensions', 'minecraft', 'the_end', 'region'),
    path.join(base + '_the_end', 'DIM1', 'region'),
    path.join(base + '_the_end', 'region'),
    path.join(base, 'DIM1', 'region'),
    path.join(root, 'DIM1', 'region'),
  ];
  return [];
}
// Reads the header of each region file to list chunks that exist on disk. A non-zero slot offset
// means a chunk was written — but proto-chunks (server crashed mid-generation) also have an
// offset, so when the world is small enough we also read each chunk's NBT and keep only those
// with Status 'minecraft:full' (or 'full' in 1.16.5). Above FULL_SCAN_BUDGET chunks we skip the per-chunk parse (it
// would block the main process for seconds) and fall back to the header-only approximation.
const FULL_SCAN_BUDGET = 3000;
// W5 (3.2.5): scanExploredChunks is called SYNCHRONOUSLY from an IPC handler, and the live-refresh
// re-runs it every 45s. Reading + NBT-parsing every region file each time blocked the main process
// on big worlds. Cache the result keyed by a cheap signature (region file names + mtime + size): if
// nothing changed on disk, return the previous Set without re-reading. Region files only change when
// the server saves, so in practice this skips almost every call.
const exploredCache = new Map(); // key 'root|level|dim' -> { sig, chunks }
function exploredSignature(dirs) {
  const parts = [];
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /^r\.-?\d+\.-?\d+\.mca$/.test(f)).sort(); } catch { continue; }
    for (const f of files) {
      try { const st = fs.statSync(path.join(dir, f)); parts.push(f + ':' + st.mtimeMs + ':' + st.size); }
      catch { parts.push(f + ':0:0'); }
    }
  }
  return parts.join('|');
}
const VALID_GENERATED_STATUSES = new Set([
  'full', 'postprocessed', 'spawn', 'light', 'initialize_light',
  'features', 'liquid_carvers', 'carvers', 'surface', 'terrain'
]);

function scanExploredChunks(root, levelName, dim) {
  const dirs = getRegionDirs(root, levelName, dim);
  const cacheKey = root + '|' + (levelName || 'world') + '|' + (dim || 'overworld');
  const sig = exploredSignature(dirs);
  const cached = exploredCache.get(cacheKey);
  if (cached && cached.sig === sig) return cached.chunks;
  const present = []; // [cx, cz, regionFile, sectorOffset]
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /^r\.-?\d+\.-?\d+\.mca$/.test(f)); } catch { continue; }
    for (const f of files) {
      const m = f.match(/^r\.(-?\d+)\.(-?\d+)\.mca$/);
      const rx = parseInt(m[1], 10), rz = parseInt(m[2], 10);
      const fp = path.join(dir, f);
      let fd;
      try {
        fd = fs.openSync(fp, 'r');
        const buf = Buffer.alloc(4096);
        fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);
        for (let i = 0; i < 1024; i++) {
          const v = buf.readUInt32BE(i * 4);
          if (v !== 0) present.push([rx * 32 + (i % 32), rz * 32 + Math.floor(i / 32), fp, v >>> 8]);
        }
      } catch { try { if (fd) fs.closeSync(fd); } catch {} }
      if (present.length > 200000) break;
    }
    if (present.length) break; // first dir that contains data wins (new layout preferred)
  }
  const chunks = new Set();
  if (present.length > FULL_SCAN_BUDGET) {
    for (const [cx, cz] of present) chunks.add(cx + ',' + cz);
    lruSet(exploredCache, cacheKey, { sig, chunks }, 8);
    return chunks;
  }
  // Small enough: verify each chunk actually finished generating.
  for (const [cx, cz, fp, off] of present) {
    const nbtData = readChunkNbtSync(fp, off);
    const st = nbtData && nbtData.Status ? String(nbtData.Status).replace(/^minecraft:/, '') : null;
    const isHorizon = fs.existsSync(path.join(root, 'server.toml'))
      || fs.existsSync(path.join(root, 'horizon-server.exe'))
      || fs.existsSync(path.join(root, 'horizon-server'))
      || fs.existsSync(path.join(root, String(levelName || 'world').replace(/[\\/]/g, '') || 'world', 'dimensions', 'minecraft', 'overworld', 'region'));
    const isFinished = isHorizon
      ? (VALID_GENERATED_STATUSES.has(st) || st === null)
      : (st === 'full' || st === 'postprocessed' || st === null);
    if (!nbtData || isFinished) chunks.add(cx + ',' + cz);
  }
  lruSet(exploredCache, cacheKey, { sig, chunks }, 8);
  return chunks;
}
// Reads a chunk's payload from a region file at sectorOff and inflates it (gzip / deflate / raw).
// Opens + closes its own fd. Returns the raw NBT buffer, or null when the chunk is missing or
// unreadable. Shared by the sync and async readers so the header parse and the compression branch
// cannot drift apart (gotcha #20).
function readChunkRaw(fp, sectorOff) {
  let fd;
  try {
    fd = fs.openSync(fp, 'r');
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, sectorOff * 4096);
    const len = head.readUInt32BE(0), ct = head.readUInt8(4);
    if (len <= 0) return null;
    const comp = Buffer.alloc(len - 1);
    fs.readSync(fd, comp, 0, len - 1, sectorOff * 4096 + 5);
    return ct === 1 ? zlib.gunzipSync(comp) : ct === 2 ? zlib.inflateSync(comp) : comp;
  } catch { return null; } finally { try { if (fd) fs.closeSync(fd); } catch {} }
}

// Synchronous twin of readChunkNbt — needed because scanExploredChunks is sync (its IPC handler
// and the wiring test both call it without awaiting). Returns null when the chunk is unreadable.
// Handles 1.18+ root Status, 1.16/1.13 Level.Status, and 1.12.2- Level.TerrainPopulated.
function readChunkNbtSync(fp, sectorOff) {
  const raw = readChunkRaw(fp, sectorOff);
  if (!raw) return null;
  // We only need the Status tag. nbt.parse is async, so it is useless inside this sync function —
  // use parseUncompressed (synchronous) instead. Java-edition chunks are big-endian.
  let parsed;
  try { parsed = nbt.parseUncompressed(raw); }
  catch { try { parsed = nbt.parseUncompressed(raw, 'little'); } catch { return null; } }
  const s = nbt.simplify(parsed);
  if (!s) return null;
  const L = s.Level;
  let status = s.Status || (L && L.Status) || null;
  if (!status && L) {
    if (L.TerrainPopulated !== undefined) {
      status = (L.TerrainPopulated === 1 || L.TerrainPopulated === true) ? 'full' : 'unpopulated';
    } else {
      status = 'full';
    }
  }
  return { Status: status };
}

// ============ REAL BIOME PREVIEW (1.18+ paletted containers & 1.16 Level biomes) ============
// Each chunk section carries `biomes` as a paletted container: { palette:[names], data?:[longs] }.
// When the section has a single biome it only has `palette` (no `data`); otherwise `data` is a
// bit-packed long array of 64 cells (4x4x4, y-major). We take the MOST COMMON biome of the highest
// section that has biome data — a good approximation of the surface biome at 16x16/chunk resolution.
function toBigLong(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (Array.isArray(v)) return ((BigInt(v[0] | 0) & 0xFFFFFFFFn) << 32n) | (BigInt(v[1] | 0) & 0xFFFFFFFFn);
  return 0n;
}
function unpackPalette(longs, bits, count) {
  const out = [];
  const perLong = Math.floor(64 / bits);
  const mask = (1n << BigInt(bits)) - 1n;
  for (const l of longs) {
    const b = toBigLong(l);
    for (let i = 0; i < perLong && out.length < count; i++) out.push(Number((b >> BigInt(i * bits)) & mask));
  }
  return out;
}
// Unpadded bit-stream unpacker for pre-1.16 saves (bits cross 64-bit boundaries)
function unpackPaletteUnpadded(longs, bits, count) {
  const out = [];
  const mask = (1n << BigInt(bits)) - 1n;
  let curLong = 0n;
  let curBits = 0;
  let li = 0;
  while (out.length < count && (li < longs.length || curBits >= bits)) {
    while (curBits < bits && li < longs.length) {
      curLong |= (toBigLong(longs[li]) & 0xFFFFFFFFFFFFFFFFn) << BigInt(curBits);
      curBits += 64;
      li++;
    }
    if (curBits < bits) break;
    out.push(Number(curLong & mask));
    curLong >>= BigInt(bits);
    curBits -= bits;
  }
  return out;
}
// HEIGHTMAP: chunk NBT carries `Heightmaps.MOTION_BLOCKING` (highest block incl. water) and
// `Heightmaps.OCEAN_FLOOR` (highest solid block under water) as 9-bit packed long arrays, 256 cells
// (z*16+x). Pure so it can be unit-tested without a real world. Returns 256 numbers (0..511).
function unpackHeightmap(longs, bits = 9, count = 256) {
  if (!longs || typeof longs.length !== 'number' || !longs.length) return null;
  // If longs length doesn't match standard 9-bit padded (37) or unpadded (36), infer bit width for modded/datapack heights
  if (longs.length !== 37 && longs.length !== 36) {
    for (let b = 8; b <= 12; b++) {
      const perLong = Math.floor(64 / b);
      if (Math.ceil(count / perLong) === longs.length) {
        bits = b;
        break;
      }
    }
  }
  let vals = unpackPalette(longs, bits, count);
  if (!vals || vals.length < count) {
    vals = unpackPaletteUnpadded(longs, bits, count);
  }
  if (!vals || vals.length < count) return null;
  return vals;
}
// Downsample the 16x16 (256) heightmap to a RES x RES grid by taking the MAX height in each block
// of (16/RES) cells — max keeps ridgelines readable instead of averaging them flat.
// Returns { heights:[RES*RES], water:[RES*RES] } (z-major, same order as the source grid).
function downsampleHeights(motion, ocean, RES = 4) {
  if (!motion || !ocean) return null;
  const step = 16 / RES;
  const heights = new Array(RES * RES).fill(0);
  const water = new Array(RES * RES).fill(false);
  for (let oz = 0; oz < RES; oz++) {
    for (let ox = 0; ox < RES; ox++) {
      let maxH = -Infinity, wet = 0, total = 0;
      for (let dz = 0; dz < step; dz++) {
        for (let dx = 0; dx < step; dx++) {
          const x = ox * step + dx, z = oz * step + dz;
          const i = z * 16 + x;
          const h = motion[i] | 0;
          if (h > maxH) maxH = h;
          if (motion[i] > ocean[i]) wet++;
          total++;
        }
      }
      heights[oz * RES + ox] = maxH === -Infinity ? 0 : maxH;
      water[oz * RES + ox] = wet * 2 >= total; // majority-water cell
    }
  }
  return { heights, water };
}
function sectionBiome(sec) {
  const b = sec && sec.biomes;
  if (!b || !Array.isArray(b.palette) || !b.palette.length) return null;
  if (!b.data || !b.data.length) return b.palette[0] || null; // single-biome section
  const bits = Math.max(1, Math.ceil(Math.log2(b.palette.length)));
  const cells = unpackPalette(b.data, bits, 64);
  const count = {};
  for (const c of cells) count[c] = (count[c] || 0) + 1;
  let best = 0, bestN = -1;
  for (const k in count) if (count[k] > bestN) { bestN = count[k]; best = Number(k); }
  return b.palette[best] || b.palette[0] || null;
}
// BIOME GRID (1.2.0): a section's biome container is 4x4x4 (64 cells). sectionBiome() collapses it
// to ONE biome for the whole chunk, so coastlines / biome edges looked like a single flat colour.
// This keeps a 4x4 grid — one biome per surface column — so the renderer can paint real biome
// boundaries inside a chunk. For each column we take the MAJORITY biome across its 4 vertical
// cells (order-independent: robust to the y/z/x packing order). Pure, so it is unit-tested.
function biomeGridFromSection(sec) {
  const b = sec && sec.biomes;
  if (!b || !Array.isArray(b.palette) || !b.palette.length) return null;
  const pal = b.palette;
  if (!b.data || !b.data.length) return new Array(16).fill(pal[0] || null); // single-biome section
  const bits = Math.max(1, Math.ceil(Math.log2(pal.length)));
  const cells = unpackPalette(b.data, bits, 64);
  const grid = new Array(16);
  for (let oz = 0; oz < 4; oz++) {
    for (let ox = 0; ox < 4; ox++) {
      const count = {};
      for (let y = 0; y < 4; y++) { const c = cells[ox + oz * 4 + y * 16] | 0; count[c] = (count[c] || 0) + 1; }
      let best = 0, bestN = -1;
      for (const k in count) if (count[k] > bestN) { bestN = count[k]; best = Number(k); }
      grid[oz * 4 + ox] = pal[best] || pal[0] || null;
    }
  }
  return grid;
}
function readChunkNbt(fp, sectorOff) {
  const raw = readChunkRaw(fp, sectorOff);
  if (!raw) return null;
  return nbt.parse(raw).then(p => nbt.simplify(p.parsed));
}

// ============ 1.16 / 1.15 / LEGACY CHUNK & BIOME SUPPORT ============
const VANILLA_BIOME_IDS = {
  0: 'minecraft:ocean', 1: 'minecraft:plains', 2: 'minecraft:desert', 3: 'minecraft:mountains',
  4: 'minecraft:forest', 5: 'minecraft:taiga', 6: 'minecraft:swamp', 7: 'minecraft:river',
  8: 'minecraft:nether_wastes', 9: 'minecraft:the_end', 10: 'minecraft:frozen_ocean',
  11: 'minecraft:frozen_river', 12: 'minecraft:snowy_tundra', 13: 'minecraft:snowy_mountains',
  14: 'minecraft:mushroom_fields', 15: 'minecraft:mushroom_field_shore', 16: 'minecraft:beach',
  17: 'minecraft:desert_hills', 18: 'minecraft:wooded_hills', 19: 'minecraft:taiga_hills',
  20: 'minecraft:mountain_edge', 21: 'minecraft:jungle', 22: 'minecraft:jungle_hills',
  23: 'minecraft:jungle_edge', 24: 'minecraft:deep_ocean', 25: 'minecraft:stone_shore',
  26: 'minecraft:snowy_beach', 27: 'minecraft:birch_forest', 28: 'minecraft:birch_forest_hills',
  29: 'minecraft:dark_forest', 30: 'minecraft:snowy_taiga', 31: 'minecraft:snowy_taiga_hills',
  32: 'minecraft:giant_tree_taiga', 33: 'minecraft:giant_tree_taiga_hills',
  34: 'minecraft:wooded_mountains', 35: 'minecraft:savanna', 36: 'minecraft:savanna_plateau',
  37: 'minecraft:badlands', 38: 'minecraft:wooded_badlands_plateau', 39: 'minecraft:badlands_plateau',
  40: 'minecraft:small_end_islands', 41: 'minecraft:end_midlands', 42: 'minecraft:end_highlands',
  43: 'minecraft:end_barrens', 44: 'minecraft:warm_ocean', 45: 'minecraft:lukewarm_ocean',
  46: 'minecraft:cold_ocean', 47: 'minecraft:deep_warm_ocean', 48: 'minecraft:deep_lukewarm_ocean',
  49: 'minecraft:deep_cold_ocean', 50: 'minecraft:deep_frozen_ocean', 127: 'minecraft:the_void',
  129: 'minecraft:sunflower_plains', 130: 'minecraft:desert_lakes', 131: 'minecraft:gravelly_mountains',
  132: 'minecraft:flower_forest', 133: 'minecraft:taiga_mountains', 134: 'minecraft:swamp_hills',
  140: 'minecraft:ice_spikes', 149: 'minecraft:modified_jungle', 151: 'minecraft:modified_jungle_edge',
  155: 'minecraft:tall_birch_forest', 156: 'minecraft:tall_birch_hills', 157: 'minecraft:dark_forest_hills',
  158: 'minecraft:snowy_taiga_mountains', 160: 'minecraft:giant_spruce_taiga',
  161: 'minecraft:giant_spruce_taiga_hills', 162: 'minecraft:modified_gravelly_mountains',
  163: 'minecraft:shattered_savanna', 164: 'minecraft:shattered_savanna_plateau',
  165: 'minecraft:eroded_badlands', 166: 'minecraft:modified_wooded_badlands_plateau',
  167: 'minecraft:modified_badlands_plateau', 168: 'minecraft:bamboo_jungle',
  169: 'minecraft:bamboo_jungle_hills', 170: 'minecraft:soul_sand_valley',
  171: 'minecraft:crimson_forest', 172: 'minecraft:warped_forest', 173: 'minecraft:basalt_deltas'
};

// Forge/Fabric mod biome registries from level.dat (fml.Registries / FML.Registries)
const worldBiomeRegistries = new Map();
function getBiomeRegistry(root, levelName) {
  if (!root) return {};
  const cacheKey = root + '|' + (levelName || 'world');
  if (worldBiomeRegistries.has(cacheKey)) return worldBiomeRegistries.get(cacheKey);

  const name = String(levelName || 'world').replace(/[\\/]/g, '') || 'world';
  const candidates = [
    path.join(root, name, 'level.dat'),
    path.join(root, 'level.dat'),
  ];
  let buf = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { try { buf = fs.readFileSync(p); break; } catch {} }
  }
  const map = {};
  if (buf) {
    try {
      let raw = buf;
      try { raw = zlib.gunzipSync(buf); } catch {}
      const parsed = nbt.parseUncompressed(raw);
      const S = nbt.simplify(parsed);
      const fml = S.fml || S.FML;
      const regs = fml && fml.Registries;
      if (regs) {
        const biomeReg = regs['minecraft:worldgen/biome'] || regs['minecraft:biomes'] || regs['biomes'];
        const ids = biomeReg && (biomeReg.ids || biomeReg.IDs || biomeReg.dump);
        if (Array.isArray(ids)) {
          for (const item of ids) {
            const num = (typeof item.V === 'number') ? item.V : (typeof item.v === 'number') ? item.v : (typeof item.id === 'number') ? item.id : null;
            const str = item.K || item.k || item.name || null;
            if (num != null && str) map[num] = str;
          }
        }
      }
    } catch {}
  }
  lruSet(worldBiomeRegistries, cacheKey, map, 16);
  return map;
}

function resolveBiome(v, customMap = null) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') {
    const num = Number(v);
    if (customMap && customMap[num]) return customMap[num];
    if (VANILLA_BIOME_IDS[num]) return VANILLA_BIOME_IDS[num];
    return 'biome_' + num;
  }
  return null;
}

function normalizeBiomeRaw(v) {
  if (typeof v === 'number') return v < 0 ? ((v + 256) & 0xFF) : v;
  if (typeof v === 'bigint') {
    const n = Number(v);
    return n < 0 ? ((n + 256) & 0xFF) : n;
  }
  return v;
}

// Normalizes sections across 1.18+ (root sections with block_states), 1.16/1.15 (Palette & BlockStates),
// and 1.12.2 and older legacy Anvil (Blocks & Data byte arrays).
function getChunkSections(nbtData) {
  if (!nbtData) return [];
  const raw = nbtData.sections || (nbtData.Level && (nbtData.Level.Sections || nbtData.Level.sections)) || [];
  if (!Array.isArray(raw)) return [];
  return raw.map(s => {
    if (!s) return s;
    if (s.block_states) return s;
    const pal = s.Palette || (s.block_states && s.block_states.palette) || null;
    const data = s.BlockStates || (s.block_states && s.block_states.data) || null;
    if (pal || data) {
      return {
        Y: s.Y,
        block_states: { palette: pal, data },
        biomes: s.biomes || null
      };
    }
    // 1.12.2 and older pre-flattening format
    if (s.Blocks) {
      return {
        Y: s.Y,
        blocks: s.Blocks,
        data: s.Data || null,
        add: s.Add || null
      };
    }
    return s;
  });
}

// Resolves 3D (1024 ints) or 2D (256 ints / bytes) biomes array into a 4x4 surface biome grid.
function biomesFromChunkArray(rawBiomes, relief, customMap = null, sliceY = null) {
  if (!rawBiomes || typeof rawBiomes.length !== 'number' || !rawBiomes.length) return null;
  const grid = new Array(16).fill(null);
  const heights = relief && relief.heights;

  if (rawBiomes.length >= 1024) {
    // 3D biomes (1.15 - 1.17): 4x4x64. Index = by * 16 + oz * 4 + ox
    for (let oz = 0; oz < 4; oz++) {
      for (let ox = 0; ox < 4; ox++) {
        const cellIdx = oz * 4 + ox;
        const h = (sliceY !== null && sliceY !== undefined && Number.isFinite(sliceY)) ? sliceY : (heights ? heights[cellIdx] : 64);
        const by = Math.max(0, Math.min(63, Math.floor(h / 4)));
        const idx = by * 16 + oz * 4 + ox;
        const rawId = normalizeBiomeRaw(rawBiomes[idx]);
        grid[cellIdx] = resolveBiome(rawId, customMap);
      }
    }
  } else if (rawBiomes.length >= 256) {
    // 2D biomes (1.14 down to 1.2 Anvil format): 16x16. Index = z * 16 + x
    for (let oz = 0; oz < 4; oz++) {
      for (let ox = 0; ox < 4; ox++) {
        const z = oz * 4 + 2, x = ox * 4 + 2;
        const idx = z * 16 + x;
        const rawId = normalizeBiomeRaw(rawBiomes[idx]);
        grid[oz * 4 + ox] = resolveBiome(rawId, customMap);
      }
    }
  } else {
    for (let i = 0; i < 16; i++) {
      const idx = i % rawBiomes.length;
      grid[i] = resolveBiome(normalizeBiomeRaw(rawBiomes[idx]), customMap);
    }
  }

  const count = {};
  for (const b of grid) if (b) count[b] = (count[b] || 0) + 1;
  let best = null, bestN = -1;
  for (const k in count) if (count[k] > bestN) { bestN = count[k]; best = k; }
  return { biome: best || grid[0] || null, biomeGrid: grid };
}

// 1.12.2 and older numeric block ID map for common terrain & surface blocks
const LEGACY_BLOCK_IDS = {
  0: 'minecraft:air', 1: 'minecraft:stone', 2: 'minecraft:grass_block', 3: 'minecraft:dirt',
  4: 'minecraft:cobblestone', 8: 'minecraft:water', 9: 'minecraft:water', 10: 'minecraft:lava', 11: 'minecraft:lava',
  12: 'minecraft:sand', 13: 'minecraft:gravel', 14: 'minecraft:gold_ore', 15: 'minecraft:iron_ore', 16: 'minecraft:coal_ore',
  17: 'minecraft:oak_log', 18: 'minecraft:oak_leaves', 21: 'minecraft:lapis_ore', 24: 'minecraft:sandstone',
  56: 'minecraft:diamond_ore', 73: 'minecraft:redstone_ore', 78: 'minecraft:snow', 79: 'minecraft:ice',
  80: 'minecraft:snow_block', 82: 'minecraft:clay', 87: 'minecraft:netherrack', 88: 'minecraft:soul_sand',
  110: 'minecraft:mycelium', 121: 'minecraft:end_stone', 129: 'minecraft:emerald_ore', 159: 'minecraft:terracotta',
  161: 'minecraft:leaves', 162: 'minecraft:oak_log', 172: 'minecraft:terracotta', 174: 'minecraft:packed_ice',
  179: 'minecraft:red_sandstone', 208: 'minecraft:dirt_path', 212: 'minecraft:frosted_ice',
  213: 'minecraft:magma_block', 214: 'minecraft:nether_wart_block', 215: 'minecraft:red_nether_brick', 216: 'minecraft:bone_block'
};

function legacyBlockName(id) {
  if (id === 0 || id === 31 || id === 32 || id === 37 || id === 38 || id === 175) return null;
  return LEGACY_BLOCK_IDS[id] || ('block_' + id);
}

// ============ SURFACE BLOCK (5.6.0) ============
// The biome alone decides only the green tints; the SURFACE BLOCK decides whether a column reads as
// grass, sand, stone, snow or water. A block_states paletted container packs 16x16x16 block ids in
// y-major order, MIN 4 bits per entry (unlike biomes, which use min 1). Returns the block Name at
// (x,y,z) in a section, or null when the section carries no block palette.
const AIR_BLOCK = /^(?:minecraft:)?(?:air|cave_air|void_air|tall_grass|grass|short_grass|fern|large_fern|dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony)$/;
function extractBlockName(e) {
  if (!e) return null;
  if (typeof e === 'string') return e;
  if (typeof e.Name === 'string') return e.Name;
  if (e.Name && typeof e.Name.value === 'string') return e.Name.value;
  if (typeof e.id === 'string') return e.id;
  if (typeof e[''] === 'string') return e[''];
  if (typeof e.name === 'string') return e.name;
  if (typeof e === 'object') {
    for (const k of Object.keys(e)) {
      if (typeof e[k] === 'string' && (e[k].includes(':') || e[k].length > 2)) return e[k];
    }
  }
  return null;
}

function blockAt(section, x, y, z) {
  if (!section) return null;
  if (section.blocks && section.blocks.length >= 4096) {
    const idx = y * 256 + z * 16 + x;
    let id = Number(section.blocks[idx]) & 0xFF;
    if (section.add && section.add.length >= 2048) {
      const nibble = (idx & 1) ? (section.add[idx >> 1] >> 4) : (section.add[idx >> 1] & 0x0F);
      id |= ((nibble & 0x0F) << 8);
    }
    return legacyBlockName(id);
  }
  const bs = section.block_states;
  if (!bs || !Array.isArray(bs.palette) || !bs.palette.length) return null;
  const pal = bs.palette;
  if (!bs.data || !bs.data.length) return extractBlockName(pal[0]); // single-block section
  const bits = Math.max(4, Math.ceil(Math.log2(pal.length)));
  const idx = y * 256 + z * 16 + x;
  const perLong = Math.floor(64 / bits);
  const mask = (1n << BigInt(bits)) - 1n;
  const unpadded = bs.data.length === Math.ceil(4096 * bits / 64) && bs.data.length < Math.ceil(4096 / perLong);
  let v = 0;
  if (!unpadded) {
    const li = Math.floor(idx / perLong);
    if (li >= bs.data.length) return null;
    const off = (idx % perLong) * bits;
    v = Number((toBigLong(bs.data[li]) >> BigInt(off)) & mask);
  } else {
    const bitIndex = idx * bits;
    const li = Math.floor(bitIndex / 64);
    if (li >= bs.data.length) return null;
    const startBit = bitIndex % 64;
    const l1 = toBigLong(bs.data[li]);
    if (startBit + bits <= 64) {
      v = Number((l1 >> BigInt(startBit)) & mask);
    } else {
      const l2 = (li + 1 < bs.data.length) ? toBigLong(bs.data[li + 1]) : 0n;
      const bitsInFirst = 64 - startBit;
      const part1 = (l1 >> BigInt(startBit)) & ((1n << BigInt(bitsInFirst)) - 1n);
      const part2 = l2 & ((1n << BigInt(bits - bitsInFirst)) - 1n);
      v = Number(part1 | (part2 << BigInt(bitsInFirst)));
    }
  }
  return extractBlockName(pal[v]);
}
// A 4x4 grid of surface block names (one per cell), or null. Uses OCEAN_FLOOR (highest SOLID block
// under any water) so a water column resolves to the ground beneath it, not the water itself; the
// renderer adds the water on top. Falls back to a slightly lower y when the first read is air
// (a flower/plant sits above the ground). Pure-ish (reads only the parsed NBT), unit-tested.
function surfaceBlocksFromChunk(nbtData, motion, ocean, RES = 4, relief = null, sliceY = null) {
  if (!nbtData || !motion || !ocean) return null;
  const sections = getChunkSections(nbtData);
  if (!sections.length) return null;
  const secByY = new Map();
  for (const s of sections) secByY.set(s.Y | 0, s);
  const step = 16 / RES;
  const out = new Array(RES * RES).fill(null);
  const hasSlice = (sliceY !== null && sliceY !== undefined && Number.isFinite(sliceY));
  for (let oz = 0; oz < RES; oz++) {
    for (let ox = 0; ox < RES; ox++) {
      const votes = {};
      let hasWater = false;
      let hasLava = false;
      let floorY = null;
      for (let dz = 0; dz < step; dz++) {
        for (let dx = 0; dx < step; dx++) {
          const x = ox * step + dx, z = oz * step + dz, i = z * 16 + x;
          const solidY = hasSlice ? Math.min(ocean[i] | 0, sliceY | 0) : (ocean[i] | 0);
          let name = null;
          // Scan down to find solid surface / slice block (supports 1.18+ to 1.21.x negative coordinates down to Y=-64)
          let depth = 0;
          for (let y = solidY; y >= -64 && depth < (hasSlice ? 64 : 20); y--, depth++) {
            const sy = Math.floor(y / 16);
            const nm = blockAt(secByY.get(sy), x, y - sy * 16, z);
            if (nm && !AIR_BLOCK.test(nm)) {
              if (nm === 'minecraft:lava') {
                hasLava = true;
                name = nm;
                if (floorY === null || y < floorY) floorY = y;
                break;
              }
              if (nm === 'minecraft:water') {
                hasWater = true;
                if (floorY === null || y < floorY) floorY = y;
                continue; // continue down to ground beneath water
              }
              name = nm;
              if (floorY === null || y < floorY) floorY = y;
              break;
            } else if (hasWater) {
              continue;
            } else if (!hasSlice && depth >= 3) {
              break;
            }
          }
          if (name) votes[name] = (votes[name] || 0) + 1;
        }
      }
      let best = null, bn = -1;
      for (const k in votes) if (votes[k] > bn) { bn = votes[k]; best = k; }
      const cellIdx = oz * RES + ox;
      out[cellIdx] = best || (hasLava ? 'minecraft:lava' : (hasWater ? 'minecraft:water' : null));
      if (hasSlice && relief && relief.water) {
        relief.water[cellIdx] = hasWater;
      } else if (hasWater && relief && relief.water) {
        relief.water[cellIdx] = true;
      }
      if (hasSlice && floorY !== null && relief && relief.heights) {
        relief.heights[cellIdx] = floorY;
      }
    }
  }
  return out;
}

const biomeRegionCache = new Map();

// PURE: extract { biome, biomeGrid, relief } from a parsed chunk NBT object. Only a FULLY generated
// chunk (Status 'minecraft:full', 'full', 'postprocessed', or 1.12.2 TerrainPopulated:1) carries REAL biome data.
// Early-stage chunks ship a placeholder palette that must NOT be trusted.
function biomeFromChunk(nbtData, customMap = null, sliceY = null) {
  let biome = null, biomeGrid = null, relief = null, surface = null;
  if (!nbtData) return { biome, biomeGrid, relief, surface };

  const L = nbtData.Level;
  let rawStatus = nbtData.Status || (L && L.Status) || '';
  if (!rawStatus && L) {
    if (L.TerrainPopulated !== undefined) {
      rawStatus = (L.TerrainPopulated === 1 || L.TerrainPopulated === true) ? 'full' : 'unpopulated';
    } else {
      rawStatus = 'full';
    }
  }
  const status = String(rawStatus).replace(/^minecraft:/, '');
  if (!VALID_GENERATED_STATUSES.has(status)) {
    return { biome, biomeGrid, relief, surface };
  }

  // Sections: normalized across 1.18+ (root sections), 1.16/1.15, and 1.12.2- (Level.Sections)
  const secs = getChunkSections(nbtData).slice().sort((a, b) => (a.Y | 0) - (b.Y | 0));
  // Heightmaps offset: only 1.18+ (no Level compound, negative yPos) offsets height values by minY.
  // Pre-1.18 chunks (1.16/1.17/1.12 with Level) ALWAYS use absolute Y coordinates (0..255).
  let minY = 0;
  if (!nbtData.Level && typeof nbtData.yPos === 'number' && nbtData.yPos < 0) {
    minY = nbtData.yPos * 16;
  }

  // 1. Heightmaps and surface relief (1.13+ Heightmaps compound, or 1.12.2- HeightMap int[256])
  const hm = nbtData.Heightmaps || (L && L.Heightmaps);
  if (hm) {
    const motionRaw = hm.MOTION_BLOCKING || hm.WORLD_SURFACE || null;
    const oceanRaw = hm.OCEAN_FLOOR || hm.OCEAN_FLOOR_WG || motionRaw;
    let motion = unpackHeightmap(motionRaw);
    let ocean = unpackHeightmap(oceanRaw) || motion;
    if (minY !== 0) {
      if (motion) motion = motion.map(h => h + minY);
      if (ocean) ocean = ocean.map(h => h + minY);
    }
    relief = downsampleHeights(motion, ocean, 4);
    try { surface = surfaceBlocksFromChunk(nbtData, motion, ocean, 4, relief, sliceY); } catch { surface = null; }
  } else if (L && (L.HeightMap || L.Heightmap)) {
    const rawH = L.HeightMap || L.Heightmap;
    if (rawH && rawH.length >= 256) {
      const motion = Array.from(rawH.slice(0, 256));
      relief = downsampleHeights(motion, motion, 4);
      try { surface = surfaceBlocksFromChunk(nbtData, motion, motion, 4, relief, sliceY); } catch { surface = null; }
    }
  }

  // 2. 1.18+ to 1.21.x sections (paletted containers in sections[].biomes)
  // In 1.18+, pick the section closest to surface elevation
  const hasSliceY = (sliceY !== null && sliceY !== undefined && Number.isFinite(sliceY));
  const targetY = hasSliceY ? Math.floor(sliceY / 16) : ((relief && relief.heights && relief.heights.length) ? Math.floor(Math.max(...relief.heights) / 16) : null);
  if (targetY !== null) {
    const targetSec = secs.find(s => (s.Y | 0) === targetY);
    if (targetSec) {
      const b = sectionBiome(targetSec);
      if (b) {
        biome = b;
        biomeGrid = biomeGridFromSection(targetSec);
      }
    }
  }
  if (!biome) {
    for (const sec of secs.reverse()) {
      const b = sectionBiome(sec);
      if (b) {
        biome = b;
        biomeGrid = biomeGridFromSection(sec);
        break;
      }
    }
  }

  // 3. 1.16 / 1.15 (1024 ints) & 1.14 / 1.12.2- (256 bytes) chunk biomes array (Level.Biomes or nbtData.biomes)
  if (!biome) {
    const rawBiomes = (L && L.Biomes) || nbtData.biomes || (L && L.biomes);
    if (rawBiomes && rawBiomes.length) {
      const fromArr = biomesFromChunkArray(rawBiomes, relief, customMap, sliceY);
      if (fromArr) {
        biome = fromArr.biome;
        biomeGrid = fromArr.biomeGrid;
      }
    }
  }

  return { biome, biomeGrid, relief, surface };
}

async function readBiomes(root, levelName, dim, rect) {
  const sliceY = (rect?.sliceY !== undefined && rect?.sliceY !== null) ? Number(rect.sliceY) : null;
  if (!root || !rect) return { biomes: [] };
  const customBiomeMap = getBiomeRegistry(root, levelName);
  const { cx0, cz0, cx1, cz1 } = rect;
  const dirs = getRegionDirs(root, levelName, dim);
  const out = [];
  const CAP = 2000;
  for (const dir of dirs) {
    const rxMin = Math.floor(cx0 / 32), rxMax = Math.floor(cx1 / 32);
    const rzMin = Math.floor(cz0 / 32), rzMax = Math.floor(cz1 / 32);
    for (let rx = rxMin; rx <= rxMax && out.length < CAP; rx++) {
      for (let rz = rzMin; rz <= rzMax && out.length < CAP; rz++) {
        const fp = path.join(dir, `r.${rx}.${rz}.mca`);
        let stat;
        try { stat = fs.statSync(fp); } catch { continue; }
        const key = fp + (sliceY !== null ? ':y' + sliceY : '');
        let entry = biomeRegionCache.get(key);
        if (!entry || entry.mtime !== stat.mtimeMs) {
          entry = { mtime: stat.mtimeMs, chunks: new Map(), header: null };
          lruSet(biomeRegionCache, key, entry, 64);
        }
        // PERF: the 4 KB region header is read once per region and cached with the entry, so
        // repeated pans over the same region don't re-open + re-read it on every readBiomes call.
        if (!entry.header) {
          try { const h = Buffer.alloc(4096); const fd = fs.openSync(fp, 'r'); fs.readSync(fd, h, 0, 4096, 0); fs.closeSync(fd); entry.header = h; } catch { continue; }
        }
        const header = entry.header;
        for (let i = 0; i < 1024 && out.length < CAP; i++) {
          const v = header.readUInt32BE(i * 4);
          if (v === 0) continue;
          const cx = rx * 32 + (i % 32), cz = rz * 32 + Math.floor(i / 32);
          if (cx < cx0 || cx > cx1 || cz < cz0 || cz > cz1) continue;
          const ck = cx + ',' + cz;
          if (entry.chunks.has(ck)) { const rec = entry.chunks.get(ck); if (rec) { const row = [cx, cz, rec.b]; if (rec.h) { row.push(rec.h, rec.w, rec.g || null, rec.s || null); } out.push(row); } continue; }
          const nbtData = await readChunkNbt(fp, v >>> 8);
          // BUGFIX (3.2.5): only a FULLY generated chunk carries real biome data. An early-stage chunk
          // (status 'minecraft:structure_starts' or similar) still ships a PLACEHOLDER biome palette
          // (minecraft:plains) that was read as if real - so The End rendered with overworld colours.
          // scanExploredChunks() already trusts only 'minecraft:full'; readBiomes must match.
          const { biome, biomeGrid, relief, surface } = biomeFromChunk(nbtData, customBiomeMap, sliceY);
          const rec = { b: biome };
          if (relief) { rec.h = relief.heights; rec.w = relief.water; rec.g = biomeGrid || null; rec.s = surface || null; }
          entry.chunks.set(ck, rec);
          // Push null-biome chunks too (as [cx,cz,null]) so the renderer can tell "checked, no
          // biome data" apart from "not fetched yet" and shade it differently. h/w (when present)
          // carry the real 4x4 heightmap + water mask; g (when present) the 16 per-cell biomes.
          const row = [cx, cz, biome];
          if (relief) { row.push(relief.heights, relief.water, biomeGrid || null, surface || null); }
          out.push(row);
        }
      }
    }
    if (out.length) break; // first dir with data wins (new layout preferred)
  }
  return { biomes: out, truncated: out.length >= CAP };
}

const WP_FILE = 'observerlauncher-waypoints.json';
function readWaypoints(root) {
  if (!root) return [];
  try {
    const list = readJsonList(root, WP_FILE);
    return Array.isArray(list) ? list.filter(w => w && w.id && typeof w.x === 'number') : [];
  } catch { return []; }
}
function writeWaypoints(root, list) {
  if (!root) return { ok: false };
  try {
    writeFileAtomic(path.join(root, WP_FILE), JSON.stringify(list, null, 2));
    return { ok: true, count: list.length };
  } catch (e) { return { ok: false, error: e.code || 'writeError' }; }
}

// MODDED SUPPORT: list the dimension folders under <world>/dimensions/<namespace>/<path>.
// Vanilla dims live under the minecraft: namespace (overworld/the_nether/the_end); anything else
// is added by a mod. Used only to WARN the user (the map cannot render custom dimensions yet) —
// it never changes what is drawn. Returns ['namespace:path', ...].
function listDimensions(root, levelName) {
  const base = path.join(root, String(levelName || 'world').replace(/[\\/]/g, '') || 'world');
  const dir = path.join(base, 'dimensions');
  const out = [];
  let nsDirs = [];
  try { nsDirs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return out; }
  for (const ns of nsDirs) {
    let dims = [];
    try { dims = fs.readdirSync(path.join(dir, ns.name), { withFileTypes: true }).filter(d => d.isDirectory()); } catch { continue; }
    for (const d of dims) out.push(`${ns.name}:${d.name}`);
  }
  return out;
}

module.exports = { readLevel, readPlayers, readWaypoints, writeWaypoints, longToBigInt, dimName, WP_FILE, getRegionDirs, scanExploredChunks, readBiomes, biomeFromChunk, unpackHeightmap, downsampleHeights, biomeGridFromSection, listDimensions, surfaceBlocksFromChunk, blockAt, extractBlockName, resolveBiome, getChunkSections, biomesFromChunkArray, getBiomeRegistry };
