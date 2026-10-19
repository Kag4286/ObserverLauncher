// The player inspector's 3D model did not look like a Minecraft player: the head was sunk into
// the torso and the torso overlapped the legs, so the body read as one melted blob instead of a
// humanoid. Cause: every part was placed at a made-up Y with no relation to the vanilla model.
//
// These assertions pin the layout to the real Minecraft proportions (32 model units tall, 1
// block = 16 units):
//     legs y 0..12    body y 12..24    arms y 12..24    head y 24..32
// and, more importantly, require that no two parts INTERPENETRATE -- the actual symptom.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

// The renderer is a classic (non-module) script, so evaluate it in a bare context and pull the
// layout constants back out. createPlayerRenderer is never called -- no WebGL needed.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '03b-player-3d.js'), 'utf8');
const ctx = vm.createContext({ console, Math, Float32Array, Image: function () {} });
vm.runInContext(src + '\n;globalThis.__layout = { PLAYER_PARTS, MODEL_HEIGHT, HIP_Y, SHOULDER_Y, ARM_X, LEG_X, TORSO_HALF_W, UV, uvc, buildCube };', ctx);
const { PLAYER_PARTS, MODEL_HEIGHT, HIP_Y, SHOULDER_Y, ARM_X, LEG_X, TORSO_HALF_W, UV, uvc, buildCube } = ctx.__layout;

const box = name => {
  const [x, y, w, h, d] = PLAYER_PARTS[name];
  return { name, x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2, z0: -d / 2, z1: d / 2 };
};
const interpenetration = (a, b) => {
  const A = box(a), B = box(b);
  const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
  const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
  const oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
  return (ox > 1e-9 && oy > 1e-9 && oz > 1e-9) ? { ox, oy, oz } : null;
};

// --- 1. Every part exists and is a plausible box ---
for (const n of ['head', 'body', 'armR', 'armL', 'legR', 'legL']) {
  const p = PLAYER_PARTS[n];
  ck(`${n} defined`, Array.isArray(p) && p.length === 5);
  ck(`${n} has positive volume`, p && p[2] > 0 && p[3] > 0 && p[4] > 0);
}

// --- 2. Vertical extents match vanilla exactly ---
const ext = n => { const b = box(n); return [b.y0, b.y1]; };
const eq = (n, got, want) => ck(`${n} spans y ${got[0]}..${got[1]} (want ${want[0]}..${want[1]})`, got[0] === want[0] && got[1] === want[1]);
eq('legs', ext('legR'), [0, HIP_Y]);
eq('body', ext('body'), [HIP_Y, SHOULDER_Y]);
eq('arms', ext('armR'), [HIP_Y, SHOULDER_Y]);
eq('head', ext('head'), [SHOULDER_Y, MODEL_HEIGHT]);

// --- 3. THE REGRESSION: no two parts may interpenetrate ---
const names = ['head', 'body', 'armR', 'armL', 'legR', 'legL'];
let clashes = 0;
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const v = interpenetration(names[i], names[j]);
    if (v) { clashes++; console.log('     ', names[i], '/', names[j], JSON.stringify(v)); }
  }
}
ck('no body parts interpenetrate', clashes === 0);

// --- 4. Parts that must touch, touch exactly (no gap, no overlap) ---
ck('head sits on the shoulders (y=24 seam)', box('head').y0 === box('body').y1);
ck('body sits on the hips (y=12 seam)', box('body').y0 === box('legR').y1);
ck('arms touch the torso edge (x=4 seam)', box('armR').x1 === -TORSO_HALF_W || box('armR').x0 === TORSO_HALF_W);
ck('legs touch each other (x=0 seam)', box('legR').x1 === box('legL').x0);

// --- 5. Overall silhouette ---
const minY = Math.min(...names.map(n => box(n).y0));
const maxY = Math.max(...names.map(n => box(n).y1));
ck(`feet on the ground (minY=${minY})`, minY === 0);
ck(`crown at 32 (maxY=${maxY})`, maxY === MODEL_HEIGHT);
const halfW = Math.max(...names.map(n => Math.max(Math.abs(box(n).x0), Math.abs(box(n).x1))));
ck(`arms define the 8-unit half-width (${halfW})`, halfW === 8);
ck('arms are 4 wide (classic Steve)', PLAYER_PARTS.armR[2] === 4);

// --- 6. The torso is 4 DEEP, not 8. Depth 8 made it swallow the arms and head. ---
ck('body depth is 4 (not a cube)', PLAYER_PARTS.body[4] === 4);
ck('head depth is 8', PLAYER_PARTS.head[4] === 8);

// --- 7. Left/right are mirrored ---
ck('arms mirror in X', PLAYER_PARTS.armL[0] === -PLAYER_PARTS.armR[0]);
ck('legs mirror in X', PLAYER_PARTS.legL[0] === -PLAYER_PARTS.legR[0]);
ck('ARM_X is 6', ARM_X === 6);
ck('LEG_X is 2', LEG_X === 2);

