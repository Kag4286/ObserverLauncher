// worldmap.test.js — update for level-name folder resolution
const fs = require('fs'), os = require('os'), path = require('path');
const nbt = require('prismarine-nbt');
const zlib = require('zlib');
const wm = require('../src/main/worldmap.js');
let pass = 0, fail = 0;
const ck = (n, c) => c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-wm-'));
const worldDir = path.join(root, 'My World'); // custom level-name with space
fs.mkdirSync(path.join(worldDir, 'playerdata'), { recursive: true });

const lvl = {
  type: 'compound', name: '',
  value: { Data: { type: 'compound', value: {
    LevelName: { type: 'string', value: 'Test World' },
    WorldGenSettings: { type: 'compound', value: { seed: { type: 'long', value: [123, 456789] } } },
    SpawnX: { type: 'int', value: 128 }, SpawnY: { type: 'int', value: 70 }, SpawnZ: { type: 'int', value: -256 },
    Version: { type: 'compound', value: { Name: { type: 'string', value: '1.21.4' }, Id: { type: 'int', value: 3953 }, Snapshot: { type: 'byte', value: 0 } } },
    DataVersion: { type: 'int', value: 3953 }, hardcore: { type: 'byte', value: 0 },
  } } },
};
fs.writeFileSync(path.join(worldDir, 'level.dat'), zlib.gzipSync(nbt.writeUncompressed(lvl)));

const mkPlayer = (x, y, z, dim) => ({ type: 'compound', name: '', value: {
  Pos: { type: 'list', value: { type: 'double', value: [x, y, z] } },
  Dimension: { type: 'string', value: dim }, playerGameType: { type: 'int', value: 0 },
}});
const uuidA = '069a79f444e94726a5befca90e38aaf5';
fs.writeFileSync(path.join(worldDir, 'playerdata', uuidA + '.dat'), zlib.gzipSync(nbt.writeUncompressed(mkPlayer(10.5, 64, -20.25, 'minecraft:overworld'))));
fs.writeFileSync(path.join(root, 'usercache.json'), JSON.stringify([{ uuid: uuidA, name: 'Notch' }]));

(async () => {
  // with level-name folder resolution
  const L = await wm.readLevel(root, 'My World');
  ck('level found in level-name folder', L.ok && L.levelName === 'Test World');
  ck('seed exact', L.seed === String((BigInt(123) << 32n) | BigInt(456789 & 0xFFFFFFFF)));
  ck('spawn exact', L.spawn.x === 128);
  const P = await wm.readPlayers(root, 'My World');
  ck('player found in level-name playerdata', P.players.length === 1 && P.players[0].name === 'Notch');
  // root fallback (legacy)
  fs.rmSync(worldDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'playerdata'), { recursive: true });
  fs.writeFileSync(path.join(root, 'level.dat'), zlib.gzipSync(nbt.writeUncompressed(lvl)));
  fs.writeFileSync(path.join(root, 'playerdata', uuidA + '.dat'), zlib.gzipSync(nbt.writeUncompressed(mkPlayer(1, 2, 3, 'minecraft:overworld'))));
  const L2 = await wm.readLevel(root, 'My World'); // folder gone — falls back to root
  ck('root fallback when level-name folder missing', L2.ok && L2.seed === L.seed);
  const P2 = await wm.readPlayers(root, 'My World');
  ck('root playerdata fallback', P2.players.length === 1);
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
