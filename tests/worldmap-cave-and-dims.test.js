const fs = require('fs');
const path = require('path');
const os = require('os');
const { getRegionDirs, surfaceBlocksFromChunk, biomeFromChunk, biomesFromChunkArray } = require('../src/main/worldmap.js');

let pass = 0, fail = 0;
function check(name, cond) {
  cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));
}

// 1. getRegionDirs Paper paths
const tmp = path.join(os.tmpdir(), 'test-paper-dirs-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
try {
  const dirsNether = getRegionDirs(tmp, 'world', 'nether');
  check('nether includes world_nether/DIM-1/region', dirsNether.some(d => d.includes('world_nether') && d.includes('DIM-1')));
  check('nether includes world_nether/region', dirsNether.some(d => d.includes('world_nether') && d.endsWith('region') && !d.includes('DIM-1')));

  const dirsEnd = getRegionDirs(tmp, 'world', 'end');
  check('end includes world_the_end/DIM1/region', dirsEnd.some(d => d.includes('world_the_end') && d.includes('DIM1')));
  check('end includes world_the_end/region', dirsEnd.some(d => d.includes('world_the_end') && d.endsWith('region') && !d.includes('DIM1')));
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

// 2. surfaceBlocksFromChunk with sliceY
const sec0 = {
  Y: 0,
  block_states: {
    palette: [{ Name: 'minecraft:stone' }],
  },
};
const sec1 = {
  Y: 1,
  block_states: {
    palette: [{ Name: 'minecraft:dirt' }],
  },
};
const mockNbt = {
  sections: [sec0, sec1],
};
const motion = new Array(256).fill(30);
const ocean = new Array(256).fill(30);

// Default scan: finds dirt (surface at Y=30)
const defaultRes = surfaceBlocksFromChunk(mockNbt, motion, ocean, 4, null, null);
check('surface without slice returns dirt', defaultRes && defaultRes[0] === 'minecraft:dirt');

// Cave slice scan at Y=10: should slice below dirt and find stone!
const sliceRes = surfaceBlocksFromChunk(mockNbt, motion, ocean, 4, null, 10);
check('cave slice at Y=10 finds underground stone', sliceRes && sliceRes[0] === 'minecraft:stone');

// 3. Cave floor relief and lava detection
const secNeg1 = {
  Y: -1,
  block_states: {
    palette: [{ Name: 'minecraft:lava' }],
  },
};
const secNeg2 = {
  Y: -2,
  block_states: {
    palette: [{ Name: 'minecraft:deepslate' }],
  },
};
const caveMock = {
  Status: 'full',
  yPos: -4,
  sections: [secNeg2, secNeg1, sec0, sec1],
};
const caveMotion = new Array(256).fill(30);
const caveOcean = new Array(256).fill(30);
const reliefObj = { heights: new Array(16).fill(30), water: new Array(16).fill(false) };

const caveRes = surfaceBlocksFromChunk(caveMock, caveMotion, caveOcean, 4, reliefObj, -10);
check('cave slice at Y=-10 finds underground lava lake', caveRes && caveRes[0] === 'minecraft:lava');
check('relief heights updated to cave floor Y', reliefObj.heights[0] === -10);

// 4. 1.18+ 3D cave biome sampling (deep_dark at Y=-40, plains at Y=70)
const secDeepDark = {
  Y: -3,
  biomes: {
    palette: ['minecraft:deep_dark'],
  },
  block_states: { palette: [{ Name: 'minecraft:deepslate' }] },
};
const secSurface = {
  Y: 4,
  biomes: {
    palette: ['minecraft:plains'],
  },
  block_states: { palette: [{ Name: 'minecraft:grass_block' }] },
};
const chunk118 = {
  Status: 'minecraft:full',
  yPos: -4,
  sections: [secDeepDark, secSurface],
  Heightmaps: {
    MOTION_BLOCKING: new Array(36).fill(0n),
  },
};
const resSurface = biomeFromChunk(chunk118, null, null);
check('surface biome defaults to surface elevation', resSurface && resSurface.biome === 'minecraft:plains');

const resCave = biomeFromChunk(chunk118, null, -40);
check('cave slice at Y=-40 retrieves deep_dark 3D cave biome', resCave && resCave.biome === 'minecraft:deep_dark');

// 5. 1.16 3D biomes 1024 array sampling with sliceY
// 1024 ints = 4x4x64. Index = by * 16 + oz * 4 + ox.
// Fill by=0 (Y=0..3) with 1 (plains), by=10 (Y=40..43) with 2 (desert)
const raw1024 = new Int32Array(1024);
for (let i = 0; i < 16; i++) {
  raw1024[0 * 16 + i] = 1; // plains at Y=0
  raw1024[10 * 16 + i] = 2; // desert at Y=40
}
const biome116Surface = biomesFromChunkArray(raw1024, { heights: new Array(16).fill(0) }, null, null);
check('1.16 biomes at surface Y=0 picks plains', biome116Surface && biome116Surface.biome === 'minecraft:plains');

const biome116Cave = biomesFromChunkArray(raw1024, null, null, 40);
check('1.16 biomes sliced at Y=40 picks desert', biome116Cave && biome116Cave.biome === 'minecraft:desert');

// 6. 1.12.2 legacy chunk slicing
const legacySec = {
  Y: 0,
  Blocks: new Uint8Array(4096).fill(1), // stone (ID: 1)
};
const legacyChunk = {
  Level: {
    Status: 'full',
    TerrainPopulated: 1,
    HeightMap: new Int32Array(256).fill(10),
    Sections: [legacySec],
  },
};
const legacyRes = biomeFromChunk(legacyChunk, null, 5);
check('1.12 legacy chunk sliced at Y=5 returns stone surface', legacyRes && legacyRes.surface && legacyRes.surface[0] === 'minecraft:stone');

// 7. Simplified palette object shapes ({ '': 'deepslate' }, { id: 'diamond_ore' })
const secSimplified = {
  Y: -1,
  block_states: {
    palette: [{ '': 'minecraft:deepslate' }],
  },
};
const mockSimpNbt = { sections: [secSimplified] };
const simpRes = surfaceBlocksFromChunk(mockSimpNbt, new Array(256).fill(0), new Array(256).fill(0), 4, null, -10);
check('simplified palette with empty string key returns deepslate', simpRes && simpRes[0] === 'minecraft:deepslate');

const secGlow = {
  Y: -2,
  block_states: {
    palette: [{ id: 'minecraft:diamond_ore' }],
  },
};
const mockGlowNbt = { sections: [secGlow] };
const glowRes = surfaceBlocksFromChunk(mockGlowNbt, new Array(256).fill(0), new Array(256).fill(0), 4, null, -20);
check('simplified palette with id property returns diamond_ore', glowRes && glowRes[0] === 'minecraft:diamond_ore');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
