// Item stacks used to be flattened to just {id, count}, so the inspector could not show the
// three things an admin actually looks for on a player: how worn a tool is, what is enchanted,
// and what the item was renamed to on an anvil.
//
// 1.20.5 moved item NBT from `tag` into a `components` compound, so BOTH layouts must be read:
//   1.20.5+  components["minecraft:damage"], components["minecraft:enchantments"].levels
//   older    tag.Damage, tag.Enchantments[].{id,lvl}, tag.display.Name
// Vanilla max durability is NOT stored on the item (only the damage is), so it has to be derived
// from the id -- which is what makes an undamaged diamond sword still show a full bar.
const { stackOf, maxDamageFor } = require('../src/main/server-files.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));
const eq = (n, a, b) => ck(`${n} (${JSON.stringify(a)} == ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));

// --- baseline: the original contract still holds ---
eq('id + Count (legacy)', stackOf({ id: 'minecraft:stone', Count: 12 }), { id: 'minecraft:stone', count: 12 });
eq('id + count (modern)', stackOf({ id: 'minecraft:stone', count: 12 }), { id: 'minecraft:stone', count: 12 });
eq('missing count defaults to 1', stackOf({ id: 'minecraft:stone' }), { id: 'minecraft:stone', count: 1 });
eq('no metadata -> no extra keys', Object.keys(stackOf({ id: 'minecraft:stone', count: 1 })), ['id', 'count']);

// --- vanilla max durability, derived from the id ---
ck('diamond sword = 1561', maxDamageFor('minecraft:diamond_sword') === 1561);
ck('netherite pickaxe = 2031', maxDamageFor('minecraft:netherite_pickaxe') === 2031);
ck('iron hoe = 250', maxDamageFor('minecraft:iron_hoe') === 250);
ck('diamond chestplate = 528', maxDamageFor('minecraft:diamond_chestplate') === 528);
ck('leather boots = 65', maxDamageFor('minecraft:leather_boots') === 65);
ck('turtle helmet = 275', maxDamageFor('minecraft:turtle_helmet') === 275);
ck('bow = 384', maxDamageFor('minecraft:bow') === 384);
ck('shield = 336', maxDamageFor('minecraft:shield') === 336);
ck('mace = 500', maxDamageFor('minecraft:mace') === 500);
ck('shears = 238', maxDamageFor('minecraft:shears') === 238);
ck('crossbow = 465', maxDamageFor('minecraft:crossbow') === 465);
ck('non-damageable item -> undefined', maxDamageFor('minecraft:dirt') === undefined);
ck('namespaced id resolves', maxDamageFor('minecraft:diamond_sword') === maxDamageFor('diamond_sword'));
ck('mod item -> undefined (no table)', maxDamageFor('create:wrench') === undefined);

// --- modern components layout ---
const modern = stackOf({
  id: 'minecraft:diamond_sword', count: 1,
  components: {
    'minecraft:damage': 561,
    'minecraft:enchantments': { levels: { 'minecraft:sharpness': 5, 'minecraft:unbreaking': 3 } },
    'minecraft:custom_name': { text: 'Excalibur' },
  },
});
eq('modern durability remaining', modern.durability, { remaining: 1000, max: 1561 });
eq('modern enchantments read', modern.enchantments, [
  { id: 'minecraft:sharpness', level: 5 },
  { id: 'minecraft:unbreaking', level: 3 },
]);
ck('modern custom name (plain text)', modern.customName === 'Excalibur');
ck('modern has no storedEnchantments', !modern.storedEnchantments);

// modern enchantments with the levels map flattened (some writers omit the "levels" wrapper)
eq('flat modern enchantments', stackOf({
  id: 'minecraft:diamond_sword', count: 1,
  components: { 'minecraft:enchantments': { 'minecraft:sharpness': 4 } },
}).enchantments, [{ id: 'minecraft:sharpness', level: 4 }]);

// --- legacy tag layout ---
const legacy = stackOf({
  id: 'minecraft:iron_pickaxe', Count: 1,
  tag: { Damage: 100, Enchantments: [{ id: 'minecraft:efficiency', lvl: 4 }], display: { Name: 'Digger' } },
});
eq('legacy durability remaining', legacy.durability, { remaining: 150, max: 250 });
eq('legacy enchantments read', legacy.enchantments, [{ id: 'minecraft:efficiency', level: 4 }]);
ck('legacy custom name', legacy.customName === 'Digger');
ck('legacy Count normalized', legacy.count === 1);

// --- stored enchantments (enchanted book) ---
const book = stackOf({
  id: 'minecraft:enchanted_book', count: 1,
  components: { 'minecraft:stored_enchantments': { levels: { 'minecraft:mending': 1 } } },
});
eq('stored enchantments', book.storedEnchantments, [{ id: 'minecraft:mending', level: 1 }]);
ck('book has no regular enchantments', !book.enchantments);
ck('book has no durability bar (max_damage unknown)', !book.durability);

// --- explicit max_damage overrides the table ---
eq('explicit max_damage wins', stackOf({
  id: 'minecraft:diamond_sword', count: 1,
  components: { 'minecraft:damage': 100, 'minecraft:max_damage': 2000 },
}).durability, { remaining: 1900, max: 2000 });

// --- edge cases ---
ck('zero damage -> no bar', !stackOf({ id: 'minecraft:diamond_sword', components: { 'minecraft:damage': 0 } }).durability);
ck('damage beyond max clamps to 0', stackOf({
  id: 'minecraft:diamond_sword', components: { 'minecraft:damage': 99999 },
}).durability.remaining === 0);
ck('non-damageable id with damage -> no bar', !stackOf({
  id: 'minecraft:dirt', components: { 'minecraft:damage': 5 },
}).durability);
// A JSON-string text component (some versions serialize it as a string) must still resolve.
ck('stringified text component', stackOf({
  id: 'minecraft:stone', components: { 'minecraft:custom_name': '{"text":"Rock"}' },
}).customName === 'Rock');
// nested extra[] tree
ck('nested extra tree', stackOf({
  id: 'minecraft:stone', components: { 'minecraft:custom_name': { text: 'My ', extra: [{ text: 'Rock' }] } },
}).customName === 'My Rock');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);