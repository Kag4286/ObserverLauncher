// World Map backend — reads REAL data from the world save (no approximations):
//   level.dat   → world seed, level name, version, spawn point
//   playerdata/ → per-player last position + dimension (names resolved via usercache.json)
//   observerlauncher-waypoints.json → user waypoints (created on demand)
// 64-bit world seeds are returned as DECIMAL STRINGS (JS numbers lose precision above 2^53).
const fs = require('fs');
const path = require('path');
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
      players.push({
        uuid,
        name: names[uuid.toLowerCase()] || null,
        pos: { x: +pos[0], y: +pos[1], z: +pos[2] },
        dim: dimName(S.Dimension),
        gamemode: S.playerGameType | 0,
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
function scanExploredChunks(root, levelName, dim) {
  const chunks = new Set();
  for (const dir of getRegionDirs(root, levelName, dim)) {
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
          if (buf.readUInt32BE(i * 4) !== 0) {
            const cx = rx * 32 + (i % 32);
            const cz = rz * 32 + Math.floor(i / 32);
            chunks.add(cx + ',' + cz);
          }
        }
      } catch { try { if (fd) fs.closeSync(fd); } catch {} }
      if (chunks.size > 200000) break;
    }
    if (chunks.size) break; // first dir that contains data wins (new layout preferred)
  }
  return chunks;
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

module.exports = { readLevel, readPlayers, readWaypoints, writeWaypoints, longToBigInt, dimName, WP_FILE, getRegionDirs, scanExploredChunks };
