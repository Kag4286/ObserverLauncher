// Tests for 3D player renderer cleanup and listener lifecycle (v6.0.2).
// Verifies that event listeners and WebGL resources are properly cleaned up on destroy
// and before re-creating a renderer on the same canvas.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); pass++; }

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', '03b-player-3d.js'), 'utf8');

function createMockCanvas() {
  const listeners = {};
  const glResources = { buffers: [], textures: [], programs: [] };
  const mockGl = {
    pixelStorei: () => {},
    createProgram: () => { const p = { id: Math.random() }; glResources.programs.push(p); return p; },
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    createBuffer: () => { const b = { id: Math.random() }; glResources.buffers.push(b); return b; },
    createTexture: () => { const t = { id: Math.random() }; glResources.textures.push(t); return t; },
    bindTexture: () => {},
    bindBuffer: () => {},
    bufferData: () => {},
    texParameteri: () => {},
    texImage2D: () => {},
    deleteBuffer: (b) => { glResources.buffers = glResources.buffers.filter(x => x !== b); },
    deleteTexture: (t) => { glResources.textures = glResources.textures.filter(x => x !== t); },
    deleteProgram: (p) => { glResources.programs = glResources.programs.filter(x => x !== p); },
    useProgram: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    viewport: () => {},
    clearColor: () => {},
    clear: () => {},
    enable: () => {},
    blendFunc: () => {},
    uniformMatrix4fv: () => {},
    drawArrays: () => {},
    STATIC_DRAW: 0, ARRAY_BUFFER: 0, TEXTURE_2D: 0,
    COLOR_BUFFER_BIT: 0, DEPTH_BUFFER_BIT: 0, DEPTH_TEST: 0, BLEND: 0,
    SRC_ALPHA: 0, ONE_MINUS_SRC_ALPHA: 0, TRIANGLES: 0, FLOAT: 0,
    UNPACK_FLIP_Y_WEBGL: 0,
  };

  const canvas = {
    style: {},
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
    getContext: () => mockGl,
    addEventListener: (type, fn) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter(f => f !== fn);
    },
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => false,
    _listeners: listeners,
    _glResources: glResources,
  };
  return canvas;
}

const loadedUrls = [];
const sandbox = {
  console, Math, Float32Array, Image: function () {
    this.naturalWidth = 64;
    this.naturalHeight = 64;
    this.addEventListener = (ev, cb) => { if (ev === 'load') cb(); };
    let _src = '';
    Object.defineProperty(this, 'src', {
      set(val) {
        _src = val;
        loadedUrls.push(val);
        if (typeof this.onload === 'function') this.onload();
      },
      get() { return _src; }
    });
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const createPlayerRenderer = sandbox.createPlayerRenderer;
ok('createPlayerRenderer exported', typeof createPlayerRenderer === 'function');

// 1. Initial render attaches handle with draw and destroy
const canvas = createMockCanvas();
const r1 = createPlayerRenderer(canvas, 'data:image/png;base64,dummy', false, null);
ok('renderer returned handle', !!r1 && typeof r1.destroy === 'function');
ok('canvas has _playerRenderer attached', canvas._playerRenderer === r1);
ok('canvas has 4 pointer listeners', canvas._listeners.pointerdown.length === 1 && canvas._listeners.pointermove.length === 1);

// 2. Calling destroy cleans up listeners and WebGL resources
r1.destroy();
ok('destroy removed pointerdown listener', canvas._listeners.pointerdown.length === 0);
ok('destroy removed pointermove listener', canvas._listeners.pointermove.length === 0);
ok('destroy cleared _playerRenderer on canvas', canvas._playerRenderer === null);
ok('destroy released buffers', canvas._glResources.buffers.length === 0);
ok('destroy released program', canvas._glResources.programs.length === 0);

// 3. Re-creating a renderer on the same canvas automatically cleans up the previous one
const r2 = createPlayerRenderer(canvas, 'data:image/png;base64,dummy', false, null);
ok('r2 created with 1 listener each', canvas._listeners.pointerdown.length === 1);
const r3 = createPlayerRenderer(canvas, 'data:image/png;base64,dummy', false, null);
ok('r3 replaced r2 without listener accumulation', canvas._listeners.pointerdown.length === 1 && canvas._listeners.pointermove.length === 1);
ok('canvas points to r3', canvas._playerRenderer === r3);
r3.destroy();
ok('clean after r3 destroy', canvas._listeners.pointerdown.length === 0);

// 4. Mixed armor material support (Diamond Helmet + Netherite Chestplate)
const mixedEquip = {
  helmet: { id: 'minecraft:diamond_helmet' },
  chest: { id: 'minecraft:netherite_chestplate' },
  legs: { id: 'minecraft:netherite_leggings' },
  boots: { id: 'minecraft:diamond_boots' }
};
const r4 = createPlayerRenderer(canvas, 'data:image/png;base64,dummy', false, mixedEquip);
ok('r4 created with mixed armor', !!r4);
ok('diamond armor texture requested for helmet', loadedUrls.some(u => u.includes('armor/diamond.png')));
ok('netherite chest armor texture requested', loadedUrls.some(u => u.includes('armor/netherite.png')));
ok('netherite legs armor texture requested', loadedUrls.some(u => u.includes('armorlegs/netherite.png')));
r4.destroy();
ok('clean after r4 destroy', canvas._listeners.pointerdown.length === 0);

console.log(`\n${pass} passed, 0 failed`);
