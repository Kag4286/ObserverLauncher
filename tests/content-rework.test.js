// tests/content-rework.test.js — verifies Content Tab Rework (Phase 1 & Phase 2)
const test = require('node:test');
const assert = require('node:assert');

function cleanModTitle(fileName, metaName) {
  if (metaName && typeof metaName === 'string' && metaName.trim() && metaName !== fileName) {
    return metaName.trim();
  }
  let s = String(fileName || '')
    .replace(/\.disabled$/i, '')
    .replace(/\.(jar|zip)$/i, '');
  s = s.replace(/[-_+]\s*(?:forge|fabric|neoforge|quilt|bukkit|spigot|paper)\b/gi, ' ');
  s = s.replace(/\b(?:forge|fabric|neoforge|quilt|bukkit|spigot|paper)\b/gi, ' ');
  s = s.replace(/\+(?:mc)?\d+[\d.\-_+a-z]*/gi, ' ');
  s = s.replace(/[-_+](?:mc)?1\.\d+(\.\d+)?/gi, ' ');
  s = s.replace(/[-_+](?:v|r)?\d+[\d.\-_+a-z]*/gi, ' ');
  s = s.replace(/\b(?:v|r)?\d+[\d.]*\b/gi, ' ');
  s = s.replace(/[-_]+/g, ' ').trim();
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  s = s.replace(/(?:^|\s)[a-z]/g, c => c.toUpperCase());
  s = s.replace(/'S\b/g, "'s");
  return s.trim() || fileName;
}

function glyphProps(name) {
  const clean = String(name || '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  let text = 'M';
  if (words.length >= 2) {
    text = (words[0][0] + words[1][0]).toUpperCase();
  } else if (clean.length > 0) {
    text = clean.slice(0, Math.min(2, clean.length)).toUpperCase();
  }
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash << 5) - hash + clean.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return {
    text,
    bg: `hsl(${hue}, 42%, 18%)`,
    border: `hsl(${hue}, 46%, 28%)`,
    color: `hsl(${hue}, 80%, 75%)`
  };
}

test('cleanModTitle cleans complex jar names into friendly titles', () => {
  assert.strictEqual(cleanModTitle('repurposed_structures_forge-3.4.7+1.16.5.jar'), 'Repurposed Structures');
  assert.strictEqual(cleanModTitle('Quark-r2.4-322.jar'), 'Quark');
  assert.strictEqual(cleanModTitle('relics-1.16.5-0.3.4.4.jar'), 'Relics');
  assert.strictEqual(cleanModTitle('RoadRunner-mc1.16.5-1.5.2.jar.disabled'), 'Road Runner');
  assert.strictEqual(cleanModTitle('SpartanShields-1.16.5-2.1.2.jar'), 'Spartan Shields');
  assert.strictEqual(cleanModTitle('stalwart-dungeons-1.16.5-1.1.7.jar'), 'Stalwart Dungeons');
  assert.strictEqual(cleanModTitle('structure_gel-1.16.5-1.7.8.jar'), 'Structure Gel');
  assert.strictEqual(cleanModTitle('TerraForged-1.16.5-0.2.16.jar'), 'Terra Forged');
  assert.strictEqual(cleanModTitle('Alex\'s Delight 1.1.3 - Forge 1.16.5.jar'), 'Alex\'s Delight');
  assert.strictEqual(cleanModTitle('EssentialsX-2.19.0.jar'), 'Essentials X');
});

test('cleanModTitle honors metaName when available', () => {
  assert.strictEqual(cleanModTitle('custom-1.0.jar', 'Custom Mod Name'), 'Custom Mod Name');
  assert.strictEqual(cleanModTitle('custom-1.0.jar', 'custom-1.0.jar'), 'Custom');
});

test('glyphProps computes initials and deterministic colors', () => {
  const g1 = glyphProps('Repurposed Structures');
  assert.strictEqual(g1.text, 'RS');
  assert.match(g1.bg, /^hsl\(\d+, 42%, 18%\)$/);

  const g2 = glyphProps('Quark');
  assert.strictEqual(g2.text, 'QU');

  const g3 = glyphProps('Quark');
  assert.strictEqual(g1.bg !== g2.bg, true);
  assert.strictEqual(g2.bg, g3.bg); // deterministic
});

test('01-content.js uses $$ for filter chips to avoid querySelector.forEach runtime TypeError', () => {
  const fs = require('fs');
  const code = fs.readFileSync(require('path').join(__dirname, '../src/renderer/js/01-content.js'), 'utf8');
  assert.strictEqual(/\b\$\('#contentFilterChips\b/.test(code), false, 'Found $(\'#contentFilterChips\') instead of $$(\'#contentFilterChips\')');
});

