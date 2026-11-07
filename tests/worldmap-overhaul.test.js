// tests/worldmap-overhaul.test.js — Unit tests for worldmap overhaul features
const assert = require('assert');
const worldmap = require('../src/main/worldmap.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
    passed++;
  } catch (err) {
    console.error('FAIL ' + name);
    throw err;
  }
}

// 1. Slime chunk math
test('slime chunk algorithm is deterministic and accurate to Java Edition', () => {
  // Test known seed 0n:
  // (cx=0, cz=0): 0 + 0 + 0 + 0 + 0 ^ 987234911 = 987234911
  // state = (987234911 ^ 0x5DEECE66D) & ((1 << 48) - 1) = 0x5deec68e2
  // next state = (0x5deec68e2 * 0x5deece66d + 0xb) & ((1 << 48) - 1) = 0x228807d4b29
  // nextInt(10) = (0x228807d4b29 >> 17) % 10 = 0x114403 % 10 = 1131523 % 10 = 3 !== 0 -> false
  assert.strictEqual(worldmap.isSlimeChunk(0n, 0, 0), false);

  // Check statistical frequency across 10,000 chunks for seed 12345n
  // Expected frequency in Minecraft Java is ~10% (around 950-1050 chunks)
  let count = 0;
  for (let cx = -50; cx < 50; cx++) {
    for (let cz = -50; cz < 50; cz++) {
      if (worldmap.isSlimeChunk(12345n, cx, cz)) count++;
    }
  }
  assert.ok(count >= 900 && count <= 1150, `Slime chunk count ${count} out of 10,000 should be ~10%`);
});

// 2. Coordinate conversions
test('coordinate bridge performs exact 1:8 Nether/Overworld conversion', () => {
  const nether = worldmap.toNetherCoords(800, -1600);
  assert.strictEqual(nether.x, 100);
  assert.strictEqual(nether.z, -200);

  const overworld = worldmap.toOverworldCoords(nether.x, nether.z);
  assert.strictEqual(overworld.x, 800);
  assert.strictEqual(overworld.z, -1600);

  // Negative floor division
  const negNether = worldmap.toNetherCoords(-5, -15);
  assert.strictEqual(negNether.x, -1);
  assert.strictEqual(negNether.z, -2);
});

// 3. Structure starts extraction
test('extractStructureStarts extracts valid structures and ignores INVALID', () => {
  const mockNbt = {
    structures: {
      starts: {
        'minecraft:village': {
          id: 'minecraft:village',
          bb: [100, 64, 200, 150, 80, 250]
        },
        'minecraft:pillager_outpost': {
          id: 'minecraft:pillager_outpost',
          ChunkX: 10,
          ChunkZ: 20
        },
        'minecraft:monument': {
          id: 'INVALID'
        }
      }
    }
  };

  const structs = worldmap.extractStructureStarts(mockNbt, 5, 10);
  assert.strictEqual(structs.length, 2);
  const village = structs.find(s => s.id === 'village');
  assert.ok(village);
  assert.strictEqual(village.x, 125); // (100 + 150) / 2
  assert.strictEqual(village.z, 225); // (200 + 250) / 2

  const outpost = structs.find(s => s.id === 'pillager_outpost');
  assert.ok(outpost);
  assert.strictEqual(outpost.x, 168); // 10 * 16 + 8
  assert.strictEqual(outpost.z, 328); // 20 * 16 + 8
});

// 4. Cheat mode default setting
test('worldmapCheatMode defaults to false (fair survival mode)', () => {
  const { defaultGlobal } = require('../src/main/settings.js');
  const s = defaultGlobal();
  assert.strictEqual(s.worldmapCheatMode, false);
});

console.log(`\n${passed} worldmap overhaul unit tests passed.`);

