// 03b-player-3d.js — Render a Minecraft player model from a 64x64 skin texture (v6.0.0 Track B1).
//
// Uses raw WebGL (no Three.js). Defines the 6 body parts (head, body, arms, legs) plus their
// outer layers (jacket, sleeves, pants, hat). UV mapping matches the standard Mojang layout.
// Supports classic (4px arm) and slim (3px arm) models.

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

function uvc(uv, w, h, d) {
  const px = 1/64, py = 1/64;
  const u = (x,y) => [x*px, 1 - (y+1)*py];
  const map = (box, pw, ph) => {
    const [x,y,pw_,ph_] = box;
    return [ u(x,y), u(x+pw_,y), u(x+pw_,y+ph_), u(x,y+ph_) ];
  };
  return {
    top: map(uv.top, w, d), bottom: map(uv.bottom, w, d),
    right: map(uv.right, d, h), front: map(uv.front, w, h),
    left: map(uv.left, d, h), back: map(uv.back, w, h)
  };
}

function buildCube(w, h, d, faces) {
  const x = w/2, y = h/2, z = d/2;
  const p = []; const t = [];
  const addFace = (verts, uvs) => {
    p.push(...verts[0], ...verts[1], ...verts[2], ...verts[0], ...verts[2], ...verts[3]);
    t.push(...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]);
  };
  // Front
  addFace([[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]], faces.front);
  // Back
  addFace([[x,-y,-z],[-x,-y,-z],[-x,y,-z],[x,y,-z]], faces.back);
  // Top
  addFace([[-x,y,z],[x,y,z],[x,y,-z],[-x,y,-z]], faces.top);
  // Bottom
  addFace([[-x,-y,-z],[x,-y,-z],[x,-y,z],[-x,-y,z]], faces.bottom);
  // Right
  addFace([[x,-y,z],[x,-y,-z],[x,y,-z],[x,y,z]], faces.right);
  // Left
  addFace([[-x,-y,-z],[-x,-y,z],[-x,y,z],[-x,y,-z]], faces.left);
  return { p: new Float32Array(p), t: new Float32Array(t) };
}

