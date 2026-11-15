// Smoke test for src/main/textures.js pure/handle logic with a mocked electron module.
const Module = require('module');
const os = require('os');
const path = require('path');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => path.join(os.tmpdir(), 'ob-tex-test-userdata') },
      net: {}, // queueRemote will fail silently on fetch — fine for this test
    };
  }
  return origLoad.apply(this, arguments);
};
require('fs').rmSync(path.join(os.tmpdir(), 'ob-tex-test-userdata'), { recursive: true, force: true });

const textures = require('../src/main/textures.js');

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name)); }

// detectMcVersion
check('detect 26.3', textures.detectMcVersion(['paper-26.3.jar']) === '26.3');
check('detect 1.21.4', textures.detectMcVersion(['minecraft_server.1.21.4.jar', 'run.bat']) === '1.21.4');
check('detect none', textures.detectMcVersion(['velocity-proxy.jar', 'run.bat']) === null);
check('detect prefers first', textures.detectMcVersion(['spigot-1.20.1.jar']) === '1.20.1');

// handle()
const r = u => textures.handle({ url: u });
check('bundled diamond hit', r('tex://auto/item/diamond.png').status === 200);
check('bundled block hit', r('tex://auto/block/stone.png').status === 200);
check('explicit version falls back to bundle', r('tex://1.21.4/item/diamond.png').status === 200);
// miss now serves the transparent 1×1 placeholder (HTTP 200) — no console error spam; the real
// icon is fetched in the background and the renderer is pushed an icons:update event.
const miss = r('tex://26.9/item/some_future_item.png');
check('unknown future item -> 200 placeholder', miss.status === 200);
check('placeholder is PNG bytes', miss.headers.get('content-type') === 'image/png');
check('bad kind rejected', r('tex://auto/entity/creeper.png').status === 400);
check('bad filename rejected', r('tex://auto/item/Bad$Name.png').status === 400);
check('wrong segment count rejected', r('tex://auto/item/sub/dir/x.png').status === 400);

// content sanity: PNG magic bytes
const resp = r('tex://auto/item/diamond.png');
resp.arrayBuffer().then(ab => {
  const b = Buffer.from(ab);
  check('served bytes are PNG', b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG');

  // resolveVanillaModelFromMap multi-face & shape resolution
  const mockModels = {
    block: {},
    cube: { parent: 'block/block' },
    cube_all: { parent: 'block/cube' },
    cube_bottom_top: { parent: 'block/cube' },
    orientable: { parent: 'block/cube' },
    slab: { parent: 'block/block' },
    stairs: { parent: 'block/block' },
    leaves: { parent: 'block/block', elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#all', tintindex: 0 }, north: { texture: '#all', tintindex: 0 }, east: { texture: '#all', tintindex: 0 } } }] },
    grass_block: {
      parent: 'block/block',
      textures: { bottom: 'block/dirt', top: 'block/grass_block_top', side: 'block/grass_block_side', overlay: 'block/grass_block_side_overlay' },
      elements: [
        { from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#top', tintindex: 0 }, north: { texture: '#side' }, east: { texture: '#side' } } },
        { from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: '#overlay', tintindex: 0 }, east: { texture: '#overlay', tintindex: 0 } } }
      ]
    },
    crafting_table: {
      parent: 'minecraft:block/cube',
      textures: { up: 'minecraft:block/crafting_table_top', north: 'minecraft:block/crafting_table_front', east: 'minecraft:block/crafting_table_side' }
    },
    oak_slab: { parent: 'minecraft:block/slab', textures: { top: 'minecraft:block/oak_planks', side: 'minecraft:block/oak_planks' } },
    oak_stairs: { parent: 'minecraft:block/stairs', textures: { top: 'minecraft:block/oak_planks', side: 'minecraft:block/oak_planks' } },
    oak_leaves: { parent: 'minecraft:block/leaves', textures: { all: 'minecraft:block/oak_leaves' } },
    cherry_leaves: { parent: 'minecraft:block/leaves', textures: { all: 'minecraft:block/cherry_leaves' } },
    glass: { parent: 'minecraft:block/cube_all', textures: { all: { sprite: 'minecraft:block/glass', force_translucent: true } } },
    chest: { textures: { particle: 'minecraft:block/oak_planks' } },
    poppy: { parent: 'minecraft:block/cross', textures: { cross: 'minecraft:block/poppy' } },
  };
  const gb = textures.resolveVanillaModelFromMap('grass_block', mockModels);
  check('grass_block resolves top + side + overlay + tints', gb && gb.top.texPath === 'block/grass_block_top' && gb.side.texPath === 'block/grass_block_side' && gb.overlay.texPath === 'block/grass_block_side_overlay' && gb.tintTop === true && gb.tintOverlay === true);
  const ct = textures.resolveVanillaModelFromMap('crafting_table', mockModels);
  check('crafting_table resolves distinct top/front/side', ct && ct.top.texPath === 'block/crafting_table_top' && ct.front.texPath === 'block/crafting_table_front' && ct.side.texPath === 'block/crafting_table_side');
  check('oak_slab resolves shape=slab', textures.resolveVanillaModelFromMap('oak_slab', mockModels)?.shape === 'slab');
  check('oak_stairs resolves shape=stairs', textures.resolveVanillaModelFromMap('oak_stairs', mockModels)?.shape === 'stairs');
  check('oak_leaves tints green', textures.resolveVanillaModelFromMap('oak_leaves', mockModels)?.tintTop === true);
  check('cherry_leaves stays untinted', textures.resolveVanillaModelFromMap('cherry_leaves', mockModels)?.tintTop === false);
  check('glass sprite object resolves cleanly', textures.resolveVanillaModelFromMap('glass', mockModels)?.top?.texPath === 'block/glass');
  check('chest skips block cubing', textures.resolveVanillaModelFromMap('chest', mockModels) === null);
  check('poppy cross skips block cubing', textures.resolveVanillaModelFromMap('poppy', mockModels) === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
