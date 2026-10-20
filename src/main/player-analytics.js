// player-analytics.js — aggregate player statistics across the world (v6.0.0 Track B - B2).
//
// WHY: The Stats tab shows one player's numbers. A server admin usually wants to see
// who has played the most, who has died the most, etc. This reads every stats JSON
// file in the world and returns a sorted leaderboard.
//
// Playtime in Minecraft stats is stored in ticks (20 ticks = 1 second).
//
// LAYOUT (fixed twice, 2026-10-20): two independent assumptions were wrong.
//   1. 1.21.5+/26.x moved <world>/stats/ to <world>/players/stats/, next to the playerdata move.
//   2. The reader then looked at ONE folder (server.properties level-name). findPlayerDataFile
//      already scans every world-like directory in the server root, because a server can hold
//      several worlds and level-name can be changed after the fact. This reader now does the
//      same: collect every world folder that has either stats layout and read them all.

const fs = require('fs');
const path = require('path');

// Every world root that has a stats folder, in either layout. Returns [{ world, statsDir }].
function findStatsDirs(root, levelName) {
  const out = [];
  const seen = new Set();
  const push = (world, statsDir) => {
    const key = statsDir;
    if (seen.has(key)) return;
    try { if (!fs.statSync(statsDir).isDirectory()) return; } catch { return; }
    seen.add(key);
    out.push({ world, statsDir });
  };
  // The configured level-name first, then every directory in the root that looks like a world.
  // A server with several worlds stores each in its own folder; the leaderboard should see all
  // of them, and the default '<world>' plus its _nether / _the_end siblings are excluded because
  // they share the parent world's stats.
  const preferred = String(levelName || 'world');
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name); } catch {}
  const worlds = [preferred, ...dirs.filter(d => !/_(nether|the_end)$/i.test(d))];
  for (const world of [...new Set(worlds)]) {
    // New layout first; a migrated world may briefly have both, and the new one is authoritative.
    push(world, path.join(root, world, 'players', 'stats'));
    push(world, path.join(root, world, 'stats'));
  }
  return out;
}

// Read all stats files for a given server root.
// Returns an array of { uuid, name, playTimeSec, deaths, mobKills, playerKills, blocksMined }.
function getPlayerAnalytics(root, levelName, knownPlayers) {
  // Build a UUID -> name map from knownPlayers (from usercache.json)
  const nameMap = new Map();
  for (const p of (knownPlayers || [])) {
    if (p.uuid && p.name) nameMap.set(String(p.uuid).replace(/-/g, '').toLowerCase(), p.name);
  }

  // Collect files from every stats folder. A player can appear in more than one world; keep the
  // largest playtime for that UUID so a leaderboard row never shows the smaller of two records.
  const byUuid = new Map();
  for (const { statsDir } of findStatsDirs(root, levelName)) {
    let files = [];
    try { files = fs.readdirSync(statsDir).filter(f => f.endsWith('.json')); } catch { continue; }
    for (const file of files) {
      const uuid = file.replace(/\.json$/, '');
      const cleanUuid = uuid.replace(/-/g, '').toLowerCase();
      let json;
      try { json = JSON.parse(fs.readFileSync(path.join(statsDir, file), 'utf8')); } catch { continue; }
      const custom = json?.stats?.['minecraft:custom'] || {};

      // The stats keys vary slightly between versions, but play_time is the modern one.
      const playTicks = Number(custom['minecraft:play_time'] ?? custom['minecraft:play_one_minute'] ?? 0);
      const row = {
        uuid,
        name: nameMap.get(cleanUuid) || uuid.slice(0, 8),
        playTimeSec: Math.round(playTicks / 20),
        deaths: Number(custom['minecraft:deaths'] ?? 0),
        mobKills: Number(custom['minecraft:mob_kills'] ?? 0),
        playerKills: Number(custom['minecraft:player_kills'] ?? 0),
        blocksMined: Number(custom['minecraft:blocks_mined'] ?? 0),
      };
      const prev = byUuid.get(cleanUuid);
      // Merge: playtime and the counters take the larger value. This is a display leaderboard,
      // not an audit; the bigger number is the least surprising rule when the same UUID exists
      // in two worlds.
      if (!prev) { byUuid.set(cleanUuid, row); continue; }
      if (row.playTimeSec > prev.playTimeSec) { prev.playTimeSec = row.playTimeSec; }
      prev.deaths = Math.max(prev.deaths, row.deaths);
      prev.mobKills = Math.max(prev.mobKills, row.mobKills);
      prev.playerKills = Math.max(prev.playerKills, row.playerKills);
      prev.blocksMined = Math.max(prev.blocksMined, row.blocksMined);
    }
  }

  const results = [...byUuid.values()];
  // Sort by playtime descending by default
  results.sort((a, b) => b.playTimeSec - a.playTimeSec);
  return results;
}

module.exports = { getPlayerAnalytics, findStatsDirs };
