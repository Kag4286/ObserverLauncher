// Regression: 1.21.5+/26.x moved per-player stats from <world>/stats/ into
// <world>/players/stats/, the same snapshot that moved playerdata into <world>/players/data/.
// getPlayerAnalytics looked only at the old folder, so a modern server returned an empty
// leaderboard even with dozens of players. It must read the new location and still work on old.
const fs = require('fs'), os = require('os'), path = require('path');
const { getPlayerAnalytics } = require('../src/main/player-analytics.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const UUID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const UUID_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const stats = (playTicks, deaths, mobKills, blocksMined) => JSON.stringify({
  stats: { 'minecraft:custom': {
    'minecraft:play_time': playTicks,
    'minecraft:deaths': deaths,
    'minecraft:mob_kills': mobKills,
    'minecraft:blocks_mined': blocksMined,
  } },
});
const known = [
  { uuid: UUID_A, name: 'Alice' },
  { uuid: UUID_B, name: 'Bob' },
];

// --- Modern layout: <world>/players/stats/ ---
const r1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-stats-new-'));
const modern = path.join(r1, 'world', 'players', 'stats');
fs.mkdirSync(modern, { recursive: true });
fs.writeFileSync(path.join(modern, UUID_A + '.json'), stats(20 * 3600, 5, 10, 100));  // 1 hour
fs.writeFileSync(path.join(modern, UUID_B + '.json'), stats(20 * 7200, 12, 30, 400)); // 2 hours
const r1rows = getPlayerAnalytics(r1, 'world', known);
ck('modern: two rows read from players/stats', r1rows.length === 2);
ck('modern: sorted by playtime desc', r1rows[0] && r1rows[0].playTimeSec >= r1rows[1].playTimeSec);
ck('modern: Bob is first', r1rows[0] && r1rows[0].name === 'Bob');
ck('modern: playtime in seconds', r1rows[0] && r1rows[0].playTimeSec === 7200);
ck('modern: deaths parsed', r1rows[0] && r1rows[0].deaths === 12);
ck('modern: mob kills parsed', r1rows[0] && r1rows[0].mobKills === 30);
ck('modern: blocks mined parsed', r1rows[0] && r1rows[0].blocksMined === 400);

// --- Legacy layout: <world>/stats/ (still supported) ---
const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-stats-old-'));
const legacy = path.join(r2, 'world', 'stats');
fs.mkdirSync(legacy, { recursive: true });
fs.writeFileSync(path.join(legacy, UUID_A + '.json'), stats(20 * 60, 1, 2, 3));
const r2rows = getPlayerAnalytics(r2, 'world', known);
ck('legacy: read from stats', r2rows.length === 1);
ck('legacy: name resolved', r2rows[0] && r2rows[0].name === 'Alice');

// --- Neither folder exists -> empty, not a throw ---
const r3 = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-stats-none-'));
let threw = false;
try { ck('no folder: empty array', getPlayerAnalytics(r3, 'world', known).length === 0); }
catch { threw = true; }
ck('no folder: does not throw', !threw);

// --- Modern wins when both exist (a migrated world may briefly have both) ---
const r4 = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-stats-both-'));
fs.mkdirSync(path.join(r4, 'world', 'players', 'stats'), { recursive: true });
fs.mkdirSync(path.join(r4, 'world', 'stats'), { recursive: true });
fs.writeFileSync(path.join(r4, 'world', 'players', 'stats', UUID_A + '.json'), stats(20 * 60, 1, 1, 1));
fs.writeFileSync(path.join(r4, 'world', 'stats', UUID_B + '.json'), stats(20 * 60, 1, 1, 1));
const r4rows = getPlayerAnalytics(r4, 'world', known);
ck('both: only the modern folder is read', r4rows.length === 1);
ck('both: the modern player is the one returned', r4rows[0] && r4rows[0].name === 'Alice');

// --- Custom level-name honoured ---
const r5 = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-stats-level-'));
const custom = path.join(r5, 'myworld', 'players', 'stats');
fs.mkdirSync(custom, { recursive: true });
fs.writeFileSync(path.join(custom, UUID_A + '.json'), stats(20 * 60, 1, 1, 1));
ck('custom level-name: found', getPlayerAnalytics(r5, 'myworld', known).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
