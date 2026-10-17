// v6.0.0 G4: game rules read/write. Builds a REAL gzip'd level.dat with prismarine-nbt, then does a
// full round-trip: read rules, write a change, read back, verify the change landed AND the rest of the
// file (LevelName, seed) survived.
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const nbt = require('prismarine-nbt');
const G = require('../src/main/gamerules.js');

let passed = 0;
function ok(name, cond) { assert(cond, `FAIL: ${name}`); console.log(`PASS ${name}`); passed++; }

function buildLevelDat(rules) {
  const grValue = {};
  for (const [k, v] of Object.entries(rules)) grValue[k] = { type: 'string', value: String(v) };
  const root = { type: 'compound', name: '', value: {
    Data: { type: 'compound', name: 'Data', value: {
      LevelName: { type: 'string', value: 'TestWorld' },
      SpawnX: { type: 'int', value: 10 },
      GameRules: { type: 'compound', name: 'GameRules', value: grValue },
    } },
  } };
  // level.dat is 'big'-endian NBT, gzip'd. writeUncompressed takes the PROTOCOL, so gzip manually.
  return require('zlib').gzipSync(nbt.writeUncompressed(root, 'big'));
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-gr-'));
  fs.mkdirSync(path.join(root, 'world'), { recursive: true });
  const lvl = path.join(root, 'world', 'level.dat');
  fs.writeFileSync(lvl, buildLevelDat({ doDaylightCycle: 'true', keepInventory: 'false', randomTickSpeed: '3' }));

  // read
  const r = await G.readGameRules(root, 'world');
  ok('read ok', r.ok === true);
  ok('read doDaylightCycle', r.rules.doDaylightCycle === 'true');
  ok('read keepInventory', r.rules.keepInventory === 'false');
  ok('read randomTickSpeed', r.rules.randomTickSpeed === '3');

  // write a change
  const w = await G.writeGameRules(root, 'world', { keepInventory: 'true', doDaylightCycle: 'false' });
  ok('write ok', w.ok === true);
  ok('write reports 2 changed', w.changed.length === 2);
  ok('write made a backup', typeof w.backup === 'string' && fs.existsSync(w.backup));

  // read back: the change landed, and the untouched rule + other fields survived
  const r2 = await G.readGameRules(root, 'world');
  ok('readback keepInventory changed', r2.rules.keepInventory === 'true');
  ok('readback doDaylightCycle changed', r2.rules.doDaylightCycle === 'false');
  ok('readback randomTickSpeed untouched', r2.rules.randomTickSpeed === '3');
  {
    const parsed = await nbt.parse(fs.readFileSync(lvl));
    const D = nbt.simplify(parsed.parsed).Data;
    ok('LevelName survived the write', D.LevelName === 'TestWorld');
    ok('SpawnX survived the write', D.SpawnX === 10);
    ok('file is still gzip', fs.readFileSync(lvl)[0] === 0x1f && fs.readFileSync(lvl)[1] === 0x8b);
  }

  // no-op: writing the same value changes nothing and makes no backup
  const w2 = await G.writeGameRules(root, 'world', { keepInventory: 'true' });
  ok('no-op write reports nothing changed', w2.ok && w2.changed.length === 0 && w2.backup === null);

  // applyRuleChanges: rejects an unsafe key, skips an empty value
  {
    const res = G.applyRuleChanges({ a: '1' }, { 'bad key': 'x', b: '  ', c: '2' });
    ok('unsafe key skipped', res.skipped.includes('bad key'));
    ok('empty value skipped', res.skipped.includes('b'));
    ok('valid change applied', res.changed.some(c => c.name === 'c' && c.value === '2'));
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
