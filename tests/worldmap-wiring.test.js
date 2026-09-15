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

  console.log(`\n${passed} passed, 0 failed`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
