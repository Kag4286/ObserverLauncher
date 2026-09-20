// World Map backend — reads REAL data from the world save (no approximations):
//   level.dat   → world seed, level name, version, spawn point
//   playerdata/ → per-player last position + dimension (names resolved via usercache.json)
//   observerlauncher-waypoints.json → user waypoints (created on demand)
// 64-bit world seeds are returned as DECIMAL STRINGS (JS numbers lose precision above 2^53).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');
const { safeTarget, readJsonList, writeFileAtomic } = require('./fs-utils.js');

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
  if (!buf) return { ok: false, error: 'noWorld', tried: name + '/level.dat, level.dat' };
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
    version: { name: D.Version?.Name || '?', id: D.Version?.Id | 0, snapshot: !!D.Version?.Snapshot },
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
  ];
  if (dim === 'nether') return [
    path.join(base, 'dimensions', 'minecraft', 'the_nether', 'region'),
    path.join(base, 'dimensions', 'minecraft', 'the_nether'),
    path.join(base, 'DIM-1', 'region'),
  ];
  if (dim === 'end') return [
    path.join(base, 'dimensions', 'minecraft', 'the_end', 'region'),
    path.join(base, 'DIM1', 'region'),
  ];
  return [];
}
// Reads the header of each region file to list chunks that exist on disk. A non-zero slot offset
// means a chunk was written — but proto-chunks (server crashed mid-generation) also have an
// offset, so when the world is small enough we also read each chunk's NBT and keep only those
// with Status 'minecraft:full'. Above FULL_SCAN_BUDGET chunks we skip the per-chunk parse (it
// would block the main process for seconds) and fall back to the header-only approximation.
const FULL_SCAN_BUDGET = 3000;
function scanExploredChunks(root, levelName, dim) {
  const present = []; // [cx, cz, regionFile, sectorOffset]
  const dirs = getRegionDirs(root, levelName, dim);
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
    return chunks;
  }
  // Small enough: verify each chunk actually finished generating.
  for (const [cx, cz, fp, off] of present) {
    const nbtData = readChunkNbtSync(fp, off);
    if (!nbtData || nbtData.Status === 'minecraft:full') chunks.add(cx + ',' + cz);
  }
  return chunks;
}
// Synchronous twin of readChunkNbt — needed because scanExploredChunks is sync (its IPC handler
// and the wiring test both call it without awaiting). Returns null when the chunk is unreadable.
function readChunkNbtSync(fp, sectorOff) {
  let fd;
  try {
    fd = fs.openSync(fp, 'r');
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, sectorOff * 4096);
    const len = head.readUInt32BE(0), ct = head.readUInt8(4);
    if (len <= 0) return null;
    const comp = Buffer.alloc(len - 1);
    fs.readSync(fd, comp, 0, len - 1, sectorOff * 4096 + 5);
    const raw = ct === 1 ? zlib.gunzipSync(comp) : ct === 2 ? zlib.inflateSync(comp) : comp;
    // We only need the Status tag. nbt.parse is async, so it is useless inside this sync function —
    // use parseUncompressed (synchronous) instead. Java-edition chunks are big-endian.
    let parsed;
    try { parsed = nbt.parseUncompressed(raw); }
    catch { try { parsed = nbt.parseUncompressed(raw, 'little'); } catch { return null; } }
    const s = nbt.simplify(parsed);
    return { Status: s && s.Status };
  } catch { return null; } finally { try { if (fd) fs.closeSync(fd); } catch {} }
}

