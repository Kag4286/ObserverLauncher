// Regression: World Map tab went blank because 02-worldmap.js captured
// switchTab at load time — but it evaluates BEFORE 08-shell.js defines it,
// so `const orig=switchTab` threw ReferenceError, aborting the script
// (Reload buttons included) and no tab switch ever called wmLoad.
// Also: worldmap backend readers must never throw on missing data.
const assert = require('assert');
const fs = require('fs');
const base = require('path').join(__dirname, '..', 'src', 'renderer', 'js') + require('path').sep;

let passed = 0;
function ok(name, cond) {
  assert(cond, `FAIL: ${name}`);
  console.log(`PASS ${name}`);
  passed++;
}

(async () => {
  // NOTE: strip comments first — 02-worldmap.js documents the old anti-pattern
  // in a NOTE comment, which must not trip this check.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const wm02 = strip(fs.readFileSync(base + '02-worldmap.js', 'utf8'));
  const shell = strip(fs.readFileSync(base + '08-shell.js', 'utf8'));

  // The anti-pattern that caused the blank tab must stay gone…
  ok('02-worldmap does not capture switchTab at load', !/const orig\s*=\s*switchTab/.test(wm02));
  ok('02-worldmap does not overwrite switchTab', !/window\.switchTab\s*=/.test(wm02));
  // …and the lazy-load hook must live in switchTab (single choke point).
  ok('switchTab lazy-loads worldmap', /tab\s*===\s*['"]worldmap['"]/.test(shell) && shell.includes('wmLoad'));
  ok('wmLoad still defined in 02-worldmap', /async function wmLoad\(\)/.test(wm02));
  ok('wmLoad guards IPC failure', wm02.includes('worldmapLoad()') && /catch/.test(wm02));

  // Backend readers: missing world must resolve, never throw.
  const worldmap = require('../src/main/worldmap.js');
  const lvl = await worldmap.readLevel('/no/such/dir/xyz', 'world');
  ok('readLevel missing dir -> ok:false', lvl && lvl.ok === false);
  const pls = await worldmap.readPlayers('/no/such/dir/xyz', 'world');
  ok('readPlayers missing dir -> empty', pls && pls.ok === true && Array.isArray(pls.players) && pls.players.length === 0);
  ok('readWaypoints missing dir -> []', JSON.stringify(worldmap.readWaypoints('/no/such/dir/xyz')) === '[]');
  ok('readWaypoints null root -> []', JSON.stringify(worldmap.readWaypoints(null)) === '[]');
  const chunks = worldmap.scanExploredChunks('/no/such/dir/xyz', 'world', 'overworld');
  ok('scanExploredChunks missing dir -> empty set', chunks instanceof Set && chunks.size === 0);

  // W5 (3.2.5): scanExploredChunks caches by region-file signature. Build a real world dir with one
  // region file holding two populated chunk slots (>FULL_SCAN_BUDGET is not hit here, so it takes
  // the NBT-verify path — a header-only chunk with no readable NBT still counts as "full").
  const os = require('os');
  const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-wm-cache-'));
  // getRegionDirs resolves overworld to <root>/<levelName>/region, so the region dir must be nested.
  const regionDir = path.join(root, 'world', 'region');
  fs.mkdirSync(regionDir, { recursive: true });
  const header = Buffer.alloc(4096);
  header.writeUInt32BE((2 << 8) | 1, 0);   // slot 0 -> chunk (0,0), sector 2
  header.writeUInt32BE((3 << 8) | 1, 4);   // slot 1 -> chunk (1,0), sector 3
  fs.writeFileSync(path.join(regionDir, 'r.0.0.mca'), header);

  const c1 = worldmap.scanExploredChunks(root, 'world', 'overworld');
  ok('W5: first scan finds chunks', c1 instanceof Set && c1.size === 2);
  const c2 = worldmap.scanExploredChunks(root, 'world', 'overworld');
  ok('W5: repeat scan returns the SAME cached Set', c2 === c1);

  // Touch the region file (change mtime) -> the signature changes -> a fresh scan.
  const rp = path.join(regionDir, 'r.0.0.mca');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(rp, future, future);
  const c3 = worldmap.scanExploredChunks(root, 'world', 'overworld');
  ok('W5: mtime change invalidates the cache (new Set)', c3 !== c1 && c3.size === 2);
  fs.rmSync(root, { recursive: true, force: true });

  console.log(`\n${passed} passed, 0 failed`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
