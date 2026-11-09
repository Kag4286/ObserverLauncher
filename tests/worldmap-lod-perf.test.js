const assert = require('assert');
const { biomeFromChunk, readChunkNbtFd } = require('../src/main/worldmap.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

function chunkNbt(status, biome) {
  return {
    Status: status,
    Heightmaps: {
      MOTION_BLOCKING: new Array(36).fill(0n),
      OCEAN_FLOOR: new Array(36).fill(0n)
    },
    sections: [{ Y: 0, biomes: { palette: [biome], data: [] } }]
  };
}

// 1. Full LOD (default) produces relief & biomeGrid
const fullLod = biomeFromChunk(chunkNbt('minecraft:full', 'minecraft:forest'), null, null, false);
ok('full LOD has real biome', fullLod.biome === 'minecraft:forest');
ok('full LOD generates biomeGrid', Array.isArray(fullLod.biomeGrid) && fullLod.biomeGrid.length === 16);
ok('full LOD generates relief', fullLod.relief !== null && Array.isArray(fullLod.relief.heights));

// 2. Fast LOD skips heightmaps, relief and 4x4 sub-grids, saving CPU & RAM
const fastLod = biomeFromChunk(chunkNbt('minecraft:full', 'minecraft:forest'), null, null, true);
ok('fast LOD retains accurate primary biome', fastLod.biome === 'minecraft:forest');
ok('fast LOD skips relief (null)', fastLod.relief === null);
ok('fast LOD skips surface (null)', fastLod.surface === null);
ok('fast LOD skips biomeGrid (null)', fastLod.biomeGrid === null);

// 3. readChunkNbtFd is exported and callable
ok('readChunkNbtFd is a function', typeof readChunkNbtFd === 'function');

console.log(`\n${passed} passed, 0 failed`);

