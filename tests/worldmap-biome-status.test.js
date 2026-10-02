// 3.2.5 regression: biomeFromChunk() must only read biome data from FULLY generated chunks. An
// early-stage chunk (status 'minecraft:structure_starts' or similar) ships a PLACEHOLDER biome
// palette (minecraft:plains) - reading it made The End render with overworld colours. Found on a
// real End world where 128/400 chunks were still structure_starts.
//
// biomeFromChunk is PURE (takes a parsed NBT object), so this needs no region file on disk.
const assert = require('assert');
const { biomeFromChunk } = require('../src/main/worldmap.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// A minimal parsed-chunk shape: sections[].biomes.palette[0] is the biome. sectionBiome reads
// sec.biomes; the chunk Status gates whether we trust it.
function chunkNbt(status, biome) {
  return { Status: status, sections: [{ Y: 0, biomes: { palette: [biome], data: [] } }] };
}

// --- the fix: a non-full chunk yields NO biome, even though its palette says 'plains' ---
const proto = biomeFromChunk(chunkNbt('minecraft:structure_starts', 'minecraft:plains'));
ok('proto chunk -> biome is null', proto.biome === null);
ok('proto chunk -> does NOT return the placeholder plains', proto.biome !== 'minecraft:plains');
ok('proto chunk -> no biomeGrid', proto.biomeGrid === null);

const biomes = biomeFromChunk(chunkNbt('minecraft:biomes', 'minecraft:plains'));
ok('mid-stage (biomes) chunk -> still null', biomes.biome === null);

// --- a full chunk yields its real biome ---
const full = biomeFromChunk(chunkNbt('minecraft:full', 'minecraft:the_end'));
ok('full chunk -> real biome (the_end)', full.biome === 'minecraft:the_end');
ok('full chunk -> biomeGrid built (single-biome = 16 cells)', Array.isArray(full.biomeGrid) && full.biomeGrid.length === 16 && full.biomeGrid[0] === 'minecraft:the_end');

// --- null / malformed input must not throw ---
ok('null chunk -> all null', (() => { const r = biomeFromChunk(null); return r.biome === null && r.biomeGrid === null && r.relief === null; })());
ok('missing sections full chunk -> null biome', biomeFromChunk({ Status: 'minecraft:full' }).biome === null);

console.log(`\n${passed} passed, 0 failed`);
