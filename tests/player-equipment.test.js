// Regression: 1.21.5+/26.x moved player armor + offhand into a top-level
// `equipment` compound (keyed head/chest/legs/feet/offhand) and switched item
// stacks from `Count` to lowercase `count`. The old reader only looked at the
// legacy Inventory slots (100-103 armor, -106 offhand), so armor came back
// empty and offhand null on modern servers. readPlayerData must read BOTH
// layouts, and must normalize Count/count in every item list.
const fs = require('fs'), os = require('os'), path = require('path');
const nbt = require('prismarine-nbt');
const zlib = require('zlib');
const { readPlayerData } = require('../src/main/server-files.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const UUID = '00eb429a-f1b0-38f5-bc6f-c6a67c34b2a2';
const item = (id, count) => ({ id, count });
const write = (root, body) => {
  const world = path.join(root, 'world');
  fs.mkdirSync(path.join(world, 'players', 'data'), { recursive: true });
  const dat = { type: 'compound', name: '', value: body };
  fs.writeFileSync(path.join(world, 'players', 'data', UUID + '.dat'), zlib.gzipSync(nbt.writeUncompressed(dat)));
};

(async () => {
  // --- Modern format (26.x): equipment compound + lowercase count ---
  const r1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-equip-new-'));
  write(r1, {
    equipment: { type: 'compound', value: {
      head: { type: 'compound', value: { id: { type: 'string', value: 'minecraft:diamond_helmet' }, count: { type: 'int', value: 1 } } },
      chest: { type: 'compound', value: { id: { type: 'string', value: 'minecraft:diamond_chestplate' }, count: { type: 'int', value: 1 } } },
      legs: { type: 'compound', value: { id: { type: 'string', value: 'minecraft:diamond_leggings' }, count: { type: 'int', value: 1 } } },
      feet: { type: 'compound', value: { id: { type: 'string', value: 'minecraft:diamond_boots' }, count: { type: 'int', value: 1 } } },
      offhand: { type: 'compound', value: { id: { type: 'string', value: 'minecraft:torch' }, count: { type: 'int', value: 10 } } },
    } },
    Inventory: { type: 'list', value: { type: 'compound', value: [
      { Slot: { type: 'byte', value: 0 }, id: { type: 'string', value: 'minecraft:dirt' }, count: { type: 'int', value: 64 } },
    ] } },
  });
  const d1 = (await readPlayerData(r1, UUID)).data;
  ck('modern: 4 armor pieces found', d1.armor.length === 4);
  ck('modern: helmet present', d1.armor.some(a => a.slot === 'Helmet' && a.id === 'minecraft:diamond_helmet'));
  ck('modern: boots first in order', d1.armor[0].slot === 'Boots');
  ck('modern: offhand torch x10', d1.offhand && d1.offhand.id === 'minecraft:torch' && d1.offhand.count === 10);
  ck('modern: inventory count not undefined', d1.inventory.length === 1 && d1.inventory[0].count === 64);
  fs.rmSync(r1, { recursive: true, force: true });

  // --- Legacy format (<=1.21.4): armor in Inventory 100-103, offhand -106, Count hoa ---
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-equip-old-'));
  write(r2, {
    Inventory: { type: 'list', value: { type: 'compound', value: [
      { Slot: { type: 'byte', value: 0 }, id: { type: 'string', value: 'minecraft:stone' }, Count: { type: 'byte', value: 12 } },
      { Slot: { type: 'byte', value: 100 }, id: { type: 'string', value: 'minecraft:iron_boots' }, Count: { type: 'byte', value: 1 } },
      { Slot: { type: 'byte', value: 103 }, id: { type: 'string', value: 'minecraft:iron_helmet' }, Count: { type: 'byte', value: 1 } },
      { Slot: { type: 'byte', value: -106 }, id: { type: 'string', value: 'minecraft:shield' }, Count: { type: 'byte', value: 1 } },
    ] } },
  });
  const d2 = (await readPlayerData(r2, UUID)).data;
  ck('legacy: armor from Inventory slots', d2.armor.length === 2 && d2.armor.some(a => a.slot === 'Helmet'));
  ck('legacy: offhand shield found', d2.offhand && d2.offhand.id === 'minecraft:shield');
  ck('legacy: Count normalized in inventory', d2.inventory[0].count === 12);
  ck('legacy: armor excluded from main inventory', !d2.inventory.some(x => x.slot >= 100 || x.slot < 0));
  fs.rmSync(r2, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
