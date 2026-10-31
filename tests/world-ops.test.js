const fs = require('fs');
const path = require('path');
const os = require('os');
const nbt = require('prismarine-nbt');
const zlib = require('zlib');
const {
  sanitizeWorldName,
  parseBigIntSeed,
  renameWorld,
  setWorldSeed,
  deleteDimension,
  cloneWorld,
} = require('../src/main/world-ops.js');

let pass = 0, fail = 0;
function check(name, cond) {
  cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name));
}

// 1. sanitizeWorldName
check('valid name', sanitizeWorldName('my_world-1') === 'my_world-1');
check('rejects traversal', sanitizeWorldName('../world') === null);
check('rejects slash', sanitizeWorldName('a/b') === null);
check('rejects empty', sanitizeWorldName('') === null);

// 2. parseBigIntSeed
check('parse positive int', parseBigIntSeed('123456789012345') === 123456789012345n);
check('parse negative int', parseBigIntSeed('-987654321') === -987654321n);
check('hashes text seed', typeof parseBigIntSeed('minecraft_seed') === 'bigint');

// 3. World operations on temporary directory
const tmp = path.join(os.tmpdir(), 'ob-worldops-test-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });

async function runTests() {
  try {
    const worldDir = path.join(tmp, 'world');
    fs.mkdirSync(worldDir, { recursive: true });

    // Create a valid level.dat in worldDir
    const levelNbt = {
      type: 'compound',
      name: '',
      value: {
        Data: {
          type: 'compound',
          value: {
            LevelName: { type: 'string', value: 'world' },
            RandomSeed: { type: 'long', value: 11111n },
            WorldGenSettings: {
              type: 'compound',
              value: {
                seed: { type: 'long', value: 11111n },
              },
            },
          },
        },
      },
    };
    const rawGzip = zlib.gzipSync(nbt.writeUncompressed(levelNbt, 'big'));
    fs.writeFileSync(path.join(worldDir, 'level.dat'), rawGzip);

    // Create server.properties
    fs.writeFileSync(path.join(tmp, 'server.properties'), 'level-name=world\r\ndifficulty=easy\r\n');

    // Create DIM-1
    const netherDir = path.join(worldDir, 'DIM-1');
    fs.mkdirSync(netherDir, { recursive: true });
    fs.writeFileSync(path.join(netherDir, 'test.txt'), 'nether data');

    // Test setWorldSeed
    const seedRes = await setWorldSeed(tmp, 'world', '9999999999');
    check('setWorldSeed ok', seedRes.ok);
    const updatedLevel = await nbt.parse(fs.readFileSync(path.join(worldDir, 'level.dat'))); check('level.dat seed updated', BigInt(updatedLevel.parsed.value.Data.value.RandomSeed.value) === 9999999999n);

    // Test deleteDimension
    const delRes = await deleteDimension(tmp, 'world', 'nether');
    check('deleteDimension ok', delRes.ok);
    check('DIM-1 removed from world', !fs.existsSync(netherDir));
    check('DIM backup created', fs.existsSync(delRes.backup));

    // Test renameWorld
    const renRes = await renameWorld(tmp, 'world', 'NewWorld');
    check('renameWorld ok', renRes.ok);
    check('NewWorld dir exists', fs.existsSync(path.join(tmp, 'NewWorld')));
    check('old world dir gone', !fs.existsSync(worldDir));
    const renLevel = await nbt.parse(fs.readFileSync(path.join(tmp, 'NewWorld', 'level.dat')));
    check('level.dat LevelName is NewWorld', renLevel.parsed.value.Data.value.LevelName.value === 'NewWorld');
    const props = fs.readFileSync(path.join(tmp, 'server.properties'), 'utf8');
    check('server.properties level-name updated', props.includes('level-name=NewWorld'));

    // Test cloneWorld
    const cloneTargetRoot = path.join(os.tmpdir(), 'ob-worldops-target-' + Date.now());
    fs.mkdirSync(cloneTargetRoot, { recursive: true });
    try {
      const cloneRes = await cloneWorld(tmp, 'NewWorld', cloneTargetRoot, 'ClonedWorld');
      check('cloneWorld ok', cloneRes.ok);
      check('cloned directory exists', fs.existsSync(path.join(cloneTargetRoot, 'ClonedWorld', 'level.dat')));
    } finally {
      try { fs.rmSync(cloneTargetRoot, { recursive: true, force: true }); } catch {}
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

runTests();
