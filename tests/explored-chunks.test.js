// Regression: scanExploredChunks must keep only chunks that finished generating (Status
// 'minecraft:full') when the world is small enough to inspect; proto-chunks (crashed mid-gen)
// have a header slot too and used to be counted as explored.
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const nbt = require('prismarine-nbt');
const { scanExploredChunks } = require('../src/main/worldmap.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// Build a minimal 1-region .mca with the given chunks written as NBT.
function buildRegion(chunks) {
  const SECTOR = 4096;
  const header = Buffer.alloc(SECTOR);       // 1024 offsets
  const timestamps = Buffer.alloc(SECTOR);
  const bodies = [];
  let sector = 2; // first two sectors are the header
  for (const { slot, status } of chunks) {
    const nbtBuf = nbt.writeUncompressed({ type: 'compound', name: '', value: {
      Status: { type: 'string', value: status },
      xPos: { type: 'int', value: 0 }, zPos: { type: 'int', value: 0 },
    } });
    const comp = zlib.deflateSync(nbtBuf);
    const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(comp.length + 1, 0);
    const ctype = Buffer.from([2]); // zlib
    const body = Buffer.concat([lenBuf, ctype, comp]);
    const sectors = Math.ceil(body.length / SECTOR);
    header.writeUInt32BE((sector << 8) | sectors, slot * 4);
    const padded = Buffer.alloc(sectors * SECTOR); body.copy(padded);
    bodies.push({ sector, padded });
    sector += sectors;
  }
  const parts = [header, timestamps];
  for (const b of bodies) parts.push(b.padded);
  return Buffer.concat(parts);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-explore-'));
const regionDir = path.join(root, 'world', 'region');
fs.mkdirSync(regionDir, { recursive: true });
// slot 0 = full, slot 1 = proto. Both in region r.0.0 -> chunk (0,0) and (1,0).
fs.writeFileSync(path.join(regionDir, 'r.0.0.mca'), buildRegion([
  { slot: 0, status: 'minecraft:full' },
  { slot: 1, status: 'minecraft:features' },
]));

const set = scanExploredChunks(root, 'world', 'overworld');
ck('only the finished chunk is counted', set.size === 1);
ck('chunk (0,0) present', set.has('0,0'));
ck('proto-chunk (1,0) excluded', !set.has('1,0'));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
