// tests/v910-mod-armor-26x.test.js — Verification for Instances Rail missing-folder fix,
// Minecraft 1.21.5 -> 26.3 parity, modded armor/item definitions, and Player Inspector 3D safeguards.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const { formatForMc, formatRange, normalizeFormat } = require('../src/main/datapack.js');
const { inspectResourcePack, readPackTexture, clearPackCache } = require('../src/main/resource-pack.js');
const { stackOf, maxDamageFor } = require('../src/main/server-files.js');
const {
  ModsIndex,
  parseEquipmentAssetJson,
  resolveItemDefinitionModels,
  resolveTexturesFromModelJson,
  hasBedrockGeoModel,
} = require('../src/main/mods-index.js');
const { encodePng } = require('../src/main/custom-item-renders.js');
const textures = require('../src/main/textures.js');

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name); }
}

// Minimal STORED ZIP builder for synthetic mod JARs & resource packs
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const lp = Buffer.concat(locals), cp = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cp.length, 12);
  eocd.writeUInt32LE(lp.length, 16);
  return Buffer.concat([lp, cp, eocd]);
}

function solidPng(w, h, r, g, b, a = 255) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  }
  return encodePng(w, h, rgba);
}

// 1. Instances Rail missing-folder CSS/HTML/i18n contract
const shellCss = fs.readFileSync(path.join(__dirname, '../src/renderer/css/02-shell.css'), 'utf8');
const shellJs = fs.readFileSync(path.join(__dirname, '../src/renderer/js/08-shell.js'), 'utf8');
ck('02-shell.css hides .inst-acts on active rest state (no active .inst-act reveal)', !/\.inst-item\.active\s+\.inst-act/.test(shellCss));
ck('02-shell.css positions .inst-acts as right-edge overlay with pointer-events gating', /\.inst-acts\{[^}]*position:absolute[^}]*pointer-events:none/.test(shellCss));
ck('02-shell.css prevents .inst-missing-tag vertical wrapping', /\.inst-missing-tag\{[^}]*white-space:nowrap[^}]*text-overflow:ellipsis/.test(shellCss));
ck('08-shell.js renders span.inst-missing-tag instead of i.inst-missing-tag', shellJs.includes('<span class="inst-missing-tag">') && !shellJs.includes('<i class="inst-missing-tag">'));
ck('08-shell.js renderInstanceDropdown preserves .missing class', /renderInstanceDropdown[\s\S]*const isMissing=!!inst\.missing/.test(shellJs));

// 2. Datapack & Resource Pack 1.21.2 -> 1.21.11 -> 26.3 parity
ck('datapack 1.21.2-1.21.3 format 57', formatForMc('1.21.2') === 57 && formatForMc('1.21.3') === 57);
ck('datapack 1.21.4 format 61', formatForMc('1.21.4') === 61);
ck('datapack 1.21.5 format 71', formatForMc('1.21.5') === 71);
ck('datapack 1.21.6 format 80', formatForMc('1.21.6') === 80);
ck('datapack 1.21.7-1.21.8 format 81', formatForMc('1.21.7') === 81 && formatForMc('1.21.8') === 81);
ck('datapack 1.21.9-1.21.10 format 88', formatForMc('1.21.9') === 88.0 && formatForMc('1.21.10') === 88.0);
ck('datapack 1.21.11 format 94.1', formatForMc('1.21.11') === 94.1 && formatRange(94.1)?.label === '1.21.11');
ck('datapack 26.1 / 26.2 / 26.3 formats', formatForMc('26.1') === 101.1 && formatForMc('26.2') === 107.1 && formatForMc('26.3') === 121.0);
ck('normalizeFormat extracts array major.minor cleanly', normalizeFormat([97, 1]) === 97.1 && normalizeFormat([121, 0]) === 121);

