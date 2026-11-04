const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
function ck(name, condition) {
  assert(condition, name);
  pass++;
  console.log(`PASS ${name}`);
}

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '03-players.js'), 'utf8');
const ctx = vm.createContext({
  console,
  Math,
  String,
  Number,
  Object,
  Array,
  Map,
  RegExp,
  window: { LOCALES: {}, addEventListener: () => {}, observer: { onIconsUpdate: () => {} } },
  $: () => ({ addEventListener: () => {}, classList: { toggle: () => {} } }),
  $$: () => [],
  state: {},
  document: { addEventListener: () => {} },
  navigator: { clipboard: { writeText: () => {} } },
  t: (k, params) => k + (params ? JSON.stringify(params) : ''),
  esc: s => s
});

vm.runInContext(src + '\n;globalThis.__iso = { isBlockItem, isoBlockCache, itemCellInner };', ctx);
const { isBlockItem, isoBlockCache, itemCellInner } = ctx.__iso;

// 1. Full cubic blocks should be recognized as block items
ck('recognizes vanilla tnt as block', isBlockItem('minecraft:tnt') === true);
ck('recognizes stone as block', isBlockItem('minecraft:stone') === true);
ck('recognizes cobblestone as block', isBlockItem('minecraft:cobblestone') === true);
ck('recognizes oak_planks as block', isBlockItem('minecraft:oak_planks') === true);
ck('recognizes diamond_block as block', isBlockItem('minecraft:diamond_block') === true);
ck('recognizes deepslate_iron_ore as block', isBlockItem('minecraft:deepslate_iron_ore') === true);
ck('recognizes glowstone as block', isBlockItem('minecraft:glowstone') === true);
ck('recognizes obsidian as block', isBlockItem('minecraft:obsidian') === true);
ck('recognizes white_wool as block', isBlockItem('minecraft:white_wool') === true);
ck('recognizes white_terracotta as block', isBlockItem('minecraft:white_terracotta') === true);
ck('recognizes white_concrete as block', isBlockItem('minecraft:white_concrete') === true);
ck('recognizes stone_bricks as block', isBlockItem('minecraft:stone_bricks') === true);
ck('recognizes oak_log as block', isBlockItem('minecraft:oak_log') === true);
ck('recognizes oak_leaves as block', isBlockItem('minecraft:oak_leaves') === true);
ck('recognizes redstone_block as block', isBlockItem('minecraft:redstone_block') === true);

// 2. Modded cubic blocks
ck('recognizes modded thermal:tin_block', isBlockItem('thermal:tin_block') === true);
ck('recognizes modded create:brass_casing', isBlockItem('create:brass_casing') === true);
ck('recognizes modded ae2:fluix_block', isBlockItem('ae2:fluix_block') === true);

// 3. Items, tools, consumables must NOT be treated as cubic blocks
ck('does NOT treat redstone dust as block', isBlockItem('minecraft:redstone') === false);
ck('does NOT treat glowstone_dust as block', isBlockItem('minecraft:glowstone_dust') === false);
ck('does NOT treat diamond_sword as block', isBlockItem('minecraft:diamond_sword') === false);
ck('does NOT treat apple as block', isBlockItem('minecraft:apple') === false);
ck('does NOT treat arrow as block', isBlockItem('minecraft:arrow') === false);
ck('does NOT treat enchanted_book as block', isBlockItem('minecraft:enchanted_book') === false);
ck('does NOT treat iron_chestplate as block', isBlockItem('minecraft:iron_chestplate') === false);
ck('does NOT treat iron_ingot as block', isBlockItem('minecraft:iron_ingot') === false);
ck('does NOT treat bread as block', isBlockItem('minecraft:bread') === false);

// 4. Flat / non-cubic blocks must stay 2D
ck('does NOT treat oak_sapling as cubic block', isBlockItem('minecraft:oak_sapling') === false);
ck('does NOT treat poppy as cubic block', isBlockItem('minecraft:poppy') === false);
ck('does NOT treat torch as cubic block', isBlockItem('minecraft:torch') === false);
ck('does NOT treat chipped_anvil as cubic block', isBlockItem('minecraft:chipped_anvil') === false);
ck('does NOT treat iron_backpack as cubic block', isBlockItem('sophisticatedbackpacks:iron_backpack') === false);

// 5. itemCellInner produces data-id and utilizes cache
const htmlInitial = itemCellInner('tex://auto/item/tnt.png', 'TNT', 'minecraft:tnt');
ck('itemCellInner includes data-id', htmlInitial.includes('data-id="minecraft:tnt"'));
ck('itemCellInner does not have data-iso before caching', !htmlInitial.includes('data-iso="1"'));

isoBlockCache.set('tex://auto/item/tnt.png', 'data:image/png;base64,isometricTntMock');
const htmlCached = itemCellInner('tex://auto/item/tnt.png', 'TNT', 'minecraft:tnt');
ck('itemCellInner uses cached data URI directly', htmlCached.includes('src="data:image/png;base64,isometricTntMock"'));
ck('itemCellInner marks data-iso="1" when cached', htmlCached.includes('data-iso="1"'));

isoBlockCache.delete('tex://auto/item/tnt.png');

console.log(`\n${pass} passed, 0 failed`);
