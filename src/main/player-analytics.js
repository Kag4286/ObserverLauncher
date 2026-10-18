// player-analytics.js — aggregate player statistics across the world (v6.0.0 Track B - B2).
//
// WHY: The Stats tab shows one player's numbers. A server admin usually wants to see
// who has played the most, who has died the most, etc. This reads every stats JSON
// file in the world and returns a sorted leaderboard.
//
// Playtime in Minecraft stats is stored in ticks (20 ticks = 1 second).

const fs = require('fs');
const path = require('path');

// Read all stats files for a given world folder.
// Returns an array of { uuid, name, playTimeSec, deaths, mobKills, playerKills, blocksMined }.
function getPlayerAnalytics(root, levelName, knownPlayers) {
  const world = levelName || 'world';
  const statsDir = path.join(root, world, 'stats');
  if (!fs.existsSync(statsDir)) return [];

  // Build a UUID -> name map from knownPlayers (from usercache.json)
  const nameMap = new Map();
  for (const p of (knownPlayers || [])) {
    if (p.uuid && p.name) nameMap.set(String(p.uuid).replace(/-/g, '').toLowerCase(), p.name);
  }

  const results = [];
  let files = [];
  try { files = fs.readdirSync(statsDir).filter(f => f.endsWith('.json')); } catch { return []; }

  for (const file of files) {
    const uuid = file.replace(/\.json$/, '');
    const cleanUuid = uuid.replace(/-/g, '').toLowerCase();
    let json;
    try { json = JSON.parse(fs.readFileSync(path.join(statsDir, file), 'utf8')); } catch { continue; }
    const custom = json?.stats?.['minecraft:custom'] || {};
    
    // The stats keys vary slightly between versions, but play_time is the modern one.
    const playTicks = Number(custom['minecraft:play_time'] ?? custom['minecraft:play_one_minute'] ?? 0);
    const deaths = Number(custom['minecraft:deaths'] ?? 0);
    const mobKills = Number(custom['minecraft:mob_kills'] ?? 0);
    const playerKills = Number(custom['minecraft:player_kills'] ?? 0);
    const blocksMined = Number(custom['minecraft:blocks_mined'] ?? 0);

    results.push({
      uuid,
      name: nameMap.get(cleanUuid) || uuid.slice(0, 8),
      playTimeSec: Math.round(playTicks / 20),
      deaths,
      mobKills,
      playerKills,
      blocksMined,
    });
  }

  // Sort by playtime descending by default
  results.sort((a, b) => b.playTimeSec - a.playTimeSec);
  return results;
}

module.exports = { getPlayerAnalytics };
