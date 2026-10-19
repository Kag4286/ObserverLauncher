// 03b-player-3d.js — Render a Minecraft player model from a 64x64 skin texture (v6.0.0 Track B1).
//
// Uses raw WebGL (no Three.js). Defines the 6 body parts (head, body, arms, legs) plus their
// outer layers (jacket, sleeves, pants, hat). UV mapping matches the standard Mojang layout.
// Supports classic (4px arm) and slim (3px arm) models.

// Model layout, in Minecraft "model units" (1 block = 16 units). The vanilla player is 32 units
// tall: feet at y=0, the leg/body seam at 12, the shoulder line at 24, the crown at 32.
//   legs y 0..12   body y 12..24   arms y 12..24 (they hang from the shoulder)   head y 24..32
// The torso is 8 wide x 4 DEEP, not a cube -- using depth 8 made the body swallow the arms.
// `out` is the outer-layer cube drawn just outside the base one (+0.25 units of inflation), which
// is what the jacket / sleeves / pants / hat map to.
//
// This lives at module scope (not inside createPlayerRenderer) so the geometry can be asserted by
// tests/player-model-geometry.test.js without a WebGL context.
const MODEL_HEIGHT = 32;
const SHOULDER_Y = 24;                 // top of the torso, bottom of the head
const HIP_Y = 12;                      // top of the legs, bottom of the torso
const TORSO_HALF_W = 4;                // 8-wide torso -> x = -4..4
const LEG_X = 2;                       // two 4-wide legs -> centres at +-2
const ARM_X = TORSO_HALF_W + 2;        // shoulder edge + half a 4-wide arm
// part -> [centreX, centreY, width, height, depth]
const PLAYER_PARTS = {
  body:  [0, HIP_Y + 6, 8, 12, 4],
  head:  [0, SHOULDER_Y + 4, 8, 8, 8],
  armR:  [-ARM_X, HIP_Y + 6, 4, 12, 4],
  armL:  [ARM_X, HIP_Y + 6, 4, 12, 4],
  legR:  [-LEG_X, HIP_Y / 2, 4, 12, 4],
  legL:  [LEG_X, HIP_Y / 2, 4, 12, 4],
};
const partPos = name => { const p = PLAYER_PARTS[name]; return { x: p[0], y: p[1] }; };

const PLAYER_VS = `
  attribute vec3 aPos;
  attribute vec2 aTex;
  uniform mat4 uMvp;
  varying vec2 vTex;
  void main() {
    gl_Position = uMvp * vec4(aPos, 1.0);
    vTex = aTex;
  }
`;

const PLAYER_FS = `
  precision mediump float;
  varying vec2 vTex;
  uniform sampler2D uSampler;
  void main() {
    vec4 color = texture2D(uSampler, vTex);
    if (color.a < 0.1) discard; // Transparency for outer layers
    gl_FragColor = color;
  }
`;

function mat4Identity() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
function mat4Multiply(a, b) {
  const o = new Float32Array(16);
  for (let i=0; i<4; i++) for (let j=0; j<4; j++)
    o[i*4+j] = a[0*4+j]*b[i*4+0] + a[1*4+j]*b[i*4+1] + a[2*4+j]*b[i*4+2] + a[3*4+j]*b[i*4+3];
  return o;
}
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}
function mat4Translate(x, y, z) {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);
}
function mat4RotateX(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
}
function mat4RotateY(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
}

