const assert = require('assert');
const { renderCustomModItem, renderCustomVanillaItem, renderBackpack, renderWaystone, encodePng, decodePngRgba, renderIsometricBlockPng } = require('../src/main/custom-item-renders.js');

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

// 5. Standalone encodePng & decodePngRgba roundtrip
const testRgba = Buffer.alloc(16 * 16 * 4, 0);
for (let i = 0; i < 16 * 16; i++) { testRgba[i * 4] = 10; testRgba[i * 4 + 1] = 200; testRgba[i * 4 + 2] = 50; testRgba[i * 4 + 3] = 255; }
const rawPng = encodePng(16, 16, testRgba);
const rawDim = getDimensions(rawPng);
ck('encodePng produces valid 16x16 PNG', rawDim.w === 16 && rawDim.h === 16);
const decoded = decodePngRgba(rawPng);
ck('decodePngRgba roundtrips RGBA pixels', decoded && decoded.w === 16 && decoded.h === 16 && decoded.rgba[0] === 10 && decoded.rgba[1] === 200 && decoded.rgba[2] === 50 && decoded.rgba[3] === 255);

// 6. Multi-face 64x64 isometric block renderer
function makeSolidPng(r, g, b, a = 255) {
  const buf = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) { buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = a; }
  return encodePng(16, 16, buf);
}
const redTop = makeSolidPng(240, 20, 20);
const greenFront = makeSolidPng(20, 240, 20);
const blueSide = makeSolidPng(20, 20, 240);
const multiIso = renderIsometricBlockPng({ top: redTop, front: greenFront, side: blueSide }, 64);
const multiDim = getDimensions(multiIso);
ck('renderIsometricBlockPng produces 64x64 PNG', multiDim.w === 64 && multiDim.h === 64);
const mDec = decodePngRgba(multiIso);
const pxAt = (x, y) => {
  const idx = (y * mDec.w + x) * 4;
  return [mDec.rgba[idx], mDec.rgba[idx + 1], mDec.rgba[idx + 2], mDec.rgba[idx + 3]];
};
const topPx = pxAt(32, 16);
const leftPx = pxAt(20, 36);
const rightPx = pxAt(44, 36);
const cornerPx = pxAt(0, 0);
ck('multi-face top face uses red texture', topPx[3] === 255 && topPx[0] > 200 && topPx[1] < 30 && topPx[2] < 30);
ck('multi-face left/front face uses green texture', leftPx[3] === 255 && leftPx[1] > 180 && leftPx[0] < 30 && leftPx[2] < 30);
ck('multi-face right/side face uses blue texture', rightPx[3] === 255 && rightPx[2] > 130 && rightPx[0] < 30 && rightPx[1] < 30);
ck('multi-face corners remain transparent', cornerPx[3] === 0 && pxAt(63, 63)[3] === 0);

// 7. Biome tint & overlay compositing (grass_block style)
const grayTop = makeSolidPng(220, 220, 220);
const brownDirt = makeSolidPng(140, 90, 50);
const ovMaskBuf = Buffer.alloc(16 * 16 * 4, 0);
for (let y = 0; y < 5; y++) for (let x = 0; x < 16; x++) {
  const i = (y * 16 + x) * 4;
  ovMaskBuf[i] = 220; ovMaskBuf[i + 1] = 220; ovMaskBuf[i + 2] = 220; ovMaskBuf[i + 3] = 255;
}
const grassIso = decodePngRgba(renderIsometricBlockPng({
  top: grayTop, front: brownDirt, side: brownDirt,
  overlay: encodePng(16, 16, ovMaskBuf),
  tintTop: true, tintOverlay: true,
}, 64));
const gPx = (x, y) => { const i = (y * 64 + x) * 4; return [grassIso.rgba[i], grassIso.rgba[i + 1], grassIso.rgba[i + 2], grassIso.rgba[i + 3]]; };
const gTop = gPx(32, 16), gTopEdge = gPx(20, 25), gDirtLower = gPx(20, 42);
ck('tintTop applies biome foliage green to top face', gTop[1] > gTop[0] + 30 && gTop[1] > gTop[2] + 30);
ck('overlay applies green grass along top lip of side face', gTopEdge[1] > gTopEdge[0] && gTopEdge[1] > gTopEdge[2]);
ck('dirt base below overlay remains untinted brown', gDirtLower[0] > gDirtLower[1] && gDirtLower[1] > gDirtLower[2]);

// 8. Slab & stair geometry shapes
const slabIso = decodePngRgba(renderIsometricBlockPng({ top: redTop, front: greenFront, side: blueSide, shape: 'slab' }, 64));
ck('slab top half peak is transparent', slabIso.rgba[(10 * 64 + 32) * 4 + 3] === 0);
ck('slab lower half renders opaque', slabIso.rgba[(38 * 64 + 32) * 4 + 3] === 255);
const stairIso = decodePngRgba(renderIsometricBlockPng({ top: redTop, front: greenFront, side: blueSide, shape: 'stairs' }, 64));
ck('stairs upper riser renders opaque while front cutout stays transparent', stairIso.rgba[(16 * 64 + 24) * 4 + 3] === 255 && stairIso.rgba[(18 * 64 + 48) * 4 + 3] === 0);

console.log(`\n${pass} passed, 0 failed`);