// 3. Server item metadata & Spear durability (1.21.5–26.3)
ck('spear durability matches Java values', maxDamageFor('wooden_spear') === 59 && maxDamageFor('copper_spear') === 190 && maxDamageFor('diamond_spear') === 1561 && maxDamageFor('netherite_spear') === 2031);
const richStack = stackOf({
  id: 'minecraft:leather_chestplate',
  count: 1,
  components: {
    'minecraft:item_name': { text: 'Royal Tunic' },
    'minecraft:equippable': { slot: 'chest', asset_id: 'mymod:royal' },
    'minecraft:item_model': 'mymod:royal_tunic_icon',
    'minecraft:dyed_color': 0x3b82f6,
    'minecraft:trim': { pattern: 'minecraft:ward', material: 'minecraft:diamond' },
  },
});
ck('stackOf reads item_name fallback', richStack.customName === 'Royal Tunic');
ck('stackOf reads equippableAsset', richStack.equippableAsset === 'mymod:royal');
ck('stackOf reads itemModel', richStack.itemModel === 'mymod:royal_tunic_icon');
ck('stackOf reads int dyedColor', richStack.dyedColor === 0x3b82f6);
ck('stackOf reads trim pattern/material', richStack.trim && richStack.trim.pattern === 'minecraft:ward');
const oldDye = stackOf({ id: 'minecraft:leather_helmet', count: 1, components: { 'minecraft:dyed_color': { rgb: 16711680 } } });
ck('stackOf reads {rgb} dyedColor from 1.20.5-1.21.4', oldDye.dyedColor === 16711680);

// 4. Equipment JSON + Item Definition JSON + NeoForge Loader helpers
const eq = parseEquipmentAssetJson(JSON.stringify({
  layers: {
    humanoid: [{ texture: 'mymod:knight' }],
    humanoid_leggings: [{ texture: 'mymod:knight' }],
  },
}), 'mymod');
ck('parseEquipmentAssetJson humanoid path', eq.humanoid[0] === 'assets/mymod/textures/entity/equipment/humanoid/knight.png');
ck('parseEquipmentAssetJson leggings path', eq.humanoid_leggings[0] === 'assets/mymod/textures/entity/equipment/humanoid_leggings/knight.png');

const defComp = resolveItemDefinitionModels(JSON.stringify({
  model: {
    type: 'minecraft:composite',
    models: [
      { type: 'minecraft:model', model: 'mymod:item/staff_base' },
      { type: 'minecraft:model', model: 'mymod:item/staff_gem' },
    ],
  },
}), 'mymod');
ck('resolveItemDefinitionModels handles composite', defComp.isComposite && defComp.modelEntries.length === 2);

const nfSep = resolveTexturesFromModelJson(JSON.stringify({
  loader: 'neoforge:separate_transforms',
  base: { textures: { layer0: 'mymod:item/heavy_greatsword_3d' } },
  perspectives: {
    gui: { parent: 'minecraft:item/generated', textures: { layer0: 'mymod:item/heavy_greatsword_gui' } },
  },
}), 'mymod');
ck('resolveTexturesFromModelJson prioritizes NeoForge gui perspective', nfSep[0] === 'assets/mymod/textures/item/heavy_greatsword_gui.png');

ck('hasBedrockGeoModel matches GeckoLib armor .geo.json', hasBedrockGeoModel(['assets/cataclysm/geo/ignitium_armor.geo.json'], 'cataclysm', 'ignitium'));

