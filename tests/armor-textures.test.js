// Regression: the player inspector's 3D model asked for worn-armor textures at
// `models/armor/<mat>_layer_1.png`, which is the PRE-1.21.2 layout. Mojang moved them to
// `entity/equipment/humanoid/<mat>.png` (and humanoid_leggings) in 1.21.2, so every modern
// server 404'd and the model rendered with no armor at all.
//
// newArmorLayout() picks the layout per version; armorCandidates() returns that layout first and
// the other one second, so a jar whose version was misdetected still resolves (one reload later).
// Verified against the live mirror:
//   1.21.4/entity/equipment/humanoid/diamond.png          OK
//   1.21.4/models/armor/diamond_layer_1.png               404
//   1.21.1/models/armor/diamond_layer_1.png               OK
//   1.21.1/entity/equipment/humanoid/diamond.png          404
const Module = require('module');
const os = require('os');
const path = require('path');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return { app: { getPath: () => path.join(os.tmpdir(), 'ob-armor-test-userdata') }, net: {} };
  }
  return origLoad.apply(this, arguments);
};
(async () => {
const textures = require('../src/main/textures.js');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// --- Layout boundary is 1.21.2, compared numerically ---
ck('1.20.1 -> old layout', textures.newArmorLayout('1.20.1') === false);
ck('1.21.1 -> old layout', textures.newArmorLayout('1.21.1') === false);
ck('1.21.2 -> new layout', textures.newArmorLayout('1.21.2') === true);
ck('1.21.4 -> new layout', textures.newArmorLayout('1.21.4') === true);
ck('1.21.10 -> new layout', textures.newArmorLayout('1.21.10') === true);
ck('26.1 -> new layout', textures.newArmorLayout('26.1') === true);
// "1.9.4" must not sort above "1.21.2" as a plain string compare would allow.
ck('1.9.4 -> old layout (string sort trap)', textures.newArmorLayout('1.9.4') === false);
ck('1.8.8 -> old layout (string sort trap)', textures.newArmorLayout('1.8.8') === false);
ck('unknown id assumes new layout', textures.newArmorLayout('custom-build') === true);
ck('empty assumes new layout', textures.newArmorLayout('') === true);

// --- Candidate ordering: this version's own layout first ---
const c = (v, legs) => textures.armorCandidates(v, legs);
ck('1.21.4 layer 1 tries humanoid/ first', c('1.21.4', false)[0][0] === 'entity/equipment/humanoid');
ck('1.21.4 layer 1 has no suffix', c('1.21.4', false)[0][1] === '');
ck('1.21.4 layer 1 falls back to models/armor', c('1.21.4', false)[1][0] === 'models/armor');
ck('1.21.4 layer 1 fallback suffix _layer_1', c('1.21.4', false)[1][1] === '_layer_1');
ck('1.21.4 leggings dir', c('1.21.4', true)[0][0] === 'entity/equipment/humanoid_leggings');
ck('1.21.4 leggings fallback suffix _layer_2', c('1.21.4', true)[1][1] === '_layer_2');
ck('1.20.1 tries models/armor first', c('1.20.1', false)[0][0] === 'models/armor');
ck('1.20.1 first suffix _layer_1', c('1.20.1', false)[0][1] === '_layer_1');
ck('1.20.1 leggings first suffix _layer_2', c('1.20.1', true)[0][1] === '_layer_2');
ck('1.20.1 falls back to humanoid/', c('1.20.1', false)[1][0] === 'entity/equipment/humanoid');
ck('always exactly 2 candidates', c('1.21.4', false).length === 2 && c('1.20.1', true).length === 2);

// --- Mirror version fallback.
// Minecraft 26.3 is the current release, but PrismarineJS had only extracted up to 26.1, so
// data/26.3/items/diamond_sword.png 404s and every icon renders blank. Item textures barely
// change between patches, so fall back to the NEAREST version the mirror actually has. ---
const mv = textures.mirrorVersion;
ck('exact mirror version is kept', mv('26.1') === '26.1');
ck('26.3 falls back to 26.1', mv('26.3') === '26.1');
ck('26.2 falls back to 26.1', mv('26.2') === '26.1');
ck('1.21.12 falls back to 1.21.11', mv('1.21.12') === '1.21.11');
ck('1.21.4 kept exactly', mv('1.21.4') === '1.21.4');
ck('1.21.2 prefers same-line 1.21.1', mv('1.21.2') === '1.21.1');
ck('1.20.1 prefers same-line 1.20.2', mv('1.20.1') === '1.20.2');
ck('unparseable falls back to default', mv('custom-build') === '26.1');
ck('empty falls back to default', mv('') === '26.1');
// The fallback must be a version the mirror ACTUALLY has (verified against the live repo).
ck('fallback target is in the mirror list', textures.MIRROR_VERSIONS.includes(mv('26.3')));
ck('every listed version is 26.x or 1.21.x or 1.20.x',
  textures.MIRROR_VERSIONS.every(v => /^(26|1\.21|1\.20)\./.test(v)));
// A 1.20.x server must NOT be sent to a 26.x texture set: the armor layout differs.
ck('1.20.1 does not fall into the 26.x line', !mv('1.20.1').startsWith('26'));
// Layout must agree with the fallback target, not the requested version.
ck('1.20.1 fallback keeps the OLD armor layout', textures.newArmorLayout(mv('1.20.1')) === false);
ck('1.21.4 fallback keeps the NEW armor layout', textures.newArmorLayout(mv('1.21.4')) === true);
ck('26.3 fallback uses the NEW armor layout', textures.newArmorLayout(mv('26.3')) === true);

// --- The new tex:// kinds are routed, the old ones still work ---
const r = u => textures.handle({ url: u });
ck('armor kind accepted', r('tex://auto/armor/diamond.png').status === 200);
ck('armorlegs kind accepted', r('tex://auto/armorlegs/diamond.png').status === 200);
ck('item kind still accepted', r('tex://auto/item/diamond.png').status === 200);
ck('block kind still accepted', r('tex://auto/block/stone.png').status === 200);
ck('unknown kind still rejected', r('tex://auto/entity/creeper.png').status === 400);
ck('armor bad filename rejected', r('tex://auto/armor/Bad$Name.png').status === 400);
ck('armor traversal rejected', r('tex://auto/armor/..%2F..%2Fx.png').status === 400);

// A miss is a 200 transparent PNG by design (no console spam); the renderer detects the 1x1 and
// falls back to the label. Make sure that contract still holds for the armor kinds.
const miss = r('tex://1.21.4/armor/definitely_not_a_material.png');
ck('armor miss -> 200 placeholder', miss.status === 200);
ck('armor miss -> PNG content type', miss.headers.get('content-type') === 'image/png');

// --- The placeholder MUST be fully transparent.
//     It decoded to a solid blue pixel (RGBA 0,0,255,127), so every icon that had not been
//     fetched yet rendered as a flat blue square — a whole inventory of them in the inspector.
//     Decode the PNG here so a bad constant can never come back unnoticed. ---
{
  const zlib = require('zlib');
  const res = textures.handle({ url: 'tex://26.9/item/definitely_missing.png' });
  const png = Buffer.from(await res.arrayBuffer());
  ck('placeholder is a valid PNG', png.slice(0, 8).toString('hex') === '89504e470d0a1a0a');
  ck('placeholder is 1x1', png.readUInt32BE(16) === 1 && png.readUInt32BE(20) === 1);
  // locate IDAT
  let off = 8, chunks = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    if (png.slice(off + 4, off + 8).toString() === 'IDAT') chunks.push(png.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const [, r, g, b, a] = raw;
  ck(`placeholder alpha is 0 (got ${a})`, a === 0);
  ck(`placeholder RGB is black (${r},${g},${b})`, r === 0 && g === 0 && b === 0);
  ck('placeholder is invisible', a === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();