// tests/mods-index.test.js — mod jar texture lookup (v6.0.0 Track B follow-up).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ModsIndex, candidateEntries, folderSignature, namespacesIn } = require('../src/main/mods-index.js');
const { splitModFile } = require('../src/main/textures.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('async test not awaited'); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
}

// Minimal STORED-entry ZIP builder (same shape as jar-reader.test.js).
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const lp = Buffer.concat(locals), cp = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cp.length, 12);
  eocd.writeUInt32LE(lp.length, 16);
  return Buffer.concat([lp, cp, eocd]);
}

// --- pure helpers ---
t('candidateEntries tries item, items, then block spellings', () => {
  const e = candidateEntries('create', 'wrench');
  assert.deepStrictEqual(e, [
    'assets/create/textures/item/wrench.png',
    'assets/create/textures/items/wrench.png',
    'assets/create/textures/block/wrench.png',
    'assets/create/textures/blocks/wrench.png',
  ]);
});

t('candidateEntries rejects path tricks', () => {
  assert.deepStrictEqual(candidateEntries('../../etc', 'x'), []);
  assert.deepStrictEqual(candidateEntries('create', '../secret'), []);
});

t('namespacesIn reads the first path segment', () => {
  const ns = namespacesIn(['assets/create/textures/item/wrench.png', 'assets/ae2/models/item/x.json', 'META-INF/MANIFEST.MF']);
  assert.deepStrictEqual(ns.sort(), ['ae2', 'create']);
});

t('folderSignature empty for a missing dir', () => {
  assert.strictEqual(folderSignature(path.join(os.tmpdir(), 'nope-' + Date.now())), '');
});

// --- class behaviour over a real temp folder ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-'));
try {
  const jarA = makeZip([
    ['assets/create/textures/item/wrench.png', Buffer.from('WRENCH')],
    ['assets/create/textures/item/cog.png', Buffer.from('COG')],
  ]);
  fs.writeFileSync(path.join(dir, 'create-1.0.jar'), jarA);
  const jarB = makeZip([
    ['assets/ae2/textures/items/cable.png', Buffer.from('CABLE')],
  ]);
  fs.writeFileSync(path.join(dir, 'ae2-2.0.jar'), jarB);
  // A BlockItem: the mod registers a block and exposes it as an item, so the texture lives under
  // textures/block/, not textures/item/. This is the shape the block fallback exists for.
  const jarC = makeZip([
    ['assets/create/textures/block/cogwheel.png', Buffer.from('COGWHEEL')],
  ]);
  fs.writeFileSync(path.join(dir, 'create-blockitem-1.0.jar'), jarC);

  const idx = new ModsIndex();
  idx.setModsDir(dir);
  idx.refresh();

  t('index finds every namespace', () => {
    assert.deepStrictEqual(idx.knownNamespaces(), ['ae2', 'create']);
  });

  t('readTexture finds item/ spelling', () => {
    assert.strictEqual(idx.readTexture('create', 'wrench').toString(), 'WRENCH');
  });

  t('readTexture finds items/ spelling (ae2)', () => {
    assert.strictEqual(idx.readTexture('ae2', 'cable').toString(), 'CABLE');
  });

  t('readTexture finds a BlockItem under textures/block/ (create cogwheel)', () => {
    assert.strictEqual(idx.readTexture('create', 'cogwheel').toString(), 'COGWHEEL');
  });

  t('an item/ texture still wins over a block/ texture of the same name', () => {
    // Both spellings exist for namespace create after the fixture above, but only cogwheel has a
    // block texture; wrench has an item texture. Reading wrench must not be shadowed.
    assert.strictEqual(idx.readTexture('create', 'wrench').toString(), 'WRENCH');
  });

  t('readTexture miss returns null', () => {
    assert.strictEqual(idx.readTexture('create', 'missing'), null);
  });

  t('readTexture unknown namespace returns null', () => {
    assert.strictEqual(idx.readTexture('nope', 'wrench'), null);
  });

  t('second read is served from the extract cache', () => {
    const a = idx.readTexture('create', 'wrench');
    const b = idx.readTexture('create', 'wrench');
    assert.strictEqual(a, b);
  });

  t('a new jar is picked up after the signature changes', () => {
    fs.writeFileSync(path.join(dir, 'botania-3.0.jar'), makeZip([
      ['assets/botania/textures/item/mana_pearl.png', Buffer.from('PEARL')],
    ]));
    assert.strictEqual(idx.readTexture('botania', 'mana_pearl').toString(), 'PEARL');
    assert.ok(idx.knownNamespaces().includes('botania'));
  });

  t('setModsDir(null) disables lookups', () => {
    const empty = new ModsIndex();
    empty.setModsDir(null);
    assert.strictEqual(empty.readTexture('create', 'wrench'), null);
  });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

// --- splitModFile in textures.js ---
t('splitModFile splits on the tilde', () => {
  assert.deepStrictEqual(splitModFile('create~wrench.png'), { namespace: 'create', name: 'wrench' });
});

t('splitModFile keeps underscores on both sides', () => {
  assert.deepStrictEqual(splitModFile('cofh_core~diamond_sword.png'), { namespace: 'cofh_core', name: 'diamond_sword' });
});

t('splitModFile keeps a slashed name', () => {
  assert.deepStrictEqual(splitModFile('create~gui/icon.png'), { namespace: 'create', name: 'gui/icon' });
});

t('splitModFile rejects a missing side', () => {
  assert.strictEqual(splitModFile('~x.png'), null);
  assert.strictEqual(splitModFile('create~.png'), null);
  assert.strictEqual(splitModFile('nopart.png'), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