// 5. End-to-end JAR + Resource Pack + tex:// handler integration
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-v910-'));
try {
  // Resource pack 26.3 with min_format [97, 1], items JSON & equipment JSON
  const rpPath = path.join(tmp, 'pack263.zip');
  fs.writeFileSync(rpPath, makeZip([
    ['pack.mcmeta', Buffer.from(JSON.stringify({ pack: { description: 'Pack 26.3', min_format: [97, 1], max_format: [97, 1] } }))],
    ['assets/minecraft/items/oak_spear_custom.json', Buffer.from(JSON.stringify({ model: { type: 'minecraft:model', model: 'minecraft:item/spear_art' } }))],
    ['assets/minecraft/models/item/spear_art.json', Buffer.from(JSON.stringify({ textures: { layer0: 'minecraft:item/spear_sprite' } }))],
    ['assets/minecraft/textures/item/spear_sprite.png', solidPng(16, 16, 200, 160, 40)],
    ['assets/minecraft/equipment/copper.json', Buffer.from(JSON.stringify({ layers: { humanoid: [{ texture: 'minecraft:copper_trim' }], humanoid_leggings: [{ texture: 'minecraft:copper_trim' }] } }))],
    ['assets/minecraft/textures/entity/equipment/humanoid/copper_trim.png', solidPng(64, 32, 180, 90, 45)],
  ]));
  const rpInfo = inspectResourcePack(rpPath);
  ck('inspectResourcePack reads min_format [97, 1] as 97.1', rpInfo.ok && rpInfo.packFormat === 97.1);
  ck('readPackTexture resolves 1.21.4-26.3 items JSON', Boolean(readPackTexture(rpPath, 'item', 'oak_spear_custom.png')));
  ck('readPackTexture resolves 1.21.4-26.3 equipment JSON', Boolean(readPackTexture(rpPath, 'armor', 'copper.png')));
  clearPackCache();

  // Synthetic mod JARs testing equipment JSON, token-reversed dragonsteel, composite item non-cube, and GeckoLib geo
  const modsDir = path.join(tmp, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  fs.writeFileSync(path.join(modsDir, 'testmods.jar'), makeZip([
    ['assets/modernmod/equipment/sapphire.json', Buffer.from(JSON.stringify({
      layers: { humanoid: [{ texture: 'modernmod:sapphire_set' }], humanoid_leggings: [{ texture: 'modernmod:sapphire_set' }] },
    }))],
    ['assets/modernmod/textures/entity/equipment/humanoid/sapphire_set.png', solidPng(64, 64, 40, 120, 255)],
    ['assets/modernmod/textures/entity/equipment/humanoid_leggings/sapphire_set.png', solidPng(64, 32, 40, 120, 255)],
    // Token-reversed armor file in subfolder (ice_dragonsteel -> armor_dragonsteel_ice_layer_1.png)
    ['assets/iceandfire/textures/models/armor/dragonsteel/armor_dragonsteel_ice_layer_1.png', solidPng(64, 32, 170, 220, 255)],
    // Composite item must return a 2D sprite (readTexture) and null from readBlockFaces
    ['assets/modernmod/items/rune_orb.json', Buffer.from(JSON.stringify({
      model: { type: 'minecraft:composite', models: [{ type: 'minecraft:model', model: 'modernmod:item/orb_base' }, { type: 'minecraft:model', model: 'modernmod:item/orb_glow' }] },
    }))],
    ['assets/modernmod/models/item/orb_base.json', Buffer.from(JSON.stringify({ textures: { layer0: 'modernmod:item/orb_base' } }))],
    ['assets/modernmod/models/item/orb_glow.json', Buffer.from(JSON.stringify({ textures: { layer0: 'modernmod:item/orb_glow' } }))],
    ['assets/modernmod/textures/item/orb_base.png', solidPng(16, 16, 40, 40, 40)],
    ['assets/modernmod/textures/item/orb_glow.png', solidPng(16, 16, 0, 255, 180, 128)],
    // GeckoLib mod with .geo.json and no flat armor layer png
    ['assets/geckomod/geo/mecha_armor.geo.json', Buffer.from(JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [] }))],
  ]));

  const idx = new ModsIndex();
  idx.setModsDir(modsDir);
  idx.refresh();

  ck('ModsIndex resolves equipment/*.json armor', Boolean(idx.readArmorTexture('modernmod', 'sapphire', 1) && idx.readArmorTexture('modernmod', 'sapphire', 2)));
  ck('ModsIndex resolves subfolder token-reversed armor texture', Boolean(idx.readArmorTexture('iceandfire', 'ice_dragonsteel', 1)));
  ck('ModsIndex composites 1.21.4+ composite item sprite', Boolean(idx.readTexture('modernmod', 'rune_orb')));
  ck('ModsIndex skips cube faces for composite item defs', idx.readBlockFaces('modernmod', 'rune_orb') === null);
  ck('ModsIndex flags missing GeckoLib armor as custom-geo', (() => {
    const info = idx.readArmorTextureInfo('geckomod', 'mecha', 1);
    return info.buffer === null && info.isCustomGeo === true;
  })());

  // textures.handle() header signal for GeckoLib / missing modded armor
  textures.init({ serverNames: () => [], modsDir: () => modsDir });
  const rGeo = textures.handle({ url: 'tex://auto/armormod/geckomod~mecha.png' });
  const rMiss = textures.handle({ url: 'tex://auto/armormod/modernmod~nonexistent.png' });
  const rHit = textures.handle({ url: 'tex://auto/armormod/modernmod~sapphire.png' });
  ck('textures.handle serves X-Observer-Armor-Status: custom-geo for .geo.json armor', rGeo.status === 200 && rGeo.headers.get('x-observer-armor-status') === 'custom-geo');
  ck('textures.handle serves X-Observer-Armor-Status: missing for unresolvable armor', rMiss.status === 200 && rMiss.headers.get('x-observer-armor-status') === 'missing');
  ck('textures.handle serves extracted PNG for modern equipment armor', rHit.status === 200 && !rHit.headers.get('x-observer-armor-status'));
  textures.init({ serverNames: () => [], modsDir: () => null });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 6. Renderer logic checks (03-players.js & 03b-player-3d.js)