// UV standard bounds (x, y, w, h) in 64x64 skin space.
const UV = {
  head:    { top:[8,0,8,8], bottom:[16,0,8,8], right:[0,8,8,8], front:[8,8,8,8], left:[16,8,8,8], back:[24,8,8,8] },
  hat:     { top:[40,0,8,8], bottom:[48,0,8,8], right:[32,8,8,8], front:[40,8,8,8], left:[48,8,8,8], back:[56,8,8,8] },
  body:    { top:[20,16,8,4], bottom:[28,16,8,4], right:[16,20,4,12], front:[20,20,8,12], left:[28,20,4,12], back:[32,20,8,12] },
  jacket:  { top:[20,32,8,4], bottom:[28,32,8,4], right:[16,36,4,12], front:[20,36,8,12], left:[28,36,4,12], back:[32,36,8,12] },
  rightArm:{ top:[44,16,4,4], bottom:[48,16,4,4], right:[40,20,4,12], front:[44,20,4,12], left:[48,20,4,12], back:[52,20,4,12] },
  rightSleeve:{ top:[44,32,4,4], bottom:[48,32,4,4], right:[40,36,4,12], front:[44,36,4,12], left:[48,36,4,12], back:[52,36,4,12] },
  leftArm:{ top:[36,48,4,4], bottom:[40,48,4,4], right:[32,52,4,12], front:[36,52,4,12], left:[40,52,4,12], back:[44,52,4,12] },
  leftSleeve:{ top:[52,48,4,4], bottom:[56,48,4,4], right:[48,52,4,12], front:[52,52,4,12], left:[56,52,4,12], back:[60,52,4,12] },
  rightLeg:{ top:[4,16,4,4], bottom:[8,16,4,4], right:[0,20,4,12], front:[4,20,4,12], left:[8,20,4,12], back:[12,20,4,12] },
  rightPants:{ top:[4,32,4,4], bottom:[8,32,4,4], right:[0,36,4,12], front:[4,36,4,12], left:[8,36,4,12], back:[12,36,4,12] },
  leftLeg:{ top:[20,48,4,4], bottom:[24,48,4,4], right:[16,52,4,12], front:[20,52,4,12], left:[24,52,4,12], back:[28,52,4,12] },
  leftPants:{ top:[4,48,4,4], bottom:[8,48,4,4], right:[0,52,4,12], front:[4,52,4,12], left:[8,52,4,12], back:[12,52,4,12] },
};

// Slim arms are 3px wide (and X offset is different).
UV.rightArmSlim = { top:[44,16,3,4], bottom:[47,16,3,4], right:[40,20,4,12], front:[44,20,3,12], left:[47,20,3,12], back:[50,20,4,12] };
UV.rightSleeveSlim = { top:[44,32,3,4], bottom:[47,32,3,4], right:[40,36,4,12], front:[44,36,3,12], left:[47,36,3,12], back:[50,36,4,12] };
UV.leftArmSlim = { top:[36,48,3,4], bottom:[39,48,3,4], right:[32,52,4,12], front:[36,52,3,12], left:[39,52,3,12], back:[42,52,4,12] };
UV.leftSleeveSlim = { top:[52,48,3,4], bottom:[55,48,3,4], right:[48,52,4,12], front:[52,52,3,12], left:[55,52,3,12], back:[58,52,4,12] };

// Build the 6 UV quads of one body part.
//
// ORIENTATION (this was reversed, which is why the head's side faces looked mirrored against
// the face): buildCube puts the "east" face at +X and "west" at -X. The model faces +Z, toward
// the camera, so a character looking back at us has their OWN left hand on OUR right = +X.
// Skin regions are named from the CHARACTER's point of view, therefore:
//   +X (screen right) must sample the skin's LEFT  region
//   -X (screen left)  must sample the skin's RIGHT region
// Getting this backwards put the character's right ear on the viewer's right.
//
// texW/texH: a 64x64 skin and a 64x32 WORN-ARMOR texture share the same atlas layout but not the
// same vertical extent. A 64x32 texture only has rows 0..31, so a v computed against 64 samples
// the wrong (lower) half -- which is how the armor ended up showing head pixels on the torso.
function uvc(uv, texW, texH) {
  const px = 1 / (texW || 64), py = 1 / (texH || 64);
  const map = (box) => {
    const [x, y, pw, ph] = box;
    const u0 = x * px;
    const u1 = (x + pw) * px;
    const v0 = 1 - (y + ph) * py; // bottom
    const v1 = 1 - y * py;        // top
    // Order: Bottom-Left, Bottom-Right, Top-Right, Top-Left
    return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  };
  return {
    top: map(uv.top), bottom: map(uv.bottom),
    east: map(uv.left),  front: map(uv.front),  // +X samples the character's LEFT
    west: map(uv.right), back: map(uv.back),
  };
}