function createPlayerRenderer(canvas, skinUrl, isSlim, equipment) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true });
  if (!gl) return null;

  const getMaterial = (id) => {
    if (!id) return null;
    if (id.includes('leather')) return 'leather';
    if (id.includes('chainmail')) return 'chainmail';
    if (id.includes('iron')) return 'iron';
    if (id.includes('golden')) return 'golden';
    if (id.includes('diamond')) return 'diamond';
    if (id.includes('netherite')) return 'netherite';
    if (id.includes('turtle')) return 'turtle';
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

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    
    if (img.height === 32) {
      // Legacy skin: use right arm/leg UVs for the left side.
      cLArm = buildCube(armW, 12, 4, uvc(isSlim ? UV.rightArmSlim : UV.rightArm, armW, 12, 4));
      cLSleeve = buildCube(armW+0.25, 12.25, 4.25, uvc(isSlim ? UV.rightSleeveSlim : UV.rightSleeve, armW, 12, 4));
      cLLeg = buildCube(4, 12, 4, uvc(UV.rightLeg, 4, 12, 4));
      cLPants = buildCube(4.25, 12.25, 4.25, uvc(UV.rightPants, 4, 12, 4));
    }
    
    if (mat1) {
      armorTex1 = gl.createTexture();
      const imgA1 = new Image();
      imgA1.crossOrigin = 'anonymous';
      imgA1.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, armorTex1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgA1);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        draw();
      };
      imgA1.src = `tex://auto/armor/${mat1}_layer_1.png`;
    }
    if (mat2) {
      armorTex2 = gl.createTexture();
      const imgA2 = new Image();
      imgA2.crossOrigin = 'anonymous';
      imgA2.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, armorTex2);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgA2);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        draw();
      };
      imgA2.src = `tex://auto/armor/${mat2}_layer_2.png`;
    }
    draw();
  };
  img.src = skinUrl;

  const armW = isSlim ? 3 : 4;
  const cHelmet = buildCube(8.5, 8.5, 8.5, uvc(UV.head, 8, 8, 8));
  const cChestplate = buildCube(8.5, 12.5, 4.5, uvc(UV.body, 8, 12, 4));
  const cRightArmArmor = buildCube(armW+0.5, 12.5, 4.5, uvc(isSlim ? UV.rightArmSlim : UV.rightArm, armW, 12, 4));
  const cLeftArmArmor = buildCube(armW+0.5, 12.5, 4.5, uvc(isSlim ? UV.leftArmSlim : UV.leftArm, armW, 12, 4));
  const cRightBoot = buildCube(4.5, 12.5, 4.5, uvc(UV.rightLeg, 4, 12, 4));
  const cLeftBoot = buildCube(4.5, 12.5, 4.5, uvc(UV.leftLeg, 4, 12, 4));
  const cLeggings = buildCube(8.5, 12.5, 4.5, uvc(UV.body, 8, 12, 4));
  const cRightLeggings = buildCube(4.5, 12.5, 4.5, uvc(UV.rightLeg, 4, 12, 4));
  const cLeftLeggings = buildCube(4.5, 12.5, 4.5, uvc(UV.leftLeg, 4, 12, 4));

  const cHead = buildCube(8, 8, 8, uvc(UV.head, 8, 8, 8));
  const cHat = buildCube(8.5, 8.5, 8.5, uvc(UV.hat, 8, 8, 8));
  const cBody = buildCube(8, 12, 4, uvc(UV.body, 8, 12, 4));
  const cJacket = buildCube(8.25, 12.25, 4.25, uvc(UV.jacket, 8, 12, 4));
  const cRArm = buildCube(armW, 12, 4, uvc(isSlim ? UV.rightArmSlim : UV.rightArm, armW, 12, 4));
  const cRSleeve = buildCube(armW+0.25, 12.25, 4.25, uvc(isSlim ? UV.rightSleeveSlim : UV.rightSleeve, armW, 12, 4));
  const cRLeg = buildCube(4, 12, 4, uvc(UV.rightLeg, 4, 12, 4));
  const cRPants = buildCube(4.25, 12.25, 4.25, uvc(UV.rightPants, 4, 12, 4));

  // v6.0.0 Track B: legacy skins (64x32) don't have left arm/leg UVs. They are mirrored.
  // We define them as 'let' so we can swap them in img.onload if isLegacy.
  let cLArm = buildCube(armW, 12, 4, uvc(isSlim ? UV.leftArmSlim : UV.leftArm, armW, 12, 4));
  let cLSleeve = buildCube(armW+0.25, 12.25, 4.25, uvc(isSlim ? UV.leftSleeveSlim : UV.leftSleeve, armW, 12, 4));
  let cLLeg = buildCube(4, 12, 4, uvc(UV.leftLeg, 4, 12, 4));
  let cLPants = buildCube(4.25, 12.25, 4.25, uvc(UV.leftPants, 4, 12, 4));

  let rotX = 0, rotY = 0;
  let dragging = false, lastX = 0, lastY = 0;

  // Use Pointer Events on the canvas itself to avoid leaking window-level listeners
  // when the Player Inspector is opened multiple times.
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', e => {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
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
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width) canvas.width = rect.width;
    if (canvas.height !== rect.height) canvas.height = rect.height;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const proj = mat4Perspective(Math.PI/4, rect.width/rect.height, 0.1, 100.0);
    const view = mat4Translate(0, -18, -40); // Center the model
    const rot = mat4Multiply(mat4RotateX(rotX), mat4RotateY(rotY));
    const baseMvp = mat4Multiply(proj, mat4Multiply(view, rot));

    const drawPart = (cube, tx, ty, tz) => {
      const model = mat4Translate(tx, ty, tz);
      gl.uniformMatrix4fv(uMvp, false, mat4Multiply(baseMvp, model));
      bindBufs(cube);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    };

    // Body center at 12
    drawPart(cBody, 0, 12, 0);
    drawPart(cJacket, 0, 12, 0);
    // Head at 18 (12 + 6)
    drawPart(cHead, 0, 18, 0);
    drawPart(cHat, 0, 18, 0);
    // Legs (top at 12, hang down)
    drawPart(cRLeg, -2, 6, 0);
    drawPart(cRPants, -2, 6, 0);
    drawPart(cLLeg, 2, 6, 0);
    drawPart(cLPants, 2, 6, 0);
    // Arms (top at 22, hang down)
    drawPart(cRArm, -(4 + armW/2), 11, 0);
    drawPart(cRSleeve, -(4 + armW/2), 11, 0);
    drawPart(cLArm, (4 + armW/2), 11, 0);
    drawPart(cLSleeve, (4 + armW/2), 11, 0);

    if (armorTex1) {
      gl.bindTexture(gl.TEXTURE_2D, armorTex1);
      if (equipment.helmet) drawPart(cHelmet, 0, 18, 0);
      if (equipment.chest) {
        drawPart(cChestplate, 0, 12, 0);
        drawPart(cRightArmArmor, -(4 + armW/2), 11, 0);
        drawPart(cLeftArmArmor, (4 + armW/2), 11, 0);
      }
      if (equipment.boots) {
        drawPart(cRightBoot, -2, 6, 0);
        drawPart(cLeftBoot, 2, 6, 0);
      }
    }
    if (armorTex2) {
      gl.bindTexture(gl.TEXTURE_2D, armorTex2);
      if (equipment.legs) {
        drawPart(cLeggings, 0, 12, 0);
        drawPart(cRightLeggings, -2, 6, 0);
        drawPart(cLeftLeggings, 2, 6, 0);
      }
    }
  }

  return { draw };
}