const p3dSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/js/03b-player-3d.js'), 'utf8');
const p3dCtx = vm.createContext({ Math, String, Number, Object, Array, RegExp, encodeURIComponent, document: {}, window: {} });
vm.runInContext(p3dSrc + ';globalThis.__p3d = { getArmorMaterial };', p3dCtx);
const { getArmorMaterial } = p3dCtx.__p3d;

ck('getArmorMaterial uses equippableAsset for vanilla/mod sets', getArmorMaterial({ id: 'mymod:custom_hat', equippableAsset: 'minecraft:copper' }) === 'copper');
ck('getArmorMaterial excludes horse/nautilus/wolf armor', getArmorMaterial('diamond_horse_armor') === null && getArmorMaterial('copper_nautilus_armor') === null && getArmorMaterial('wolf_armor') === null);
ck('getArmorMaterial strips mod armor suffix variants (cuirass/greaves/sabatons)', (() => {
  const c = getArmorMaterial('cataclysm:ignitium_cuirass');
  const g = getArmorMaterial('cataclysm:ignitium_greaves');
  return c && c.isMod && c.mat === 'ignitium' && g && g.mat === 'ignitium';
})());

const plySrc = fs.readFileSync(path.join(__dirname, '../src/renderer/js/03-players.js'), 'utf8');
const plyCtx = vm.createContext({
  console, Math, String, Number, Object, Array, Map, RegExp, encodeURIComponent,
  window: { LOCALES: {}, addEventListener: () => {}, observer: { onIconsUpdate: () => {} } },
  $: () => ({ addEventListener: () => {}, classList: { toggle: () => {} } }),
  $$: () => [],
  state: {},
  document: { addEventListener: () => {} },
  navigator: { clipboard: { writeText: () => {} } },
  t: k => k,
  esc: s => s,
});
vm.runInContext(plySrc + ';globalThis.__ply = { isBlockItem, calculateDefensePoints, itemIconUrl };', plyCtx);
const { isBlockItem, calculateDefensePoints, itemIconUrl } = plyCtx.__ply;

ck('isBlockItem excludes 26.x non-cube items (spear/harness/nautilus/cushion/shelf)',
  !isBlockItem('copper_spear') && !isBlockItem('blue_harness') && !isBlockItem('copper_nautilus_armor')
  && !isBlockItem('straw_bed') && !isBlockItem('white_cushion') && !isBlockItem('oak_shelf'));
ck('isBlockItem keeps wood planks & solid blocks', isBlockItem('pale_oak_planks') && isBlockItem('poplar_planks'));
ck('calculateDefensePoints totals Copper Armor (2+4+3+1 = 10)', calculateDefensePoints([
  { id: 'minecraft:copper_helmet' },
  { id: 'minecraft:copper_chestplate' },
  { id: 'minecraft:copper_leggings' },
  { id: 'minecraft:copper_boots' },
]) === 10);
ck('itemIconUrl respects custom itemModel component', itemIconUrl({ id: 'minecraft:stick', itemModel: 'mymod:magic_wand' }) === 'tex://auto/itemmod/mymod~magic_wand.png');

const indexHtml = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
const playersCss = fs.readFileSync(path.join(__dirname, '../src/renderer/css/04-players.css'), 'utf8');
ck('index.html & 04-players.css include pd3dNotice banner', indexHtml.includes('id="pd3dNotice"') && playersCss.includes('.pd-3d-notice'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
