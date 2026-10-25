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
  for (const { slot, status, is116, is112, populated } of chunks) {
    let val;
    if (is112) {
      val = {
        Level: {
          type: 'compound',
          value: {
            TerrainPopulated: { type: 'byte', value: populated ? 1 : 0 },
            xPos: { type: 'int', value: slot % 32 },
            zPos: { type: 'int', value: Math.floor(slot / 32) }
          }
        }
      };
    } else if (is116) {
      val = {
        Level: {
          type: 'compound',
          value: {
            Status: { type: 'string', value: status },
            xPos: { type: 'int', value: slot % 32 },
            zPos: { type: 'int', value: Math.floor(slot / 32) }
          }
        }
      };
    } else {
      val = {
        Status: { type: 'string', value: status },
        xPos: { type: 'int', value: 0 }, zPos: { type: 'int', value: 0 },
      };
    }
    const nbtBuf = nbt.writeUncompressed({ type: 'compound', name: '', value: val });
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
// slot 0 = 1.18+ full, slot 1 = 1.18+ proto, slot 2 = 1.16 full, slot 3 = 1.16 proto, slot 4 = 1.12 full, slot 5 = 1.12 unpopulated
fs.writeFileSync(path.join(regionDir, 'r.0.0.mca'), buildRegion([
  { slot: 0, status: 'minecraft:full' },
  { slot: 1, status: 'minecraft:features' },
  { slot: 2, status: 'full', is116: true },
  { slot: 3, status: 'features', is116: true },
  { slot: 4, is112: true, populated: 1 },
  { slot: 5, is112: true, populated: 0 },
]));

const set = scanExploredChunks(root, 'world', 'overworld');
ck('all finished chunks are counted (1.18+, 1.16, 1.12.2)', set.size === 3);
ck('1.18+ chunk (0,0) present', set.has('0,0'));
ck('1.16 chunk (2,0) present', set.has('2,0'));
ck('1.12 chunk (4,0) present', set.has('4,0'));
ck('1.18+ proto-chunk (1,0) excluded', !set.has('1,0'));
ck('1.16 proto-chunk (3,0) excluded', !set.has('3,0'));
ck('1.12 unpopulated chunk (5,0) excluded', !set.has('5,0'));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

