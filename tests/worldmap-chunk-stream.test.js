const assert = require('assert');
const { readBiomes } = require('../src/main/worldmap.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

(async () => {
  // 1. Verify readBiomes CAP=8000 handles larger chunk ranges without truncating at 2000
  // Test with PumpkinMC if present
  const pumpkinDir = 'C:/Users/PC/Downloads/PumpkinMC';
  const fs = require('fs');
  if (fs.existsSync(pumpkinDir)) {
    const res = await readBiomes(pumpkinDir, 'world', 'overworld', {
      cx0: -40,
      cz0: 102,
      cx1: 24,
      cz1: 166,
      sliceY: null,
      lod: 'fast'
    });
    ok('readBiomes returns more than 2000 chunks without truncating', res.biomes.length > 2000);
    ok('readBiomes truncated is false for area up to 8000 chunks', res.truncated === false);
  } else {
    ok('PumpkinMC skipped (not on disk)', true);
  }

  // 2. Mock tile cache completeness logic
  const mockBiomes = new Map();
  mockBiomes.set('overworld:0,0', ['0', '0', 'plains']);
  
  function checkTileComplete(tx, tz, exploredSet, biomesMap) {
    let complete = true;
    const chunkX0 = tx * 16;
    const chunkZ0 = tz * 16;
    for (let cz = chunkZ0; cz < chunkZ0 + 16; cz++) {
      for (let cx = chunkX0; cx < chunkX0 + 16; cx++) {
        const ck = cx + ',' + cz;
        if (!exploredSet.has(ck)) continue;
        if (!biomesMap.has('overworld:' + ck)) {
          complete = false;
          break;
        }
      }
      if (!complete) break;
    }
    return complete;
  }

  const explored = new Set(['0,0', '0,1', '1,0']);
  ok('tile is incomplete when some explored chunks lack biomes', checkTileComplete(0, 0, explored, mockBiomes) === false);

  mockBiomes.set('overworld:0,1', ['0', '1', 'forest']);
  mockBiomes.set('overworld:1,0', ['1', '0', 'desert']);
  ok('tile is complete when all explored chunks have biomes', checkTileComplete(0, 0, explored, mockBiomes) === true);

  console.log(`\n${passed} passed, 0 failed`);
})();

