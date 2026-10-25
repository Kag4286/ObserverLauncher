// worldmap.test.js — update for level-name folder resolution
const fs = require('fs'), os = require('os'), path = require('path');
const nbt = require('prismarine-nbt');
const zlib = require('zlib');
const wm = require('../src/main/worldmap.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-wm-'));
const worldDir = path.join(root, 'My World'); // custom level-name with space
fs.mkdirSync(path.join(worldDir, 'playerdata'), { recursive: true });

const lvl = {
  type: 'compound', name: '',
  value: { Data: { type: 'compound', value: {
    LevelName: { type: 'string', value: 'Test World' },
    WorldGenSettings: { type: 'compound', value: { seed: { type: 'long', value: [123, 456789] } } },
    SpawnX: { type: 'int', value: 128 }, SpawnY: { type: 'int', value: 70 }, SpawnZ: { type: 'int', value: -256 },
    Version: { type: 'compound', value: { Name: { type: 'string', value: '1.21.4' }, Id: { type: 'int', value: 3953 }, Snapshot: { type: 'byte', value: 0 } } },
    DataVersion: { type: 'int', value: 3953 }, hardcore: { type: 'byte', value: 0 },
  } } },
};
fs.writeFileSync(path.join(worldDir, 'level.dat'), zlib.gzipSync(nbt.writeUncompressed(lvl)));

const mkPlayer = (x, y, z, dim) => ({ type: 'compound', name: '', value: {
  Pos: { type: 'list', value: { type: 'double', value: [x, y, z] } },
  Dimension: { type: 'string', value: dim }, playerGameType: { type: 'int', value: 0 },
}});
const uuidA = '069a79f444e94726a5befca90e38aaf5';
fs.writeFileSync(path.join(worldDir, 'playerdata', uuidA + '.dat'), zlib.gzipSync(nbt.writeUncompressed(mkPlayer(10.5, 64, -20.25, 'minecraft:overworld'))));
fs.writeFileSync(path.join(root, 'usercache.json'), JSON.stringify([{ uuid: uuidA, name: 'Notch' }]));