function buildCube(w, h, d, faces) {
  const x = w / 2, y = h / 2, z = d / 2;
  const p = []; const t = [];
  const addFace = (verts, uvs) => {
    p.push(...verts[0], ...verts[1], ...verts[2], ...verts[0], ...verts[2], ...verts[3]);
    t.push(...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]);
  };
  // Front (Bottom-Left, Bottom-Right, Top-Right, Top-Left)
  addFace([[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], faces.front);
  // Back
  addFace([[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], faces.back);
  // Top
  addFace([[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], faces.top);
  // Bottom
  addFace([[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], faces.bottom);
  // East = +X (viewer's right = character's left)
  addFace([[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], faces.east);
  // West = -X
  addFace([[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], faces.west);
  return { p: new Float32Array(p), t: new Float32Array(t) };
}

function createPlayerRenderer(canvas, skinUrl, isSlim, equipment) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true });
  if (!gl) return null;

  // Standard Minecraft skin UVs assume the origin at the image BOTTOM (OpenGL convention).
  // WebGL defaults UNPACK_FLIP_Y_WEBGL to false (v=0 = image TOP), so without this every
  // face samples a vertically-mirrored region: on a 64x64 skin that lands on the overlay /
  // armor rows (mostly transparent) and is discarded by the alpha test, which looks like
  // "only the head renders". This is persistent state, so it covers skin AND armor textures.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  // Item id -> armor material name used by the game textures. Mojang calls GOLDEN armor
  // "gold" on disk, so matching on the id prefix alone silently 404s golden helmets.
  const getMaterial = (id) => {
    if (!id) return null;
    const s = String(id);
    if (s.includes('turtle')) return 'turtle';
    if (s.includes('netherite')) return 'netherite';
    if (s.includes('diamond')) return 'diamond';
    if (s.includes('chainmail')) return 'chainmail';
    if (s.includes('leather')) return 'leather';
    if (s.includes('golden')) return 'gold';       // item is golden_*, texture is gold.png
    if (s.includes('iron')) return 'iron';
    if (s.includes('copper')) return 'copper';
    return null;
  };

  const prog = gl.createProgram();
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, PLAYER_VS); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, PLAYER_FS); gl.compileShader(fs);
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);

  const uMvp = gl.getUniformLocation(prog, 'uMvp');
  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aTex = gl.getAttribLocation(prog, 'aTex');

  const bufPos = gl.createBuffer();
  const bufTex = gl.createBuffer();

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let armorTex1 = null, armorTex2 = null;
  let mat1 = null, mat2 = null;
  if (equipment) {
    const helmetMat = getMaterial(equipment.helmet?.id);
    const chestMat = getMaterial(equipment.chest?.id);
    const bootsMat = getMaterial(equipment.boots?.id);
    const legsMat = getMaterial(equipment.legs?.id);
    mat1 = helmetMat || chestMat || bootsMat;
    mat2 = legsMat;
  }

  // Upload a texture, but only if it is real. tex:// answers a cache miss with a 1x1 transparent
  // PNG rather than a 404 (to avoid console spam), so a 1px image means "not downloaded yet".
  // Binding it would give the armor cube a fully transparent texture and the alpha test in the
  // fragment shader would discard every fragment -- the armor would silently vanish.
  const upload = (texture, image) => {
    if (!image || image.naturalWidth <= 1) return false;
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return true;
    } catch (e) {
      // A tainted image throws SecurityError from texImage2D. Swallow it so one bad texture
      // cannot break the whole draw loop; the part simply renders untextured.
      return false;
    }
  };

  // The armor layer number: 1 covers helmet + chestplate + boots, 2 covers leggings. Both live in
  // the same texture file per material, so one fetch per material serves every piece.
  // 'armor' / 'armorlegs' map to the two layouts (pre-1.21.2 <mat>_layer_N vs 1.21.2+ humanoid/);
  // textures.js picks per version and falls back to the other on a miss.
  const loadArmor = (kind, material, onReady) => {
    const texture = gl.createTexture();
    const image = new Image();
    // crossOrigin IS required: WebGL texImage2D refuses a cross-origin image that is not
    // CORS-clean (it would throw SecurityError). The original failure was NOT this attribute but
    // the tex:// scheme itself missing CORS support; that is now fixed in main.js (corsEnabled)
    // and textures.js (Access-Control-Allow-Origin). Both halves are needed.
    image.crossOrigin = 'anonymous';
    image.onload = () => { if (upload(texture, image)) onReady(texture); };
    image.onerror = () => {};
    image.src = `tex://auto/${kind}/${material}.png`;
  };

  const img = new Image();
  // Same reasoning as loadArmor above: the CORS handshake is required for a WebGL texture upload
  // from a cross-origin image, and now works because tex:// is a corsEnabled scheme.
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    upload(tex, img);

    // Detect legacy skin: either 64x32, or Mojang padded it to 64x64 with a transparent bottom half.
    const isLegacy = img.height === 32 || (() => {
      try {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 32, img.width, img.height - 32).data;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 0) return false;
        }
        return true;
      } catch { return false; }
    })();

    if (isLegacy) {
      // Legacy skin: use right arm/leg UVs for the left side.
      cLArm = buildCube(armW, 12, 4, uvc(isSlim ? UV.rightArmSlim : UV.rightArm, SKIN, SKIN));
      cLSleeve = buildCube(armW+0.25, 12.25, 4.25, uvc(isSlim ? UV.rightSleeveSlim : UV.rightSleeve, SKIN, SKIN));
      cLLeg = buildCube(4, 12, 4, uvc(UV.rightLeg, SKIN, SKIN));
      cLPants = buildCube(4.25, 12.25, 4.25, uvc(UV.rightPants, SKIN, SKIN));
    }

    if (mat1) {
      loadArmor('armor', mat1, t => { armorTex1 = t; draw(); });
    }
    if (mat2) {
      loadArmor('armorlegs', mat2, t => { armorTex2 = t; draw(); });
    }
    draw();
  };
  img.src = skinUrl;

  const armW = isSlim ? 3 : 4;
  // Skin UVs live on a 64x64 grid. Worn-armor textures are 64x32 (verified against the live
  // mirror: entity/equipment/humanoid/diamond.png is 64x32, head in rows 0..15, body/arms/legs
  // in rows 16..31), so armor cubes must be built against a 32-row grid or they sample the
  // wrong half of the atlas.
  const SKIN = 64;
  const ARMOR_TEX = 32;
  const cHelmet = buildCube(8.5, 8.5, 8.5, uvc(UV.head, SKIN, ARMOR_TEX));
  const cChestplate = buildCube(8.5, 12.5, 4.5, uvc(UV.body, SKIN, ARMOR_TEX));
  // Armor cubes are built from the RIGHT-side UVs on both sides. Worn-armor textures are always
  // 64x32 and only contain one arm and one leg's worth of pixels (the mirrored half is out of
  // range, so CLAMP_TO_EDGE smeared the edge texel across the whole left piece). The game does
  // the same thing -- the left arm/leg of armor reuses the right side's texture region.
  const cRightArmArmor = buildCube(armW+0.5, 12.5, 4.5, uvc(isSlim ? UV.rightArmSlim : UV.rightArm, SKIN, ARMOR_TEX));
  const cLeftArmArmor = buildCube(armW+0.5, 12.5, 4.5, uvc(isSlim ? UV.rightArmSlim : UV.rightArm, SKIN, ARMOR_TEX));
  const cRightBoot = buildCube(4.5, 12.5, 4.5, uvc(UV.rightLeg, SKIN, ARMOR_TEX));
  const cLeftBoot = buildCube(4.5, 12.5, 4.5, uvc(UV.rightLeg, SKIN, ARMOR_TEX));
  const cLeggings = buildCube(8.5, 12.5, 4.5, uvc(UV.body, SKIN, ARMOR_TEX));
  const cRightLeggings = buildCube(4.5, 12.5, 4.5, uvc(UV.rightLeg, SKIN, ARMOR_TEX));
  const cLeftLeggings = buildCube(4.5, 12.5, 4.5, uvc(UV.rightLeg, SKIN, ARMOR_TEX));

  const cHead = buildCube(8, 8, 8, uvc(UV.head, SKIN, SKIN));
  const cHat = buildCube(8.5, 8.5, 8.5, uvc(UV.hat, SKIN, SKIN));
  const cBody = buildCube(8, 12, 4, uvc(UV.body, SKIN, SKIN));
  const cJacket = buildCube(8.25, 12.25, 4.25, uvc(UV.jacket, SKIN, SKIN));
  const cRArm = buildCube(armW, 12, 4, uvc(isSlim ? UV.rightArmSlim : UV.rightArm, SKIN, SKIN));
  const cRSleeve = buildCube(armW+0.25, 12.25, 4.25, uvc(isSlim ? UV.rightSleeveSlim : UV.rightSleeve, SKIN, SKIN));
  const cRLeg = buildCube(4, 12, 4, uvc(UV.rightLeg, SKIN, SKIN));
  const cRPants = buildCube(4.25, 12.25, 4.25, uvc(UV.rightPants, SKIN, SKIN));

  // v6.0.0 Track B: legacy skins (64x32) don't have left arm/leg UVs. They are mirrored.
  // We define them as 'let' so we can swap them in img.onload if isLegacy.
  let cLArm = buildCube(armW, 12, 4, uvc(isSlim ? UV.leftArmSlim : UV.leftArm, SKIN, SKIN));
  let cLSleeve = buildCube(armW+0.25, 12.25, 4.25, uvc(isSlim ? UV.leftSleeveSlim : UV.leftSleeve, SKIN, SKIN));
  let cLLeg = buildCube(4, 12, 4, uvc(UV.leftLeg, SKIN, SKIN));
  let cLPants = buildCube(4.25, 12.25, 4.25, uvc(UV.leftPants, SKIN, SKIN));

  let rotX = 0, rotY = 0;
  let dragging = false, lastX = 0, lastY = 0;

  // Use Pointer Events on the canvas itself to avoid leaking window-level listeners
  // when the Player Inspector is opened multiple times.
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault(); // Prevent native drag/selection, which locks the cursor and blocks pointermove
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    e.preventDefault();
    rotY += (e.clientX - lastX) * 0.01;
    rotX += (e.clientY - lastY) * 0.01;
    rotX = Math.max(-Math.PI/2, Math.min(Math.PI/2, rotX));
    lastX = e.clientX; lastY = e.clientY;
    draw();
  });

  function bindBufs(cube) {
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, cube.p, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufTex);
    gl.bufferData(gl.ARRAY_BUFFER, cube.t, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0);
  }

  function draw() {
    // BUGFIX: useProgram must run on EVERY draw, not only at setup. The inspector rebuilds the
    // renderer whenever a late armor texture arrives, and the OLD closure keeps firing draw() from
    // its pointermove listener. Without this, uniformMatrix4fv below is called with a location
    // that belongs to the previous program while the new one is active, and Chromium throws
    // 'INVALID_OPERATION: uniformMatrix4fv: location is not from the associated program'.
    gl.useProgram(prog);
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width) canvas.width = rect.width;
    if (canvas.height !== rect.height) canvas.height = rect.height;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Fit the model to the viewport. The canvas is square (aspect-ratio 1), so the vertical FOV is
    // the binding constraint: half_height = dist * tan(fov/2). Solve for the distance that puts
    // the 32-unit-tall player at ~78% of the frame, and use that same distance for the far plane
    // so nothing is ever clipped by depth.
    const tanHalf = Math.tan(Math.PI / 8); // fov 45deg -> tan(22.5deg)
    const dist = (MODEL_HEIGHT / 2) / (0.78 * tanHalf);
    const proj = mat4Perspective(Math.PI/4, rect.width/rect.height, 0.1, dist * 4);
    // Look at the model's mid-height so the feet and the crown are both comfortably inside.
    const view = mat4Translate(0, -MODEL_HEIGHT / 2, -dist);
    const rot = mat4Multiply(mat4RotateX(rotX), mat4RotateY(rotY));
    const baseMvp = mat4Multiply(proj, mat4Multiply(view, rot));

    const drawPart = (cube, tx, ty, tz) => {
      const model = mat4Translate(tx, ty, tz);
      gl.uniformMatrix4fv(uMvp, false, mat4Multiply(baseMvp, model));
      bindBufs(cube);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    };

    // BUGFIX: bind the skin texture on EVERY draw. loadArmor's upload() binds the armor texture to
    // TEXTURE0, and both skin and armor share that one texture unit (the sampler defaults to 0), so
    // without this rebind every skin cube after the first armor upload sampled the armor atlas at
    // skin UVs -- the body sampled transparent rows and disappeared, which the user saw as a model
    // with no armor and a missing torso.
    gl.bindTexture(gl.TEXTURE_2D, tex);

    const p = name => partPos(name);
    drawPart(cBody, p('body').x, p('body').y, 0);
    drawPart(cJacket, p('body').x, p('body').y, 0);
    drawPart(cHead, p('head').x, p('head').y, 0);
    drawPart(cHat, p('head').x, p('head').y, 0);
    drawPart(cRLeg, p('legR').x, p('legR').y, 0);
    drawPart(cRPants, p('legR').x, p('legR').y, 0);
    drawPart(cLLeg, p('legL').x, p('legL').y, 0);
    drawPart(cLPants, p('legL').x, p('legL').y, 0);
    drawPart(cRArm, p('armR').x, p('armR').y, 0);
    drawPart(cRSleeve, p('armR').x, p('armR').y, 0);
    drawPart(cLArm, p('armL').x, p('armL').y, 0);
    drawPart(cLSleeve, p('armL').x, p('armL').y, 0);

    if (armorTex1) {
      gl.bindTexture(gl.TEXTURE_2D, armorTex1);
      if (equipment.helmet) drawPart(cHelmet, p('head').x, p('head').y, 0);
      if (equipment.chest) {
        drawPart(cChestplate, p('body').x, p('body').y, 0);
        drawPart(cRightArmArmor, p('armR').x, p('armR').y, 0);
        drawPart(cLeftArmArmor, p('armL').x, p('armL').y, 0);
      }
      if (equipment.boots) {
        drawPart(cRightBoot, p('legR').x, p('legR').y, 0);
        drawPart(cLeftBoot, p('legL').x, p('legL').y, 0);
      }
    }
    if (armorTex2) {
      gl.bindTexture(gl.TEXTURE_2D, armorTex2);
      if (equipment.legs) {
        drawPart(cLeggings, p('body').x, p('body').y, 0);
        drawPart(cRightLeggings, p('legR').x, p('legR').y, 0);
        drawPart(cLeftLeggings, p('legL').x, p('legL').y, 0);
      }
    }
  }

  return { draw };
}
