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
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
