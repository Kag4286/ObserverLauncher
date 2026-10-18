// v6.0.0 C5: datapack load-order read/write + pure helpers. Uses prismarine-nbt to build a real
// level.dat (gzip'd big-endian) and verifies the round-trip: read the enabled list, reorder it,
// write it back, re-read, and confirm the rest of the file survived.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const nbt = require('prismarine-nbt');
const D = require('../src/main/datapack-order.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

// --- buildPackEntry / parsePackEntry ---
ok('buildPackEntry file', D.buildPackEntry('my_pack.zip') === 'file/my_pack.zip');
ok('buildPackEntry keeps prefix', D.buildPackEntry('file/x') === 'file/x');
ok('buildPackEntry empty -> null', D.buildPackEntry('') === null);
ok('parsePackEntry file', JSON.stringify(D.parsePackEntry('file/x')) === JSON.stringify({ kind: 'file', name: 'x' }));
ok('parsePackEntry vanilla', D.parsePackEntry('vanilla').kind === 'vanilla');
ok('parsePackEntry builtin', D.parsePackEntry('fabric').kind === 'builtin');
ok('parsePackEntry empty -> null', D.parsePackEntry('') === null);

// --- reorderPack ---
const base = ['vanilla', 'file/a', 'file/b', 'file/c'];
ok('up swaps with next', JSON.stringify(D.reorderPack(base, 'file/a', 'up')) === JSON.stringify(['vanilla', 'file/b', 'file/a', 'file/c']));
ok('down swaps with prev', JSON.stringify(D.reorderPack(base, 'file/c', 'down')) === JSON.stringify(['vanilla', 'file/a', 'file/c', 'file/b']));
ok('up at end -> no-op', JSON.stringify(D.reorderPack(base, 'file/c', 'up')) === JSON.stringify(base));
ok('down at start -> no-op', JSON.stringify(D.reorderPack(base, 'vanilla', 'down')) === JSON.stringify(base));
ok('unknown entry -> no-op', JSON.stringify(D.reorderPack(base, 'file/zz', 'up')) === JSON.stringify(base));
ok('reorder does not mutate input', (() => { const c = base.slice(); D.reorderPack(c, 'file/a', 'up'); return JSON.stringify(c) === JSON.stringify(base); })());

// --- listsFromData ---
ok('missing DataPacks -> empty', JSON.stringify(D.listsFromData({})) === JSON.stringify({ enabled: [], disabled: [] }));
ok('reads enabled list', JSON.stringify(D.listsFromData({ DataPacks: { value: { Enabled: { value: { type: 'string', value: ['a', 'b'] } } } } }).enabled) === JSON.stringify(['a', 'b']));

// --- round-trip through level.dat ---
function buildLevelDat(enabled) {
  return require('zlib').gzipSync(nbt.writeUncompressed({
    type: 'compound', name: '', value: {
      Data: { type: 'compound', name: 'Data', value: {
        LevelName: { type: 'string', value: 'TestWorld' },
        DataPacks: { type: 'compound', name: 'DataPacks', value: {
          Enabled: { type: 'list', name: 'Enabled', value: { type: 'string', value: enabled } },
          Disabled: { type: 'list', name: 'Disabled', value: { type: 'string', value: [] } },
        } },
      } },
    },
  }, 'big'));
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-dp-order-'));
  fs.mkdirSync(path.join(root, 'world'), { recursive: true });
  const lvl = path.join(root, 'world', 'level.dat');
  fs.writeFileSync(lvl, buildLevelDat(['vanilla', 'file/a', 'file/b', 'file/c']));

  const r1 = await D.readDatapackOrder(root, 'world');
  ok('read ok', r1.ok === true);
  ok('read enabled', JSON.stringify(r1.enabled) === JSON.stringify(['vanilla', 'file/a', 'file/b', 'file/c']));

  // Reorder: move 'file/a' up (towards the end, higher priority).
  const next = D.reorderPack(r1.enabled, 'file/a', 'up');
  const w = await D.writeDatapackOrder(root, 'world', next);
  ok('write ok', w.ok === true);
  ok('write backup created', typeof w.backup === 'string' && fs.existsSync(w.backup));

  const r2 = await D.readDatapackOrder(root, 'world');
  ok('re-read after write', r2.ok === true);
  ok('reorder persisted', JSON.stringify(r2.enabled) === JSON.stringify(['vanilla', 'file/b', 'file/a', 'file/c']));

  // Write with unchanged array -> no backup, no write.
  const w2 = await D.writeDatapackOrder(root, 'world', r2.enabled);
  ok('unchanged -> no backup', w2.ok === true && w2.backup === null);

  // Rest of the file survived (LevelName still there).
  const raw = require('zlib').gunzipSync(fs.readFileSync(lvl));
  const parsed = await nbt.parse(raw);
  ok('LevelName survived', parsed.parsed.value.Data.value.LevelName.value === 'TestWorld');

  // Missing world -> read fails cleanly.
  const rm = await D.readDatapackOrder(root, 'nope');
  ok('missing world -> error', rm.ok === false);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
})();