// --- 8. Worn-armor textures are 64x32, so they must NOT use the left-arm/left-leg UV regions.
//        Those live at y=48..64, outside a 64x32 texture; CLAMP_TO_EDGE smeared the border
//        texel across the whole left piece, which is what made the left armor look wrong. ---
ck('leftArm UVs are out of range for a 64x32 armor texture', UV.leftArm.front[1] >= 32);
ck('leftLeg UVs are out of range for a 64x32 armor texture', UV.leftLeg.front[1] >= 32);
ck('rightArm UVs are in range', UV.rightArm.front[1] < 32);
ck('rightLeg UVs are in range', UV.rightLeg.front[1] < 32);

// --- 9. FACE ORIENTATION (the "sides mirrored vs the face" bug).
// buildCube puts east at +X and west at -X. The model faces +Z, toward the camera, so the
// viewer's right (+X) is the CHARACTER's LEFT. Skin regions are named from the character's
// perspective, so +X must sample the LEFT region and -X the RIGHT region. Reversing this put
// the character's right ear on the viewer's right. ---
const headUV = uvc(UV.head, 64, 64);
ck('east face samples the skin LEFT region', headUV.east[0][0] === UV.head.left[0] / 64);
ck('west face samples the skin RIGHT region', headUV.west[0][0] === UV.head.right[0] / 64);
ck('front face still samples the skin FRONT region', headUV.front[0][0] === UV.head.front[0] / 64);
ck('east is genuinely a different region than west', headUV.east[0][0] !== headUV.west[0][0]);
// The old bug returned keys named right/left; make sure nothing silently keeps that shape,
// because a caller reading faces.right would now be undefined.
ck('uvc no longer exposes a swapped "right" key', headUV.right === undefined);
ck('uvc exposes east/west', headUV.east !== undefined && headUV.west !== undefined);
// Same rule must hold for every part, not just the head.
for (const [part, uv] of [['body', UV.body], ['arm', UV.rightArm], ['leg', UV.rightLeg], ['hat', UV.hat], ['jacket', UV.jacket]]) {
  const f = uvc(uv, 64, 64);
  ck(`${part}: east<-left, west<-right`, f.east[0][0] === uv.left[0] / 64 && f.west[0][0] === uv.right[0] / 64);
}

// --- 10. Armor cubes are built against a 32-row grid.
// A worn-armor texture is 64x32: the head occupies rows 0..15 and the body/arms/legs rows
// 16..31. Computing v against 64 samples the wrong half -- the torso ended up wearing the
// helmet's pixels. ---
const armorHead = uvc(UV.head, 64, 32);
const skinHead = uvc(UV.head, 64, 64);
ck('armor head v differs from skin head v', armorHead.front[0][1] !== skinHead.front[0][1]);
// u is unaffected by the vertical extent
ck('armor head u unchanged by texH', armorHead.front[0][0] === skinHead.front[0][0]);
// With texH=32 the head rows (0..16) must map into the UPPER half of the v range (0.5..1).
ck('armor head stays in upper v half', armorHead.front[0][1] >= 0.5 && armorHead.front[0][1] <= 1);
// With texH=64 (a skin) the same box sits in v 0.75..0.875 -- i.e. the two must NOT agree,
// which is exactly the mismatch that put head pixels on the chest.
const armorBody = uvc(UV.body, 64, 32);
ck('armor body samples rows 16..32 -> lower v half', armorBody.front[0][1] >= 0 && armorBody.front[0][1] <= 0.5);

// --- 11. buildCube actually wires +X to faces.east and -X to faces.west ---
{
  const probe = {
    top: [[0, 0], [0, 0], [0, 0], [0, 0]], bottom: [[0, 0], [0, 0], [0, 0], [0, 0]],
    front: [[1, 1], [1, 1], [1, 1], [1, 1]], back: [[2, 2], [2, 2], [2, 2], [2, 2]],
    east: [[3, 3], [3, 3], [3, 3], [3, 3]], west: [[4, 4], [4, 4], [4, 4], [4, 4]],
  };
  const cube = buildCube(2, 2, 2, probe);
  // Each face is 2 triangles = 6 vertices = 18 floats, and 12 texcoords.
  // Faces are emitted in a fixed order: front, back, top, bottom, east, west.
  const firstU = [];
  for (let f = 0; f < 6; f++) firstU.push(cube.t[f * 12]);
  ck('buildCube face order front,back,top,bottom,east,west',
    firstU[0] === 1 && firstU[1] === 2 && firstU[4] === 3 && firstU[5] === 4);
  // Every vertex of the east face (5th face -> vertices 24..29) must be at +X.
  const pos = cube.p;
  const xOf = v => pos[v * 3];
  const eastVerts = [24, 25, 26, 27, 28, 29];
  const westVerts = [30, 31, 32, 33, 34, 35];
  ck('east face vertices all sit at +X', eastVerts.every(v => xOf(v) > 0));
  ck('west face vertices all sit at -X', westVerts.every(v => xOf(v) < 0));
  // And the front face must be at +Z (facing the camera).
  const zOf = v => pos[v * 3 + 2];
  ck('front face vertices all sit at +Z', [0, 1, 2, 3, 4, 5].every(v => zOf(v) > 0));
  ck('back face vertices all sit at -Z', [6, 7, 8, 9, 10, 11].every(v => zOf(v) < 0));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);