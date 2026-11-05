const assert = require('assert');
const { renderCustomModItem, renderCustomVanillaItem, renderBackpack, renderWaystone, encodePng } = require('../src/main/custom-item-renders.js');

let pass = 0;
function ck(name, condition) {
  assert(condition, name);
  pass++;
  console.log(`PASS ${name}`);
}

function getDimensions(buf) {
  assert(buf && buf.length >= 24, 'valid png length');
  assert(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, 'png signature');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

// 1. Sophisticated Backpacks procedural generation
const ironBp = renderCustomModItem('sophisticatedbackpacks', 'iron_backpack');
ck('iron_backpack produces non-empty buffer', Buffer.isBuffer(ironBp) && ironBp.length > 50);
const ironDim = getDimensions(ironBp);
ck('iron_backpack is 32x32', ironDim.w === 32 && ironDim.h === 32);

const goldBp = renderCustomModItem('sophisticatedbackpacks', 'gold_backpack');
ck('gold_backpack produces buffer', Buffer.isBuffer(goldBp) && goldBp.length > 50);

const diamondBp = renderCustomModItem('sophisticatedbackpacks', 'diamond_backpack');
ck('diamond_backpack produces buffer', Buffer.isBuffer(diamondBp) && diamondBp.length > 50);

const netheriteBp = renderCustomModItem('sophisticatedbackpacks', 'netherite_backpack');
ck('netherite_backpack produces buffer', Buffer.isBuffer(netheriteBp) && netheriteBp.length > 50);

const copperBp = renderCustomModItem('sophisticatedbackpacks', 'copper_backpack');
ck('copper_backpack produces buffer', Buffer.isBuffer(copperBp) && copperBp.length > 50);

const basicBp = renderCustomModItem('sophisticatedbackpacks', 'backpack');
ck('basic backpack produces buffer', Buffer.isBuffer(basicBp) && basicBp.length > 50);

// 2. Waystones procedural 3D generation
const ws = renderCustomModItem('waystones', 'waystone');
ck('waystone produces non-empty buffer', Buffer.isBuffer(ws) && ws.length > 50);
const wsDim = getDimensions(ws);
ck('waystone is 32x32', wsDim.w === 32 && wsDim.h === 32);

const mossyWs = renderCustomModItem('waystones', 'mossy_waystone');
ck('mossy_waystone produces buffer', Buffer.isBuffer(mossyWs) && mossyWs.length > 50);

const sharestone = renderCustomModItem('waystones', 'sharestone');
ck('sharestone produces buffer', Buffer.isBuffer(sharestone) && sharestone.length > 50);

// 3. Custom Vanilla Item (TNT 3D)
const tntBuf = renderCustomVanillaItem('tnt');
ck('renderCustomVanillaItem("tnt") produces buffer', Buffer.isBuffer(tntBuf) && tntBuf.length > 500);
const tntDim = getDimensions(tntBuf);
ck('TNT 3D icon is 32x32', tntDim.w === 32 && tntDim.h === 32);
ck('renderCustomVanillaItem("diamond") returns null', renderCustomVanillaItem('diamond') === null);

// 4. Negative cases
ck('unsupported mod returns null', renderCustomModItem('unknown_ns', 'item') === null);
ck('non-backpack item in sophisticatedbackpacks returns null', renderCustomModItem('sophisticatedbackpacks', 'upgrade_base') === null);
ck('non-waystone item in waystones returns null', renderCustomModItem('waystones', 'warp_scroll') === null);

// 5. Standalone encodePng
const testRgba = Buffer.alloc(16 * 16 * 4, 0);
const rawPng = encodePng(16, 16, testRgba);
const rawDim = getDimensions(rawPng);
ck('encodePng produces valid 16x16 PNG', rawDim.w === 16 && rawDim.h === 16);

console.log(`\n${pass} passed, 0 failed`);
