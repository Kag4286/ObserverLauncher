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

  // --- 1.12.2- format: numeric item IDs, tag.ench with numeric ID, numeric Dimension ---
  const r3 = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-equip-112-'));
  write(r3, {
    Dimension: { type: 'int', value: 0 },
    Inventory: { type: 'list', value: { type: 'compound', value: [
      {
        Slot: { type: 'byte', value: 0 },
        id: { type: 'short', value: 276 }, // diamond_sword
        Count: { type: 'byte', value: 1 },
        tag: { type: 'compound', value: {
          Damage: { type: 'short', value: 50 },
          ench: { type: 'list', value: { type: 'compound', value: [
            { id: { type: 'short', value: 16 }, lvl: { type: 'short', value: 5 } }, // Sharpness V
            { id: { type: 'short', value: 34 }, lvl: { type: 'short', value: 3 } }, // Unbreaking III
          ] } },
        } },
      },
      {
        Slot: { type: 'byte', value: 103 },
        id: { type: 'short', value: 310 }, // diamond_helmet
        Count: { type: 'byte', value: 1 },
        tag: { type: 'compound', value: {
          ench: { type: 'list', value: { type: 'compound', value: [
            { id: { type: 'short', value: 0 }, lvl: { type: 'short', value: 4 } }, // Protection IV
          ] } },
        } },
      },
    ] } },
  });
  const d3 = (await readPlayerData(r3, UUID)).data;
  ck('1.12.2: numeric dimension 0 mapped to overworld', d3.dimension === 'minecraft:overworld');
  ck('1.12.2: numeric id 276 resolved to diamond_sword', d3.inventory[0].id === 'minecraft:diamond_sword');
  ck('1.12.2: tag.ench numeric 16 mapped to minecraft:sharpness', d3.inventory[0].enchantments.some(e => e.id === 'minecraft:sharpness' && e.level === 5));
  ck('1.12.2: tag.ench numeric 34 mapped to minecraft:unbreaking', d3.inventory[0].enchantments.some(e => e.id === 'minecraft:unbreaking' && e.level === 3));
  ck('1.12.2: durability calculated from Damage and inferred maxDamage', d3.inventory[0].durability && d3.inventory[0].durability.remaining === 1561 - 50);
  ck('1.12.2: helmet has Protection IV', d3.armor.some(a => a.slot === 'Helmet' && a.enchantments.some(e => e.id === 'minecraft:protection' && e.level === 4)));
  fs.rmSync(r3, { recursive: true, force: true });

  // --- 1.20.5+ / 1.21.11- format: components['minecraft:enchantments'] ---
  const r4 = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-equip-modern-ench-'));
  write(r4, {
    Dimension: { type: 'string', value: 'minecraft:the_nether' },
    Inventory: { type: 'list', value: { type: 'compound', value: [
      {
        Slot: { type: 'byte', value: 0 },
        id: { type: 'string', value: 'minecraft:netherite_sword' },
        count: { type: 'int', value: 1 },
        components: { type: 'compound', value: {
          'minecraft:damage': { type: 'int', value: 100 },
          'minecraft:max_damage': { type: 'int', value: 2031 },
          'minecraft:enchantments': { type: 'compound', value: {
            levels: { type: 'compound', value: {
              'minecraft:sharpness': { type: 'int', value: 5 },
              'minecraft:mending': { type: 'int', value: 1 },
            } },
          } },
        } },
      },
    ] } },
  });
  const d4 = (await readPlayerData(r4, UUID)).data;
  ck('1.20.5+: nether dimension preserved', d4.dimension === 'minecraft:the_nether');
  ck('1.20.5+: modern components sharpness V', d4.inventory[0].enchantments.some(e => e.id === 'minecraft:sharpness' && e.level === 5));
  ck('1.20.5+: modern components mending I', d4.inventory[0].enchantments.some(e => e.id === 'minecraft:mending' && e.level === 1));
  ck('1.20.5+: modern components durability remaining', d4.inventory[0].durability && d4.inventory[0].durability.remaining === 1931);
  fs.rmSync(r4, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
