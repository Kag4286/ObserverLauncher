// tests/item-alias.test.js — items that have no texture file of their own on the mirror.
const assert = require('assert');
const { itemAliasOf } = require('../src/main/textures.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
}

// The mirror 404s enchanted_golden_apple.png; the game draws it from golden_apple.png + a glint.
t('enchanted_golden_apple maps to golden_apple', () => {
  assert.strictEqual(itemAliasOf('enchanted_golden_apple.png'), 'golden_apple.png');
});

t('enchanted_book maps to book', () => {
  assert.strictEqual(itemAliasOf('enchanted_book.png'), 'book.png');
});

t('a normal item has no alias', () => {
  assert.strictEqual(itemAliasOf('diamond_sword.png'), null);
  assert.strictEqual(itemAliasOf('golden_apple.png'), null);
});

t('missing/empty input is safe', () => {
  assert.strictEqual(itemAliasOf(''), null);
  assert.strictEqual(itemAliasOf(null), null);
  assert.strictEqual(itemAliasOf(undefined), null);
});

t('the alias never chains (target is not itself aliased)', () => {
  const target = itemAliasOf('enchanted_golden_apple.png');
  assert.strictEqual(itemAliasOf(target), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