(async () => {
  // with level-name folder resolution
  const L = await wm.readLevel(root, 'My World');
  ck('level found in level-name folder', L.ok && L.levelName === 'Test World');
  ck('seed exact', L.seed === String((BigInt(123) << 32n) | BigInt(456789 & 0xFFFFFFFF)));
  ck('spawn exact', L.spawn.x === 128);
  const P = await wm.readPlayers(root, 'My World');
  ck('player found in level-name playerdata', P.players.length === 1 && P.players[0].name === 'Notch');
  ck('player carries seenAt mtime', typeof P.players[0].seenAt === 'number' && P.players[0].seenAt > 0);
  // root fallback (legacy)
  fs.rmSync(worldDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'playerdata'), { recursive: true });
  fs.writeFileSync(path.join(root, 'level.dat'), zlib.gzipSync(nbt.writeUncompressed(lvl)));
  fs.writeFileSync(path.join(root, 'playerdata', uuidA + '.dat'), zlib.gzipSync(nbt.writeUncompressed(mkPlayer(1, 2, 3, 'minecraft:overworld'))));
  const L2 = await wm.readLevel(root, 'My World'); // folder gone — falls back to root
  ck('root fallback when level-name folder missing', L2.ok && L2.seed === L.seed);
  const P2 = await wm.readPlayers(root, 'My World');
  ck('root playerdata fallback', P2.players.length === 1);
  fs.rmSync(root, { recursive: true, force: true });

  // --- heightmap pure helpers ---
  // pack 9-bit values into big-endian longs ([hi,lo]) the same way Minecraft does.
  const pack9 = (vals) => {
    const longs = [];
    for (let i = 0; i < vals.length; i += 7) {
      let b = 0n;
      for (let j = 0; j < 7 && i + j < vals.length; j++) b |= BigInt(vals[i + j] & 0x1ff) << BigInt(j * 9);
      longs.push([Number((b >> 32n) & 0xffffffffn), Number(b & 0xffffffffn)]);
    }
    return longs;
  };
  const grid = new Array(256); for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) grid[z * 16 + x] = (x + z) & 0x1ff;
  const un = wm.unpackHeightmap(pack9(grid), 9, 256);
  ck('unpackHeightmap length 256', Array.isArray(un) && un.length === 256);
  ck('unpackHeightmap value roundtrip', un && un[0] === 0 && un[255] === ((15 + 15) & 0x1ff));
  ck('unpackHeightmap rejects empty', wm.unpackHeightmap([], 9, 256) === null);

  const ocean = grid.map(v => Math.max(0, v - 1));
  const ds = wm.downsampleHeights(un, ocean, 4);
  ck('downsample 4x4 -> 16 cells', ds && ds.heights.length === 16 && ds.water.length === 16);
  ck('downsample max keeps ridge', ds && ds.heights[15] === un[255]);
  ck('downsample null on missing input', wm.downsampleHeights(null, ocean, 4) === null);
  const allWet = wm.downsampleHeights(grid.map(v => v + 5), grid, 4);
  ck('water majority detected', allWet && allWet.water.every(Boolean));
  const allDry = wm.downsampleHeights(grid, grid.map(v => v + 5), 4);
  ck('no water when ocean >= motion', allDry && allDry.water.every(w => w === false));

  // --- biome grid (1.2.0): 4x4 per-cell biomes ---
  // pack arbitrary-bit values into big-endian longs, matching unpackPalette's layout.
  const packBits = (vals, bits) => {
    const longs = [];
    const per = Math.floor(64 / bits);
    for (let i = 0; i < vals.length; i += per) {
      let b = 0n;
      for (let j = 0; j < per && i + j < vals.length; j++) b |= BigInt(vals[i + j] & ((1 << bits) - 1)) << BigInt(j * bits);
      longs.push([Number((b >> 32n) & 0xffffffffn), Number(b & 0xffffffffn)]);
    }
    return longs;
  };
  const single = wm.biomeGridFromSection({ biomes: { palette: ['minecraft:plains'] } });
  ck('biome grid: single-biome section -> 16 cells', Array.isArray(single) && single.length === 16);
  ck('biome grid: single-biome cells all palette[0]', single && single.every(x => x === 'minecraft:plains'));
  ck('biome grid: rejects missing palette', wm.biomeGridFromSection({}) === null);
  // multi-biome: make column (ox0,oz0) all-ocean, everything else plains. cell = ox + oz*4 + y*16.
  const cells64 = new Array(64).fill(0);
  for (let y = 0; y < 4; y++) cells64[0 + 0 * 4 + y * 16] = 1; // palette index 1 = ocean
  const multi = wm.biomeGridFromSection({ biomes: { palette: ['minecraft:plains', 'minecraft:ocean'], data: packBits(cells64, 1) } });
  ck('biome grid: multi returns 16 cells', multi && multi.length === 16);
  ck('biome grid: ocean column at [0]', multi && multi[0] === 'minecraft:ocean');
  ck('biome grid: plains at [1]', multi && multi[1] === 'minecraft:plains');
  ck('biome grid: plains at [15]', multi && multi[15] === 'minecraft:plains');

  // --- surface block (5.6.0): blockAt + surfaceBlocksFromChunk ---
  // single-block section: no data -> palette[0]. block_states is the snake_case key nbt.simplify
  // produces; the palette entry is an object with a Name after simplify.
  const stoneSec = { block_states: { palette: [{ Name: 'minecraft:stone' }] } };
  ck('blockAt single-block -> palette[0]', wm.blockAt(stoneSec, 0, 0, 0) === 'minecraft:stone');
  ck('blockAt missing palette -> null', wm.blockAt({}, 0, 0, 0) === null);
  ck('blockAt null section -> null', wm.blockAt(null, 0, 0, 0) === null);
  // multi-block: index = y*256 + z*16 + x, 4 bits/entry (min). Fill one cell with sand, rest stone.
  const idx = 0 * 256 + 2 * 16 + 3; // y0, z2, x3 -> idx 35
  const cells = new Array(256).fill(0); cells[idx] = 1;
  const multiSec = { block_states: { palette: [{ Name: 'minecraft:stone' }, { Name: 'minecraft:sand' }], data: packBits(cells, 4) } };
  ck('blockAt multi picks the right cell', wm.blockAt(multiSec, 3, 0, 2) === 'minecraft:sand');
  ck('blockAt multi other cell is stone', wm.blockAt(multiSec, 0, 0, 0) === 'minecraft:stone');
  // surfaceBlocksFromChunk: a chunk whose whole surface column is sand -> every cell sand.
  const motion2 = new Array(256).fill(64), ocean2 = new Array(256).fill(64);
  const flatChunk = { sections: [{ Y: 4, block_states: { palette: [{ Name: 'minecraft:sand' }] } }] };
  const surf = wm.surfaceBlocksFromChunk(flatChunk, motion2, ocean2, 4);
  ck('surface grid length 16', Array.isArray(surf) && surf.length === 16);
  ck('surface grid all sand', surf && surf.every(s => s === 'minecraft:sand'));
  ck('surface grid null without heights', wm.surfaceBlocksFromChunk(flatChunk, null, null, 4) === null);

  // --- listDimensions (1.4.0): modded-dimension detection ---
  const dimRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-wmdim-'));
  const wd = path.join(dimRoot, 'world', 'dimensions');
  fs.mkdirSync(path.join(wd, 'minecraft', 'overworld'), { recursive: true });
  fs.mkdirSync(path.join(wd, 'twilightforest', 'twilight_forest'), { recursive: true });
  fs.mkdirSync(path.join(wd, 'aether', 'the_aether'), { recursive: true });
  const dims = wm.listDimensions(dimRoot, 'world').sort();
  ck('listDimensions finds vanilla overworld', dims.includes('minecraft:overworld'));
  ck('listDimensions finds mod dims', dims.includes('twilightforest:twilight_forest') && dims.includes('aether:the_aether'));
  ck('listDimensions total 3', dims.length === 3);
  ck('listDimensions empty when no dimensions dir', wm.listDimensions(dimRoot, 'nope').length === 0);
  // --- 1.16.5 chunk structure & biomes ---
  // 1. Biomes mapping
  ck('resolveBiome 1 -> plains', wm.resolveBiome(1) === 'minecraft:plains');
  ck('resolveBiome 2 -> desert', wm.resolveBiome(2) === 'minecraft:desert');
  ck('resolveBiome 3 -> mountains', wm.resolveBiome(3) === 'minecraft:mountains');
  ck('resolveBiome string passthrough', wm.resolveBiome('terraforged:bryce') === 'terraforged:bryce');
  ck('resolveBiome modded numeric id', wm.resolveBiome(200) === 'biome_200');

  // 2. 1.16.5 3D Biomes int array (1024 ints)
  const biomes1024 = new Array(1024).fill(1); // all plains
  // set cell ox=0, oz=0 to desert (2) at y=64 (by=16) -> index = 16 * 16 + 0 * 4 + 0 = 256
  biomes1024[16 * 16 + 0 * 4 + 0] = 2;
  const reliefSample = { heights: new Array(16).fill(64), water: new Array(16).fill(false) };
  const bRes = wm.biomesFromChunkArray(biomes1024, reliefSample);
  ck('biomesFromChunkArray 1024 returns grid length 16', bRes && bRes.biomeGrid.length === 16);
  ck('biomesFromChunkArray majority is plains', bRes && bRes.biome === 'minecraft:plains');
  ck('biomesFromChunkArray cell [0] is desert', bRes && bRes.biomeGrid[0] === 'minecraft:desert');
  ck('biomesFromChunkArray cell [1] is plains', bRes && bRes.biomeGrid[1] === 'minecraft:plains');

  // 3. 2D biomes (256 ints)
  const biomes256 = new Array(256).fill(4); // all forest
  biomes256[2 * 16 + 2] = 2; // ox=0, oz=0 center -> desert
  const bRes2 = wm.biomesFromChunkArray(biomes256, reliefSample);
  ck('biomesFromChunkArray 256 returns grid length 16', bRes2 && bRes2.biomeGrid.length === 16);
  ck('biomesFromChunkArray 256 cell [0] is desert', bRes2 && bRes2.biomeGrid[0] === 'minecraft:desert');
  ck('biomesFromChunkArray 256 majority is forest', bRes2 && bRes2.biome === 'minecraft:forest');

  // 4. Full 1.16.5 chunk NBT with Level compound
  const chunk116 = {
    DataVersion: 2586,
    Level: {
      Status: 'full',
      xPos: 0,
      zPos: 0,
      Biomes: biomes1024,
      Heightmaps: {
        MOTION_BLOCKING: pack9(new Array(256).fill(70)),
        OCEAN_FLOOR: pack9(new Array(256).fill(64))
      },
      Sections: [
        {
          Y: 4,
          Palette: [{ Name: 'minecraft:grass_block' }],
          BlockStates: []
        }
      ]
    }
  };
  const parsed116 = wm.biomeFromChunk(chunk116);
  ck('1.16 chunk: parses biome', parsed116.biome === 'minecraft:plains');
  ck('1.16 chunk: parses biomeGrid', Array.isArray(parsed116.biomeGrid) && parsed116.biomeGrid.length === 16);
  ck('1.16 chunk: parses relief heights', parsed116.relief && parsed116.relief.heights.length === 16 && parsed116.relief.heights[0] === 70);
  ck('1.16 chunk: detects water', parsed116.relief && parsed116.relief.water.every(Boolean));
  ck('1.16 chunk: parses surface blocks', parsed116.surface && parsed116.surface[0] === 'minecraft:grass_block');

  // 5. Unpadded heightmap test (36 longs)
  let bitBuf = 0n, inBuf = 0; const longs36 = [];
  for (let i = 0; i < 256; i++) {
    bitBuf |= BigInt(i & 0x1ff) << BigInt(inBuf);
    inBuf += 9;
    while (inBuf >= 64) {
      longs36.push([Number((bitBuf >> 32n) & 0xffffffffn), Number(bitBuf & 0xffffffffn)]);
      bitBuf >>= 64n;
      inBuf -= 64;
    }
  }
  if (inBuf > 0) longs36.push([Number((bitBuf >> 32n) & 0xffffffffn), Number(bitBuf & 0xffffffffn)]);
  const unp = wm.unpackHeightmap(longs36, 9, 256);
  ck('unpackHeightmap unpadded 36 longs decodes 256 entries', unp && unp.length === 256 && unp[255] === 255);

  // 6. Minecraft 1.12.2 legacy chunk (TerrainPopulated: 1, HeightMap int[256], Biomes byte[256], Blocks byte[4096])
  const blocks4096 = new Uint8Array(4096);
  // Fill section with stone (id 1), surface block at y=0 is grass_block (id 2)
  blocks4096.fill(1);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks4096[0 * 256 + z * 16 + x] = 2; // grass
  const biomes112 = new Int8Array(256).fill(1); // plains (signed byte array)
  biomes112[2 * 16 + 2] = -127;
  const chunk112 = {
    Level: {
      TerrainPopulated: 1,
      xPos: 0,
      zPos: 0,
      HeightMap: new Array(256).fill(64),
      Biomes: biomes112,
      Sections: [
        {
          Y: 4,
          Blocks: blocks4096,
          Data: new Uint8Array(2048)
        }
      ]
    }
  };
  const parsed112 = wm.biomeFromChunk(chunk112);
  ck('1.12 chunk: parses biome', parsed112.biome === 'minecraft:plains');
  ck('1.12 chunk: parses negative byte biome (sunflower_plains)', parsed112.biomeGrid[0] === 'minecraft:sunflower_plains');
  ck('1.12 chunk: parses legacy HeightMap int[256]', parsed112.relief && parsed112.relief.heights.length === 16 && parsed112.relief.heights[0] === 64);
  ck('1.12 chunk: parses legacy Blocks byte[4096] (grass_block)', parsed112.surface && parsed112.surface[0] === 'minecraft:grass_block');

  // 7. Minecraft 1.12.2 unpopulated chunk (TerrainPopulated: 0) -> must be rejected as proto-chunk
  const unpop112 = {
    Level: {
      TerrainPopulated: 0,
      HeightMap: new Array(256).fill(64),
      Biomes: biomes112,
    }
  };
  const parsedUnpop = wm.biomeFromChunk(unpop112);
  ck('1.12 unpopulated chunk: returns null', parsedUnpop.biome === null && parsedUnpop.relief === null);

  // 8. Minecraft 1.18+ / 1.21.x negative Y sections (world bottom Y = -64)
  const deepChunk = {
    Status: 'minecraft:full',
    yPos: -4,
    sections: [
      {
        Y: -4, // y = -64..-49
        block_states: { palette: [{ Name: 'minecraft:deepslate' }] },
        biomes: { palette: ['minecraft:deep_dark'], data: [] }
      }
    ],
    Heightmaps: {
      MOTION_BLOCKING: pack9(new Array(256).fill(14)), // 14 + (-64) = -50
      OCEAN_FLOOR: pack9(new Array(256).fill(14))
    }
  };
  const parsedDeep = wm.biomeFromChunk(deepChunk);
  ck('1.18+ negative Y: biome deep_dark at Y=-50', parsedDeep.biome === 'minecraft:deep_dark');
  ck('1.18+ negative Y: relief height is -50', parsedDeep.relief && parsedDeep.relief.heights[0] === -50);
  ck('1.18+ negative Y: surface is deepslate', parsedDeep.surface && parsedDeep.surface[0] === 'minecraft:deepslate');

  // 9. Minecraft 1.12.2: water column over seabed (sand)
  const blocksWater = new Uint8Array(4096);
  // Y=4: y=64..79 in world coordinates.
  // In section Y=4: y=0 (block Y=64) is sand (12), y=1,2 (block Y=65,66) is water (9)
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      blocksWater[0 * 256 + z * 16 + x] = 12; // sand at y=0
      blocksWater[1 * 256 + z * 16 + x] = 9;  // water at y=1
      blocksWater[2 * 256 + z * 16 + x] = 9;  // water at y=2
    }
  }
  const chunkWater112 = {
    Level: {
      TerrainPopulated: 1,
      HeightMap: new Array(256).fill(67), // top of water + 1
      Biomes: new Int8Array(256).fill(0), // ocean
      Sections: [{ Y: 4, Blocks: blocksWater }]
    }
  };
  const parsedWater112 = wm.biomeFromChunk(chunkWater112);
  ck('1.12 water column: finds sand seabed under water', parsedWater112.surface && parsedWater112.surface[0] === 'minecraft:sand');
  ck('1.12 water column: marks relief water true', parsedWater112.relief && parsedWater112.relief.water[0] === true);

  // 10. Minecraft 1.12.2: plant/flower on top of grass block is skipped
  const blocksPlant = new Uint8Array(4096);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      blocksPlant[0 * 256 + z * 16 + x] = 2;  // grass block
      blocksPlant[1 * 256 + z * 16 + x] = 38; // red flower on top
    }
  }
  const chunkPlant112 = {
    Level: {
      TerrainPopulated: 1,
      HeightMap: new Array(256).fill(66), // flower height + 1
      Biomes: new Int8Array(256).fill(1), // plains
      Sections: [{ Y: 4, Blocks: blocksPlant }]
    }
  };
  const parsedPlant112 = wm.biomeFromChunk(chunkPlant112);
  ck('1.12 plant on grass: penetrates flower to grass_block', parsedPlant112.surface && parsedPlant112.surface[0] === 'minecraft:grass_block');

  // 11. Custom world height (10-bit heightmap with 43 longs)
  const longs43 = [];
  let cur = 0n, inL = 0;
  for (let i = 0; i < 256; i++) {
    cur |= BigInt(350) << BigInt(inL * 10);
    inL++;
    if (inL === 6) {
      longs43.push([Number((cur >> 32n) & 0xffffffffn), Number(cur & 0xffffffffn)]);
      cur = 0n;
      inL = 0;
    }
  }
  if (inL > 0) longs43.push([Number((cur >> 32n) & 0xffffffffn), Number(cur & 0xffffffffn)]);
  const unp43 = wm.unpackHeightmap(longs43);
  ck('unpackHeightmap auto-detects 10-bit width for 43 longs', unp43 && unp43.length === 256 && unp43[0] === 350);

  // 12. Forge mod biome resolution via customMap
  const customMap = { 122: 'biomesoplenty:redwood_forest', 76: 'biomesoplenty:alps' };
  ck('resolveBiome maps 122 with customMap', wm.resolveBiome(122, customMap) === 'biomesoplenty:redwood_forest');
  ck('resolveBiome maps 76 with customMap', wm.resolveBiome(76, customMap) === 'biomesoplenty:alps');

  // 13. 1.16 TerraForged chunk with section Y=-1: minY must remain 0 and NOT dig underground
  const tfChunk = {
    Level: {
      Status: 'full',
      Heightmaps: {
        MOTION_BLOCKING: pack9(new Array(256).fill(91)),
        OCEAN_FLOOR: pack9(new Array(256).fill(91))
      },
      Biomes: new Array(1024).fill(122),
      Sections: [
        { Y: -1, Palette: [{ Name: 'minecraft:air' }] },
        { Y: 4, Palette: [{ Name: 'minecraft:diorite' }] }, // y=64..79 underground
        { Y: 5, Palette: [{ Name: 'minecraft:podzol' }] }    // y=80..95 surface
      ]
    }
  };
  const parsedTF = wm.biomeFromChunk(tfChunk, customMap);
  ck('1.16 TerraForged: resolves mod biome name', parsedTF.biome === 'biomesoplenty:redwood_forest');
  ck('1.16 TerraForged with Y=-1 section: height stays 91', parsedTF.relief && parsedTF.relief.heights[0] === 91);
  ck('1.16 TerraForged with Y=-1 section: surface stays podzol (not underground diorite)', parsedTF.surface && parsedTF.surface[0] === 'minecraft:podzol');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