// ============ REAL BIOME PREVIEW (1.18+ paletted containers) ============
// Each chunk section carries `biomes` as a paletted container: { palette:[names], data?:[longs] }.
// When the section has a single biome it only has `palette` (no `data`); otherwise `data` is a
// bit-packed long array of 64 cells (4x4x4, y-major). We take the MOST COMMON biome of the highest
// section that has biome data — a good approximation of the surface biome at 16x16/chunk resolution.
function toBigLong(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (Array.isArray(v)) return (BigInt(v[0] | 0) << 32n) | BigInt(v[1] >>> 0);
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
// HEIGHTMAP: chunk NBT carries `Heightmaps.MOTION_BLOCKING` (highest block incl. water) and
// `Heightmaps.OCEAN_FLOOR` (highest solid block under water) as 9-bit packed long arrays, 256 cells
// (z*16+x). Pure so it can be unit-tested without a real world. Returns 256 numbers (0..511).
function unpackHeightmap(longs, bits = 9, count = 256) {
  if (!Array.isArray(longs) || !longs.length) return null;
  const vals = unpackPalette(longs, bits, count);
  if (vals.length < count) return null;
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
      let maxH = 0, wet = 0, total = 0;
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
      heights[oz * RES + ox] = maxH;
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
function readChunkNbt(fp, sectorOff) {
  let fd;
  try {
    fd = fs.openSync(fp, 'r');
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, sectorOff * 4096);
    const len = head.readUInt32BE(0), ct = head.readUInt8(4);
    if (len <= 0) return null;
    const comp = Buffer.alloc(len - 1);
    fs.readSync(fd, comp, 0, len - 1, sectorOff * 4096 + 5);
    const raw = ct === 1 ? zlib.gunzipSync(comp) : ct === 2 ? zlib.inflateSync(comp) : comp;
    return nbt.parse(raw).then(p => nbt.simplify(p.parsed));
  } catch { return null; } finally { try { if (fd) fs.closeSync(fd); } catch {} }
}

// Cache: region file path -> { mtime, [cx,cz] -> biome }. Avoids re-reading a region on every pan.
const biomeRegionCache = new Map();

async function readBiomes(root, levelName, dim, rect) {
  if (!root || !rect) return { biomes: [] };
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
        const key = fp;
        let entry = biomeRegionCache.get(key);
        if (!entry || entry.mtime !== stat.mtimeMs) {
          entry = { mtime: stat.mtimeMs, chunks: new Map() };
          biomeRegionCache.set(key, entry);
          if (biomeRegionCache.size > 64) { const k0 = biomeRegionCache.keys().next().value; biomeRegionCache.delete(k0); }
        }
        let header = null;
        try { header = Buffer.alloc(4096); const fd = fs.openSync(fp, 'r'); fs.readSync(fd, header, 0, 4096, 0); fs.closeSync(fd); } catch { continue; }
        for (let i = 0; i < 1024 && out.length < CAP; i++) {
          const v = header.readUInt32BE(i * 4);
          if (v === 0) continue;
          const cx = rx * 32 + (i % 32), cz = rz * 32 + Math.floor(i / 32);
          if (cx < cx0 || cx > cx1 || cz < cz0 || cz > cz1) continue;
          const ck = cx + ',' + cz;
          if (entry.chunks.has(ck)) { const rec = entry.chunks.get(ck); if (rec) out.push(rec.h ? [cx, cz, rec.b, rec.h, rec.w] : [cx, cz, rec.b]); continue; }
          const nbtData = await readChunkNbt(fp, v >>> 8);
          let biome = null, relief = null;
          if (nbtData) {
            const secs = (nbtData.sections || []).slice().sort((a, b) => (a.Y | 0) - (b.Y | 0));
            for (const sec of secs.reverse()) { const b = sectionBiome(sec); if (b) { biome = b; break; } }
            // Real heightmap (no extra I/O — already parsed). Gives the renderer actual terrain
            // relief + water instead of the seed-noise approximation.
            const hm = nbtData.Heightmaps;
            if (hm) {
              const motion = unpackHeightmap(hm.MOTION_BLOCKING);
              const ocean = unpackHeightmap(hm.OCEAN_FLOOR);
              relief = downsampleHeights(motion, ocean, 4);
            }
          }
          const rec = relief ? { b: biome, h: relief.heights, w: relief.water } : { b: biome };
          entry.chunks.set(ck, rec);
          // Push null-biome chunks too (as [cx,cz,null]) so the renderer can tell "checked, no
          // biome data" apart from "not fetched yet" and shade it differently. h/w (when present)
          // carry the real 4x4 heightmap + water mask.
          out.push(relief ? [cx, cz, biome, relief.heights, relief.water] : [cx, cz, biome]);
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

module.exports = { readLevel, readPlayers, readWaypoints, writeWaypoints, longToBigInt, dimName, WP_FILE, getRegionDirs, scanExploredChunks, readBiomes, unpackHeightmap, downsampleHeights };
